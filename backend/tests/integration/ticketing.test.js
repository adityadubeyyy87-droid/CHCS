'use strict';

/**
 * Ticket QR, Google Maps navigation and transactional notification coverage.
 * These exercise the real API and real MySQL rows: no mocks of the database.
 */

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

async function notificationsFor(bookingId, type) {
  const [rows] = await pool.query(
    'SELECT * FROM notifications_log WHERE booking_id = ? AND type = ? ORDER BY channel',
    [bookingId, type],
  );
  return rows;
}

describe('ticket QR, Google Maps navigation and notifications', () => {
  it('issues an unguessable ticket token and a Maps QR payload', async () => {
    const patient = await insertUser({ role: 'PATIENT', name: 'Meera Sharma' });
    const fixture = await createCampFixture({ capacity: 3 });

    const response = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const booking = response.body.booking;

    // 60 bits of base32 entropy, not the old six-digit guessable pass.
    expect(booking.qrToken).toMatch(/^CHSC-BLR-[A-HJ-NP-Z2-9]{12}$/);
    expect(booking.mapsUrl).toContain('https://www.google.com/maps/dir/?api=1');
    expect(booking.mapsUrl).toContain('destination=');
    expect(booking.qrPayload).toBe(`${booking.mapsUrl}#chsc=${booking.qrToken}`);

    const destination = decodeURIComponent(
      booking.mapsUrl.split('destination=')[1].split('&')[0],
    );
    expect(destination).toContain('Test Venue');
    expect(destination).toContain('Test address');
  });

  it('checks a patient in by scanning the Google Maps QR payload', async () => {
    const doctor = await insertUser({ role: 'DOCTOR' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const created = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    await assignStaff(doctor, fixture.campId, 'DOCTOR');

    const response = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: created.body.booking.qrPayload })
      .expect(200);

    expect(response.body.status).toBe('CHECKED_IN');
    expect(response.body.booking.id).toBe(created.body.booking.id);

    // The same scan again is idempotent, not a duplicate check-in.
    const again = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ qrToken: created.body.booking.qrPayload })
      .expect(200);
    expect(again.body.status).toBe('ALREADY_CHECKED_IN');
  });

  it('redirects the SMS short link to the real Google Maps destination', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const created = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const { qrToken } = created.body.booking;

    const response = await request(app).get(`/n/${qrToken}`).expect(302);
    expect(response.headers.location).toContain('https://www.google.com/maps/dir/?api=1');
    expect(response.headers.location).toContain('destination=');
    expect(response.headers['cache-control']).toBe('no-store');

    await request(app).get('/n/CHSC-BLR-DOESNOTEXIST').expect(404);
  });

  it('confirmation notifications carry booking id, venue, address, date and navigation', async () => {
    const patient = await insertUser({ role: 'PATIENT', name: 'Meera Sharma' });
    const fixture = await createCampFixture({ capacity: 3 });
    const created = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const booking = created.body.booking;

    const rows = await notificationsFor(booking.id, 'BOOKING_CONFIRMED');
    expect(rows).toHaveLength(2);
    const sms = rows.find((row) => row.channel === 'SMS');
    const email = rows.find((row) => row.channel === 'EMAIL');

    for (const row of [sms, email]) {
      expect(row.status).toBe('SIMULATED'); // honest sandbox, never claimed as sent
      expect(row.message).toContain(`#${booking.id}`);
      expect(row.message).toContain(booking.tokenNumber);
      expect(row.message).toContain('Test Venue');
      expect(row.message).toContain('Test address');
      expect(row.message).toContain('Bengaluru');
      expect(row.dedupe_key).toBeTruthy();
    }

    // SMS: short backend navigation link, not a long Maps URL.
    expect(sms.message).toContain(`/n/${booking.qrToken}`);
    expect(sms.message.length).toBeLessThanOrEqual(480);

    // Email: full Maps URL and an inline ticket QR attachment reference.
    expect(email.subject).toContain('appointment confirmed');
    expect(email.message).toContain(booking.mapsUrl);

    const payload = typeof email.payload === 'string' ? JSON.parse(email.payload) : email.payload;
    expect(payload.qrToken).toBe(booking.qrToken);
    expect(payload.mapsUrl).toBe(booking.mapsUrl);
    expect(payload.shortUrl).toContain(`/n/${booking.qrToken}`);
  });

  it('does not duplicate the confirmation rows when confirm is retried', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const created = await hold({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const bookingId = created.body.booking.id;

    await confirm({ token: patient.token, bookingId }).expect(200);
    await confirm({ token: patient.token, bookingId }).expect(200);

    expect(await countRows(
      'SELECT COUNT(*) FROM notifications_log WHERE booking_id = ? AND type = ?',
      [bookingId, 'BOOKING_CONFIRMED'],
    )).toBe(2);
  });

  it('notifies both channels with the new time when a booking is rescheduled', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 3, startsInHours: 96 });
    const created = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const bookingId = created.body.booking.id;

    const [extra] = await pool.query(
      `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
       VALUES (?, 2, '15:00:00', '15:30:00', 3, 0)`,
      [fixture.campId],
    );

    await request(app)
      .patch(`/api/bookings/${bookingId}/reschedule`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ slotId: extra.insertId })
      .expect(200);

    const rows = await notificationsFor(bookingId, 'RESCHEDULED');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.channel).sort()).toEqual(['EMAIL', 'SMS']);
    for (const row of rows) {
      expect(row.status).toBe('SIMULATED');
      expect(row.message).toContain('3:00 PM');
      expect(row.message).toContain(`#${bookingId}`);
      expect(row.dedupe_key).toBeTruthy();
    }
  });

  it('lets an organizer set camp coordinates and exposes a precise Maps destination', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const fixture = await createCampFixture({ capacity: 2 });

    const updated = await request(app)
      .patch(`/api/camps/${fixture.campId}`)
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ latitude: 12.9569, longitude: 77.7011 })
      .expect(200);

    expect(updated.body.camp.latitude).toBe(12.9569);
    expect(updated.body.camp.longitude).toBe(77.7011);
    expect(updated.body.camp.mapsUrl).toContain('destination=12.9569%2C77.7011');

    const publicCamps = await request(app).get('/api/camps').expect(200);
    const found = publicCamps.body.camps.find((camp) => camp.id === fixture.campId);
    expect(found.mapsUrl).toContain('destination=12.9569%2C77.7011');
  });

  it('refuses an admin retry while the provider is still an honest sandbox', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });
    const created = await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const [row] = await notificationsFor(created.body.booking.id, 'BOOKING_CONFIRMED');

    const response = await request(app)
      .post(`/api/admin/notifications/${row.id}/retry`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(409);

    expect(response.body.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(response.body.details.channel).toBe(row.channel);
  });
});
