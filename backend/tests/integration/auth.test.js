'use strict';

const { app, request, pool, uniqueEmail, insertUser } = require('../helpers/api');

describe('auth', () => {
  it('registers a patient, hashes the password and returns a working token', async () => {
    const email = uniqueEmail('register');
    const phone = `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Registration Test',
        email,
        phone,
        password: 'Test@1234',
        role: 'ADMIN',
      })
      .expect(201);

    expect(response.body.user.role).toBe('PATIENT');
    expect(response.body.token).toBeTruthy();

    const [[row]] = await pool.query('SELECT password_hash, role FROM users WHERE email = ?', [email]);
    expect(row.role).toBe('PATIENT');
    expect(row.password_hash).not.toBe('Test@1234');
    expect(row.password_hash.startsWith('$2')).toBe(true);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.token}`)
      .expect(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects a duplicate email with the shared 409 envelope', async () => {
    const existing = await insertUser({ email: uniqueEmail('dupe') });
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Duplicate',
        email: existing.email,
        phone: '9845000199',
        password: 'Test@1234',
      })
      .expect(409);

    expect(response.body).toMatchObject({ ok: false, code: 'USER_EXISTS' });
    expect(response.body.requestId).toBeTruthy();
  });

  it('rejects a weak password with field-level issues', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Weak Password',
        email: uniqueEmail('weak'),
        phone: '9845000198',
        password: 'password',
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details.issues[0].path).toBe('password');
  });

  it('logs in by email and rejects the wrong password', async () => {
    const user = await insertUser({ email: uniqueEmail('login') });

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Test@1234' })
      .expect(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Wrong@1234' })
      .expect(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('blocks protected routes without a token and enforces roles', async () => {
    await request(app).get('/api/bookings/me').expect(401);

    const patient = await insertUser({ role: 'PATIENT' });
    const forbidden = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(403);
    expect(forbidden.body.code).toBe('ROLE_FORBIDDEN');
  });
});
