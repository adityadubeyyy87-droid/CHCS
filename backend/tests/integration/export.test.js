'use strict';

const { app, request, pool, insertUser, createCampFixture, book } = require('../helpers/api');

describe('CSV export', () => {
  it('exports camp attendance report as CSV', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const fixture = await createCampFixture({ organizerId: organizer.id, capacity: 2 });

    // Book and check in one patient; leave another confirmed (will be no-show on close-out)
    const attended = await insertUser({ role: 'PATIENT' });
    const absent = await insertUser({ role: 'PATIENT' });
    const b1 = (await book({ token: attended.token, slotId: fixture.slotId }).expect(201)).body
      .booking;
    const b2 = (await book({ token: absent.token, slotId: fixture.slotId }).expect(201)).body
      .booking;

    await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ qrToken: b1.qrToken })
      .expect(200);

    await request(app)
      .post(`/api/camps/${fixture.campId}/close-out`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);

    const res = await request(app)
      .get('/api/admin/reports/export.csv')
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('Camp,Venue,Date,Status,Capacity,Booked,Attended,No-Shows,Attendance Rate %');
    expect(res.text).toContain('Test Venue');
    expect(res.text).toContain('COMPLETED');
  });

  it('rejects CSV export from non-organizer', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    await request(app)
      .get('/api/admin/reports/export.csv')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(403);
  });
});
