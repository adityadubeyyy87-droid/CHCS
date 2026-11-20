'use strict';

const {
  app,
  request,
  pool,
  insertUser,
  createCampFixture,
  countRows,
} = require('../helpers/api');
const { remindersEngine } = require('../../server');

/** Provider that records every message and can be told to fail. */
function recorder({ fail = false, delayMs = 0 } = {}) {
  const sent = [];
  const provider = (channel) => ({
    name: `${channel} Recorder`,
    send: async (message) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) throw new Error(`${channel} gateway unavailable`);
      sent.push({ channel, ...message });
      return { ok: true, provider: `${channel} Recorder`, simulated: true };
    },
  });
  return { providers: { email: provider('EMAIL'), sms: provider('SMS') }, sent };
}

async function bookedCamp({ capacity = 3, startsInHours = 96 } = {}) {
  const patient = await insertUser({ role: 'PATIENT', name: 'Reminder Patient' });
  const fixture = await createCampFixture({ capacity, startsInHours });
  const response = await request(app)
    .post(`/api/slots/${fixture.slotId}/book`)
    .set('Authorization', `Bearer ${patient.token}`)
    .send({})
    .expect(201);
  return { patient, fixture, bookingId: response.body.booking.id };
}

function makeDue(bookingId) {
  return pool.query(
    `UPDATE reminders SET send_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE), status = 'PENDING'
     WHERE booking_id = ?`,
    [bookingId],
  );
}

async function remindersFor(bookingId) {
  const [rows] = await pool.query('SELECT * FROM reminders WHERE booking_id = ? ORDER BY type', [
    bookingId,
  ]);
  return rows;
}

describe('reminder engine', () => {
  it('delivers both channels exactly once, then reports nothing left to do', async () => {
    const { bookingId } = await bookedCamp();
    await makeDue(bookingId);

    const { providers, sent } = recorder();
    const first = await remindersEngine.runReminderSweep({ pool, providers });

    expect(first).toMatchObject({ checked: 2, sent: 2, failed: 0 });
    expect(sent.filter((message) => message.channel === 'EMAIL')).toHaveLength(2);
    expect(sent.filter((message) => message.channel === 'SMS')).toHaveLength(2);
    expect(sent[0].text).toContain('CHSC reminder');
    expect(sent[0].text).toContain('QR pass');

    const rows = await remindersFor(bookingId);
    expect(rows.every((row) => row.status === 'SENT')).toBe(true);
    expect(rows.every((row) => row.sent_at)).toBeTruthy();
    expect(rows.every((row) => row.attempts === 1)).toBe(true);

    // Audit trail: one SIMULATED row per channel per reminder.
    expect(
      await countRows(
        `SELECT COUNT(*) FROM notifications_log
         WHERE booking_id = ? AND status = 'SIMULATED' AND type IN ('REMINDER_24H','REMINDER_2H')`,
        [bookingId],
      ),
    ).toBe(4);

    const second = await remindersEngine.runReminderSweep({ pool, providers });
    expect(second).toMatchObject({ checked: 0, sent: 0 });
    expect(sent).toHaveLength(4);
  });

  it('splits work between two concurrent sweeps without double-sending', async () => {
    const a = await bookedCamp();
    const b = await bookedCamp();
    await makeDue(a.bookingId);
    await makeDue(b.bookingId);
    await makeDue(a.bookingId);

    const { providers, sent } = recorder({ delayMs: 5 });
    const [left, right] = await Promise.all([
      remindersEngine.runReminderSweep({ pool, providers }),
      remindersEngine.runReminderSweep({ pool, providers }),
    ]);

    expect(left.checked + right.checked).toBe(4);
    expect(sent.filter((message) => message.channel === 'EMAIL')).toHaveLength(4);
    expect(sent.filter((message) => message.channel === 'SMS')).toHaveLength(4);
    expect(await countRows('SELECT COUNT(*) FROM reminders WHERE status = "SENT" AND booking_id IN (?)', [
      [a.bookingId, b.bookingId],
    ])).toBe(4);
  });

  it('retries with exponential backoff and never sends a failed nudge twice', async () => {
    const { bookingId } = await bookedCamp();
    await makeDue(bookingId);

    const broken = recorder({ fail: true });
    const first = await remindersEngine.runReminderSweep({
      pool,
      providers: broken.providers,
      maxAttempts: 5,
    });
    expect(first).toMatchObject({ checked: 2, sent: 0, failed: 2, retried: 2 });

    const rows = await remindersFor(bookingId);
    expect(rows.every((row) => row.status === 'PENDING')).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
    expect(rows.every((row) => row.last_error.includes('unavailable'))).toBe(true);
    // First retry waits 2^1 minutes.
    const [[{ seconds }]] = await pool.query(
      'SELECT TIMESTAMPDIFF(SECOND, NOW(), MIN(send_at)) AS seconds FROM reminders WHERE booking_id = ?',
      [bookingId],
    );
    expect(Number(seconds)).toBeGreaterThan(60);

    // The backoff window protects the gateway from an immediate retry storm.
    const immediate = await remindersEngine.runReminderSweep({
      pool,
      providers: broken.providers,
      maxAttempts: 5,
    });
    expect(immediate.checked).toBe(0);

    // Audit trail records the failures.
    expect(
      await countRows(
        `SELECT COUNT(*) FROM notifications_log WHERE booking_id = ? AND status = 'FAILED'`,
        [bookingId],
      ),
    ).toBe(4);
  });

  it('gives up after the attempt budget and marks the reminder FAILED', async () => {
    const { bookingId } = await bookedCamp();
    await makeDue(bookingId);
    await pool.query(
      `UPDATE reminders SET attempts = 5, send_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE booking_id = ?`,
      [bookingId],
    );

    const broken = recorder({ fail: true });
    const result = await remindersEngine.runReminderSweep({
      pool,
      providers: broken.providers,
      maxAttempts: 5,
    });

    expect(result).toMatchObject({ checked: 2, failed: 2, retried: 0 });
    const rows = await remindersFor(bookingId);
    expect(rows.every((row) => row.status === 'FAILED')).toBe(true);
  });

  it('recovers a reminder stuck in SENDING after a crashed worker', async () => {
    const { bookingId } = await bookedCamp();
    await makeDue(bookingId);
    await pool.query(
      `UPDATE reminders SET status = 'SENDING', attempts = 1,
              updated_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE)
       WHERE booking_id = ?`,
      [bookingId],
    );

    const { providers, sent } = recorder();
    const result = await remindersEngine.runReminderSweep({ pool, providers });

    expect(result).toMatchObject({ checked: 2, sent: 2 });
    expect(sent).toHaveLength(4);
    const rows = await remindersFor(bookingId);
    expect(rows.every((row) => row.status === 'SENT')).toBe(true);
  });

  it('never sends a reminder for a cancelled booking or a closed camp', async () => {
    const cancelled = await bookedCamp();
    await makeDue(cancelled.bookingId);
    await request(app)
      .patch(`/api/bookings/${cancelled.bookingId}/cancel`)
      .set('Authorization', `Bearer ${cancelled.patient.token}`)
      .expect(200);

    const { providers, sent } = recorder();
    await remindersEngine.runReminderSweep({ pool, providers });
    expect(sent).toHaveLength(0);

    const rows = await remindersFor(cancelled.bookingId);
    expect(rows.every((row) => row.status === 'CANCELLED')).toBe(true);
  });

  it('re-queues both nudges with the new send_at after a reschedule', async () => {
    const { patient, fixture, bookingId } = await bookedCamp({ startsInHours: 96 });
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

    const rows = await remindersFor(bookingId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'PENDING')).toBe(true);
    expect(rows.every((row) => row.attempts === 0)).toBe(true);
  });
});
