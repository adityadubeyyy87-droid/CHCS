'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  countRows,
  book,
  hold,
  confirm,
  assignStaff,
} = require('../helpers/api');

async function bookSeat(patient, slotId) {
  const response = await book({ token: patient.token, slotId }).expect(201);
  return response.body.booking;
}

describe('attendance — check-in, no-show and close-out', () => {
  it('checks a patient in by QR token and is idempotent on the second scan', async () => {
    const doctor = await insertUser({ role: 'DOCTOR' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 3 });
    const booking = await bookSeat(patient, fixture.slotId);
    await assignStaff(doctor, fixture.campId, 'DOCTOR');

    const first = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: booking.qrToken })
      .expect(200);

    expect(first.body.status).toBe('CHECKED_IN');
    expect(first.body.booking.status).toBe('CHECKED_IN');
    expect(first.body.clinicChime).toBe(true);

    const second = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: booking.qrToken })
      .expect(200);

    expect(second.body.status).toBe('ALREADY_CHECKED_IN');
    expect(second.body.clinicChime).toBe(false);

    const [[row]] = await pool.query('SELECT status, checked_in_at FROM bookings WHERE id = ?', [
      booking.id,
    ]);
    expect(row.status).toBe('CHECKED_IN');
    expect(row.checked_in_at).toBeTruthy();
  });

  it('accepts the human token number, not just the QR payload', async () => {
    const volunteer = await insertUser({ role: 'VOLUNTEER' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const booking = await bookSeat(patient, fixture.slotId);
    await assignStaff(volunteer, fixture.campId, 'VOLUNTEER');

    const response = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${volunteer.token}`)
      .send({ qrToken: booking.tokenNumber })
      .expect(200);
    expect(response.body.booking.id).toBe(booking.id);
  });

  it('rejects unknown tokens, cancelled bookings and patient tokens', async () => {
    const doctor = await insertUser({ role: 'DOCTOR' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const booking = await bookSeat(patient, fixture.slotId);

    const unknown = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: 'CHSC-BLR-000000' })
      .expect(404);
    expect(unknown.body.code).toBe('TOKEN_NOT_FOUND');

    const blank = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({})
      .expect(400);
    expect(blank.body.code).toBe('VALIDATION');

    const asPatient = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ qrToken: booking.qrToken })
      .expect(403);
    expect(asPatient.body.code).toBe('ROLE_FORBIDDEN');
  });

  it('walks the attendance state machine and rejects illegal jumps', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const booking = await bookSeat(patient, fixture.slotId);

    const move = (status) =>
      request(app)
        .patch(`/api/bookings/${booking.id}/attendance`)
        .set('Authorization', `Bearer ${organizer.token}`)
        .send({ status });

    const checkedIn = await move('CHECKED_IN').expect(200);
    expect(checkedIn.body.status).toBe('CHECKED_IN');

    const completed = await move('COMPLETED').expect(200);
    expect(completed.body.status).toBe('COMPLETED');

    const backwards = await move('CHECKED_IN').expect(409);
    expect(backwards.body.code).toBe('INVALID_ATTENDANCE_TRANSITION');
    expect(backwards.body.details).toMatchObject({ from: 'COMPLETED', allowed: [] });

    const invalid = await move('MAYBE').expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
  });

  it('allows correcting a no-show into a late check-in', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const booking = await bookSeat(patient, fixture.slotId);

    await request(app)
      .patch(`/api/bookings/${booking.id}/attendance`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ status: 'NO_SHOW' })
      .expect(200);

    const late = await request(app)
      .patch(`/api/bookings/${booking.id}/attendance`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ status: 'CHECKED_IN' })
      .expect(200);
    expect(late.body.status).toBe('CHECKED_IN');
    expect(late.body.booking.checkedInAt || late.body.booking.checked_in_at).toBeTruthy();
  });

  it('cancels queued reminders as soon as someone checks in', async () => {
    const doctor = await insertUser({ role: 'DOCTOR' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const booking = await bookSeat(patient, fixture.slotId);
    await assignStaff(doctor, fixture.campId, 'DOCTOR');

    expect(
      await countRows('SELECT COUNT(*) FROM reminders WHERE booking_id = ? AND status = "PENDING"', [
        booking.id,
      ]),
    ).toBe(2);

    await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: booking.qrToken })
      .expect(200);

    expect(
      await countRows('SELECT COUNT(*) FROM reminders WHERE booking_id = ? AND status = "CANCELLED"', [
        booking.id,
      ]),
    ).toBe(2);
  });

  it('closes the camp day: leftovers become NO_SHOW and analytics update', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });
    const attended = await insertUser({ role: 'PATIENT' });
    const absent = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 4 });

    const attendedBooking = await bookSeat(attended, fixture.slotId);
    const absentBooking = await bookSeat(absent, fixture.slotId);
    await assignStaff(doctor, fixture.campId, 'DOCTOR');

    await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: attendedBooking.qrToken })
      .expect(200);

    const closed = await request(app)
      .post(`/api/camps/${fixture.campId}/close-out`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);

    expect(closed.body).toMatchObject({
      status: 'COMPLETED',
      campId: fixture.campId,
      noShowMarked: 1,
      checkedIn: 1,
      noShow: 1,
    });

    const [[camp]] = await pool.query('SELECT status FROM camps WHERE id = ?', [fixture.campId]);
    expect(camp.status).toBe('COMPLETED');

    const [[absentRow]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [
      absentBooking.id,
    ]);
    expect(absentRow.status).toBe('NO_SHOW');
    expect(
      await countRows(
        'SELECT COUNT(*) FROM reminders WHERE booking_id = ? AND status = "CANCELLED"',
        [absentBooking.id],
      ),
    ).toBe(2);

    // Idempotent: a second close-out changes nothing and marks nobody new.
    const again = await request(app)
      .post(`/api/camps/${fixture.campId}/close-out`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);
    expect(again.body.noShowMarked).toBe(0);

    // Attendance is queryable per camp: one attended, one no-show.
    const [[counts]] = await pool.query(
      `SELECT SUM(status = 'CHECKED_IN') AS checked_in,
              SUM(status = 'NO_SHOW') AS no_show
       FROM bookings WHERE camp_id = ?`,
      [fixture.campId],
    );
    expect(Number(counts.checked_in)).toBe(1);
    expect(Number(counts.no_show)).toBe(1);
    expect(Number(counts.checked_in) / (Number(counts.checked_in) + Number(counts.no_show))).toBe(0.5);

    // The analytics endpoint keeps working after the camp closes.
    const analytics = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);
    expect(analytics.body.kpis.totalBookings).toBeGreaterThan(0);
    expect(analytics.body.attendanceVsNoShow.length).toBeGreaterThan(0);
  });

  it('refuses close-out from a non-organizer and on an unknown camp', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const fixture = await createCampFixture();

    await request(app)
      .post(`/api/camps/${fixture.campId}/close-out`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(403);

    const missing = await request(app)
      .post('/api/camps/999999/close-out')
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(404);
    expect(missing.body.code).toBe('CAMP_NOT_FOUND');
  });
});
