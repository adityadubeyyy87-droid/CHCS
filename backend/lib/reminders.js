'use strict';

/**
 * Reminder engine — 24h and 2h nudges for confirmed bookings.
 *
 * Lifecycle (one row per booking/type, enforced by uq_reminder_booking_type):
 *   PENDING → SENDING → SENT            (happy path)
 *   PENDING → SENDING → PENDING → …     (retry with exponential backoff)
 *   PENDING → SENDING → FAILED          (attempts exhausted)
 *   PENDING → CANCELLED                 (booking released)
 *
 * The sweep claims work with `SELECT … FOR UPDATE SKIP LOCKED`, so two API
 * instances can run it concurrently without sending the same reminder twice.
 * A stale `SENDING` row (process died mid-delivery) is recycled after 10 min.
 */

const { buildMapsUrl, buildShortNavigationUrl, publicBaseUrl } = require('./maps');
const { loadPushSubscriptions, prunePushSubscriptions } = require('./push');

const REMINDER_TYPES = {
  REMINDER_24H: { minutesBefore: 24 * 60, phrase: 'tomorrow' },
  REMINDER_2H: { minutesBefore: 2 * 60, phrase: 'in about 2 hours' },
};

const LATE_GRACE_MINUTES = 30;
const STALE_SENDING_MINUTES = 10;

function pad(value) {
  return String(value).padStart(2, '0');
}

function toParts(campDate, startTime) {
  const [hh, mm] = String(startTime).split(':').map(Number);
  if (campDate instanceof Date) {
    return {
      year: campDate.getFullYear(),
      month: campDate.getMonth() + 1,
      day: campDate.getDate(),
      hour: hh,
      minute: mm,
    };
  }
  const match = String(campDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`Invalid camp date: ${campDate}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: hh,
    minute: mm,
  };
}

function formatSqlDate(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

function formatTime12(timeValue) {
  const [h, m] = String(timeValue).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${pad(hour)}:${pad(m)} ${suffix}`;
}

/** Local wall-clock instant of the camp slot. */
function slotStart(campDate, startTime) {
  const parts = toParts(campDate, startTime);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
}

/** When a given reminder should leave the queue. */
function computeSendAt(campDate, startTime, type) {
  const spec = REMINDER_TYPES[type];
  if (!spec) throw new Error(`Unknown reminder type: ${type}`);
  return new Date(slotStart(campDate, startTime).getTime() - spec.minutesBefore * 60 * 1000);
}

/**
 * Queue the reminders for a new/confirmed booking. Safe to call repeatedly —
 * the unique key makes it idempotent and a SENT reminder is never re-queued.
 */
async function scheduleForBooking(conn, { bookingId, campDate, startTime, now = new Date() }) {
  const created = [];
  for (const type of Object.keys(REMINDER_TYPES)) {
    const sendAt = computeSendAt(campDate, startTime, type);
    if (sendAt.getTime() < now.getTime() - LATE_GRACE_MINUTES * 60 * 1000) continue;

    await conn.query(
      `INSERT INTO reminders (booking_id, type, send_at, status, attempts, last_error)
       VALUES (?, ?, ?, 'PENDING', 0, NULL)
       ON DUPLICATE KEY UPDATE
         send_at = IF(status IN ('SENT', 'SENDING', 'CANCELLED'), send_at, VALUES(send_at)),
         status = IF(status IN ('SENT', 'SENDING', 'CANCELLED'), status, 'PENDING'),
         attempts = IF(status IN ('SENT', 'SENDING', 'CANCELLED'), attempts, 0),
         last_error = NULL`,
      [bookingId, type, formatSqlDate(sendAt)],
    );
    created.push({ type, sendAt: sendAt.toISOString() });
  }
  return created;
}

async function cancelForBooking(conn, bookingId) {
  const [result] = await conn.query(
    `UPDATE reminders SET status = 'CANCELLED'
     WHERE booking_id = ? AND status IN ('PENDING', 'SENDING', 'FAILED')`,
    [bookingId],
  );
  return result.affectedRows;
}

/**
 * A reschedule replaces only queued/failed nudges so they follow the new slot.
 * SENT and SENDING rows are terminal/in-flight and must never be resurrected or
 * deleted — doing so could double-send a reminder or re-announce a past slot.
 */
async function rescheduleForBooking(conn, { bookingId, campDate, startTime, now = new Date() }) {
  await conn.query(
    `DELETE FROM reminders
     WHERE booking_id = ? AND status IN ('PENDING', 'FAILED')`,
    [bookingId],
  );
  return scheduleForBooking(conn, { bookingId, campDate, startTime, now });
}

function buildMessage(row) {
  const spec = REMINDER_TYPES[row.type] || REMINDER_TYPES.REMINDER_24H;
  const mapsUrl = buildMapsUrl(row);
  const shortUrl = buildShortNavigationUrl(publicBaseUrl(process.env), row.qr_token);
  const address = [row.address, row.city].filter(Boolean).join(', ');
  const navigation = shortUrl || mapsUrl;
  return (
    `CHSC reminder: ${row.name}, your ${row.title} at ${row.venue} starts ${spec.phrase} ` +
    `at ${formatTime12(row.start_time)}. ` +
    `${address ? `Address: ${address}. ` : ''}` +
    `Booking ID #${row.booking_id}. ` +
    `${navigation ? `Navigate: ${navigation}. ` : ''}` +
    `Please arrive 10 minutes early with your QR pass. ` +
    `Can't make it? Release your seat from My Bookings so a waiting neighbour can be promoted.`
  ).slice(0, 480);
}

async function logDelivery(pool, { reminder, channel, status, recipient, subject, message, provider, error }) {
  try {
    await pool.query(
      `INSERT INTO notifications_log
         (booking_id, user_id, channel, type, recipient, subject, message, provider, status, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reminder.booking_id,
        reminder.patient_id,
        channel,
        reminder.type,
        recipient,
        subject || null,
        message,
        provider,
        status,
        JSON.stringify({
          reminderId: reminder.reminder_id,
          attempt: reminder.attempts,
          error: error ? String(error).slice(0, 400) : null,
        }),
      ],
    );
  } catch (logError) {
    // Never let the audit trail break delivery bookkeeping.
    console.warn('[reminder audit]', logError.message);
  }
}

/**
 * Deliver one claimed reminder over both channels.
 * Throws if any channel fails so the row is retried with backoff.
 */
async function deliver(reminder, providers, pool) {
  const message = buildMessage(reminder);
  const subject = `CHSC reminder · ${reminder.title} ${reminder.type === 'REMINDER_24H' ? 'tomorrow' : 'soon'}`;
  const failures = [];
  const navigate =
    buildShortNavigationUrl(publicBaseUrl(process.env), reminder.qr_token) ||
    buildMapsUrl(reminder) ||
    publicBaseUrl(process.env);

  const channels = [
    {
      channel: 'EMAIL',
      provider: providers.email,
      recipient: reminder.email,
      subject,
    },
    {
      channel: 'SMS',
      provider: providers.sms,
      recipient: reminder.phone,
      subject: null,
    },
  ];

  // Free device alerts are only attempted when this patient actually enabled
  // browser notifications on at least one device. No subscription = no fake row.
  if (providers.push?.live) {
    const subscriptions = await loadPushSubscriptions(pool, reminder.patient_id);
    if (subscriptions.length) {
      channels.push({
        channel: 'PUSH',
        provider: providers.push,
        recipient: `device:${reminder.patient_id}`,
        subject,
        subscriptions,
        url: navigate,
      });
    }
  }

  for (const item of channels) {
    if (!item.recipient) continue;
    try {
      const result = await item.provider.send({
        to: item.recipient,
        subject: item.subject,
        text: message,
        ...(item.subscriptions
          ? { subscriptions: item.subscriptions, url: item.url }
          : {}),
      });
      if (result.expired?.length) await prunePushSubscriptions(pool, result.expired);
      await logDelivery(pool, {
        reminder,
        channel: item.channel,
        status: result.simulated ? 'SIMULATED' : 'SENT',
        recipient: item.recipient,
        subject: item.subject,
        message,
        provider: result.provider || item.provider.name,
      });
    } catch (error) {
      failures.push(`${item.channel}: ${error.message}`);
      await logDelivery(pool, {
        reminder,
        channel: item.channel,
        status: 'FAILED',
        recipient: item.recipient,
        subject: item.subject,
        message,
        provider: item.provider.name,
        error: error.message,
      });
    }
  }

  if (failures.length) throw new Error(failures.join('; '));
  return { delivered: channels.filter((c) => c.recipient).length };
}

async function claimDueReminders(pool, { now, limit }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE reminders SET status = 'PENDING'
       WHERE status = 'SENDING' AND updated_at < DATE_SUB(?, INTERVAL ? MINUTE)`,
      [formatSqlDate(now), STALE_SENDING_MINUTES],
    );

    const [rows] = await conn.query(
      `SELECT r.id AS reminder_id, r.booking_id, r.type, r.attempts,
              b.patient_id, b.qr_token, u.name, u.phone, u.email,
              c.id AS camp_id, c.title, c.venue, c.address, c.city,
              c.latitude, c.longitude, c.camp_date,
              s.start_time
       FROM reminders r
       JOIN bookings b ON b.id = r.booking_id
       JOIN users u ON u.id = b.patient_id
       JOIN camps c ON c.id = b.camp_id
       JOIN slots s ON s.id = b.slot_id
       WHERE r.status = 'PENDING'
         AND r.send_at <= ?
         AND b.status = 'CONFIRMED'
         AND c.status = 'PUBLISHED'
       ORDER BY r.send_at ASC, r.id ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [formatSqlDate(now), limit],
    );

    if (rows.length) {
      const ids = rows.map((row) => row.reminder_id);
      await conn.query(
        `UPDATE reminders SET status = 'SENDING', attempts = attempts + 1 WHERE id IN (?)`,
        [ids],
      );
    }

    await conn.commit();
    return rows.map((row) => ({ ...row, attempts: Number(row.attempts) + 1 }));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function markSent(pool, reminder, now) {
  await pool.query(
    `UPDATE reminders SET status = 'SENT', sent_at = ?, last_error = NULL WHERE id = ?`,
    [formatSqlDate(now), reminder.reminder_id],
  );
}

async function markFailed(pool, reminder, error, { maxAttempts, now }) {
  const attempts = Number(reminder.attempts);
  const exhausted = attempts >= maxAttempts;
  const backoffMinutes = Math.min(60, 2 ** attempts);

  await pool.query(
    `UPDATE reminders
     SET status = ?, send_at = DATE_ADD(?, INTERVAL ? MINUTE), last_error = ?
     WHERE id = ?`,
    [
      exhausted ? 'FAILED' : 'PENDING',
      formatSqlDate(now),
      backoffMinutes,
      String(error.message || error).slice(0, 500),
      reminder.reminder_id,
    ],
  );
  return { exhausted, backoffMinutes };
}

/**
 * One sweep. Call from cron every minute (and from the admin endpoint).
 * Returns counts that are safe to log/emit.
 */
async function runReminderSweep({
  pool,
  providers,
  now = new Date(),
  limit = 50,
  maxAttempts = Number(process.env.REMINDER_MAX_ATTEMPTS || 5),
  logger = console,
}) {
  const due = await claimDueReminders(pool, { now, limit });
  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const reminder of due) {
    try {
      await deliver(reminder, providers, pool);
      await markSent(pool, reminder, now);
      sent += 1;
    } catch (error) {
      failed += 1;
      const outcome = await markFailed(pool, reminder, error, { maxAttempts, now });
      if (!outcome.exhausted) retried += 1;
      logger.warn(
        `[reminder] ${reminder.type} for booking ${reminder.booking_id} failed ` +
          `(attempt ${reminder.attempts}/${maxAttempts}): ${error.message}`,
      );
    }
  }

  return { checked: due.length, sent, failed, retried, at: now.toISOString() };
}

module.exports = {
  REMINDER_TYPES,
  LATE_GRACE_MINUTES,
  computeSendAt,
  slotStart,
  scheduleForBooking,
  rescheduleForBooking,
  cancelForBooking,
  runReminderSweep,
  buildMessage,
};
