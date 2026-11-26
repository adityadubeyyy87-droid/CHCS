'use strict';

/**
 * Strict-live regressions: no demo surfaces, no fabricated data, honest sandbox
 * labels, PII-free promotion payloads, and a proof-only concurrency endpoint.
 */

const {
  app,
  request,
  pool,
  providers,
  providerMeta,
  insertNotification,
  insertUser,
  createCampFixture,
  countRows,
  book,
  hold,
  confirm,
} = require('../helpers/api');
const { createProviders } = require('../../lib/providers');

describe('strict live / real data only', () => {
  it('health reports a strict live backend with no simulated data', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      demoMode: false,
      database: 'connected',
      socket: 'ready',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/simulated|sample|mock/i);
  });

  it('returns 404 for every removed demo endpoint', async () => {
    const cases = [
      ['post', '/api/auth/demo-login', { role: 'ADMIN' }],
      ['post', '/api/demo/rush', { campId: 1 }],
      ['get', '/api/demo/status', undefined],
      ['post', '/api/demo/reset', {}],
    ];
    for (const [method, url, body] of cases) {
      const call = request(app)[method](url);
      const response = body === undefined ? await call : await call.send(body);
      expect(response.status).toBe(404);
      expect(response.body.code).not.toBe('USER_EXISTS');
    }
  });

  it('labels sandbox providers honestly and never claims a real delivery', async () => {
    const sandbox = createProviders(
      { SMTP_HOST: '', SMTP_USER: '', FAST2SMS_API_KEY: '' },
      { quiet: true },
    );
    expect(sandbox.email).toMatchObject({ name: 'Email Sandbox', live: false });
    expect(sandbox.sms).toMatchObject({ name: 'SMS Sandbox', live: false });
    expect(sandbox.push).toMatchObject({ name: 'Web Push Sandbox', live: false });
    expect(await sandbox.email.send({ to: 'patient@example.org', subject: 'x', text: 'x' })).toMatchObject({
      simulated: true,
      provider: 'Email Sandbox',
    });
    expect(await sandbox.sms.send({ to: '9999999999', text: 'x' })).toMatchObject({
      simulated: true,
      provider: 'SMS Sandbox',
    });
    expect(await sandbox.push.send({ subscriptions: [], subject: 'x', text: 'x' })).toMatchObject({
      simulated: true,
      provider: 'Web Push Sandbox',
      accepted: 0,
    });

    const live = createProviders(
      {
        SMTP_HOST: 'smtp.example.org',
        SMTP_USER: 'user',
        SMTP_PASS: 'secret',
        FAST2SMS_API_KEY: 'live-key',
      },
      { quiet: true },
    );
    expect(live.email).toMatchObject({ name: 'SMTP', live: true });
    expect(live.sms).toMatchObject({ name: 'Fast2SMS', live: true });
    expect(live.push).toMatchObject({ name: 'Web Push Sandbox', live: false });

    // Every notification written by the live API must pair SIMULATED with a
    // Sandbox provider — a fake gateway is never presented as a real delivery.
    const admin = await insertUser({ role: 'ADMIN' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 3, startsInHours: 96 });
    await book({ token: patient.token, slotId: fixture.slotId }).expect(201);
    const log = await request(app)
      .get('/api/admin/notifications?page=1&pageSize=20')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(log.body.notifications.length).toBeGreaterThan(0);
    for (const row of log.body.notifications) {
      expect(row.simulated).toBe(row.status === 'SIMULATED');
      if (row.simulated) expect(row.provider).toMatch(/Sandbox/i);
      else expect(row.provider).not.toMatch(/Sandbox/i);
    }
  });

  it('starts live-provider audit rows with the schema-valid QUEUED status', async () => {
    const previousLive = providers.sms.live;
    providers.sms.live = true;
    try {
      expect(providerMeta('SMS').status).toBe('QUEUED');
      const row = await insertNotification(pool, {
        channel: 'SMS',
        type: 'BOOKING_CONFIRMED',
        recipient: '9999999999',
        subject: 'CHSC test',
        message: 'Regression: live status must match the ENUM.',
        dedupeKey: `live-status-${Date.now()}`,
      });
      expect(row.status).toBe('QUEUED');
      const [[stored]] = await pool.query('SELECT status FROM notifications_log WHERE id = ?', [
        row.id,
      ]);
      expect(stored.status).toBe('QUEUED');
    } finally {
      providers.sms.live = previousLive;
    }
  });

  it('analytics provenance is live-mysql with no fabricated KPI', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const response = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(response.body.meta).toMatchObject({
      provenance: 'live-mysql',
      engine: 'MySQL aggregate queries',
    });
    expect(response.body.kpis).not.toHaveProperty('noShowReductionPct');
    for (const key of ['bookingsVsCapacity', 'attendanceVsNoShow', 'hourlyUtilisation']) {
      expect(Array.isArray(response.body[key])).toBe(true);
      for (const row of response.body[key]) expect(row.provenance).toBe('live-mysql');
    }

    const advisor = await request(app)
      .get('/api/admin/capacity-advisor')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(advisor.body.badge).toBe('Rule-Based Statistical Heuristic — NOT Black-Box AI/ML');
  });

  it('auto-promotion returns only id and name for the promoted patient', async () => {
    const holder = await insertUser({ role: 'PATIENT', name: 'Seat Holder' });
    const waiter = await insertUser({ role: 'PATIENT', name: 'Next In Line' });
    const fixture = await createCampFixture({ capacity: 1, startsInHours: 96 });

    const held = await hold({ token: holder.token, slotId: fixture.slotId }).expect(201);
    const active = await confirm({ token: holder.token, bookingId: held.body.booking.id }).expect(200);
    const waiting = await hold({ token: waiter.token, slotId: fixture.slotId }).expect(202);
    expect(waiting.body.waitlist.position).toBe(1);

    const cancelled = await request(app)
      .patch(`/api/bookings/${active.body.booking.id}/cancel`)
      .set('Authorization', `Bearer ${holder.token}`)
      .send({ reason: 'privacy regression' })
      .expect(200);
    expect(cancelled.body.autoPromoted).toBe(true);
    expect(Object.keys(cancelled.body.promotedPatient).sort()).toEqual(['id', 'name']);
    expect(cancelled.body.promotedPatient.id).toBe(waiter.id);
    expect(cancelled.body.promotedPatient.name).toBe('Next In Line');
    const payload = JSON.stringify(cancelled.body);
    expect(payload).not.toContain(waiter.email);
    expect(payload).not.toContain(waiter.phone);
  });

  it('runs 50 real transactions, leaves no proof rows and records an audit event', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 10, startsInHours: 120 });
    await request(app)
      .post('/api/admin/concurrency-proof')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ campId: fixture.campId })
      .expect(403);

    const beforeUsers = await countRows('SELECT COUNT(*) AS n FROM users');
    const response = await request(app)
      .post('/api/admin/concurrency-proof')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ campId: fixture.campId })
      .expect(200);

    expect(response.body).toMatchObject({
      slotId: fixture.slotId,
      capacity: 10,
      totalRequests: 50,
      confirmed: 10,
      waitlisted: 40,
      errors: 0,
      zeroOverbooked: true,
      source: 'Live MySQL transactions (SELECT ... FOR UPDATE)',
    });
    expect(response.body.positions).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    // `db` is evidence captured before the finally-cleanup in the endpoint.
    expect(response.body.db).toMatchObject({
      booked_count: 10,
      capacity: 10,
      confirmedBookings: 10,
      waitingBookings: 40,
    });

    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(0);
    expect(
      await countRows('SELECT COUNT(*) AS n FROM bookings WHERE slot_id = ?', [fixture.slotId]),
    ).toBe(0);
    expect(
      await countRows('SELECT COUNT(*) AS n FROM waitlist WHERE slot_id = ?', [fixture.slotId]),
    ).toBe(0);
    expect(
      await countRows("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'proof.%@invalid.local'"),
    ).toBe(0);
    expect(await countRows('SELECT COUNT(*) AS n FROM users')).toBe(beforeUsers);

    const [[slot]] = await pool.query('SELECT booked_count, capacity FROM slots WHERE id = ?', [
      fixture.slotId,
    ]);
    expect(Number(slot.booked_count)).toBeLessThanOrEqual(Number(slot.capacity));

    const audit = await request(app)
      .get('/api/admin/audit-log?page=1&pageSize=100')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(audit.body.pagination).toMatchObject({ page: 1, pageSize: 100 });
    const proofRow = audit.body.audit.find(
      (row) => row.action === 'CONCURRENCY_PROOF' && Number(row.targetId) === fixture.campId,
    );
    expect(proofRow).toBeTruthy();
    expect(proofRow.after).toMatchObject({ confirmed: 10, waitlisted: 40, errors: 0 });
  });

  it('keeps DRAFT camps private while exposing them to the management workspace', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const patient = await insertUser({ role: 'PATIENT' });
    const draft = await createCampFixture({ status: 'DRAFT', startsInHours: -72 });

    await request(app).get('/api/camps?scope=manage').expect(403);
    await request(app)
      .get('/api/camps?scope=manage')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(403);

    const publicCamps = await request(app).get('/api/camps?pageSize=100').expect(200);
    expect(publicCamps.body.camps.some((c) => c.id === draft.campId)).toBe(false);

    const managed = await request(app)
      .get('/api/camps?scope=manage&pageSize=100')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(managed.body.scope).toBe('manage');
    expect(managed.body.camps.some((c) => c.id === draft.campId)).toBe(true);
  });

  it('returns real camp context and address in booking responses', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2, startsInHours: 120 });

    const held = await hold({ token: patient.token, slotId: fixture.slotId }).expect(201);
    expect(held.body.booking).toMatchObject({
      campId: fixture.campId,
      campTitle: expect.any(String),
      campDate: expect.any(String),
      venue: expect.any(String),
      address: 'Test address, Bengaluru',
      startTime: fixture.startTime,
      endTime: fixture.endTime,
    });

    const confirmed = await confirm({ token: patient.token, bookingId: held.body.booking.id }).expect(200);
    expect(confirmed.body.booking.address).toBe('Test address, Bengaluru');
    expect(confirmed.body.booking.campTitle).toBeTruthy();

    const mine = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);
    expect(mine.body.bookings.some((b) => b.id === held.body.booking.id && b.address)).toBe(true);
  });
});
