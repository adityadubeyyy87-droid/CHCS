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
} = require('../helpers/api');

describe('concurrency — 50 parallel bookings against 10 seats', () => {
  it('holds 10 seats, confirms all 10, waitlists the other 40 and never overbooks', async () => {
    const fixture = await createCampFixture({ capacity: 10, startsInHours: 120 });

    // 50 distinct patients, created up front so the parallel burst only
    // exercises the booking transaction.
    const patients = [];
    for (let i = 0; i < 50; i += 1) {
      patients.push(await insertUser({ role: 'PATIENT', name: `Race Patient ${i + 1}` }));
    }

    const responses = await Promise.all(
      patients.map((patient) =>
        hold({ token: patient.token, slotId: fixture.slotId, body: { travelMode: 'WALK' } }),
      ),
    );

    const statuses = responses.map((response) => response.status);
    const held = responses.filter((response) => response.status === 201);
    const waitlisted = responses.filter((response) => response.status === 202);

    expect(held).toHaveLength(10);
    expect(waitlisted).toHaveLength(40);
    expect(statuses.filter((status) => status === 201)).toHaveLength(10);
    // Nothing may surface a 500 (lock timeout, deadlock, duplicate key leak).
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
    expect(held.every((response) => response.body.booking.status === 'HELD')).toBe(true);
    expect(held.every((response) => Boolean(response.body.holdExpiresAt))).toBe(true);

    // publicBooking deliberately omits patientId, so map through the original
    // request order: every 201 response belongs to the patient that made it.
    const winners = new Map();
    responses.forEach((response, index) => {
      if (response.status === 201) winners.set(response.body.booking.id, patients[index]);
    });
    const confirmations = await Promise.all(
      [...winners.entries()].map(([bookingId, patient]) =>
        confirm({ token: patient.token, bookingId }),
      ),
    );
    expect(confirmations.every((response) => response.status === 200)).toBe(true);
    expect(confirmations.every((response) => response.body.booking.status === 'CONFIRMED')).toBe(true);

    // Every waiter got a distinct FIFO position in 1..40.
    const positions = waitlisted.map((response) => response.body.waitlist.position).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));

    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(10);
    expect(
      await countRows(
        `SELECT COUNT(*) FROM bookings WHERE slot_id = ? AND status = 'CONFIRMED'`,
        [fixture.slotId],
      ),
    ).toBe(10);
    expect(
      await countRows(
        `SELECT COUNT(*) FROM waitlist WHERE slot_id = ? AND status = 'WAITING'`,
        [fixture.slotId],
      ),
    ).toBe(40);

    // The seat counter and the booking rows must agree — no phantom seats.
    const [[slot]] = await pool.query('SELECT capacity, booked_count FROM slots WHERE id = ?', [
      fixture.slotId,
    ]);
    expect(Number(slot.booked_count)).toBeLessThanOrEqual(Number(slot.capacity));
  });

  it('lets exactly one of two simultaneous holds win the last seat', async () => {
    const fixture = await createCampFixture({ capacity: 1, startsInHours: 120 });
    const [a, b] = [await insertUser({ role: 'PATIENT' }), await insertUser({ role: 'PATIENT' })];

    const results = await Promise.all([
      hold({ token: a.token, slotId: fixture.slotId }),
      hold({ token: b.token, slotId: fixture.slotId }),
    ]);

    const codes = results.map((result) => result.status).sort();
    expect(codes).toEqual([201, 202]);
    expect(await countRows('SELECT booked_count FROM slots WHERE id = ?', [fixture.slotId])).toBe(1);
  });

  it('never grants two active bookings in one camp under parallel double-clicks', async () => {
    const patient = await insertUser({ role: 'PATIENT' });
    const fixture = await createCampFixture({ capacity: 5, startsInHours: 120 });
    const [extra] = await pool.query(
      `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
       VALUES (?, 2, '18:00:00', '18:30:00', 5, 0)`,
      [fixture.campId],
    );

    const results = await Promise.all([
      hold({ token: patient.token, slotId: fixture.slotId }),
      hold({ token: patient.token, slotId: extra.insertId }),
      hold({ token: patient.token, slotId: fixture.slotId }),
    ]);

    const created = results.filter((result) => result.status === 201);
    expect(created).toHaveLength(1);
    expect(
      await countRows(
        `SELECT COUNT(*) FROM bookings WHERE patient_id = ? AND camp_id = ?
           AND status IN ('HELD','CONFIRMED','CHECKED_IN','COMPLETED')`,
        [patient.id, fixture.campId],
      ),
    ).toBe(1);
  });
});
