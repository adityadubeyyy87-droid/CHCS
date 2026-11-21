'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  countRows,
} = require('../helpers/api');

async function addSlot(campId, { index = 2, start = '11:00:00', end = '12:00:00', capacity = 4 } = {}) {
  const [result] = await pool.query(
    `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [campId, index, start, end, capacity],
  );
  return result.insertId;
}

async function remindersFor(bookingId) {
  const [rows] = await pool.query(
    'SELECT * FROM reminders WHERE booking_id = ? ORDER BY type, id',
    [bookingId],
  );
  return rows;
}

describe('booking integrity', () => {
  it('confirms a seat, increments the slot and queues 24h + 2h reminders', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 3, startsInHours: 96 });

    const response = await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ travelMode: 'WALK', pledge: true })
      .expect(201);

    expect(response.body.booking.status).toBe('CONFIRMED');
    expect(response.body.booking.tokenNumber).toMatch(/^[A-F]-\d{6}$/);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(1);

    const reminders = await remindersFor(response.body.booking.id);
    expect(reminders.map((row) => row.type).sort()).toEqual(['REMINDER_24H', 'REMINDER_2H']);
    expect(reminders.every((row) => row.status === 'PENDING')).toBe(true);
  });

  it('refuses a second booking on the same slot and on another slot of the same camp', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2, startsInHours: 96 });
    const secondSlot = await addSlot(fixture.campId);

    await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(201);

    const sameSlot = await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(409);
    expect(sameSlot.body.code).toBe('DUPLICATE_BOOKING');

    const otherSlot = await request(app)
      .post(`/api/slots/${secondSlot}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(409);
    expect(otherSlot.body.code).toBe('ALREADY_BOOKED_IN_CAMP');
  });

  it('enforces one active booking per camp at the database level too', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const secondSlot = await addSlot(fixture.campId);

    await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(201);

    await expect(
      pool.query(
        `INSERT INTO bookings (slot_id, camp_id, patient_id, qr_token, token_number, status)
         VALUES (?, ?, ?, ?, ?, 'CONFIRMED')`,
        [secondSlot, fixture.campId, patient.id, `RAW-${Date.now()}`, `R-${Date.now()}`],
      ),
    ).rejects.toThrow(/uq_one_active_booking_per_camp|Duplicate entry/);
  });

  it('moves a booking atomically and re-queues reminders for the new time', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    // Fixed times: the rescheduled slot must be later than the original one,
    // otherwise the re-queued reminders move earlier and the assertion below
    // becomes dependent on the hour of day the suite happens to run.
    const fixture = await createCampFixture({ capacity: 3, startsInHours: 96, startTime: '09:00:00', endTime: '14:00:00' });
    const secondSlot = await addSlot(fixture.campId, { start: '12:00:00', end: '13:00:00' });

    const booked = await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(201);
    const bookingId = booked.body.booking.id;
    const before = await remindersFor(bookingId);

    const moved = await request(app)
      .patch(`/api/bookings/${bookingId}/reschedule`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ slotId: secondSlot })
      .expect(200);

    expect(moved.body.status).toBe('RESCHEDULED');
    expect(moved.body.fromSlotId).toBe(fixture.slotId);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(0);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [secondSlot])).toBe(1);
    expect(await countRows('SELECT slot_id FROM bookings WHERE id = ?', [bookingId])).toBe(secondSlot);

    const after = await remindersFor(bookingId);
    expect(after).toHaveLength(2);
    for (const row of after) {
      const previous = before.find((item) => item.type === row.type);
      expect(new Date(row.send_at).getTime()).toBeGreaterThan(new Date(previous.send_at).getTime());
    }
  });

  it('refuses to reschedule into a full slot', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const other = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2, startsInHours: 96 });
    const fullSlot = await addSlot(fixture.campId, { capacity: 1 });

    await request(app)
      .post(`/api/slots/${fullSlot}/book`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({})
      .expect(201);

    const booked = await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(201);

    const response = await request(app)
      .patch(`/api/bookings/${booked.body.booking.id}/reschedule`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ slotId: fullSlot })
      .expect(409);
    expect(response.body.code).toBe('SLOT_FULL');
  });

  it('cancels, frees the seat and cancels queued reminders', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2, startsInHours: 96 });

    const booked = await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(201);

    await request(app)
      .patch(`/api/bookings/${booked.body.booking.id}/cancel`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);

    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(0);
    const reminders = await remindersFor(booked.body.booking.id);
    expect(reminders.every((row) => row.status === 'CANCELLED')).toBe(true);

    // Cancelling twice is rejected, not silently repeated.
    await request(app)
      .patch(`/api/bookings/${booked.body.booking.id}/cancel`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(409);
  });

  it('offers the FIFO waitlist when the slot is full', async () => {
    const fixture = await createCampFixture({ capacity: 1, startsInHours: 96 });
    const first = await insertUser({ role: 'PATIENT' });
    const second = await insertUser({ role: 'PATIENT' });

    await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${first.token}`)
      .send({})
      .expect(201);

    const waitlisted = await request(app)
      .post(`/api/slots/${fixture.slotId}/book`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({})
      .expect(202);

    expect(waitlisted.body).toMatchObject({ status: 'WAITLISTED' });
    expect(waitlisted.body.waitlist.position).toBe(1);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(1);
  });

  it('rejects bookings for a camp that is not published', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const draft = await createCampFixture({ status: 'DRAFT' });

    const response = await request(app)
      .post(`/api/slots/${draft.slotId}/book`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({})
      .expect(409);
    expect(response.body.code).toBe('CAMP_NOT_OPEN');
  });
});
