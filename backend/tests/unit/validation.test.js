'use strict';

const express = require('express');
const request = require('supertest');
const { schemas, validateBody } = require('../../lib/validation');
const { createLimiters } = require('../../lib/limits');

function appWith(schema) {
  const app = express();
  app.use(express.json());
  app.post('/x', validateBody(schema), (req, res) => res.json({ body: req.body }));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({
      ok: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  });
  return app;
}

describe('zod validation middleware', () => {
  it('accepts a valid registration and normalises email + defaults', async () => {
    const response = await request(appWith(schemas.registerSchema))
      .post('/x')
      .send({
        name: 'Meera Sharma',
        email: '  MEERA@Test.LOCAL ',
        phone: '9845000101',
        password: 'Test@1234',
      })
      .expect(200);

    expect(response.body.body.email).toBe('meera@test.local');
    expect(response.body.body.preferredLanguage).toBe('en');
  });

  it('rejects a weak password with field-level issues', async () => {
    const response = await request(appWith(schemas.registerSchema))
      .post('/x')
      .send({ name: 'A B', email: 'a@b.co', phone: '9845000101', password: 'short' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details.issues.some((issue) => issue.path === 'password')).toBe(true);
  });

  it('strips unknown fields so clients cannot self-assign a role', async () => {
    const response = await request(appWith(schemas.registerSchema))
      .post('/x')
      .send({
        name: 'Meera Sharma',
        email: 'meera@test.local',
        phone: '9845000101',
        password: 'Test@1234',
        role: 'ADMIN',
        isActive: 0,
      })
      .expect(200);

    expect(response.body.body.role).toBeUndefined();
    expect(response.body.body.isActive).toBeUndefined();
  });

  it('requires a login identifier and password', async () => {
    const missingIdentifier = await request(appWith(schemas.loginSchema))
      .post('/x')
      .send({ password: 'Test@1234' })
      .expect(400);
    expect(missingIdentifier.body.details.issues[0].message).toMatch(/required/i);

    const missingPassword = await request(appWith(schemas.loginSchema))
      .post('/x')
      .send({ email: 'meera@test.local' })
      .expect(400);
    expect(missingPassword.body.details.issues[0].path).toBe('password');
  });

  it('validates camp windows and capacity', async () => {
    const response = await request(appWith(schemas.campCreateSchema))
      .post('/x')
      .send({
        title: 'Camp',
        venue: 'Venue',
        address: '1 Main Road',
        campDate: '2026-13-45',
        startTime: '16:00',
        endTime: '09:00',
        slotDurationMins: 30,
        totalCapacity: 0,
      })
      .expect(400);

    const paths = response.body.details.issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['campDate', 'totalCapacity', 'endTime']));
  });

  it('rejects a reschedule without a slotId', async () => {
    await request(appWith(schemas.rescheduleSchema)).post('/x').send({}).expect(400);
  });
});

describe('rate limiting', () => {
  it('returns the shared error envelope with 429 after the bucket is exhausted', async () => {
    const app = express();
    const limiters = createLimiters({ disabled: false });
    app.use(limiters.auth);
    app.get('/x', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 10; i += 1) {
      await request(app).get('/x').expect(200);
    }
    const blocked = await request(app).get('/x').expect(429);
    expect(blocked.body).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(blocked.body.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.headers['ratelimit'] || blocked.headers['ratelimit-policy']).toBeDefined();
  });

  it('is fully bypassable for the test suite', async () => {
    const app = express();
    const limiters = createLimiters({ disabled: true });
    app.use(limiters.api);
    app.get('/x', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 5; i += 1) {
      await request(app).get('/x').expect(200);
    }
  });
});
