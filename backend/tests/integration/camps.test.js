'use strict';

const { app, request, pool, insertUser, createCampFixture } = require('../helpers/api');

function campBody(overrides = {}) {
  return {
    title: 'Ward Screening Camp',
    venue: 'Ward Community Hall',
    address: '12th Main Road, Indiranagar',
    city: 'Bengaluru',
    campDate: '2099-06-15',
    startTime: '09:00',
    endTime: '12:00',
    slotDurationMins: 30,
    totalCapacity: 24,
    physicalCapacity: 30,
    status: 'PUBLISHED',
    ...overrides,
  };
}

describe('camps — organizer CRUD', () => {
  it('creates a camp and partitions capacity across contiguous slots', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const response = await request(app)
      .post('/api/camps')
      .set('Authorization', `Bearer ${organizer.token}`)
      .send(campBody())
      .expect(201);

    const { camp, slotPlan } = response.body;
    expect(camp.status).toBe('PUBLISHED');
    expect(slotPlan).toHaveLength(6);
    expect(slotPlan.reduce((sum, slot) => sum + slot.capacity, 0)).toBe(24);
    expect(camp.slots).toHaveLength(6);
    expect(camp.slots[0].startTime).toBe('09:00:00');
    expect(camp.slots[5].endTime).toBe('12:00:00');
  });

  it('rejects invalid windows and missing fields with 400', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });

    const invalid = await request(app)
      .post('/api/camps')
      .set('Authorization', `Bearer ${organizer.token}`)
      .send(campBody({ endTime: '08:00' }))
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
    expect(invalid.body.details.issues[0].path).toBe('endTime');

    await request(app)
      .post('/api/camps')
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ title: 'Only a title' })
      .expect(400);
  });

  it('forbids patients from creating camps', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const response = await request(app)
      .post('/api/camps')
      .set('Authorization', `Bearer ${patient.token}`)
      .send(campBody())
      .expect(403);
    expect(response.body.code).toBe('ROLE_FORBIDDEN');
  });

  it('updates descriptive fields but refuses to delete a camp with bookings', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const created = await request(app)
      .post('/api/camps')
      .set('Authorization', `Bearer ${organizer.token}`)
      .send(campBody())
      .expect(201);
    const campId = created.body.camp.id;

    const updated = await request(app)
      .patch(`/api/camps/${campId}`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ venue: 'Renamed Hall', descriptionEn: 'Updated description' })
      .expect(200);
    expect(updated.body.camp.venue).toBe('Renamed Hall');
    expect(updated.body.camp.descriptionEn).toBe('Updated description');

    // Empty camps are deletable.
    await request(app)
      .delete(`/api/camps/${campId}`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);

    // Camps with history are not.
    const fixture = await createCampFixture();
    // Add a booking so the camp has history.
    const bookingPatient = await insertUser({ role: 'PATIENT' });
    await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${bookingPatient.token}`)
      .send({})
      .expect(201);
    const blocked = await request(app)
      .delete(`/api/camps/${fixture.campId}`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(409);
    expect(blocked.body.code).toBe('CAMP_HAS_BOOKINGS');
  });

  it('paginates the public camp list with metadata', async () => {
    const response = await request(app).get('/api/camps?page=1&pageSize=2').expect(200);
    expect(response.body.camps.length).toBeLessThanOrEqual(2);
    expect(response.body.pagination).toMatchObject({ page: 1, pageSize: 2 });
    expect(response.body.pagination.total).toBeGreaterThan(2);

    await request(app).get('/api/camps?page=0').expect(400);
    await request(app).get('/api/camps?page=1&pageSize=500').expect(400);
  });

  it('lists camps in a fixed number of queries (no N+1)', async () => {
    const original = pool.query.bind(pool);
    let queries = 0;
    pool.query = (...args) => {
      queries += 1;
      return original(...args);
    };
    try {
      const response = await request(app).get('/api/camps?page=1&pageSize=5').expect(200);
      expect(response.body.camps.length).toBeGreaterThan(0);
      // camps + count + slots + staff = 4
      expect(queries).toBeLessThanOrEqual(5);
    } finally {
      pool.query = original;
    }
  });
});
