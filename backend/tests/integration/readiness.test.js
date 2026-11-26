'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  assignStaff,
  countRows,
} = require('../helpers/api');

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

describe('ops readiness and provider self-test', () => {
  it('denies patients and doctors on both ops endpoints', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const doctor = await insertUser({ role: 'DOCTOR' });

    for (const user of [patient, doctor]) {
      await request(app)
        .get('/api/admin/ops/readiness')
        .set(auth(user.token))
        .expect(403);
      await request(app)
        .post('/api/admin/ops/delivery-test')
        .set(auth(user.token))
        .send({ channel: 'EMAIL' })
        .expect(403);
    }
  });

  it('returns honest provider state and a scored check per camp', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    const doctor = await insertUser({ role: 'DOCTOR' });
    const fixture = await createCampFixture();
    await assignStaff(doctor, fixture.campId, 'DOCTOR');

    const response = await request(app)
      .get('/api/admin/ops/readiness')
      .set(auth(organizer.token))
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.providers.email.live).toBe(false);
    expect(response.body.providers.email.status).toBe('SANDBOX');
    expect(response.body.providers.sms.live).toBe(false);
    expect(response.body.providers.ready).toBe(false);

    // Presence booleans only — no secret value is ever echoed back.
    expect(response.body.providers.email.present).toHaveProperty('SMTP_HOST');
    expect(Object.values(response.body.providers.email.present).every((v) => typeof v === 'boolean')).toBe(true);

    expect(response.body.integrity).toEqual(expect.objectContaining({
      oversubscribedSlots: 0,
      failedNotifications: expect.any(Number),
      unnotifiedConfirmedBookings: expect.any(Number),
    }));

    const camp = response.body.camps.find((item) => item.id === fixture.campId);
    expect(camp).toBeTruthy();
    expect(camp.checks.length).toBeGreaterThanOrEqual(8);
    expect(camp.score).toBeGreaterThanOrEqual(0);
    expect(camp.score).toBeLessThanOrEqual(100);
    expect(['READY', 'ATTENTION', 'BLOCKED']).toContain(camp.band);
    expect(camp.mapsUrl).toContain('google.com/maps');
    expect(camp.staff.doctors).toBeGreaterThanOrEqual(1);
  });

  it('validates the delivery-test channel and keeps it admin-only', async () => {
    const organizer = await insertUser({ role: 'ORGANIZER' });
    await request(app)
      .post('/api/admin/ops/delivery-test')
      .set(auth(organizer.token))
      .send({ channel: 'EMAIL' })
      .expect(403);

    const admin = await insertUser({ role: 'ADMIN' });
    await request(app)
      .post('/api/admin/ops/delivery-test')
      .set(auth(admin.token))
      .send({ channel: 'FAX' })
      .expect(400);
  });

  it('reports a sandbox test honestly and audits the attempt', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const before = await countRows("SELECT COUNT(*) FROM audit_log WHERE action = 'DELIVERY_TEST'");

    const response = await request(app)
      .post('/api/admin/ops/delivery-test')
      .set(auth(admin.token))
      .send({ channel: 'EMAIL' })
      .expect(200);

    expect(response.body.simulated).toBe(true);
    expect(response.body.delivered).toBe(false);
    expect(response.body.live).toBe(false);
    expect(response.body.provider).toBe('Email Sandbox');
    expect(response.body.recipient).not.toBe(admin.email);
    expect(response.body.message).toMatch(/nothing left the server/i);

    const after = await countRows("SELECT COUNT(*) FROM audit_log WHERE action = 'DELIVERY_TEST'");
    expect(after).toBe(before + 1);

    const [[row]] = await pool.query(
      "SELECT * FROM audit_log WHERE action = 'DELIVERY_TEST' ORDER BY id DESC LIMIT 1",
    );
    const detail = typeof row.after === 'string' ? JSON.parse(row.after) : row.after;
    expect(detail.channel).toBe('EMAIL');
    expect(detail.simulated).toBe(true);
    expect(detail.provider).toBe('Email Sandbox');
  });

  it('uses the admin mobile number for an SMS self-test', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const response = await request(app)
      .post('/api/admin/ops/delivery-test')
      .set(auth(admin.token))
      .send({ channel: 'SMS' })
      .expect(200);

    expect(response.body.channel).toBe('SMS');
    expect(response.body.provider).toBe('SMS Sandbox');
    expect(response.body.simulated).toBe(true);
    expect(response.body.recipient.startsWith('***')).toBe(true);
  });
});
