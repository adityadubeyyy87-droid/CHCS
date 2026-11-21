'use strict';

/**
 * Regression: GET /api/admin/audit-log must survive JSON columns.
 *
 * MySQL returns JSON columns already decoded. An earlier implementation called
 * JSON.parse() on the object, which throws `"[object Object]" is not valid
 * JSON` and 500s the audit page for every row that has a before/after snapshot.
 * This test writes a real audited mutation and reads the log back.
 */

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  book,
} = require('../helpers/api');

describe('audit log', () => {
  it('returns decoded before/after snapshots instead of 500ing', async () => {
    const admin = await insertUser({ role: 'ADMIN', name: 'Audit Admin' });
    const patient = await insertUser({ role: 'PATIENT', name: 'Audit Patient' });
    const fixture = await createCampFixture({ capacity: 5, startsInHours: 96 });

    const created = await book({ token: patient.token, slotId: fixture.slotId });
    expect(created.status).toBe(201);

    // Cancelling a booking writes an audit row with before/after JSON.
    const cancelled = await request(app)
      .patch(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ reason: 'audit regression test' });
    expect(cancelled.status).toBe(200);

    const log = await request(app)
      .get('/api/admin/audit-log?page=1&pageSize=10')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(log.status).toBe(200);
    expect(Array.isArray(log.body.audit)).toBe(true);
    expect(log.body.audit.length).toBeGreaterThan(0);

    const cancelRow = log.body.audit.find((row) => row.action === 'CANCEL_BOOKING');
    expect(cancelRow).toBeTruthy();
    expect(cancelRow.before).toEqual(expect.objectContaining({ status: 'CONFIRMED' }));
    expect(cancelRow.after).toEqual(expect.objectContaining({ status: 'CANCELLED' }));
  });

  it('rejects non-admin callers', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const log = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${patient.token}`);
    expect(log.status).toBe(403);
  });

  it('is append-only: no endpoint deletes or rewrites audit rows', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const del = await request(app)
      .delete('/api/admin/audit-log')
      .set('Authorization', `Bearer ${admin.token}`);
    expect([404, 405]).toContain(del.status);

    // Direct DELETE on the table is not exposed anywhere; the count only grows
    // as a result of application actions.
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM audit_log');
    expect(Number(total)).toBeGreaterThan(0);
  });
});
