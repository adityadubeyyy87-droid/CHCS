'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  countRows,
  book,
} = require('../helpers/api');
const { remindersEngine } = require('../../server');

describe('P0/P1 security and correctness regressions', () => {
  it('reloads the current role from the DB instead of trusting stale JWT claims', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    await pool.query('UPDATE users SET role = ? WHERE id = ?', ['ORGANIZER', user.id]);

    const campBody = {
      title: 'Role Reload Camp',
      venue: 'Town Hall',
      address: '1 Main Road, Bengaluru',
      campDate: '2099-09-09',
      startTime: '09:00',
      endTime: '10:00',
      slotDurationMins: 60,
      totalCapacity: 5,
      status: 'PUBLISHED',
    };
    await request(app)
      .post('/api/camps')
      .set('Authorization', `Bearer ${user.token}`)
      .send(campBody)
      .expect(201);

    await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [user.id]);
    const inactive = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(401);
    expect(['AUTH_INVALID', 'USER_INACTIVE']).toContain(inactive.body.code);
  });

  it('never exposes staff email or phone on the public staff endpoint', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR', name: 'Dr Private' });
    const fixture = await createCampFixture();

    await request(app)
      .post(`/api/camps/${fixture.campId}/staff`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({
        userId: doctor.id,
        roleAtCamp: 'DOCTOR',
        shiftStart: '09:00',
        shiftEnd: '12:00',
      })
      .expect(201);

    const response = await request(app)
      .get(`/api/camps/${fixture.campId}/staff`)
      .expect(200);
    expect(response.body.staff.length).toBeGreaterThan(0);
    for (const member of response.body.staff) {
      expect(member).not.toHaveProperty('email');
      expect(member).not.toHaveProperty('phone');
    }
  });

  it('gives organizers a PII-free assignable-user list without a 403', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR', name: 'Dr Assignable' });
    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);
    expect(response.body.users.some((u) => u.id === doctor.id && u.name === 'Dr Assignable')).toBe(true);
    for (const user of response.body.users) {
      expect(user).not.toHaveProperty('email');
      expect(user).not.toHaveProperty('phone');
      expect(user).not.toHaveProperty('ageGroup');
    }
    const patient = await insertUser({ role: 'PATIENT' });
    await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(403);
  });

  it('refuses a destructive slot rebuild even with force=true', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 4, startsInHours: 96 });
    const booked = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const bookingId = booked.body.booking.id;

    const response = await request(app)
      .post(`/api/camps/${fixture.campId}/generate-slots`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({
        startTime: fixture.startTime.slice(0, 5),
        endTime: fixture.endTime.slice(0, 5),
        slotDurationMins: 60,
        totalCapacity: 4,
        force: true,
      })
      .expect(409);
    expect(response.body.code).toBe('DESTRUCTIVE_REBUILD_BLOCKED');
    expect(
      await countRows('SELECT COUNT(*) AS n FROM bookings WHERE id = ?', [bookingId]),
    ).toBe(1);
  });

  it('denies reschedule authority to clinical roles and to non-published camps', async () => {
    const doctor = await insertUser({ role: 'DOCTOR' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 4, startsInHours: 96 });
    const booked = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const bookingId = booked.body.booking.id;

    await request(app)
      .patch(`/api/bookings/${bookingId}/reschedule`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ slotId: fixture.slotId })
      .expect(403);

    await pool.query("UPDATE camps SET status = 'COMPLETED' WHERE id = ?", [fixture.campId]);
    const closed = await request(app)
      .patch(`/api/bookings/${bookingId}/reschedule`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ slotId: fixture.slotId })
      .expect(409);
    expect(closed.body.code).toBe('CAMP_NOT_OPEN');
  });

  it('anonymises user PII in place on self-purge and writes an audit record', async () => {
    const patient = await insertUser({ role: 'PATIENT', name: 'Erase Me' });
    const response = await request(app)
      .delete('/api/users/me/purge')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);
    expect(response.body.purged).toBe(true);

    const [[row]] = await pool.query(
      'SELECT name, email, phone, is_active FROM users WHERE id = ?',
      [patient.id],
    );
    expect(row).toBeDefined();
    expect(row.name).toBe('Purged User');
    expect(row.email).not.toBe(patient.email);
    expect(row.phone).not.toBe(patient.phone);
    expect(Number(row.is_active)).toBe(0);

    const auditCount = await countRows(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'PURGE_USER_DATA' AND target_id = ?",
      [patient.id],
    );
    expect(auditCount).toBe(1);
  });

  it('validates capacity advisor query parameters instead of coercing NaN', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    for (const query of ['physicalCapacity=abc', 'physicalCapacity=-5', 'alphaMax=NaN', 'alphaMax=9']) {
      const response = await request(app)
        .get(`/api/admin/capacity-advisor?${query}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('does not multiply CSV capacity/attendance by joining slots and bookings', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const patientA = await insertUser({ role: 'PATIENT' });
    const patientB = await insertUser({ role: 'PATIENT' });
    const title = `CSV Fanout ${Date.now()}`;
    const fixture = await createCampFixture({ capacity: 4, startsInHours: 96, title });
    await pool.query(
      `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
       VALUES (?, 2, ?, ?, 4, 0)`,
      [fixture.campId, '08:00:00', '09:00:00'],
    );
    await book({ token: patientA.token, slotId: fixture.slotId }).expect(201);
    await book({ token: patientB.token, slotId: fixture.slotId }).expect(201);

    const response = await request(app)
      .get('/api/admin/reports/export.csv')
      .set('Authorization', `Bearer ${organizer.token}`)
      .expect(200);
    const rows = response.text.replace(/^\uFEFF/, '').split('\n').filter(Boolean);
    const header = rows[0].split(',');
    const capacityIndex = header.indexOf('Capacity');
    const bookedIndex = header.indexOf('Booked');
    const titleIndex = header.indexOf('Camp');
    const match = rows
      .slice(1)
      .map((row) => row.split(','))
      .find((cols) => cols[titleIndex] && cols[titleIndex].includes(title));
    expect(match).toBeDefined();
    expect(Number(match[capacityIndex])).toBe(8);
    expect(Number(match[bookedIndex])).toBe(2);
  });

  it('never resurrects a SENT reminder when a booking is rescheduled', async () => {
    const conn = await pool.getConnection();
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 3, startsInHours: 96 });
    const booked = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const bookingId = booked.body.booking.id;
    await conn.query("UPDATE reminders SET status = 'SENT' WHERE booking_id = ? AND type = 'REMINDER_24H'", [bookingId]);

    await remindersEngine.rescheduleForBooking(conn, {
      bookingId,
      campDate: fixture.campDate,
      startTime: fixture.startTime,
    });
    const [[reminder]] = await conn.query(
      "SELECT status FROM reminders WHERE booking_id = ? AND type = 'REMINDER_24H'",
      [bookingId],
    );
    conn.release();
    expect(reminder.status).toBe('SENT');
  });
});
