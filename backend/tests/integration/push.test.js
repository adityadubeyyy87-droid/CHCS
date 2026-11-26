'use strict';

/**
 * Free browser device alerts — real MySQL subscription rows, honest sandbox
 * state in tests, and strict authentication. No test contacts a push service.
 */

const crypto = require('crypto');
const {
  app,
  request,
  pool,
  insertUser,
  countRows,
} = require('../helpers/api');

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function subscription(seed = crypto.randomBytes(6).toString('hex')) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${seed}`,
    keys: {
      p256dh: crypto.randomBytes(65).toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
}

async function auditCount(action) {
  return countRows('SELECT COUNT(*) AS total FROM audit_log WHERE action = ?', [action]);
}

describe('free browser device alerts', () => {
  it('publishes honest VAPID configuration without leaking keys', async () => {
    const response = await request(app).get('/api/push/config').expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      enabled: false,
      publicKey: null,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/private|BEGIN EC/i);
  });

  it('requires authentication for every device operation', async () => {
    const sub = subscription();
    await request(app).get('/api/push/devices').expect(401);
    await request(app).post('/api/push/subscriptions').send(sub).expect(401);
    await request(app).delete('/api/push/subscriptions').send({ endpoint: sub.endpoint }).expect(401);
    await request(app).post('/api/push/test').expect(401);
  });

  it('stores one real subscription per browser and shows only the host', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const sub = subscription('one-real-device');
    const before = await countRows('SELECT COUNT(*) AS total FROM push_subscriptions');
    const beforeAudit = await auditCount('PUSH_DEVICE_ENABLED');

    const created = await request(app)
      .post('/api/push/subscriptions')
      .set(auth(user.token))
      .send(sub)
      .expect(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.enabled).toBe(false);
    expect(await countRows('SELECT COUNT(*) AS total FROM push_subscriptions')).toBe(before + 1);

    // Re-subscribing the same browser updates its keys; it never duplicates rows.
    await request(app)
      .post('/api/push/subscriptions')
      .set(auth(user.token))
      .send(sub)
      .expect(201);
    expect(await countRows('SELECT COUNT(*) AS total FROM push_subscriptions')).toBe(before + 1);

    const devices = await request(app)
      .get('/api/push/devices')
      .set(auth(user.token))
      .expect(200);
    expect(devices.body.devices).toHaveLength(1);
    expect(devices.body.devices[0].endpointHost).toBe('fcm.googleapis.com');
    expect(devices.body.devices[0]).not.toHaveProperty('endpoint');
    expect(devices.body.devices[0]).not.toHaveProperty('p256dh');
    expect(JSON.stringify(devices.body)).not.toContain(sub.endpoint);
    expect(JSON.stringify(devices.body)).not.toContain(sub.keys.p256dh);

    // A repeated opt-in is an explicit operator-visible event too, so two
    // POSTs produce two audit rows while the endpoint table stays unique.
    expect(await auditCount('PUSH_DEVICE_ENABLED')).toBe(beforeAudit + 2);
  });

  it('rejects endpoints that are not real browser push services', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const sub = subscription();
    await request(app)
      .post('/api/push/subscriptions')
      .set(auth(user.token))
      .send({ ...sub, endpoint: 'https://evil.example.com/collect' })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('INVALID_ENDPOINT'));
    await request(app)
      .post('/api/push/subscriptions')
      .set(auth(user.token))
      .send({ ...sub, keys: { p256dh: 'short', auth: 'x' } })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('INVALID_KEYS'));
  });

  it('removes the device through the API and audits it', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const sub = subscription('device-to-remove');
    await request(app).post('/api/push/subscriptions').set(auth(user.token)).send(sub).expect(201);
    const before = await countRows('SELECT COUNT(*) AS total FROM push_subscriptions');
    const beforeAudit = await auditCount('PUSH_DEVICE_DISABLED');

    await request(app)
      .delete('/api/push/subscriptions')
      .set(auth(user.token))
      .send({ endpoint: sub.endpoint })
      .expect(200)
      .expect((res) => expect(res.body.removed).toBe(1));

    expect(await countRows('SELECT COUNT(*) AS total FROM push_subscriptions')).toBe(before - 1);
    expect(await auditCount('PUSH_DEVICE_DISABLED')).toBe(beforeAudit + 1);

    await request(app)
      .delete('/api/push/subscriptions')
      .set(auth(user.token))
      .send({ endpoint: sub.endpoint })
      .expect(404)
      .expect((res) => expect(res.body.code).toBe('DEVICE_NOT_FOUND'));
  });

  it('refuses a push self-test when VAPID is not configured, and audits the refusal', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const before = await auditCount('DELIVERY_TEST_FAILED');
    const response = await request(app)
      .post('/api/push/test')
      .set(auth(user.token))
      .expect(409);

    expect(response.body.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(response.body.details).toMatchObject({ channel: 'PUSH' });
    expect(await auditCount('DELIVERY_TEST_FAILED')).toBe(before + 1);
  });

  it('accepts PUSH in the live audit trail and counts devices in readiness', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const sub = subscription('readiness-device');
    await request(app).post('/api/push/subscriptions').set(auth(user.token)).send(sub).expect(201);

    await pool.query(
      `INSERT INTO notifications_log (user_id, channel, type, recipient, subject, message)
       VALUES (?, 'PUSH', 'BOOKING_CONFIRMED', ?, ?, ?)`,
      [user.id, `device:${user.id}`, 'CHSC test', 'Logistics-only alert body.'],
    );
    const [[row]] = await pool.query(
      'SELECT channel FROM notifications_log WHERE user_id = ? AND channel = ? ORDER BY id DESC LIMIT 1',
      [user.id, 'PUSH'],
    );
    expect(row.channel).toBe('PUSH');

    const organizer = await insertUser({ role: 'ORGANIZER' });
    const readiness = await request(app)
      .get('/api/admin/ops/readiness')
      .set(auth(organizer.token))
      .expect(200);
    expect(readiness.body.providers.push).toMatchObject({
      channel: 'PUSH',
      live: false,
      status: 'SANDBOX',
    });
    expect(readiness.body.providers.freeReady).toBe(false);
    expect(readiness.body.integrity.browserDevices).toBeGreaterThanOrEqual(1);
  });

  it('erases device subscriptions with the rest of the personal data', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const sub = subscription('erasure-device');
    await request(app).post('/api/push/subscriptions').set(auth(user.token)).send(sub).expect(201);
    const before = await countRows('SELECT COUNT(*) AS total FROM push_subscriptions');

    await request(app).delete('/api/users/me/purge').set(auth(user.token)).expect(200);
    expect(await countRows('SELECT COUNT(*) AS total FROM push_subscriptions')).toBe(before - 1);
    const [[row]] = await pool.query(
      'SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?',
      [user.id],
    );
    expect(Number(row.total)).toBe(0);
  });
});
