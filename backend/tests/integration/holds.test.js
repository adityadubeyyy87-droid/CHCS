'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  countRows,
  hold,
  confirm,
  book,
} = require('../helpers/api');

describe('bounded seat holds and FIFO claim windows', () => {
  it('exposes holdExpiresAt on the 201 response and requires an explicit confirm', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 2 });

    const created = await hold({ token: patient.token, slotId: fixture.slotId }).expect(201);

    expect(created.body.status).toBe('HELD');
    expect(created.body.holdExpiresAt).toBeTruthy();
    expect(created.body.booking).toMatchObject({ status: 'HELD' });
    expect(created.body.booking.holdExpiresAt).toBe(created.body.holdExpiresAt);
    expect(new Date(created.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const [[row]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [
      created.body.booking.id,
    ]);
    expect(row.status).toBe('HELD');
  });

  it('rejects an expired hold with HOLD_EXPIRED and hands the seat to the next waiter', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const first = await insertUser({ role: 'PATIENT' });
    const second = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 1 });

    const held = await hold({ token: first.token, slotId: fixture.slotId }).expect(201);
    const waiting = await hold({ token: second.token, slotId: fixture.slotId }).expect(202);
    expect(waiting.body.status).toBe('WAITLISTED');

    await pool.query(
      'UPDATE bookings SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
      [held.body.booking.id],
    );

    const expired = await confirm({
      token: first.token,
      bookingId: held.body.booking.id,
    }).expect(409);
    expect(expired.body.code).toBe('HOLD_EXPIRED');
    expect(expired.body.details.booking).toMatchObject({ status: 'EXPIRED' });

    expect(
      await countRows('SELECT COUNT(*) FROM bookings WHERE id = ? AND status = ?', [
        held.body.booking.id,
        'EXPIRED',
      ]),
    ).toBe(1);
    expect(
      await countRows('SELECT COUNT(*) FROM bookings WHERE patient_id = ? AND status = ?', [
        second.id,
        'HELD',
      ]),
    ).toBe(1);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(1);
    expect(
      await countRows(`SELECT COUNT(*) FROM waitlist WHERE id = ? AND status = 'PROMOTED'`, [
        waiting.body.waitlist.id,
      ]),
    ).toBe(1);

    // The sweep is now a no-op for this seat; it never double-releases capacity.
    const sweep = await request(app)
      .post('/api/admin/holds/expire')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(sweep.body.expiredHolds).toBe(0);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(1);
  });

  it('expires an unclaimed promotion and moves to the next FIFO patient', async () => {
    const admin = await insertUser({ role: 'ADMIN' });
    const owner = await insertUser({ role: 'PATIENT' });
    const next = await insertUser({ role: 'PATIENT' });
    const last = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 1 });

    const ownerBooking = await book({ token: owner.token, slotId: fixture.slotId }).expect(201);
    const nextWait = await hold({ token: next.token, slotId: fixture.slotId }).expect(202);
    const lastWait = await hold({ token: last.token, slotId: fixture.slotId }).expect(202);

    await request(app)
      .patch(`/api/bookings/${ownerBooking.body.booking.id}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const [[promoted]] = await pool.query(
      'SELECT id FROM bookings WHERE slot_id = ? AND patient_id = ?',
      [fixture.slotId, next.id],
    );
    expect(promoted).toBeTruthy();

    await pool.query(
      'UPDATE bookings SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
      [promoted.id],
    );
    await pool.query(
      `UPDATE waitlist SET promotion_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
       WHERE id = ?`,
      [nextWait.body.waitlist.id],
    );

    const sweep = await request(app)
      .post('/api/admin/holds/expire')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(sweep.body.expiredHolds).toBeGreaterThanOrEqual(1);

    expect(
      await countRows('SELECT COUNT(*) FROM bookings WHERE id = ? AND status = ?', [
        promoted.id,
        'EXPIRED',
      ]),
    ).toBe(1);
    expect(
      await countRows('SELECT COUNT(*) FROM bookings WHERE patient_id = ? AND status = ?', [
        last.id,
        'HELD',
      ]),
    ).toBe(1);
    expect(
      await countRows(`SELECT COUNT(*) FROM waitlist WHERE id = ? AND status = 'PROMOTED'`, [
        lastWait.body.waitlist.id,
      ]),
    ).toBe(1);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(1);
  });
});
