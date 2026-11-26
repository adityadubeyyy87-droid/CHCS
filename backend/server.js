/* ============================================================================
 * COMMUNITY HEALTH SCREENING CAMP SCHEDULER (CHSC)
 * Express.js + Socket.io + MySQL 8 backend
 * CMRIT Bengaluru · Department of Information Science & Engineering
 *
 * Architectural highlights
 *  - Pessimistic row locking (SELECT ... FOR UPDATE) for zero overbooking
 *  - Atomic cancellation → FIFO waitlist promotion in one ACID transaction
 *  - Deterministic interval partitioning for automatic slot generation
 *  - Rule-based statistical Capacity Advisor (not black-box ML)
 *  - node-cron reminder sweep (24h + 2h)
 *  - Sandbox SMS/Email gateway with live Socket.io interception
 *  - DPDP Act-aligned data minimisation and right-to-erasure endpoint
 * ========================================================================== */

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { Server } = require('socket.io');

// Optional: inline ticket QR in HTML email. If the package is unavailable the
// email still ships with the booking ID, reference and navigation links.
let QRCode = null;
try {
  QRCode = require('qrcode');
} catch {
  QRCode = null;
}

const { schemas, validateBody, validateQuery } = require('./lib/validation');
const { parsePagination, buildPagination } = require('./lib/pagination');
const { createLimiters } = require('./lib/limits');
const { createProviders } = require('./lib/providers');
const remindersEngine = require('./lib/reminders');
const {
  buildMapsUrl,
  buildTicketQrPayload,
  extractTicketToken,
  publicBaseUrl,
  buildShortNavigationUrl,
} = require('./lib/maps');
const { buildMessages } = require('./lib/messages');
const { providerReadiness, evaluateCamp, isoDate } = require('./lib/readiness');
const { dbConnectionOptions } = require('./lib/db-config');
const {
  parseTrustProxy,
  buildCsp,
  redactRecipient,
  redactNotificationForSocket,
  limitSocketPayload,
} = require('./lib/security');
const {
  validPushEndpoint,
  parsePushSubscription,
  loadPushSubscriptions,
  prunePushSubscriptions,
  publicPushDevice,
} = require('./lib/push');

const PORT = Number(process.env.PORT || 4000);
const HOST = String(process.env.HOST || '').trim() || undefined;
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4000,http://127.0.0.1:4000';
const ALLOWED_ORIGINS = FRONTEND_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
const ALPHA_MAX = Number(process.env.ALPHA_MAX || 0.25);
const ALLOW_DESTRUCTIVE_SLOT_REBUILD =
  String(process.env.ALLOW_DESTRUCTIVE_SLOT_REBUILD || '').toLowerCase() === 'true';

/** Bounded integer environment settings for seat holds and expiry sweeps. */
function boundedIntEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
const BOOKING_HOLD_MINUTES = boundedIntEnv('BOOKING_HOLD_MINUTES', 10, 1, 1440);
const PROMOTION_HOLD_MINUTES = boundedIntEnv('PROMOTION_HOLD_MINUTES', 15, 1, 1440);
const HOLD_EXPIRY_BATCH_SIZE = boundedIntEnv('HOLD_EXPIRY_BATCH_SIZE', 100, 1, 1000);
const HOLD_EXPIRY_CRON = String(process.env.HOLD_EXPIRY_CRON || '* * * * *');
const ACTIVE_BOOKING_STATUSES = ['HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'];

/**
 * Clicking a device alert returns to the hosted app, not the raw API host.
 * PUSH_APP_URL may include the GitHub Pages project subpath (`/CHCS`); without
 * it we fall back to the configured frontend origin and finally local dev.
 */
function pushTargetUrl(env = process.env) {
  const explicit = String(env.PUSH_APP_URL || env.PUSH_FRONTEND_URL || '').trim();
  const frontend = explicit || String(env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);
  const base = String(frontend || `http://localhost:${PORT}`).replace(/\/+$/, '');
  if (base.endsWith('#/notifications')) return base;
  return `${base}/#/notifications`;
}

class ApiError extends Error {
  constructor(status, message, code = 'API_ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const pool = mysql.createPool(dbConnectionOptions());

const app = express();
// TRUST_PROXY is opt-in: false by default, 'loopback' / hop count / IP list when
// an explicit reverse proxy is deployed. Never trust X-Forwarded-* blindly.
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.disable('x-powered-by');

const isDevRuntime = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', buildCsp({ isDev: isDevRuntime, allowedOrigins: ALLOWED_ORIGINS }));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Camera is required for the optional BarcodeDetector QR scanner on Camp Day.
  // Microphone and geolocation are never used by this application.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.secure && !isDevRuntime) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      return callback(null, true);
    }
    // A denied origin is a client error. Previously this surfaced as a 500.
    return callback(new ApiError(403, 'CORS blocked origin.', 'CORS_FORBIDDEN'));
  },
  credentials: true,
};

app.use((req, res, next) => {
  req.id = String(req.headers['x-request-id'] || crypto.randomUUID());
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const limiters = createLimiters({
  disabled: String(process.env.RATE_LIMIT_DISABLED || 'false') === 'true',
});
const providers = createProviders(process.env, { quiet: process.env.NODE_ENV === 'test' });
app.use('/api', limiters.api);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  transports: ['websocket', 'polling'],
  // Cap the decoded packet size. Incoming payload guards are applied per-event
  // below; outgoing payloads go through emitBounded().
  maxHttpBufferSize: 64 * 1024,
});

/** Socket auth state attached at handshake; never trusts client-supplied role. */
function anonymousSocketUser() {
  return { id: null, role: 'ANONYMOUS', name: null };
}

/* ---------------------------------------------------------------------------
 * Small utilities
 * ------------------------------------------------------------------------- */

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseTimeToMinutes(value) {
  if (value === null || value === undefined) return NaN;
  const text = String(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function formatTime12(timeValue) {
  const minutes = parseTimeToMinutes(timeValue);
  if (!Number.isFinite(minutes)) return String(timeValue);
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

function todayIso() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function maskName(name = '') {
  const parts = String(name).trim().split(/\s+/);
  return `${parts[0] || 'Guest'} ${parts[1] ? `${parts[1][0]}.` : ''}`.trim();
}

function maskEmail(email = '') {
  const [local, domain] = String(email).split('@');
  if (!domain) return 'hidden';
  return `${local.slice(0, 2)}***@${domain}`;
}

// 60 bits of cryptographic entropy in a human-typable base32 token. Legacy
// six-digit tokens remain valid for check-in, but every new pass is unguessable.
const QR_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeQrToken() {
  const bytes = crypto.randomBytes(12);
  let body = '';
  for (const byte of bytes) body += QR_TOKEN_ALPHABET[byte % QR_TOKEN_ALPHABET.length];
  return `CHSC-BLR-${body}`;
}

function makeTokenNumber() {
  const prefix = String.fromCharCode(65 + crypto.randomInt(0, 6));
  return `${prefix}-${crypto.randomInt(100000, 999999)}`;
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    ageGroup: row.age_group,
    preferredLanguage: row.preferred_language,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

function publicCamp(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    descriptionEn: row.description_en,
    descriptionKn: row.description_kn,
    venue: row.venue,
    address: row.address,
    city: row.city,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
    mapsUrl: buildMapsUrl(row),
    campDate: row.camp_date,
    startTime: row.start_time,
    endTime: row.end_time,
    slotDurationMins: Number(row.slot_duration_mins),
    totalCapacity: Number(row.total_capacity),
    physicalCapacity: Number(row.physical_capacity),
    status: row.status,
    createdBy: row.created_by,
    creatorName: row.creator_name || null,
    slotCapacity: Number(row.slot_capacity || 0),
    bookedTotal: Number(row.booked_total || 0),
    waitingTotal: Number(row.waiting_total || 0),
    staffTotal: Number(row.staff_total || 0),
    createdAt: row.created_at,
  };
}

function publicSlot(row) {
  return {
    id: row.id,
    campId: row.camp_id,
    slotIndex: Number(row.slot_index),
    startTime: row.start_time,
    endTime: row.end_time,
    capacity: Number(row.capacity),
    bookedCount: Number(row.booked_count),
    waitingCount: Number(row.waiting_count || 0),
    remaining: Number(row.capacity) - Number(row.booked_count),
  };
}

/** Public-safe staff projection: never expose contact details (email/phone). */
function publicStaff(row) {
  return {
    id: row.id,
    campId: row.camp_id,
    userId: row.user_id,
    name: row.name,
    roleAtCamp: row.role_at_camp,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    expectedLoadPerHour: Number(row.expected_load_per_hour),
    maxPatientsPerHour: Number(row.max_patients_per_hour),
    duties: row.duties,
    loadWarning: Number(row.expected_load_per_hour) > Number(row.max_patients_per_hour),
  };
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function publicBooking(row) {
  if (!row) return null;
  const mapsUrl = buildMapsUrl(row);
  return {
    id: row.id,
    slotId: row.slot_id,
    campId: row.camp_id,
    patientId: row.patient_id,
    patientName: row.patient_name || undefined,
    qrToken: row.qr_token,
    tokenNumber: row.token_number,
    status: row.status,
    travelMode: row.travel_mode,
    pledgeOnTime: Boolean(row.pledge_on_time),
    bookedAt: row.booked_at,
    holdExpiresAt: toIso(row.hold_expires_at),
    checkedInAt: row.checked_in_at,
    cancelledAt: row.cancelled_at,
    waitlistPosition: row.waitlist_position !== undefined ? Number(row.waitlist_position) : undefined,
    campTitle: row.camp_title || row.title || undefined,
    campDate: row.camp_date || undefined,
    venue: row.venue || undefined,
    address: row.address || undefined,
    city: row.city || undefined,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined,
    mapsUrl: mapsUrl || undefined,
    // The exact string encoded in the ticket QR: Google Maps directions plus the
    // opaque ticket token in the fragment (ignored by Maps, read by our scanner).
    qrPayload: buildTicketQrPayload(mapsUrl, row.qr_token) || undefined,
    startTime: row.start_time || undefined,
    endTime: row.end_time || undefined,
  };
}

/** Everything a transactional message needs, with a real Maps navigation URL. */
function bookingMessageDetails({ booking, patient, camp, slot }) {
  const mapsUrl = buildMapsUrl(camp || {});
  return {
    patientName: patient?.name,
    bookingId: booking?.id,
    tokenNumber: booking?.token_number,
    qrToken: booking?.qr_token,
    campTitle: camp?.title,
    campDate: camp?.camp_date,
    startTime: slot?.start_time,
    endTime: slot?.end_time,
    venue: camp?.venue,
    address: camp?.address,
    city: camp?.city,
    mapsUrl,
    shortUrl: buildShortNavigationUrl(publicBaseUrl(process.env), booking?.qr_token),
  };
}

/** Attach real camp/slot context to a booking row before it is serialised. */
function withBookingContext(row, camp, slot) {
  if (!row) return row;
  return {
    ...row,
    camp_title: camp?.camp_title || camp?.title || row.camp_title || row.title,
    camp_date: camp?.camp_date || row.camp_date,
    venue: camp?.venue || row.venue,
    address: camp?.address || row.address,
    city: camp?.city || row.city,
    latitude: camp?.latitude ?? row.latitude,
    longitude: camp?.longitude ?? row.longitude,
    start_time: slot?.start_time || row.start_time,
    end_time: slot?.end_time || row.end_time,
  };
}

/** Only the minimum promoted-patient identity is safe for a REST response. */
function publicPromotedPatient(patient) {
  if (!patient) return null;
  return { id: patient.id, name: patient.name };
}

function publicNotification(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    userId: row.user_id,
    channel: row.channel,
    type: row.type,
    recipient: row.recipient,
    subject: row.subject,
    message: row.message,
    provider: row.provider,
    status: row.status,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || null,
    providerMessageId: row.provider_message_id || null,
    simulated: String(row.status || '').toUpperCase() === 'SIMULATED',
    sentAt: row.sent_at,
    updatedAt: row.updated_at || row.sent_at,
  };
}

/**
 * Read a MySQL JSON column defensively.
 * mysql2 returns JSON columns already decoded; some driver/pool configs return
 * the raw string. Handle both so a page can never 500 on valid data.
 */
function decodeJsonColumn(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { raw: String(value) };
  }
}

async function auditLog({ actorId, actorName, action, targetType, targetId, before, after }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, \`before\`, \`after\`)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [actorId, actorName, action, targetType, targetId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
    );
  } catch (e) {
    // Audit must never break the primary request.
    console.error('[audit] failed:', e.message);
  }
}

async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    // READ COMMITTED minimises gap-lock surprises while SELECT ... FOR UPDATE
    // still provides an exclusive X-lock on the targeted slot index record.
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      /* connection may already be closed */
    }
    throw error;
  } finally {
    conn.release();
  }
}

/* ---------------------------------------------------------------------------
 * Seat holds, confirmation and expiry
 *
 * A successful booking reserves inventory but is deliberately HELD for a short,
 * bounded window. Confirmation is a second, atomic mutation under the same slot
 * row lock. Expiry releases inventory and hands the seat to the next FIFO
 * waiter, so an abandoned checkout can never leak capacity.
 * ------------------------------------------------------------------------- */

function auditEvent(action, targetType, targetId, before, after) {
  return { action, targetType, targetId, before, after };
}

async function writeAuditEvents(events = [], actor = null) {
  for (const event of events) {
    await auditLog({
      actorId: actor?.id || null,
      actorName: actor?.name || 'system',
      ...event,
    });
  }
}

async function fetchBookingRow(conn, bookingId) {
  const [rows] = await conn.query('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
  return rows[0] || null;
}

async function fetchPatientRow(conn, patientId) {
  const [rows] = await conn.query(
    'SELECT id, name, phone, email FROM users WHERE id = ? AND is_active = 1',
    [patientId],
  );
  return rows[0] || null;
}

/** Create (or reuse a cancelled/expired row for) a timed seat reservation. */
async function createHoldBooking(
  conn,
  { slot, camp, patient, travelMode = null, pledge = false, minutes = BOOKING_HOLD_MINUTES, existing = null },
) {
  const qrToken = makeQrToken();
  const tokenNumber = makeTokenNumber();
  let bookingId;
  if (existing?.id) {
    await conn.query(
      `UPDATE bookings
       SET status = 'HELD', qr_token = ?, token_number = ?, travel_mode = ?, pledge_on_time = ?,
           hold_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
           booked_at = NOW(), checked_in_at = NULL, cancelled_at = NULL
       WHERE id = ?`,
      [qrToken, tokenNumber, travelMode, pledge ? 1 : 0, minutes, existing.id],
    );
    bookingId = existing.id;
  } else {
    const [insert] = await conn.query(
      `INSERT INTO bookings
         (slot_id, camp_id, patient_id, qr_token, token_number, status,
          travel_mode, pledge_on_time, hold_expires_at)
       VALUES (?, ?, ?, ?, ?, 'HELD', ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [slot.id, camp.id || camp.camp_id, patient.id, qrToken, tokenNumber, travelMode, pledge ? 1 : 0, minutes],
    );
    bookingId = insert.insertId;
  }
  return fetchBookingRow(conn, bookingId);
}

async function confirmHeldBooking(conn, booking, { slot, camp, patient }) {
  const before = { status: booking.status, holdExpiresAt: toIso(booking.hold_expires_at) };
  await conn.query(
    `UPDATE bookings
     SET status = 'CONFIRMED', hold_expires_at = NULL, cancelled_at = NULL
     WHERE id = ? AND status = 'HELD'`,
    [booking.id],
  );
  await conn.query(
    `UPDATE waitlist
     SET status = 'CANCELLED', promotion_expires_at = NULL
     WHERE slot_id = ? AND patient_id = ? AND status = 'PROMOTED'`,
    [booking.slot_id, booking.patient_id],
  );
  await remindersEngine.scheduleForBooking(conn, {
    bookingId: booking.id,
    campDate: camp.camp_date,
    startTime: slot.start_time,
  });

  const details = bookingMessageDetails({
    booking,
    patient,
    camp,
    slot,
  });
  const built = buildMessages('BOOKING_CONFIRMED', details);
  const payload = { ...details, slotId: slot.id, eventKey: 'confirmed' };
  const notifications = [
    await insertNotification(conn, {
      bookingId: booking.id,
      userId: patient.id,
      channel: 'SMS',
      type: 'BOOKING_CONFIRMED',
      recipient: patient.phone,
      message: built.sms,
      provider: providerFor('SMS'),
      status: 'PENDING',
      eventKey: 'confirmed',
      payload,
    }),
    await insertNotification(conn, {
      bookingId: booking.id,
      userId: patient.id,
      channel: 'EMAIL',
      type: 'BOOKING_CONFIRMED',
      recipient: patient.email,
      subject: built.subject,
      message: built.text,
      provider: providerFor('EMAIL'),
      status: 'PENDING',
      eventKey: 'confirmed',
      payload,
    }),
  ];

  return {
    booking: { ...booking, status: 'CONFIRMED', hold_expires_at: null },
    notifications,
    audit: auditEvent(
      'CONFIRM_HOLD',
      'booking',
      booking.id,
      before,
      { status: 'CONFIRMED', confirmedAt: new Date().toISOString() },
    ),
  };
}

/** Atomically give a released seat to the next eligible FIFO waiter as a HELD claim. */
async function promoteNextWaiter(conn, { slotId, campId, source = 'release' }) {
  const [slotRows] = await conn.query(
    `SELECT s.*, c.title, c.venue, c.address, c.city, c.latitude, c.longitude,
            c.camp_date, c.status AS camp_status
     FROM slots s JOIN camps c ON c.id = s.camp_id
     WHERE s.id = ? FOR UPDATE`,
    [slotId],
  );
  if (!slotRows.length) return null;
  const slot = slotRows[0];
  if (slot.camp_status !== 'PUBLISHED') return null;
  if (Number(slot.booked_count) >= Number(slot.capacity)) return null;

  const [waiters] = await conn.query(
    `SELECT w.*, p.name, p.phone, p.email
     FROM waitlist w JOIN users p ON p.id = w.patient_id
     WHERE w.slot_id = ? AND w.camp_id = ? AND w.status = 'WAITING'
       AND NOT EXISTS (
         SELECT 1 FROM bookings b2
         WHERE b2.patient_id = w.patient_id AND b2.camp_id = w.camp_id
           AND b2.status IN (${ACTIVE_BOOKING_STATUSES.map(() => '?').join(',')})
       )
     ORDER BY w.created_at ASC, w.id ASC
     LIMIT 1 FOR UPDATE`,
    [slotId, campId, ...ACTIVE_BOOKING_STATUSES],
  );
  if (!waiters.length) return null;
  const waiter = waiters[0];

  const [existing] = await conn.query(
    'SELECT * FROM bookings WHERE slot_id = ? AND patient_id = ? FOR UPDATE',
    [slotId, waiter.patient_id],
  );
  const booking = await createHoldBooking(conn, {
    slot,
    camp: { id: campId, title: slot.title, camp_date: slot.camp_date },
    patient: { id: waiter.patient_id, name: waiter.name, phone: waiter.phone, email: waiter.email },
    minutes: PROMOTION_HOLD_MINUTES,
    existing: existing[0] || null,
  });

  const [seatUpdate] = await conn.query(
    `UPDATE slots SET booked_count = booked_count + 1
     WHERE id = ? AND booked_count < capacity`,
    [slotId],
  );
  if (seatUpdate.affectedRows !== 1) {
    throw new ApiError(409, 'Seat changed unexpectedly. Please retry.', 'SEAT_RACE_RETRY');
  }

  await conn.query(
    `UPDATE waitlist SET status = 'PROMOTED', promoted_at = NOW(),
       promotion_expires_at = ? WHERE id = ?`,
    [booking.hold_expires_at, waiter.id],
  );

  const details = bookingMessageDetails({
    booking,
    patient: { name: waiter.name },
    camp: slot,
    slot,
  });
  const built = buildMessages('WAITLIST_PROMOTED', details);
  const payload = {
    ...details,
    fromWaitlistId: waiter.id,
    slotId,
    holdExpiresAt: toIso(booking.hold_expires_at),
    eventKey: `promotion-${waiter.id}`,
  };
  const notifications = [
    await insertNotification(conn, {
      bookingId: booking.id,
      userId: waiter.patient_id,
      channel: 'SMS',
      type: 'WAITLIST_PROMOTED',
      recipient: waiter.phone,
      message: built.sms,
      provider: providerFor('SMS'),
      status: 'PENDING',
      eventKey: `promotion-${waiter.id}`,
      payload,
    }),
    await insertNotification(conn, {
      bookingId: booking.id,
      userId: waiter.patient_id,
      channel: 'EMAIL',
      type: 'WAITLIST_PROMOTED',
      recipient: waiter.email,
      subject: built.subject,
      message: built.text,
      provider: providerFor('EMAIL'),
      status: 'PENDING',
      eventKey: `promotion-${waiter.id}`,
      payload,
    }),
  ];

  return {
    booking,
    patient: { id: waiter.patient_id, name: waiter.name, phone: waiter.phone, email: waiter.email },
    waitlistId: waiter.id,
    notifications,
    source,
    audit: auditEvent(
      'PROMOTE_WAITLIST',
      'booking',
      booking.id,
      { waitlistStatus: 'WAITING' },
      { status: 'HELD', waitlistStatus: 'PROMOTED', source },
    ),
  };
}

/** Release a reserved seat. Used by patient cancellation and both expiry sweeps. */
async function releaseReservedSeat(
  conn,
  booking,
  { finalStatus = 'EXPIRED', reason = 'hold_expired' } = {},
) {
  const [slotRows] = await conn.query(
    `SELECT s.*, c.title, c.venue, c.address, c.city, c.latitude, c.longitude,
            c.camp_date, c.status AS camp_status
     FROM slots s JOIN camps c ON c.id = s.camp_id
     WHERE s.id = ? FOR UPDATE`,
    [booking.slot_id],
  );
  if (!slotRows.length) throw new ApiError(404, 'Slot not found.', 'SLOT_NOT_FOUND');
  const slot = slotRows[0];
  const patient = await fetchPatientRow(conn, booking.patient_id);

  await conn.query(
    `UPDATE bookings SET status = ?, cancelled_at = NOW()
     WHERE id = ? AND status = 'HELD'`,
    [finalStatus, booking.id],
  );
  await remindersEngine.cancelForBooking(conn, booking.id);
  await conn.query(
    'UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = ?',
    [booking.slot_id],
  );
  await conn.query(
    `UPDATE waitlist SET status = 'EXPIRED', promotion_expires_at = NULL
     WHERE slot_id = ? AND patient_id = ? AND status = 'PROMOTED'`,
    [booking.slot_id, booking.patient_id],
  );

  const notifications = [];
  if (patient) {
    const details = bookingMessageDetails({
      booking,
      patient,
      camp: slot,
      slot,
    });
    const built = buildMessages('CANCELLATION', details);
    const payload = { ...details, reason, eventKey: `release-${finalStatus}` };
    notifications.push(
      await insertNotification(conn, {
        bookingId: booking.id,
        userId: patient.id,
        channel: 'SMS',
        type: 'CANCELLATION',
        recipient: patient.phone,
        message: built.sms,
        provider: providerFor('SMS'),
        status: 'PENDING',
        eventKey: `release-${finalStatus}`,
        payload,
      }),
      await insertNotification(conn, {
        bookingId: booking.id,
        userId: patient.id,
        channel: 'EMAIL',
        type: 'CANCELLATION',
        recipient: patient.email,
        subject: built.subject,
        message: built.text,
        provider: providerFor('EMAIL'),
        status: 'PENDING',
        eventKey: `release-${finalStatus}`,
        payload,
      }),
    );
  }

  const promoted = await promoteNextWaiter(conn, {
    slotId: booking.slot_id,
    campId: booking.camp_id,
    source: reason,
  });
  if (promoted) notifications.push(...promoted.notifications);

  return {
    releasedBooking: { ...booking, status: finalStatus, cancelled_at: new Date() },
    promoted,
    notifications,
    slotId: booking.slot_id,
    campId: booking.camp_id,
    audits: [
      auditEvent(
        finalStatus === 'CANCELLED' ? 'CANCEL_BOOKING' : 'EXPIRE_HOLD',
        'booking',
        booking.id,
        { status: 'HELD', holdExpiresAt: toIso(booking.hold_expires_at) },
        { status: finalStatus, reason },
      ),
      ...(promoted ? [promoted.audit] : []),
    ],
  };
}

async function runHoldExpirySweep(trigger = 'cron') {
  const summary = await withTransaction(async (conn) => {
    const result = {
      expiredHolds: 0,
      expiredPromotions: 0,
      promotedWaiters: 0,
      notifications: [],
      audits: [],
      slotIds: new Set(),
    };

    const [expiredHolds] = await conn.query(
      `SELECT id FROM bookings
       WHERE status = 'HELD' AND hold_expires_at <= NOW()
       ORDER BY hold_expires_at ASC, id ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [HOLD_EXPIRY_BATCH_SIZE],
    );
    for (const row of expiredHolds) {
      const booking = await fetchBookingRow(conn, row.id);
      if (!booking || booking.status !== 'HELD') continue;
      const outcome = await releaseReservedSeat(conn, booking, {
        finalStatus: 'EXPIRED',
        reason: 'hold_expired',
      });
      result.expiredHolds += 1;
      result.slotIds.add(outcome.slotId);
      result.notifications.push(...outcome.notifications);
      result.audits.push(...outcome.audits);
      if (outcome.promoted) result.promotedWaiters += 1;
    }

    const [expiredPromotions] = await conn.query(
      `SELECT id FROM waitlist
       WHERE status = 'PROMOTED' AND promotion_expires_at <= NOW()
       ORDER BY promotion_expires_at ASC, id ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [HOLD_EXPIRY_BATCH_SIZE],
    );
    for (const row of expiredPromotions) {
      const [rows] = await conn.query(
        'SELECT * FROM waitlist WHERE id = ? AND status = \'PROMOTED\' FOR UPDATE',
        [row.id],
      );
      const waitlist = rows[0];
      if (!waitlist) continue;
      const [bookingRows] = await conn.query(
        `SELECT * FROM bookings
         WHERE slot_id = ? AND patient_id = ? AND status = 'HELD'
         LIMIT 1 FOR UPDATE`,
        [waitlist.slot_id, waitlist.patient_id],
      );
      if (bookingRows.length) {
        const outcome = await releaseReservedSeat(conn, bookingRows[0], {
          finalStatus: 'EXPIRED',
          reason: 'promotion_expired',
        });
        result.expiredPromotions += 1;
        result.slotIds.add(outcome.slotId);
        result.notifications.push(...outcome.notifications);
        result.audits.push(...outcome.audits);
        if (outcome.promoted) result.promotedWaiters += 1;
      } else {
        await conn.query(
          `UPDATE waitlist SET status = 'EXPIRED', promotion_expires_at = NULL WHERE id = ?`,
          [waitlist.id],
        );
        result.expiredPromotions += 1;
        result.audits.push(
          auditEvent('EXPIRE_PROMOTION', 'waitlist', waitlist.id, { status: 'PROMOTED' }, { status: 'EXPIRED' }),
        );
      }
    }

    return { ...result, slotIds: [...result.slotIds] };
  });

  await writeAuditEvents(summary.audits, { id: null, name: 'system' });
  publishNotifications(summary.notifications);
  emitBounded(io, 'holds:expired', { trigger, ...summary });
  return {
    trigger,
    expiredHolds: summary.expiredHolds,
    expiredPromotions: summary.expiredPromotions,
    promotedWaiters: summary.promotedWaiters,
    slotIds: summary.slotIds,
  };
}

/* ---------------------------------------------------------------------------
 * Authentication & role middleware
 * ------------------------------------------------------------------------- */

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES, issuer: 'chsc-cmrit' },
  );
}

/**
 * Resolve the *current* user from the database. JWT claims for role/name are
 * snapshots and must never be trusted after a role change, deactivation or
 * rename: only `sub` is authoritative. Helper-generated tokens only need a
 * valid `sub` — the DB supplies role/name/email.
 */
async function userFromToken(token) {
  const payload = jwt.verify(token, JWT_SECRET, { issuer: 'chsc-cmrit' });
  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(401, 'Session expired or token invalid.', 'AUTH_INVALID');
  }
  const [rows] = await pool.query(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
    [id],
  );
  if (!rows.length || !rows[0].is_active) {
    throw new ApiError(401, 'User no longer active.', 'USER_INACTIVE');
  }
  return {
    id: rows[0].id,
    role: rows[0].role,
    name: rows[0].name,
    email: rows[0].email,
  };
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

const authenticate = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) return next(new ApiError(401, 'Authentication token required.', 'AUTH_REQUIRED'));
  try {
    req.user = await userFromToken(token);
    return next();
  } catch (error) {
    if (error instanceof ApiError || error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'Session expired or token invalid.', 'AUTH_INVALID'));
    }
    return next(error);
  }
});

async function optionalAuth(req, _res, next) {
  const token = bearerToken(req);
  if (token) {
    try {
      req.user = await userFromToken(token);
    } catch (_) {
      req.user = null;
    }
  }
  next();
}

function requireRole(...roles) {
  const allowed = roles.map((r) => r.toUpperCase());
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required.', 'AUTH_REQUIRED'));
    if (!allowed.includes(req.user.role)) {
      return next(
        new ApiError(403, `Role ${req.user.role} cannot perform this action.`, 'ROLE_FORBIDDEN', {
          allowed,
        }),
      );
    }
    return next();
  };
}

/* ---------------------------------------------------------------------------
 * Transactional gateway (SMTP + Fast2SMS, sandbox when unconfigured)
 * ------------------------------------------------------------------------- */

function providerMeta(channel) {
  const provider =
    channel === 'SMS' ? providers.sms : channel === 'PUSH' ? providers.push : providers.email;
  return {
    name: provider.name,
    live: Boolean(provider.live),
    status: provider.live ? 'PENDING' : 'SIMULATED',
    simulated: !provider.live,
  };
}

function providerFor(channel) {
  return providerMeta(channel).name;
}

const MAX_DELIVERY_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stable idempotency key: one event, one channel, one booking/user. */
function notificationDedupeKey(data) {
  if (data.dedupeKey) return String(data.dedupeKey).slice(0, 190);
  const event = data.eventKey || 'primary';
  const owner = data.bookingId ? `b${data.bookingId}` : `u${data.userId || 0}`;
  return `${owner}:${data.type}:${data.channel}:${event}`.slice(0, 190);
}

async function insertNotification(conn, data) {
  const payload = data.payload ? JSON.stringify(data.payload) : null;
  const meta = providerMeta(data.channel);
  // A configured real provider starts PENDING and is updated to SENT/FAILED by
  // the delivery attempt. With no credentials it stays honestly SIMULATED.
  const status = meta.live ? 'PENDING' : 'SIMULATED';
  const dedupeKey = notificationDedupeKey(data);
  const [result] = await conn.query(
    `INSERT INTO notifications_log
       (booking_id, user_id, channel, type, recipient, subject, message, provider, status,
        dedupe_key, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      data.bookingId || null,
      data.userId || null,
      data.channel,
      data.type,
      data.recipient,
      data.subject || null,
      data.message,
      data.provider || meta.name,
      status,
      dedupeKey,
      payload,
    ],
  );
  const duplicate = Number(result.affectedRows) !== 1;
  return {
    id: result.insertId,
    bookingId: data.bookingId || null,
    userId: data.userId || null,
    channel: data.channel,
    type: data.type,
    recipient: data.recipient,
    subject: data.subject || null,
    message: data.message,
    provider: data.provider || meta.name,
    status,
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    dedupeKey,
    payload: data.payload || null,
    duplicate,
    sentAt: new Date().toISOString(),
    simulated: meta.simulated,
  };
}

async function updateNotificationStatus(id, status, extra = {}) {
  try {
    const columns = ['status = ?'];
    const params = [status];
    if (extra.attempts !== undefined) {
      columns.push('attempts = ?');
      params.push(extra.attempts);
    }
    if (extra.lastError !== undefined) {
      columns.push('last_error = ?');
      params.push(extra.lastError ? String(extra.lastError).slice(0, 500) : null);
    }
    if (extra.providerMessageId !== undefined) {
      columns.push('provider_message_id = ?');
      params.push(extra.providerMessageId ? String(extra.providerMessageId).slice(0, 190) : null);
    }
    params.push(id);
    await pool.query(`UPDATE notifications_log SET ${columns.join(', ')} WHERE id = ?`, params);
  } catch (error) {
    console.warn('[notification status update]', error.message);
  }
}

/**
 * Rebuild the full logistics payload for a notification. New rows carry it in
 * `payload`; legacy rows are hydrated from the booking so an admin retry still
 * produces a complete, navigable message.
 */
async function hydrateNotificationDetails(row) {
  const payload = decodeJsonColumn(row.payload) || {};
  const details = {
    patientName: payload.patientName,
    bookingId: row.booking_id,
    tokenNumber: payload.tokenNumber,
    qrToken: payload.qrToken,
    campTitle: payload.campTitle,
    campDate: payload.campDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    venue: payload.venue,
    address: payload.address,
    city: payload.city,
    mapsUrl: payload.mapsUrl,
    shortUrl: payload.shortUrl,
    waitlistPosition: payload.waitlistPosition,
  };

  if (row.booking_id && (!details.campTitle || !details.mapsUrl || !details.qrToken)) {
    const [rows] = await pool.query(
      `SELECT b.id, b.token_number, b.qr_token, p.name AS patient_name,
              c.title, c.camp_date, c.venue, c.address, c.city, c.latitude, c.longitude,
              s.start_time, s.end_time
       FROM bookings b
       JOIN camps c ON c.id = b.camp_id
       JOIN slots s ON s.id = b.slot_id
       JOIN users p ON p.id = b.patient_id
       WHERE b.id = ?`,
      [row.booking_id],
    );
    if (rows.length) {
      const booking = rows[0];
      details.patientName = details.patientName || booking.patient_name;
      details.tokenNumber = details.tokenNumber || booking.token_number;
      details.qrToken = details.qrToken || booking.qr_token;
      details.campTitle = details.campTitle || booking.title;
      details.campDate = details.campDate || booking.camp_date;
      details.startTime = details.startTime || booking.start_time;
      details.endTime = details.endTime || booking.end_time;
      details.venue = details.venue || booking.venue;
      details.address = details.address || booking.address;
      details.city = details.city || booking.city;
      details.mapsUrl = details.mapsUrl || buildMapsUrl(booking);
      details.shortUrl =
        details.shortUrl ||
        buildShortNavigationUrl(publicBaseUrl(process.env), details.qrToken);
    }
  }

  if (!details.mapsUrl && (details.venue || details.address)) {
    details.mapsUrl = buildMapsUrl(details);
  }
  return details;
}

async function deliverNotification(notification, { force = false } = {}) {
  if (!notification?.id) return null;
  try {
    const [rows] = await pool.query('SELECT * FROM notifications_log WHERE id = ?', [
      notification.id,
    ]);
    if (!rows.length) return null;
    const row = rows[0];

    // Idempotent: a completed or honestly-simulated row is never re-sent unless
    // an administrator explicitly asks for a retry.
    if (!force && ['SENT', 'SIMULATED'].includes(row.status)) return row;

    const provider =
      row.channel === 'SMS' ? providers.sms : row.channel === 'PUSH' ? providers.push : providers.email;
    const subscriptions = row.channel === 'PUSH'
      ? await loadPushSubscriptions(pool, row.user_id)
      : [];
    if (row.channel === 'PUSH' && !subscriptions.length) {
      // The mirror is only created when a device exists; this guards a race
      // where the browser revoked the subscription before delivery started.
      await updateNotificationStatus(row.id, 'SIMULATED', {
        lastError: 'No subscribed browser device remained at delivery time.',
      });
      return { ...row, status: 'SIMULATED' };
    }
    const details = await hydrateNotificationDetails(row);
    const built = buildMessages(row.type, details, { qrCid: 'chsc-ticket' });

    if (!provider.live) {
      // Sandbox is an honest audit state, not a provider delivery.
      console.log(
        `[GATEWAY ${row.channel} · ${provider.name}] → ${redactRecipient(row.recipient)} (message omitted)`,
      );
      await updateNotificationStatus(row.id, 'SIMULATED', {
        attempts: Number(row.attempts || 0),
        lastError: null,
      });
      return { ...row, status: 'SIMULATED' };
    }

    if (!row.recipient) {
      await updateNotificationStatus(row.id, 'FAILED', {
        lastError: 'No recipient on file for this channel.',
      });
      return { ...row, status: 'FAILED' };
    }

    let attachments = [];
    if (row.channel === 'EMAIL' && QRCode && details.qrToken) {
      try {
        const qrPayload = buildTicketQrPayload(details.mapsUrl, details.qrToken);
        const png = await QRCode.toBuffer(qrPayload, {
          type: 'png',
          width: 420,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#04310f', light: '#ffffff' },
        });
        attachments = [{ filename: 'chsc-pass.png', content: png, cid: 'chsc-ticket' }];
      } catch (qrError) {
        console.warn('[email qr]', qrError.message);
      }
    }

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await updateNotificationStatus(row.id, 'QUEUED', { attempts: attempt });
      try {
        const result = await provider.send({
          to: row.recipient,
          subject: built.subject,
          text: row.channel === 'SMS' ? built.sms : built.text,
          html: row.channel === 'EMAIL' ? built.html : undefined,
          attachments,
          replyTo: process.env.MAIL_REPLY_TO || undefined,
          ...(row.channel === 'PUSH'
            ? { subscriptions, url: pushTargetUrl(process.env) }
            : {}),
        });
        if (result.expired?.length) await prunePushSubscriptions(pool, result.expired);
        const finalStatus = result.simulated ? 'SIMULATED' : 'SENT';
        await updateNotificationStatus(row.id, finalStatus, {
          attempts: attempt,
          lastError: null,
          providerMessageId: result.reference || null,
        });
        return { ...row, status: finalStatus, attempts: attempt };
      } catch (error) {
        lastError = error;
        console.warn(
          `[gateway delivery ${row.channel} attempt ${attempt}/${MAX_DELIVERY_ATTEMPTS}]`,
          String(error.message || error).slice(0, 200),
        );
        if (attempt < MAX_DELIVERY_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
      }
    }

    await updateNotificationStatus(row.id, 'FAILED', {
      attempts: MAX_DELIVERY_ATTEMPTS,
      lastError: lastError?.message || 'Provider rejected the message.',
    });
    return { ...row, status: 'FAILED', lastError: lastError?.message || null };
  } catch (error) {
    console.warn('[gateway delivery]', error.message);
    await updateNotificationStatus(notification.id, 'FAILED', { lastError: error.message });
    return null;
  }
}

/**
 * Mirror a real booking/reminder event to the patient's enabled browser devices.
 * A push row is created only when at least one live subscription exists, so a
 * user who never opted in never receives a failed or fabricated delivery row.
 */
async function queueDevicePush(notification) {
  if (!notification?.userId || !providers.push.live) return null;
  const subscriptions = await loadPushSubscriptions(pool, notification.userId);
  if (!subscriptions.length) return null;

  const rowLike = {
    booking_id: notification.bookingId || null,
    user_id: notification.userId,
    payload: notification.payload || null,
  };
  const details = await hydrateNotificationDetails(rowLike);
  const built = buildMessages(notification.type, details, { qrCid: 'chsc-ticket' });
  const dedupeKey = notification.dedupeKey
    ? notification.dedupeKey.replace(/:(EMAIL|SMS):/, ':PUSH:')
    : notificationDedupeKey({
        bookingId: notification.bookingId,
        userId: notification.userId,
        type: notification.type,
        channel: 'PUSH',
      });

  const created = await insertNotification(pool, {
    bookingId: notification.bookingId,
    userId: notification.userId,
    channel: 'PUSH',
    type: notification.type,
    recipient: `device:${notification.userId}`,
    subject: built.subject,
    message: String(built.text).slice(0, 480),
    dedupeKey,
    payload: { ...details, devicePush: true },
  });
  if (!created.duplicate) {
    const safe = redactNotificationForSocket(created);
    emitBounded(io, 'gateway:message', safe);
    emitBounded(io, 'notification:new', safe);
    deliverNotification(created);
  }
  return created;
}

function publishNotifications(notifications = []) {
  for (const notification of notifications) {
    if (!notification || notification.duplicate) continue;
    // The live Gateway Interceptor Drawer listens to a PII-free summary.
    const safe = redactNotificationForSocket(notification);
    emitBounded(io, 'gateway:message', safe);
    emitBounded(io, 'notification:new', safe);
    deliverNotification(notification);
    queueDevicePush(notification).catch((error) => {
      console.warn('[device push mirror]', String(error.message || error).slice(0, 200));
    });
  }
}

/** Every socket emission goes through a byte-size guard. */
function emitBounded(target, event, payload) {
  target.emit(event, limitSocketPayload(payload));
}

/** Booking summaries broadcast to rooms never contain patient identifiers. */
function safeSocketBooking(booking = {}) {
  return {
    id: booking.id,
    tokenNumber: booking.token_number ?? booking.tokenNumber,
    status: booking.status,
    campId: booking.camp_id ?? booking.campId,
    checkedInAt: booking.checked_in_at ?? booking.checkedInAt,
  };
}

/**
 * Camp room authorization. Organizers/admins manage any camp; other staff must
 * be assigned to that camp; patients must hold a booking there. Anonymous
 * sockets are rejected before connection by the handshake middleware.
 */
async function canJoinCampRoom(user, campId, conn = pool) {
  if (!user || !user.id || !user.role) return false;
  const id = Number(campId);
  if (!Number.isInteger(id) || id <= 0) return false;
  if (user.role === 'ADMIN' || user.role === 'ORGANIZER') return true;

  if (user.role === 'PATIENT') {
    const [rows] = await conn.query(
      'SELECT 1 FROM bookings WHERE patient_id = ? AND camp_id = ? LIMIT 1',
      [user.id, id],
    );
    return rows.length > 0;
  }

  if (['DOCTOR', 'VOLUNTEER', 'NURSE', 'COORDINATOR'].includes(user.role)) {
    const [rows] = await conn.query(
      'SELECT 1 FROM staff_assignments WHERE user_id = ? AND camp_id = ? LIMIT 1',
      [user.id, id],
    );
    return rows.length > 0;
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * Slot generation & camp bundle queries
 * ------------------------------------------------------------------------- */

function buildSlotPlan(startTime, endTime, slotDurationMins, totalCapacity) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  const duration = Number(slotDurationMins);
  const capacity = Number(totalCapacity);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new ApiError(400, 'startTime and endTime must be HH:MM.', 'INVALID_TIME');
  }
  if (!Number.isFinite(duration) || duration < 5) {
    throw new ApiError(400, 'slotDurationMins must be at least 5.', 'INVALID_DURATION');
  }
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new ApiError(400, 'totalCapacity must be a positive integer.', 'INVALID_CAPACITY');
  }
  if (end <= start) {
    throw new ApiError(400, 'endTime must be after startTime.', 'INVALID_INTERVAL');
  }

  // k = floor((T_end - T_start) / Δt)
  const k = Math.floor((end - start) / duration);
  if (k < 1) {
    throw new ApiError(400, 'The camp interval is shorter than one slot.', 'INVALID_INTERVAL');
  }
  if (capacity < k) {
    throw new ApiError(
      400,
      `Capacity (${capacity}) must be at least the number of slots (${k}).`,
      'CAPACITY_TOO_SMALL',
    );
  }

  // base = floor(C_camp / k); remainder = C_camp mod k
  const base = Math.floor(capacity / k);
  const remainder = capacity % k;

  return Array.from({ length: k }, (_, index) => {
    const slotStart = start + index * duration;
    const slotEnd = slotStart + duration;
    return {
      slotIndex: index + 1,
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      capacity: base + (index < remainder ? 1 : 0),
    };
  });
}

async function loadCampBundle(campId, conn = pool) {
  const [campRows] = await conn.query(
    `SELECT c.*, u.name AS creator_name,
       (SELECT COALESCE(SUM(s.capacity), 0) FROM slots s WHERE s.camp_id = c.id) AS slot_capacity,
       (SELECT COALESCE(SUM(s.booked_count), 0) FROM slots s WHERE s.camp_id = c.id) AS booked_total,
       (SELECT COUNT(*) FROM waitlist w WHERE w.camp_id = c.id AND w.status = 'WAITING') AS waiting_total,
       (SELECT COUNT(*) FROM staff_assignments sa WHERE sa.camp_id = c.id) AS staff_total
     FROM camps c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = ?`,
    [campId],
  );
  if (!campRows.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');

  const [slotRows] = await conn.query(
    `SELECT s.*,
       (SELECT COUNT(*) FROM waitlist w WHERE w.slot_id = s.id AND w.status = 'WAITING') AS waiting_count
     FROM slots s WHERE s.camp_id = ? ORDER BY s.slot_index`,
    [campId],
  );
  const [staffRows] = await conn.query(
    `SELECT sa.*, u.name
     FROM staff_assignments sa JOIN users u ON u.id = sa.user_id
     WHERE sa.camp_id = ? ORDER BY sa.role_at_camp, u.name`,
    [campId],
  );

  const camp = publicCamp(campRows[0]);
  camp.slots = slotRows.map(publicSlot);
  camp.staff = staffRows.map(publicStaff);
  camp.loadWarnings = camp.staff
    .filter((member) => member.loadWarning)
    .map((member) => ({
      staffId: member.id,
      name: member.name,
      roleAtCamp: member.roleAtCamp,
      expected: member.expectedLoadPerHour,
      threshold: member.maxPatientsPerHour,
      message: `${member.name} assigned ${member.expectedLoadPerHour} patients/hr — exceeds ${member.maxPatientsPerHour}/hr safe threshold.`,
    }));
  return camp;
}

async function loadAllCampBundles() {
  return (await loadCampCollection()).camps;
}

/**
 * Paginated camp collection in exactly three queries (camps + slots + staff)
 * regardless of page size — no N+1 round trips.
 */
async function loadCampCollection({ where = `c.status IN ('PUBLISHED','COMPLETED')`, params = [], limit = null, offset = 0 } = {}) {
  const paged = Number.isFinite(limit);
  const [campRows] = await pool.query(
    `SELECT c.*, u.name AS creator_name,
       (SELECT COALESCE(SUM(s.capacity), 0) FROM slots s WHERE s.camp_id = c.id) AS slot_capacity,
       (SELECT COALESCE(SUM(s.booked_count), 0) FROM slots s WHERE s.camp_id = c.id) AS booked_total,
       (SELECT COUNT(*) FROM waitlist w WHERE w.camp_id = c.id AND w.status = 'WAITING') AS waiting_total,
       (SELECT COUNT(*) FROM staff_assignments sa WHERE sa.camp_id = c.id) AS staff_total
     FROM camps c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE ${where}
     ORDER BY c.camp_date ASC, c.start_time ASC, c.id ASC
     ${paged ? 'LIMIT ? OFFSET ?' : ''}`,
    paged ? [...params, limit, offset] : params,
  );

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM camps c WHERE ${where}`,
    params,
  );
  const total = Number(countRow.total);

  if (!campRows.length) return { camps: [], total };

  const ids = campRows.map((row) => row.id);
  const [slotRows] = await pool.query(
    `SELECT s.*,
       (SELECT COUNT(*) FROM waitlist w WHERE w.slot_id = s.id AND w.status = 'WAITING') AS waiting_count
     FROM slots s WHERE s.camp_id IN (?) ORDER BY s.camp_id, s.slot_index`,
    [ids],
  );
  const [staffRows] = await pool.query(
    `SELECT sa.*, u.name
     FROM staff_assignments sa JOIN users u ON u.id = sa.user_id
     WHERE sa.camp_id IN (?) ORDER BY sa.camp_id, sa.role_at_camp, u.name`,
    [ids],
  );

  const slotsByCamp = new Map();
  for (const row of slotRows) {
    if (!slotsByCamp.has(row.camp_id)) slotsByCamp.set(row.camp_id, []);
    slotsByCamp.get(row.camp_id).push(publicSlot(row));
  }
  const staffByCamp = new Map();
  for (const row of staffRows) {
    if (!staffByCamp.has(row.camp_id)) staffByCamp.set(row.camp_id, []);
    staffByCamp.get(row.camp_id).push(publicStaff(row));
  }

  const camps = campRows.map((row) => {
    const camp = publicCamp(row);
    camp.slots = slotsByCamp.get(row.id) || [];
    camp.staff = staffByCamp.get(row.id) || [];
    camp.loadWarnings = camp.staff
      .filter((member) => member.loadWarning)
      .map((member) => ({
        staffId: member.id,
        name: member.name,
        roleAtCamp: member.roleAtCamp,
        expected: member.expectedLoadPerHour,
        threshold: member.maxPatientsPerHour,
        message: `${member.name} assigned ${member.expectedLoadPerHour} patients/hr — exceeds ${member.maxPatientsPerHour}/hr safe threshold.`,
      }));
    return camp;
  });

  return { camps, total };
}

/* ---------------------------------------------------------------------------
 * Queue snapshot + analytics + advisor helpers
 * ------------------------------------------------------------------------- */

async function getQueueSnapshot(campId) {
  const [rows] = await pool.query(
    `SELECT b.id, b.token_number, b.status, b.checked_in_at,
            u.name AS patient_name, s.start_time, s.end_time
     FROM bookings b
     JOIN users u ON u.id = b.patient_id
     JOIN slots s ON s.id = b.slot_id
         WHERE b.camp_id = ? AND b.status = 'CHECKED_IN'
         ORDER BY b.checked_in_at ASC, b.id ASC`,
      [campId],
    );

    const now = Date.now();
  const checkedIn = rows.map((row) => {
    const checked = row.checked_in_at ? new Date(row.checked_in_at).getTime() : now;
    return {
      id: row.id,
      tokenNumber: row.token_number,
      patientName: maskName(row.patient_name),
      checkedInAt: row.checked_in_at,
      slot: `${formatTime12(row.start_time)} – ${formatTime12(row.end_time)}`,
      waitedMinutes: Math.max(0, Math.round((now - checked) / 60000)),
    };
  });

  const waits = checkedIn.map((item) => item.waitedMinutes);
  const averageWaitMinutes = waits.length
    ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length)
    : 0;

  return {
    campId: Number(campId),
    current: checkedIn[0] || null,
    next: checkedIn.slice(1, 5),
    totalCheckedIn: checkedIn.length,
    averageWaitMinutes,
    updatedAt: new Date().toISOString(),
  };
}

async function buildAnalytics() {
  const [[patientCount]] = await pool.query(
    `SELECT COUNT(*) AS total FROM users WHERE role = 'PATIENT' AND is_active = 1`,
  );
  const [[promotedCount]] = await pool.query(
    `SELECT COUNT(*) AS total FROM waitlist WHERE status = 'PROMOTED'`,
  );
  const [campRows] = await pool.query(
    `SELECT c.id, c.title, c.venue, c.camp_date, c.status, c.total_capacity, c.physical_capacity,
       (SELECT COALESCE(SUM(s.capacity), 0) FROM slots s WHERE s.camp_id = c.id) AS slot_capacity,
       (SELECT COALESCE(SUM(s.booked_count), 0) FROM slots s WHERE s.camp_id = c.id) AS booked_total
     FROM camps c
     WHERE c.status IN ('PUBLISHED','COMPLETED')
     ORDER BY c.camp_date ASC`,
  );
  const [statusRows] = await pool.query(
    `SELECT b.camp_id, b.status, COUNT(*) AS total
     FROM bookings b
     JOIN camps c ON c.id = b.camp_id
     WHERE c.status = 'COMPLETED'
       AND b.status IN ('CHECKED_IN','COMPLETED','NO_SHOW')
     GROUP BY b.camp_id, b.status`,
  );
  const [hourRows] = await pool.query(
    `SELECT HOUR(s.start_time) AS hour_of_day,
            SUM(s.booked_count) AS booked,
            SUM(s.capacity) AS capacity
     FROM slots s JOIN camps c ON c.id = s.camp_id
     WHERE c.status = 'PUBLISHED'
     GROUP BY HOUR(s.start_time)
     ORDER BY hour_of_day`,
  );

  const statusMap = new Map();
  for (const row of statusRows) {
    if (!statusMap.has(row.camp_id)) statusMap.set(row.camp_id, {});
    statusMap.get(row.camp_id)[row.status] = Number(row.total);
  }

  const bookingsVsCapacity = campRows.map((camp) => ({
    camp: camp.title
      .replace(' Community Health Camp', '')
      .replace(' Primary Health Camp', '')
      .replace(' (Completed)', ''),
    short: camp.venue.split(' ')[0],
    bookings: Number(camp.booked_total || 0),
    capacity: Number(camp.slot_capacity || camp.total_capacity || 0),
    date: camp.camp_date,
    status: camp.status,
    provenance: 'live-mysql',
  }));

  const attendanceVsNoShow = campRows
    .filter((camp) => camp.status === 'COMPLETED')
    .map((camp) => {
      const counts = statusMap.get(camp.id) || {};
      return {
        camp: camp.venue.split(' ')[0],
        attended: Number(counts.CHECKED_IN || 0) + Number(counts.COMPLETED || 0),
        noShow: Number(counts.NO_SHOW || 0),
        provenance: 'live-mysql',
      };
    });

  const hourlyUtilisation = hourRows.map((row) => ({
    hour: `${String(row.hour_of_day).padStart(2, '0')}:00`,
    utilisation: Number(row.capacity)
      ? Math.round((Number(row.booked) / Number(row.capacity)) * 100)
      : 0,
    booked: Number(row.booked),
    capacity: Number(row.capacity),
    provenance: 'live-mysql',
  }));

  let attended = 0;
  let noShow = 0;
  statusRows.forEach((row) => {
    if (row.status === 'NO_SHOW') noShow += Number(row.total);
    else attended += Number(row.total);
  });
  const completedTotal = attended + noShow;
  const noShowRate = completedTotal ? (noShow / completedTotal) * 100 : 0;
  const attendanceRate = completedTotal ? (attended / completedTotal) * 100 : 0;

  return {
    kpis: {
      totalRegistered: Number(patientCount.total),
      attendanceRate: Number(attendanceRate.toFixed(1)),
      waitlistPromotions: Number(promotedCount.total),
      totalBookings: statusRows.reduce((sum, row) => sum + Number(row.total), 0),
      noShowRate: Number(noShowRate.toFixed(1)),
    },
    bookingsVsCapacity,
    attendanceVsNoShow,
    hourlyUtilisation,
    meta: {
      generatedAt: new Date().toISOString(),
      engine: 'MySQL aggregate queries',
      isolation: 'READ COMMITTED + explicit row locks for writes',
      provenance: 'live-mysql',
      note: 'All analytics values are computed from live database rows. Empty periods return zero rather than invented figures.',
    },
  };
}

async function buildCapacityAdvisor(physicalCapacity = 100, alphaMax = ALPHA_MAX) {
  const [[historical]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN b.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS no_shows
     FROM bookings b
     JOIN camps c ON c.id = b.camp_id
     WHERE c.status = 'COMPLETED'
       AND b.status IN ('CHECKED_IN','COMPLETED','NO_SHOW')`,
  );
  const total = Number(historical.total || 0);
  const noShows = Number(historical.no_shows || 0);
  const p = total > 0 ? noShows / total : 0;
  const cPhys = Math.max(1, Number(physicalCapacity) || 100);
  const cap = Number(alphaMax) >= 0 ? Number(alphaMax) : ALPHA_MAX;
  const rawRecommendation = Math.ceil(cPhys / Math.max(0.01, 1 - p));
  const safetyCeiling = Math.floor(cPhys * (1 + cap));
  const recommended = Math.max(cPhys, Math.min(rawRecommendation, safetyCeiling));
  const buffer = recommended - cPhys;
  const expectedAttendance = recommended * (1 - p);
  const expectedDoctorUtilisation = Math.min(
    100,
    Number(((expectedAttendance / cPhys) * 100).toFixed(1)),
  );

  return {
    badge: 'Rule-Based Statistical Heuristic — NOT Black-Box AI/ML',
    formula: 'min( ceil(C_phys / (1 - p)), floor(C_phys × (1 + α_max)) )',
    sampleSize: total,
    noShows,
    noShowRate: Number((p * 100).toFixed(1)),
    physicalCapacity: cPhys,
    alphaMax: cap,
    rawRecommendation,
    safetyCeiling,
    recommended,
    buffer,
    expectedAttendance: Number(expectedAttendance.toFixed(1)),
    expectedDoctorUtilisation,
    interpretation:
      'The advisor only reallocates a bounded safety buffer. Clinical judgement and venue constraints remain authoritative.',
  };
}

/* ---------------------------------------------------------------------------
 * Ops readiness — delivery configuration + camp run-readiness
 *
 * Every value is derived from live rows or from the presence (never the value)
 * of an environment variable. No score is estimated; the checks and their
 * weights are printed next to the result.
 * ------------------------------------------------------------------------- */

function groupByCamp(rows, build) {
  const map = new Map();
  for (const row of rows) map.set(Number(row.camp_id), build(row));
  return map;
}

async function buildOpsReadiness() {
  const [campRows] = await pool.query(
    `SELECT id, title, status, venue, address, city, latitude, longitude,
            camp_date, start_time, end_time, total_capacity, physical_capacity
       FROM camps
      WHERE status IN ('DRAFT','PUBLISHED')
      ORDER BY camp_date ASC, id ASC
      LIMIT 200`,
  );

  const [slotRows] = await pool.query(
    `SELECT s.camp_id, COUNT(*) AS slots,
            COALESCE(SUM(s.capacity), 0) AS capacity,
            SUM(CASE WHEN TIMESTAMP(c.camp_date, s.end_time) >= NOW() THEN 1 ELSE 0 END) AS future
       FROM slots s
       JOIN camps c ON c.id = s.camp_id
      GROUP BY s.camp_id`,
  );
  const slotMap = groupByCamp(slotRows, (row) => ({
    count: Number(row.slots || 0),
    capacity: Number(row.capacity || 0),
    future: Number(row.future || 0),
  }));

  const [bookingRows] = await pool.query(
    `SELECT camp_id,
            SUM(status IN ('HELD','CONFIRMED','CHECKED_IN','COMPLETED')) AS active,
            SUM(status = 'CHECKED_IN') AS checked_in,
            SUM(status = 'HELD' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()) AS stuck_holds
       FROM bookings
      GROUP BY camp_id`,
  );
  const bookingMap = groupByCamp(bookingRows, (row) => ({
    active: Number(row.active || 0),
    checkedIn: Number(row.checked_in || 0),
    stuckHolds: Number(row.stuck_holds || 0),
  }));

  const [waitRows] = await pool.query(
    `SELECT camp_id, SUM(status = 'WAITING') AS waiting FROM waitlist GROUP BY camp_id`,
  );
  const waitMap = groupByCamp(waitRows, (row) => Number(row.waiting || 0));

  const [staffRows] = await pool.query(
    `SELECT camp_id,
            SUM(role_at_camp = 'DOCTOR') AS doctors,
            SUM(role_at_camp = 'VOLUNTEER') AS volunteers,
            COUNT(*) AS total
       FROM staff_assignments
      GROUP BY camp_id`,
  );
  const staffMap = groupByCamp(staffRows, (row) => ({
    doctors: Number(row.doctors || 0),
    volunteers: Number(row.volunteers || 0),
    total: Number(row.total || 0),
  }));

  const [notifRows] = await pool.query(
    `SELECT b.camp_id,
            SUM(n.status = 'SENT') AS sent,
            SUM(n.status = 'SIMULATED') AS simulated,
            SUM(n.status = 'FAILED') AS failed
       FROM notifications_log n
       JOIN bookings b ON b.id = n.booking_id
      GROUP BY b.camp_id`,
  );
  const notifMap = groupByCamp(notifRows, (row) => ({
    sent: Number(row.sent || 0),
    simulated: Number(row.simulated || 0),
    failed: Number(row.failed || 0),
  }));

  const [overRows] = await pool.query(
    `SELECT s.camp_id, COUNT(*) AS slots
       FROM slots s
       JOIN (
         SELECT slot_id, COUNT(*) AS booked
           FROM bookings
          WHERE status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
          GROUP BY slot_id
       ) b ON b.slot_id = s.id
      WHERE b.booked > s.capacity
      GROUP BY s.camp_id`,
  );
  const overMap = groupByCamp(overRows, (row) => Number(row.slots || 0));

  const [[stuckRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM bookings
      WHERE status = 'HELD' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()`,
  );
  const [[notifStatusRow]] = await pool.query(
    `SELECT SUM(status = 'SENT') AS sent,
            SUM(status = 'SIMULATED') AS simulated,
            SUM(status = 'FAILED') AS failed
       FROM notifications_log`,
  );
  const [[pushDeviceRow]] = await pool.query(
    'SELECT COUNT(*) AS total FROM push_subscriptions',
  );
  const [[unnotifiedRow]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM bookings b
      WHERE b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
        AND NOT EXISTS (
          SELECT 1 FROM notifications_log n
           WHERE n.booking_id = b.id AND n.type = 'BOOKING_CONFIRMED'
        )`,
  );

  const today = isoDate(new Date());
  let campsWithoutDoctor = 0;
  let campsWithoutVolunteer = 0;
  let campsWithoutSlots = 0;
  let oversubscribedSlots = 0;

  const camps = campRows.map((row) => {
    const slots = slotMap.get(Number(row.id)) || { count: 0, capacity: 0, future: 0 };
    const staff = staffMap.get(Number(row.id)) || { doctors: 0, volunteers: 0, total: 0 };
    const bookings = bookingMap.get(Number(row.id)) || { active: 0, checkedIn: 0, stuckHolds: 0 };
    const notifications = notifMap.get(Number(row.id)) || { sent: 0, simulated: 0, failed: 0 };
    const oversubscribed = overMap.get(Number(row.id)) || 0;

    const evaluation = evaluateCamp({
      camp: {
        id: row.id,
        title: row.title,
        status: row.status,
        venue: row.venue,
        address: row.address,
        city: row.city,
        latitude: row.latitude,
        longitude: row.longitude,
        campDate: row.camp_date,
        totalCapacity: row.total_capacity,
      },
      slots,
      staff,
      bookings,
      notifications: { ...notifications, failed: notifications.failed },
      oversubscribedSlots: oversubscribed,
      today,
    });

    const isPublished = String(row.status).toUpperCase() === 'PUBLISHED';
    if (isPublished && staff.doctors === 0) campsWithoutDoctor += 1;
    if (isPublished && staff.volunteers === 0) campsWithoutVolunteer += 1;
    if (isPublished && slots.count === 0) campsWithoutSlots += 1;
    oversubscribedSlots += oversubscribed;

    return {
      id: Number(row.id),
      title: row.title,
      status: row.status,
      campDate: isoDate(row.camp_date),
      startTime: row.start_time,
      endTime: row.end_time,
      venue: row.venue,
      address: row.address,
      city: row.city,
      hasCoordinates: row.latitude !== null && row.longitude !== null,
      mapsUrl: buildMapsUrl(row),
      capacity: Number(row.total_capacity || 0),
      physicalCapacity: Number(row.physical_capacity || 0),
      slots,
      staff,
      bookings: { ...bookings, waitlisted: waitMap.get(Number(row.id)) || 0 },
      notifications,
      score: evaluation.score,
      band: evaluation.band,
      headline: evaluation.headline,
      blockers: evaluation.blockers,
      warnings: evaluation.warnings,
      checks: evaluation.checks,
    };
  });

  const providers = providerReadiness(process.env);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    providers,
    integrity: {
      stuckHolds: Number(stuckRow.total || 0),
      sentNotifications: Number(notifStatusRow.sent || 0),
      simulatedNotifications: Number(notifStatusRow.simulated || 0),
      failedNotifications: Number(notifStatusRow.failed || 0),
      browserDevices: Number(pushDeviceRow.total || 0),
      unnotifiedConfirmedBookings: Number(unnotifiedRow.total || 0),
      oversubscribedSlots,
      campsWithoutDoctor,
      campsWithoutVolunteer,
      campsWithoutSlots,
      publishedCamps: camps.filter((camp) => String(camp.status).toUpperCase() === 'PUBLISHED').length,
    },
    camps,
    meta: {
      engine: 'Rule-based readiness checks over live MySQL rows',
      scope: 'DRAFT and PUBLISHED camps only; completed camps are archived history.',
      weights:
        'Missing location −25 · no future slots −25 · no doctor −20 · oversubscribed slot −20 · zero capacity −15 · past published date −15 · no volunteer −10 · failed notifications −10 · expired holds −5 · capacity mismatch −5 · sandbox-only delivery −5.',
      note:
        'Provider readiness reflects variable presence only; secret values are never returned. Sandbox is an honest audit state, not a delivery.',
      provenance: 'live-mysql',
    },
  };
}

/* ---------------------------------------------------------------------------
 * Reminder sweep
 * ------------------------------------------------------------------------- */

async function runReminderSweep(trigger = 'cron') {
  const result = await remindersEngine.runReminderSweep({ pool, providers });
  emitBounded(io, 'reminders:sweep', { trigger, ...result });
  return result;
}

const REMINDER_CRON = String(process.env.REMINDER_CRON || '* * * * *');
if (process.env.NODE_ENV !== 'test' && REMINDER_CRON !== 'off') {
  cron.schedule(REMINDER_CRON, () => {
    runReminderSweep('cron').catch((error) => console.warn('[reminder cron]', error.message));
  });
}

// One sweep handles both abandoned booking holds and unclaimed waitlist
// promotions. It is idempotent and safe to run from several workers because
// rows are claimed with FOR UPDATE SKIP LOCKED.
if (process.env.NODE_ENV !== 'test' && HOLD_EXPIRY_CRON !== 'off') {
  cron.schedule(HOLD_EXPIRY_CRON, () => {
    runHoldExpirySweep('cron').catch((error) => console.warn('[hold expiry cron]', error.message));
  });
}

/* ---------------------------------------------------------------------------
 * FREE DEVICE ALERTS — Web Push / VAPID
 * No paid SMS gateway is involved. The browser issues the subscription and the
 * browser vendor delivers the encrypted notification for free.
 * ------------------------------------------------------------------------- */

app.get('/api/push/config', (_req, res) => {
  res.json({
    ok: true,
    enabled: Boolean(providers.push.live),
    publicKey: providers.push.publicKey || null,
    subject: providers.push.live ? pushTargetUrl(process.env) : null,
    note: providers.push.live
      ? 'Browser push is free. Each device grants its own notification permission.'
      : 'VAPID keys are not configured; browser alerts are unavailable.',
  });
});

app.get(
  '/api/push/devices',
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, endpoint, created_at, updated_at FROM push_subscriptions WHERE user_id = ? ORDER BY id ASC',
      [req.user.id],
    );
    res.json({ ok: true, enabled: Boolean(providers.push.live), devices: rows.map(publicPushDevice) });
  }),
);

app.post(
  '/api/push/subscriptions',
  authenticate,
  asyncHandler(async (req, res) => {
    let subscription;
    try {
      subscription = parsePushSubscription(req.body);
    } catch (error) {
      throw new ApiError(400, error.message, error.code || 'VALIDATION');
    }
    const [result] = await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [req.user.id, subscription.endpoint, subscription.p256dh, subscription.auth],
    );
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'PUSH_DEVICE_ENABLED',
      targetType: 'device',
      targetId: Number(result.insertId) || null,
      after: { endpointHost: new URL(subscription.endpoint).hostname },
    });
    res.status(201).json({ ok: true, deviceId: Number(result.insertId) || null, enabled: Boolean(providers.push.live) });
  }),
);

app.delete(
  '/api/push/subscriptions',
  authenticate,
  asyncHandler(async (req, res) => {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!validPushEndpoint(endpoint)) {
      throw new ApiError(400, 'endpoint must be a supported HTTPS browser push service URL.', 'VALIDATION');
    }
    const [result] = await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      [req.user.id, endpoint],
    );
    if (!Number(result.affectedRows)) {
      throw new ApiError(404, 'That device subscription was not found on this account.', 'DEVICE_NOT_FOUND');
    }
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'PUSH_DEVICE_DISABLED',
      targetType: 'device',
      targetId: null,
      after: { endpointHost: new URL(endpoint).hostname },
    });
    res.json({ ok: true, removed: Number(result.affectedRows) });
  }),
);

app.post(
  '/api/push/test',
  authenticate,
  asyncHandler(async (req, res) => {
    const subscriptions = await loadPushSubscriptions(pool, req.user.id);
    const testedAt = new Date().toISOString();
    if (!providers.push.live) {
      // Even a refused attempt is recorded — a silent failure looks like delivery.
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'DELIVERY_TEST_FAILED',
        targetType: 'provider',
        targetId: null,
        after: {
          channel: 'PUSH',
          provider: providers.push.name,
          error: 'PROVIDER_NOT_CONFIGURED',
          testedAt,
        },
      });
      throw new ApiError(
        409,
        'Browser push is not configured on the backend. Nothing was sent.',
        'PROVIDER_NOT_CONFIGURED',
        { channel: 'PUSH', provider: providers.push.name },
      );
    }
    if (!subscriptions.length) {
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'DELIVERY_TEST_FAILED',
        targetType: 'provider',
        targetId: null,
        after: { channel: 'PUSH', provider: providers.push.name, error: 'NO_DEVICE', testedAt },
      });
      throw new ApiError(
        409,
        'No browser alert is enabled on this account. Open Settings → Browser alerts and enable this device first.',
        'NO_DEVICE',
        { channel: 'PUSH' },
      );
    }
    const text =
      `CHSC browser alert test at ${testedAt}. ` +
      'This free device notification contains no booking, patient or clinical data.';
    try {
      const result = await providers.push.send({
        subscriptions,
        subject: 'CHSC browser alert test',
        text,
        url: pushTargetUrl(process.env),
      });
      if (result.expired?.length) await prunePushSubscriptions(pool, result.expired);
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'DELIVERY_TEST',
        targetType: 'provider',
        targetId: null,
        after: {
          channel: 'PUSH',
          provider: providers.push.name,
          simulated: false,
          accepted: result.accepted,
          reference: result.reference,
          testedAt,
        },
      });
      res.json({
        ok: true,
        channel: 'PUSH',
        provider: providers.push.name,
        live: true,
        simulated: false,
        delivered: true,
        accepted: result.accepted,
        reference: result.reference || null,
        recipient: `${subscriptions.length} browser device${subscriptions.length === 1 ? '' : 's'}`,
        testedAt,
        message: 'Your browser push service accepted the test alert. Check this device.',
      });
    } catch (error) {
      const reason = String(error?.message || error || 'Push service rejected the message.').slice(0, 300);
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'DELIVERY_TEST_FAILED',
        targetType: 'provider',
        targetId: null,
        after: { channel: 'PUSH', provider: providers.push.name, error: reason, testedAt },
      });
      throw new ApiError(502, `Web Push rejected the test alert: ${reason}`, 'PROVIDER_ERROR', {
        channel: 'PUSH',
        provider: providers.push.name,
      });
    }
  }),
);

/* ---------------------------------------------------------------------------
 * HEALTH & AUTH
 * ------------------------------------------------------------------------- */

app.get('/api/health', async (_req, res) => {
  let db = false;
  let dbVersion = null;
  try {
    const [rows] = await pool.query('SELECT VERSION() AS version');
    db = true;
    dbVersion = rows[0].version;
  } catch (error) {
    dbVersion = error.code || error.message;
  }
  res.status(db ? 200 : 503).json({
    ok: db,
    service: 'CHSC API',
    demoMode: false,
    database: db ? 'connected' : 'offline',
    dbVersion,
    socket: 'ready',
    push: providers.push.live ? 'configured' : 'unconfigured',
    time: new Date().toISOString(),
  });
});

app.post(
  '/api/auth/register',
  limiters.authIp,
  limiters.auth,
  validateBody(schemas.registerSchema),
  asyncHandler(async (req, res) => {
    const {
      name,
      email,
      phone,
      password,
      ageGroup = null,
      preferredLanguage = 'en',
    } = req.body || {};

    if (!name || !email || !phone || !password) {
      throw new ApiError(400, 'Name, email, phone and password are required.', 'VALIDATION');
    }
    if (String(password).length < 8) {
      throw new ApiError(400, 'Password must be at least 8 characters.', 'WEAK_PASSWORD');
    }
    if (!/^[0-9]{10}$/.test(String(phone))) {
      throw new ApiError(400, 'Phone must be a 10-digit Indian mobile number.', 'INVALID_PHONE');
    }
    if (ageGroup && !['18-29', '30-45', '46-60', '60+'].includes(ageGroup)) {
      throw new ApiError(400, 'Invalid age group.', 'INVALID_AGE_GROUP');
    }

    const hash = await bcrypt.hash(String(password), 10);
    try {
      const [result] = await pool.query(
        `INSERT INTO users
           (name, email, phone, password_hash, role, age_group, preferred_language)
         VALUES (?, ?, ?, ?, 'PATIENT', ?, ?)`,
        [
          String(name).trim(),
          String(email).trim().toLowerCase(),
          String(phone).trim(),
          hash,
          ageGroup,
          preferredLanguage === 'kn' ? 'kn' : 'en',
        ],
      );
      const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      const user = safeUser(rows[0]);
      emitBounded(io, 'admin:users-changed', { reason: 'registered', userId: user.id });
      res.status(201).json({ user, token: signToken(user) });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ApiError(409, 'Email or phone is already registered.', 'USER_EXISTS');
      }
      throw error;
    }
  }),
);

app.post(
  '/api/auth/login',
  limiters.authIp,
  limiters.auth,
  validateBody(schemas.loginSchema),
  asyncHandler(async (req, res) => {
    const { identifier, email, phone, password } = req.body || {};
    const login = identifier || email || phone;
    if (!login || !password) {
      throw new ApiError(400, 'Email/phone and password are required.', 'VALIDATION');
    }
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE (email = ? OR phone = ?) AND is_active = 1 LIMIT 1',
      [String(login).trim().toLowerCase(), String(login).trim()],
    );
    if (!rows.length || !(await bcrypt.compare(String(password), rows[0].password_hash))) {
      throw new ApiError(401, 'Invalid credentials.', 'INVALID_CREDENTIALS');
    }
    const user = safeUser(rows[0]);
    res.json({ user, token: signToken(user) });
  }),
);

app.get(
  '/api/auth/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [
      req.user.id,
    ]);
    if (!rows.length) throw new ApiError(401, 'User no longer active.', 'USER_INACTIVE');
    res.json({ user: safeUser(rows[0]) });
  }),
);

/* ---------------------------------------------------------------------------
 * PUBLIC CAMP READ APIs
 * ------------------------------------------------------------------------- */

app.get(
  '/api/camps',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const paging = parsePagination(req.query);
    if (!paging) {
      throw new ApiError(
        400,
        'page must be ≥ 1 and pageSize between 1 and 100.',
        'INVALID_PAGINATION',
      );
    }
    // DRAFT camps are internal until an organiser publishes them. Only the
    // authenticated management workspace may ask for that scope.
    const manageScope = String(req.query.scope || '').toLowerCase() === 'manage';
    if (manageScope && (!req.user || !['ORGANIZER', 'ADMIN'].includes(req.user.role))) {
      throw new ApiError(403, 'You cannot view unpublished camps.', 'MANAGE_SCOPE_FORBIDDEN');
    }
    const options = manageScope
      ? { where: `c.status IN ('DRAFT','PUBLISHED','COMPLETED')` }
      : {};
    if (paging.requested) {
      options.limit = paging.limit;
      options.offset = paging.offset;
    }
    const { camps, total } = await loadCampCollection(options);
    res.json({ camps, pagination: buildPagination(total, paging), scope: manageScope ? 'manage' : 'public' });
  }),
);

app.get(
  '/api/camps/:id',
  asyncHandler(async (req, res) => {
    const camp = await loadCampBundle(Number(req.params.id));
    res.json({ camp });
  }),
);

app.get(
  '/api/camps/:id/slots',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM waitlist w WHERE w.slot_id = s.id AND w.status = 'WAITING') AS waiting_count
       FROM slots s WHERE s.camp_id = ? ORDER BY s.slot_index`,
      [req.params.id],
    );
    res.json({ slots: rows.map(publicSlot) });
  }),
);

// Public TV board by design: only opaque token numbers are broadcast, never
// patient names or contact details. Mutating queue operations remain staff-only.
app.get(
  '/api/queue/:campId',
  asyncHandler(async (req, res) => {
    res.json({ queue: await getQueueSnapshot(req.params.campId) });
  }),
);

/* ---------------------------------------------------------------------------
 * CAMP CREATION + DETERMINISTIC SLOT GENERATION
 * ------------------------------------------------------------------------- */

app.post(
  '/api/camps',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  validateBody(schemas.campCreateSchema),
  asyncHandler(async (req, res) => {
    const {
      title,
      descriptionEn = '',
      descriptionKn = '',
      venue,
      address,
      city = 'Bengaluru',
      latitude = null,
      longitude = null,
      campDate,
      startTime,
      endTime,
      slotDurationMins,
      totalCapacity,
      physicalCapacity,
      status = 'PUBLISHED',
    } = req.body || {};

    if (!title || !venue || !address || !campDate || !startTime || !endTime) {
      throw new ApiError(
        400,
        'title, venue, address, campDate, startTime and endTime are required.',
        'VALIDATION',
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(campDate))) {
      throw new ApiError(400, 'campDate must be YYYY-MM-DD.', 'INVALID_DATE');
    }
    if (!['DRAFT', 'PUBLISHED'].includes(String(status))) {
      throw new ApiError(400, 'New camp status must be DRAFT or PUBLISHED.', 'INVALID_STATUS');
    }

    const plan = buildSlotPlan(startTime, endTime, slotDurationMins, totalCapacity);
    const physical = Number(physicalCapacity || totalCapacity);

    const result = await withTransaction(async (conn) => {
      const [campInsert] = await conn.query(
        `INSERT INTO camps
          (title, description_en, description_kn, venue, address, city, latitude, longitude,
           camp_date, start_time, end_time, slot_duration_mins, total_capacity,
           physical_capacity, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(title).trim(),
          String(descriptionEn || ''),
          String(descriptionKn || ''),
          String(venue).trim(),
          String(address).trim(),
          String(city).trim(),
          latitude,
          longitude,
          campDate,
          startTime,
          endTime,
          Number(slotDurationMins),
          Number(totalCapacity),
          physical,
          status,
          req.user.id,
        ],
      );

      const campId = campInsert.insertId;
      for (const slot of plan) {
        await conn.query(
          `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [campId, slot.slotIndex, slot.startTime, slot.endTime, slot.capacity],
        );
      }
      return campId;
    });

    const camp = await loadCampBundle(result);
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'CREATE_CAMP',
      targetType: 'camp',
      targetId: camp.id,
      before: null,
      after: { title: camp.title, campDate: camp.camp_date, status: camp.status, slotCount: plan.length },
    });
    emitBounded(io, 'camp:created', { campId: camp.id, camp });
    res.status(201).json({
      camp,
      slotPlan: plan,
      algorithm: {
        k: plan.length,
        formula: 'k = floor((T_end − T_start) / Δt); seats = floor(C_camp / k) + remainder distribution',
        capacityAllocated: plan.reduce((sum, slot) => sum + slot.capacity, 0),
      },
    });
  }),
);

app.post(
  '/api/camps/:id/generate-slots',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  validateBody(schemas.generateSlotsSchema),
  asyncHandler(async (req, res) => {
    const campId = Number(req.params.id);
    const {
      startTime,
      endTime,
      slotDurationMins,
      totalCapacity,
      physicalCapacity,
      force = false,
      destructive = false,
    } = req.body || {};

    const plan = buildSlotPlan(startTime, endTime, slotDurationMins, totalCapacity);

    let beforeCount = 0;
    let destructivePermitted = false;

    await withTransaction(async (conn) => {
      const [camps] = await conn.query('SELECT * FROM camps WHERE id = ? FOR UPDATE', [campId]);
      if (!camps.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');

      const [statusRows] = await conn.query(
        'SELECT status, COUNT(*) AS total FROM bookings WHERE camp_id = ? GROUP BY status',
        [campId],
      );
      const countOf = (status) =>
        Number(statusRows.find((row) => row.status === status)?.total || 0);
      const lockedIn =
        countOf('CONFIRMED') + countOf('CHECKED_IN') + countOf('COMPLETED');
      const anyBookings = lockedIn + countOf('CANCELLED');

      if (anyBookings > 0 && !force) {
        throw new ApiError(
          409,
          'Slots already contain bookings. Pass force=true only when intentionally rebuilding.',
          'SLOTS_IN_USE',
          { activeBookings: lockedIn, totalBookings: anyBookings },
        );
      }

      destructivePermitted =
        ALLOW_DESTRUCTIVE_SLOT_REBUILD && destructive === true && req.user.role === 'ADMIN';
      if (lockedIn > 0 && force && !destructivePermitted) {
        throw new ApiError(
          409,
          'Refusing to rebuild slots with confirmed/checked-in bookings. ' +
            'Requires ALLOW_DESTRUCTIVE_SLOT_REBUILD=true, destructive=true and an ADMIN caller.',
          'DESTRUCTIVE_REBUILD_BLOCKED',
          { confirmedBookings: lockedIn },
        );
      }

      const [existing] = await conn.query(
        'SELECT id, slot_index, booked_count FROM slots WHERE camp_id = ? ORDER BY slot_index, id FOR UPDATE',
        [campId],
      );
      beforeCount = existing.length;
      const reuseCount = Math.min(existing.length, plan.length);

      for (let i = 0; i < reuseCount; i += 1) {
        if (Number(existing[i].booked_count) > plan[i].capacity) {
          throw new ApiError(
            409,
            'The new slot capacity is smaller than the bookings already on that slot.',
            'SLOT_CAPACITY_TOO_SMALL',
            { slotId: existing[i].id, bookedCount: Number(existing[i].booked_count) },
          );
        }
      }

      // Rebuild IN PLACE: bookings keep their slot_id and follow the new times.
      // Temporary high indexes avoid transient UNIQUE(camp_id, slot_index) clashes.
      if (existing.length) {
        await conn.query('UPDATE slots SET slot_index = id + 30000 WHERE camp_id = ?', [campId]);
      }
      for (let i = 0; i < reuseCount; i += 1) {
        const slot = plan[i];
        await conn.query(
          `UPDATE slots SET slot_index = ?, start_time = ?, end_time = ?, capacity = ?, booked_count = ?
           WHERE id = ?`,
          [
            slot.slotIndex,
            slot.startTime,
            slot.endTime,
            slot.capacity,
            Number(existing[i].booked_count),
            existing[i].id,
          ],
        );
      }
      for (let i = reuseCount; i < plan.length; i += 1) {
        const slot = plan[i];
        await conn.query(
          `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [campId, slot.slotIndex, slot.startTime, slot.endTime, slot.capacity],
        );
      }

      // Extra slots can only be removed when nothing references them; otherwise
      // park them at full capacity so no new bookings can land on old times.
      for (const extra of existing.slice(plan.length)) {
        const [[refs]] = await conn.query(
          `SELECT (SELECT COUNT(*) FROM bookings WHERE slot_id = ?) AS bookings,
                  (SELECT COUNT(*) FROM waitlist WHERE slot_id = ?) AS waiting`,
          [extra.id, extra.id],
        );
        if (!Number(refs.bookings) && !Number(refs.waiting)) {
          await conn.query('DELETE FROM slots WHERE id = ?', [extra.id]);
        } else {
          const full = Math.max(1, Number(extra.booked_count));
          await conn.query('UPDATE slots SET capacity = ?, booked_count = ? WHERE id = ?', [
            full,
            full,
            extra.id,
          ]);
        }
      }

      await conn.query(
        `UPDATE camps SET start_time = ?, end_time = ?, slot_duration_mins = ?,
          total_capacity = ?, physical_capacity = ? WHERE id = ?`,
        [
          startTime,
          endTime,
          Number(slotDurationMins),
          Number(totalCapacity),
          Number(physicalCapacity || totalCapacity),
          campId,
        ],
      );
    });

    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'GENERATE_SLOTS',
      targetType: 'camp',
      targetId: campId,
      before: { slotCount: beforeCount, force },
      after: { slotCount: plan.length, destructive: destructivePermitted },
    });
    const camp = await loadCampBundle(campId);
    emitBounded(io, 'slots:generated', { campId, camp, slotPlan: plan });
    res.status(201).json({ camp, slotPlan: plan });
  }),
);

app.patch(
  '/api/camps/:id/status',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  validateBody(schemas.campStatusSchema),
  asyncHandler(async (req, res) => {
    const status = String(req.body?.status || '').toUpperCase();
    if (!['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      throw new ApiError(400, 'Invalid camp status.', 'INVALID_STATUS');
    }
    const [beforeRows] = await pool.query('SELECT status FROM camps WHERE id = ?', [req.params.id]);
    if (!beforeRows.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    const previousStatus = beforeRows[0].status;
    const [result] = await pool.query('UPDATE camps SET status = ? WHERE id = ?', [
      status,
      req.params.id,
    ]);
    if (!result.affectedRows) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    const camp = await loadCampBundle(Number(req.params.id));
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'CHANGE_CAMP_STATUS',
      targetType: 'camp',
      targetId: camp.id,
      before: { status: previousStatus },
      after: { status },
    });
    emitBounded(io, 'camp:updated', { campId: camp.id, status });
    res.json({ camp });
  }),
);

/* Update descriptive camp fields. Schedule/capacity changes go through
   /generate-slots because they invalidate existing slot rows. */
app.patch(
  '/api/camps/:id',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  validateBody(schemas.campUpdateSchema),
  asyncHandler(async (req, res) => {
    const campId = Number(req.params.id);
    const fields = req.body;
    const columns = {
      title: 'title',
      descriptionEn: 'description_en',
      descriptionKn: 'description_kn',
      venue: 'venue',
      address: 'address',
      city: 'city',
      latitude: 'latitude',
      longitude: 'longitude',
    };
    const [beforeRows] = await pool.query(
      'SELECT title, description_en, description_kn, venue, address, city, latitude, longitude FROM camps WHERE id = ?',
      [campId],
    );
    if (!beforeRows.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    const before = beforeRows[0];
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (fields[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(fields[key]);
      }
    }
    values.push(campId);
    const [result] = await pool.query(
      `UPDATE camps SET ${sets.join(', ')} WHERE id = ?`,
      values,
    );
    if (!result.affectedRows) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    const camp = await loadCampBundle(campId);
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'UPDATE_CAMP',
      targetType: 'camp',
      targetId: campId,
      before,
      after: {
        title: camp.title,
        descriptionEn: camp.descriptionEn,
        descriptionKn: camp.descriptionKn,
        venue: camp.venue,
        address: camp.address,
        city: camp.city,
      },
    });
    emitBounded(io, 'camp:updated', { campId, camp });
    res.json({ camp });
  }),
);

/* Delete is only allowed for a camp with no booking history. Once a camp has
   bookings it is an audit record: cancel it instead of erasing it. */
app.delete(
  '/api/camps/:id',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const campId = Number(req.params.id);
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM bookings WHERE camp_id = ?',
      [campId],
    );
    if (Number(total) > 0) {
      throw new ApiError(
        409,
        'This camp has booking history. Cancel it instead of deleting it.',
        'CAMP_HAS_BOOKINGS',
        { bookings: Number(total) },
      );
    }
    const [beforeRows] = await pool.query('SELECT title, camp_date, status FROM camps WHERE id = ?', [campId]);
    if (!beforeRows.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    const [result] = await pool.query('DELETE FROM camps WHERE id = ?', [campId]);
    if (!result.affectedRows) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'DELETE_CAMP',
      targetType: 'camp',
      targetId: campId,
      before: beforeRows[0],
      after: null,
    });
    emitBounded(io, 'camp:deleted', { campId });
    res.json({ deleted: true, campId });
  }),
);

/* ---------------------------------------------------------------------------
 * PESSIMISTIC BOOKING — THE FOR UPDATE MUTEX
 * ------------------------------------------------------------------------- */

app.post(
  '/api/slots/:slotId/book',
  authenticate,
  requireRole('PATIENT'),
  limiters.booking,
  validateBody(schemas.bookingSchema),
  asyncHandler(async (req, res) => {
    const slotId = Number(req.params.slotId);
    const travelMode = req.body?.travelMode || null;
    const pledge = Boolean(req.body?.pledge);
    if (
      travelMode &&
      !['WALK', 'AUTO_BUS', 'TWO_WHEELER', 'WITH_FAMILY'].includes(travelMode)
    ) {
      throw new ApiError(400, 'Invalid travel mode.', 'INVALID_TRAVEL_MODE');
    }

    const outcome = await withTransaction(async (conn) => {
      // STEP 1: Acquire exclusive X-lock on the slot row. Concurrent transactions
      // for the same slot block here until this transaction commits or rolls back.
      const [slotRows] = await conn.query(
        `SELECT id, camp_id, slot_index, start_time, end_time, capacity, booked_count
         FROM slots WHERE id = ? FOR UPDATE`,
        [slotId],
      );
      if (!slotRows.length) throw new ApiError(404, 'Slot not found.', 'SLOT_NOT_FOUND');
      const slot = slotRows[0];

      const [campRows] = await conn.query(
        'SELECT id, title, venue, address, city, latitude, longitude, camp_date, status FROM camps WHERE id = ?',
        [slot.camp_id],
      );
      if (!campRows.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
      const camp = campRows[0];
      if (camp.status !== 'PUBLISHED') {
        throw new ApiError(409, 'This camp is not accepting bookings.', 'CAMP_NOT_OPEN');
      }

      const [userRows] = await conn.query(
        'SELECT id, name, phone, email FROM users WHERE id = ? AND is_active = 1',
        [req.user.id],
      );
      if (!userRows.length) throw new ApiError(401, 'Patient account inactive.', 'USER_INACTIVE');
      const patient = userRows[0];

      const [existingRows] = await conn.query(
        `SELECT * FROM bookings WHERE slot_id = ? AND patient_id = ? FOR UPDATE`,
        [slotId, patient.id],
      );

      if (
        existingRows.length &&
        ACTIVE_BOOKING_STATUSES.includes(existingRows[0].status)
      ) {
        return {
          kind: 'duplicate',
          booking: existingRows[0],
          camp,
          slot,
          message: 'You already hold a booking for this slot.',
        };
      }

      // One active booking per camp. The generated-column unique index is the
      // hard guarantee; this read gives the patient a precise error message.
      const [campActive] = await conn.query(
        `SELECT id, slot_id FROM bookings
         WHERE patient_id = ? AND camp_id = ?
           AND status IN (${ACTIVE_BOOKING_STATUSES.map(() => '?').join(',')})
         FOR UPDATE`,
        [patient.id, camp.id, ...ACTIVE_BOOKING_STATUSES],
      );
      if (campActive.length) {
        return {
          kind: 'camp_duplicate',
          booking: campActive[0],
          camp,
          slot,
          message: 'You already have an active booking at this camp. Reschedule it instead.',
        };
      }

      // STEP 2: Deterministic full-slot branch → FIFO waitlist.
      if (Number(slot.booked_count) >= Number(slot.capacity)) {
        const [waitingRows] = await conn.query(
          `SELECT id, position FROM waitlist
           WHERE slot_id = ? AND status = 'WAITING'
           ORDER BY created_at ASC, id ASC FOR UPDATE`,
          [slotId],
        );
        const alreadyWaiting = await conn.query(
          `SELECT * FROM waitlist WHERE slot_id = ? AND patient_id = ? AND status = 'WAITING' LIMIT 1`,
          [slotId, patient.id],
        );
        let waitRow = alreadyWaiting[0][0] || null;
        if (!waitRow) {
          const position = waitingRows.length + 1;
          const [waitInsert] = await conn.query(
            `INSERT INTO waitlist (slot_id, camp_id, patient_id, position, status)
             VALUES (?, ?, ?, ?, 'WAITING')`,
            [slotId, camp.id, patient.id, position],
          );
          waitRow = { id: waitInsert.insertId, position, status: 'WAITING' };
        }

        const details = {
          patientName: patient.name,
          campTitle: camp.title,
          campDate: camp.camp_date,
          startTime: slot.start_time,
          endTime: slot.end_time,
          venue: camp.venue,
          address: camp.address,
          city: camp.city,
          mapsUrl: buildMapsUrl(camp),
          waitlistPosition: waitRow.position,
        };
        const built = buildMessages('WAITLIST_JOINED', details);
        const payload = { ...details, slotId, position: waitRow.position };
        const sms = await insertNotification(conn, {
          bookingId: null,
          userId: patient.id,
          channel: 'SMS',
          type: 'WAITLIST_JOINED',
          recipient: patient.phone,
          message: built.sms,
          provider: providerFor('SMS'),
          status: 'PENDING',
          eventKey: `slot-${slotId}`,
          payload,
        });
        const email = await insertNotification(conn, {
          bookingId: null,
          userId: patient.id,
          channel: 'EMAIL',
          type: 'WAITLIST_JOINED',
          recipient: patient.email,
          subject: built.subject,
          message: built.text,
          provider: providerFor('EMAIL'),
          status: 'PENDING',
          eventKey: `slot-${slotId}`,
          payload,
        });

        return {
          kind: 'waitlisted',
          waitlist: {
            id: waitRow.id,
            slotId,
            campId: camp.id,
            position: waitRow.position,
            status: 'WAITING',
          },
          notifications: [sms, email],
          slot,
          camp,
        };
      }

      // STEP 3: Seat is available while holding the lock → reserve it as HELD.
      // Reminders and the confirmation notification are deliberately deferred
      // until POST /api/bookings/:id/confirm.
      const [seatUpdate] = await conn.query(
        `UPDATE slots SET booked_count = booked_count + 1
         WHERE id = ? AND booked_count < capacity`,
        [slotId],
      );
      if (seatUpdate.affectedRows !== 1) {
        // Defensive: should be unreachable while holding the X-lock.
        throw new ApiError(409, 'Seat changed unexpectedly. Please retry.', 'SEAT_RACE_RETRY');
      }

      const booking = await createHoldBooking(conn, {
        slot,
        camp,
        patient,
        travelMode,
        pledge,
        minutes: BOOKING_HOLD_MINUTES,
        existing: existingRows[0] || null,
      });

      await conn.query(
        `UPDATE waitlist SET status = 'CANCELLED'
         WHERE slot_id = ? AND patient_id = ? AND status = 'WAITING'`,
        [slotId, patient.id],
      );

      return {
        kind: 'held',
        booking,
        slot: { ...slot, booked_count: Number(slot.booked_count) + 1 },
        camp,
        patient,
        notifications: [],
        audit: auditEvent(
          'CREATE_HOLD',
          'booking',
          booking.id,
          existingRows.length ? { status: existingRows[0].status } : null,
          { status: 'HELD', holdExpiresAt: toIso(booking.hold_expires_at) },
        ),
      };
    });

    if (outcome.kind === 'duplicate') {
      throw new ApiError(409, outcome.message, 'DUPLICATE_BOOKING', {
        booking: publicBooking(withBookingContext(outcome.booking, outcome.camp, outcome.slot)),
      });
    }

    if (outcome.kind === 'camp_duplicate') {
      throw new ApiError(409, outcome.message, 'ALREADY_BOOKED_IN_CAMP', {
        booking: publicBooking(withBookingContext(outcome.booking, outcome.camp, outcome.slot)),
      });
    }

    publishNotifications(outcome.notifications || []);
    if (outcome.audit) await auditLog({ actorId: req.user.id, actorName: req.user.name, ...outcome.audit });
    emitBounded(io, 'slot:updated', {
      slotId,
      bookedCount: outcome.kind === 'waitlisted' ? Number(outcome.slot.booked_count) : undefined,
      action: outcome.kind,
    });

    if (outcome.kind === 'waitlisted') {
      emitBounded(io, 'waitlist:joined', {
        slotId,
        position: outcome.waitlist.position,
        waitlist: outcome.waitlist,
        at: new Date().toISOString(),
      });
      return res.status(202).json({
        status: 'WAITLISTED',
        message: `Slot full. You are #${outcome.waitlist.position} in the FIFO waitlist.`,
        waitlist: outcome.waitlist,
      });
    }

    const payload = publicBooking(withBookingContext(outcome.booking, outcome.camp, outcome.slot));
    emitBounded(io, 'booking:held', { booking: safeSocketBooking(outcome.booking), at: new Date().toISOString() });
    return res.status(201).json({
      status: 'HELD',
      message: `Seat reserved for ${BOOKING_HOLD_MINUTES} minutes. Confirm before ${payload.holdExpiresAt} to finalise it.`,
      holdExpiresAt: payload.holdExpiresAt,
      booking: payload,
    });
  }),
);

/**
 * Confirm a HELD reservation atomically. The slot row is locked again so an
 * expiry sweep cannot free the same seat between the expiry check and commit.
 */
app.post(
  '/api/bookings/:id/confirm',
  authenticate,
  limiters.booking,
  asyncHandler(async (req, res) => {
    const bookingId = Number(req.params.id);

    const outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT b.*, s.capacity, s.booked_count, s.start_time, s.end_time,
                c.title, c.title AS camp_title, c.venue, c.address, c.city,
                c.latitude, c.longitude, c.camp_date, c.status AS camp_status,
                p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN camps c ON c.id = b.camp_id
         JOIN users p ON p.id = b.patient_id
         WHERE b.id = ? FOR UPDATE`,
        [bookingId],
      );
      if (!rows.length) throw new ApiError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
      const booking = rows[0];

      if (req.user.role === 'PATIENT' && booking.patient_id !== req.user.id) {
        throw new ApiError(403, 'You cannot confirm this booking.', 'CONFIRM_FORBIDDEN');
      }
      if (!['PATIENT', 'ADMIN', 'ORGANIZER'].includes(req.user.role)) {
        throw new ApiError(403, 'You cannot confirm this booking.', 'CONFIRM_FORBIDDEN');
      }

      if (booking.status === 'CONFIRMED') {
        return { kind: 'already_confirmed', booking };
      }
      if (booking.status !== 'HELD') {
        throw new ApiError(409, 'Only a held booking can be confirmed.', 'NOT_HELD', {
          status: booking.status,
        });
      }

      const [[clock]] = await conn.query('SELECT NOW() AS now, hold_expires_at FROM bookings WHERE id = ?', [bookingId]);
      if (!clock.hold_expires_at || new Date(clock.hold_expires_at).getTime() <= new Date(clock.now).getTime()) {
        const released = await releaseReservedSeat(conn, booking, {
          finalStatus: 'EXPIRED',
          reason: 'hold_expired',
        });
        return { kind: 'expired', released };
      }
      if (booking.camp_status !== 'PUBLISHED') {
        throw new ApiError(409, 'This camp is not accepting bookings.', 'CAMP_NOT_OPEN');
      }

      const patient = {
        id: booking.patient_id,
        name: booking.patient_name,
        phone: booking.patient_phone,
        email: booking.patient_email,
      };
      const confirmed = await confirmHeldBooking(conn, booking, {
        slot: { ...rows[0], id: booking.slot_id },
        camp: { ...rows[0], id: booking.camp_id },
        patient,
      });
      return { kind: 'confirmed', ...confirmed };
    });

    if (outcome.kind === 'expired') {
      await writeAuditEvents(outcome.released.audits, req.user);
      publishNotifications(outcome.released.notifications);
      emitBounded(io, 'slot:updated', { slotId: outcome.released.slotId, action: 'hold_expired' });
      if (outcome.released.promoted) {
        emitBounded(io, 'waitlist:promoted', {
          slotId: outcome.released.slotId,
          booking: safeSocketBooking(outcome.released.promoted.booking),
          at: new Date().toISOString(),
        });
      }
      throw new ApiError(409, 'Your seat hold expired and the seat was released.', 'HOLD_EXPIRED', {
        booking: publicBooking(outcome.released.releasedBooking),
      });
    }

    if (outcome.kind === 'already_confirmed') {
      return res.json({
        status: 'CONFIRMED',
        message: 'This booking was already confirmed.',
        booking: publicBooking(outcome.booking),
      });
    }

    await auditLog({ actorId: req.user.id, actorName: req.user.name, ...outcome.audit });
    publishNotifications(outcome.notifications);
    emitBounded(io, 'booking:confirmed', {
      booking: safeSocketBooking(outcome.booking),
      at: new Date().toISOString(),
    });
    return res.json({
      status: 'CONFIRMED',
      message: 'Seat confirmed. Queued reminders are now scheduled.',
      booking: publicBooking(outcome.booking),
    });
  }),
);

/* ---------------------------------------------------------------------------
 * ATOMIC CANCELLATION + FIFO WAITLIST PROMOTION
 * ------------------------------------------------------------------------- */

app.patch(
  '/api/bookings/:id/cancel',
  authenticate,
  asyncHandler(async (req, res) => {
    const bookingId = Number(req.params.id);

    const outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT b.*, s.capacity, s.booked_count, s.start_time, s.end_time,
                c.title, c.title AS camp_title, c.venue, c.address, c.city,
                c.latitude, c.longitude, c.camp_date,
                p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN camps c ON c.id = b.camp_id
         JOIN users p ON p.id = b.patient_id
         WHERE b.id = ? FOR UPDATE`,
        [bookingId],
      );
      if (!rows.length) throw new ApiError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
      const booking = rows[0];

      if (
        !['PATIENT', 'ADMIN', 'ORGANIZER'].includes(req.user.role) ||
        (req.user.role === 'PATIENT' && booking.patient_id !== req.user.id)
      ) {
        throw new ApiError(403, 'You cannot cancel this booking.', 'CANCEL_FORBIDDEN');
      }
      if (booking.status === 'HELD') {
        const released = await releaseReservedSeat(conn, booking, {
          finalStatus: 'CANCELLED',
          reason: 'patient_cancelled',
        });
        return {
          ...released,
          cancelledBooking: released.releasedBooking,
          promotedBooking: released.promoted?.booking || null,
          promotedPatient: publicPromotedPatient(released.promoted?.patient),
          autoPromoted: Boolean(released.promoted),
        };
      }
      if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
        throw new ApiError(409, 'Only an active booking can be released.', 'NOT_ACTIVE');
      }

      const beforeStatus = booking.status;
      await conn.query(
        `UPDATE bookings SET status = 'CANCELLED', cancelled_at = NOW() WHERE id = ?`,
        [bookingId],
      );
      await remindersEngine.cancelForBooking(conn, bookingId);
      await conn.query(
        `UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = ?`,
        [booking.slot_id],
      );

      const promoted = await promoteNextWaiter(conn, {
        slotId: booking.slot_id,
        campId: booking.camp_id,
        source: 'cancellation',
      });
      const notifications = [];

      const details = bookingMessageDetails({
        booking,
        patient: { name: booking.patient_name },
        camp: booking,
        slot: booking,
      });
      const built = buildMessages('CANCELLATION', details);
      const payload = {
        ...details,
        autoPromoted: Boolean(promoted),
        eventKey: 'cancelled',
      };
      notifications.push(
        await insertNotification(conn, {
          bookingId: booking.id,
          userId: booking.patient_id,
          channel: 'SMS',
          type: 'CANCELLATION',
          recipient: booking.patient_phone,
          message: built.sms,
          provider: providerFor('SMS'),
          status: 'PENDING',
          eventKey: 'cancelled',
          payload,
        }),
        await insertNotification(conn, {
          bookingId: booking.id,
          userId: booking.patient_id,
          channel: 'EMAIL',
          type: 'CANCELLATION',
          recipient: booking.patient_email,
          subject: built.subject,
          message: built.text,
          provider: providerFor('EMAIL'),
          status: 'PENDING',
          eventKey: 'cancelled',
          payload,
        }),
      );
      if (promoted) notifications.push(...promoted.notifications);

      return {
        cancelledBooking: { ...booking, status: 'CANCELLED' },
        promotedBooking: promoted?.booking || null,
        promotedPatient: publicPromotedPatient(promoted?.patient),
        autoPromoted: Boolean(promoted),
        notifications,
        audits: [
          auditEvent(
            'CANCEL_BOOKING',
            'booking',
            bookingId,
            { status: beforeStatus },
            { status: 'CANCELLED', autoPromoted: Boolean(promoted) },
          ),
          ...(promoted ? [promoted.audit] : []),
        ],
        slotId: booking.slot_id,
        campId: booking.camp_id,
      };
    });
    await writeAuditEvents(outcome.audits, req.user);
    publishNotifications(outcome.notifications);
    emitBounded(io, 'slot:updated', {
      slotId: outcome.slotId,
      action: 'cancelled',
      autoPromoted: outcome.autoPromoted,
    });

    if (outcome.autoPromoted) {
      emitBounded(io, 'waitlist:promoted', {
        slotId: outcome.slotId,
        booking: safeSocketBooking(outcome.promotedBooking),
        at: new Date().toISOString(),
      });
    }

    res.json({
      status: 'CANCELLED',
      message: outcome.autoPromoted
        ? 'Seat released and the first waiting neighbour was atomically promoted.'
        : 'Seat released. No waitlisted patient was pending.',
      booking: publicBooking(outcome.cancelledBooking),
      autoPromoted: outcome.autoPromoted,
      promotedBooking: outcome.autoPromoted ? publicBooking(outcome.promotedBooking) : null,
      promotedPatient: outcome.autoPromoted ? publicPromotedPatient(outcome.promotedPatient) : null,
    });
  }),
);

app.patch(
  '/api/bookings/:id/reschedule',
  authenticate,
  validateBody(schemas.rescheduleSchema),
  asyncHandler(async (req, res) => {
    const bookingId = Number(req.params.id);
    const newSlotId = Number(req.body.slotId);

    const outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT b.*, c.title, c.venue, c.address, c.city, c.latitude, c.longitude,
                c.camp_date, c.status AS camp_status,
                p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email
         FROM bookings b
         JOIN camps c ON c.id = b.camp_id
         JOIN users p ON p.id = b.patient_id
         WHERE b.id = ? FOR UPDATE`,
        [bookingId],
      );
      if (!rows.length) throw new ApiError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
      const booking = rows[0];

      // Patients may only move their own booking. Administrative staff may act;
      // clinical/volunteer roles have no reschedule authority.
      if (
        !['PATIENT', 'ADMIN', 'ORGANIZER'].includes(req.user.role) ||
        (req.user.role === 'PATIENT' && booking.patient_id !== req.user.id)
      ) {
        throw new ApiError(403, 'You cannot reschedule this booking.', 'RESCHEDULE_FORBIDDEN');
      }
      if (booking.camp_status !== 'PUBLISHED') {
        throw new ApiError(409, 'This camp is not accepting schedule changes.', 'CAMP_NOT_OPEN');
      }
      if (booking.status !== 'CONFIRMED') {
        throw new ApiError(409, 'Only a confirmed booking can be rescheduled.', 'NOT_ACTIVE');
      }
      if (Number(booking.slot_id) === newSlotId) {
        throw new ApiError(409, 'This booking is already on that slot.', 'SAME_SLOT');
      }

      // Lock both slot rows in ascending id order so two opposite reschedules
      // can never deadlock each other.
      const [slotRows] = await conn.query(
        `SELECT * FROM slots WHERE id IN (?) ORDER BY id ASC FOR UPDATE`,
        [[booking.slot_id, newSlotId]],
      );
      const target = slotRows.find((row) => Number(row.id) === newSlotId);
      if (!target) throw new ApiError(404, 'Target slot not found.', 'SLOT_NOT_FOUND');
      if (Number(target.camp_id) !== Number(booking.camp_id)) {
        throw new ApiError(400, 'A booking can only move within its own camp.', 'CROSS_CAMP_MOVE');
      }
      if (Number(target.booked_count) >= Number(target.capacity)) {
        throw new ApiError(409, 'That slot is full. Pick another slot or join its waitlist.', 'SLOT_FULL', {
          slot: publicSlot(target),
        });
      }

      await conn.query('UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = ?', [
        booking.slot_id,
      ]);
      const [moved] = await conn.query(
        `UPDATE slots SET booked_count = booked_count + 1
         WHERE id = ? AND booked_count < capacity`,
        [newSlotId],
      );
      if (moved.affectedRows !== 1) {
        throw new ApiError(409, 'That slot filled while you were moving. Try again.', 'SEAT_RACE_RETRY');
      }

      await conn.query('UPDATE bookings SET slot_id = ?, booked_at = NOW() WHERE id = ?', [
        newSlotId,
        bookingId,
      ]);

      await remindersEngine.rescheduleForBooking(conn, {
        bookingId,
        campDate: booking.camp_date,
        startTime: target.start_time,
      });

      // A reschedule is a real event: the patient must receive the new time,
      // venue and navigation link over both channels.
      const details = bookingMessageDetails({
        booking,
        patient: { name: booking.patient_name },
        camp: booking,
        slot: target,
      });
      const built = buildMessages('RESCHEDULED', details);
      const eventKey = `reschedule-${newSlotId}-${Date.now()}`;
      const payload = {
        ...details,
        fromSlotId: Number(booking.slot_id),
        toSlotId: newSlotId,
        eventKey,
      };
      const notifications = [
        await insertNotification(conn, {
          bookingId,
          userId: booking.patient_id,
          channel: 'SMS',
          type: 'RESCHEDULED',
          recipient: booking.patient_phone,
          message: built.sms,
          provider: providerFor('SMS'),
          status: 'PENDING',
          eventKey,
          payload,
        }),
        await insertNotification(conn, {
          bookingId,
          userId: booking.patient_id,
          channel: 'EMAIL',
          type: 'RESCHEDULED',
          recipient: booking.patient_email,
          subject: built.subject,
          message: built.text,
          provider: providerFor('EMAIL'),
          status: 'PENDING',
          eventKey,
          payload,
        }),
      ];

      return {
        fromSlotId: Number(booking.slot_id),
        toSlot: target,
        campId: Number(booking.camp_id),
        notifications,
      };
    });

    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'RESCHEDULE_BOOKING',
      targetType: 'booking',
      targetId: bookingId,
      before: { slotId: outcome.fromSlotId },
      after: { slotId: Number(outcome.toSlot.id) },
    });
    emitBounded(io, 'slot:updated', { slotId: outcome.toSlot.id, action: 'rescheduled' });
    emitBounded(io, 'booking:rescheduled', {
      bookingId,
      fromSlotId: outcome.fromSlotId,
      toSlotId: Number(outcome.toSlot.id),
    });
    publishNotifications(outcome.notifications);

    res.json({
      status: 'RESCHEDULED',
      message: 'Booking moved. Reminders were re-queued for the new slot.',
      fromSlotId: outcome.fromSlotId,
      slot: publicSlot(outcome.toSlot),
      bookingId,
    });
  }),
);

app.get(
  '/api/bookings/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT b.*, c.title AS camp_title, c.camp_date, c.venue, c.address,
              c.city, c.latitude, c.longitude,
              s.start_time, s.end_time, w.position AS waitlist_position
       FROM bookings b
       JOIN camps c ON c.id = b.camp_id
       JOIN slots s ON s.id = b.slot_id
       LEFT JOIN waitlist w ON w.slot_id = b.slot_id AND w.patient_id = b.patient_id AND w.status = 'WAITING'
       WHERE b.patient_id = ?
       ORDER BY b.booked_at DESC`,
      [req.user.id],
    );
    res.json({ bookings: rows.map(publicBooking) });
  }),
);

app.get(
  '/api/bookings/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT b.*, c.title AS camp_title, c.camp_date, c.venue, c.address,
              c.city, c.latitude, c.longitude,
              s.start_time, s.end_time
       FROM bookings b
       JOIN camps c ON c.id = b.camp_id
       JOIN slots s ON s.id = b.slot_id
       WHERE b.id = ?`,
      [req.params.id],
    );
    if (!rows.length) throw new ApiError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
    if (req.user.role === 'PATIENT' && rows[0].patient_id !== req.user.id) {
      throw new ApiError(403, 'Not your booking.', 'BOOKING_FORBIDDEN');
    }
    res.json({
      booking: publicBooking(rows[0]),
      waitlistCount: 0,
      offlinePass: {
        note: 'Cache this payload for offline QR display. No medical data is present.',
        generatedAt: new Date().toISOString(),
      },
    });
  }),
);

/* ---------------------------------------------------------------------------
 * SHORT NAVIGATION LINK (used in SMS)
 * `/n/<token>` resolves the real camp and redirects to Google Maps. The token
 * is opaque and the destination is built only from database values, so this is
 * never an open redirect.
 * ------------------------------------------------------------------------- */

app.get(
  '/n/:token',
  asyncHandler(async (req, res) => {
    const token = extractTicketToken(req.params.token);
    if (!token) throw new ApiError(404, 'Navigation link not found.', 'NAV_NOT_FOUND');
    const [rows] = await pool.query(
      `SELECT c.venue, c.address, c.city, c.latitude, c.longitude
       FROM bookings b JOIN camps c ON c.id = b.camp_id
       WHERE b.qr_token = ? OR b.token_number = ?
       LIMIT 1`,
      [token, token],
    );
    if (!rows.length) throw new ApiError(404, 'Navigation link not found.', 'NAV_NOT_FOUND');
    const mapsUrl = buildMapsUrl(rows[0]);
    if (!mapsUrl) throw new ApiError(404, 'This camp has no navigation address.', 'NAV_UNAVAILABLE');
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, mapsUrl);
  }),
);

/* ---------------------------------------------------------------------------
 * QR CHECK-IN + LIVE QUEUE BROADCAST
 * ------------------------------------------------------------------------- */

app.post(
  '/api/checkin',
  authenticate,
  requireRole('DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    // The QR encodes a Google Maps URL with the opaque ticket token in its
    // fragment. A raw token and the legacy six-digit pass are still accepted.
    const token = extractTicketToken(req.body?.qrToken);
    if (!token) throw new ApiError(400, 'qrToken is required.', 'VALIDATION');

    const outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT b.*, s.start_time, s.end_time, c.title, c.title AS camp_title,
                c.venue, c.address, c.city, c.latitude, c.longitude, c.camp_date,
                p.name AS patient_name, p.phone, p.email
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN camps c ON c.id = b.camp_id
         JOIN users p ON p.id = b.patient_id
         WHERE (b.qr_token = ? OR b.token_number = ?) FOR UPDATE`,
        [token, token],
      );
      if (!rows.length) throw new ApiError(404, 'QR token not recognised.', 'TOKEN_NOT_FOUND');
      const booking = rows[0];

      // Role alone is not enough: a doctor or volunteer may only scan passes at
      // camps where they are actually assigned. Organizers/admins manage all camps.
      if (!(await canJoinCampRoom(req.user, booking.camp_id, conn))) {
        throw new ApiError(403, 'You are not assigned to this camp.', 'CAMP_SCOPE_FORBIDDEN');
      }

      if (booking.status === 'CHECKED_IN') {
        return { alreadyCheckedIn: true, booking };
      }
      if (booking.status === 'CANCELLED') {
        throw new ApiError(409, 'This booking was cancelled.', 'BOOKING_CANCELLED');
      }
      if (booking.status === 'NO_SHOW') {
        throw new ApiError(409, 'This booking is marked NO_SHOW.', 'BOOKING_NO_SHOW');
      }
      // A QR pass is a claim only after confirmation. HELD/EXPIRED/COMPLETED and
      // any unknown status must never be silently promoted into the queue.
      if (booking.status !== 'CONFIRMED') {
        throw new ApiError(
          409,
          `A ${booking.status} booking cannot be checked in. Confirm the seat first.`,
          'INVALID_CHECKIN_STATUS',
          { status: booking.status },
        );
      }

      await conn.query(
        `UPDATE bookings SET status='CHECKED_IN', checked_in_at=NOW() WHERE id=?`,
        [booking.id],
      );
      await remindersEngine.cancelForBooking(conn, booking.id);
      return {
        alreadyCheckedIn: false,
        beforeStatus: booking.status,
        booking: { ...booking, status: 'CHECKED_IN', checked_in_at: new Date() },
      };
    });

    const queue = await getQueueSnapshot(outcome.booking.camp_id);
    const payload = {
      ...publicBooking(outcome.booking),
      patientName: outcome.booking.patient_name,
      campTitle: outcome.booking.camp_title || outcome.booking.title,
      venue: outcome.booking.venue,
      address: outcome.booking.address,
      startTime: outcome.booking.start_time,
      endTime: outcome.booking.end_time,
    };
    // Only the authenticated caller receives the full booking details. Global
    // and room broadcasts carry a PII-free token summary.
    const safeBooking = safeSocketBooking(outcome.booking);
    emitBounded(io.to(`camp:${outcome.booking.camp_id}`), 'queue:updated', queue);
    if (!outcome.alreadyCheckedIn) {
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'CHECK_IN',
        targetType: 'booking',
        targetId: outcome.booking.id,
        before: { status: outcome.beforeStatus || 'CONFIRMED' },
        after: { status: 'CHECKED_IN' },
      });
    }
    emitBounded(io, 'checkin:new', {
      booking: safeBooking,
      queue,
      alreadyCheckedIn: outcome.alreadyCheckedIn,
      at: new Date().toISOString(),
    });

    res.json({
      status: outcome.alreadyCheckedIn ? 'ALREADY_CHECKED_IN' : 'CHECKED_IN',
      message: outcome.alreadyCheckedIn
        ? 'Token was already checked in. Queue unchanged.'
        : `Token ${payload.tokenNumber} joined the live waiting room.`,
      booking: payload,
      queue,
      clinicChime: !outcome.alreadyCheckedIn,
    });
  }),
);

/* ---------------------------------------------------------------------------
 * ATTENDANCE — staff can correct a check-in or mark a no-show.
 * ------------------------------------------------------------------------- */

app.patch(
  '/api/bookings/:id/attendance',
  authenticate,
  requireRole('DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'),
  validateBody(schemas.attendanceSchema),
  asyncHandler(async (req, res) => {
    const bookingId = Number(req.params.id);
    const next = req.body.status;

    const booking = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT * FROM bookings WHERE id = ? FOR UPDATE',
        [bookingId],
      );
      if (!rows.length) throw new ApiError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
      const row = rows[0];

      if (!(await canJoinCampRoom(req.user, row.camp_id, conn))) {
        throw new ApiError(403, 'You are not assigned to this camp.', 'CAMP_SCOPE_FORBIDDEN');
      }

      const allowed = {
        CONFIRMED: ['CHECKED_IN', 'NO_SHOW'],
        NO_SHOW: ['CHECKED_IN'],
        CHECKED_IN: ['COMPLETED', 'NO_SHOW'],
        COMPLETED: [],
        CANCELLED: [],
      };
      if (!(allowed[row.status] || []).includes(next)) {
        throw new ApiError(
          409,
          `Cannot move a ${row.status} booking to ${next}.`,
          'INVALID_ATTENDANCE_TRANSITION',
          { from: row.status, to: next, allowed: allowed[row.status] || [] },
        );
      }

      const now = new Date();
      if (next === 'CHECKED_IN') {
        await conn.query(
          `UPDATE bookings SET status = 'CHECKED_IN', checked_in_at = COALESCE(checked_in_at, NOW()) WHERE id = ?`,
          [bookingId],
        );
        await remindersEngine.cancelForBooking(conn, bookingId);
      } else if (next === 'NO_SHOW') {
        await conn.query(
          `UPDATE bookings SET status = 'NO_SHOW', checked_in_at = NULL WHERE id = ?`,
          [bookingId],
        );
        await remindersEngine.cancelForBooking(conn, bookingId);
      } else {
        await conn.query(`UPDATE bookings SET status = 'COMPLETED' WHERE id = ?`, [bookingId]);
      }

      const checkedInAt = next === 'CHECKED_IN'
        ? (row.checked_in_at ?? now)
        : row.checked_in_at;
      return {
        ...row,
        status: next,
        checked_in_at: checkedInAt,
        beforeStatus: row.status,
        beforeCheckedInAt: row.checked_in_at,
      };
    });

    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'UPDATE_ATTENDANCE',
      targetType: 'booking',
      targetId: bookingId,
      before: { status: booking.beforeStatus, checkedInAt: toIso(booking.beforeCheckedInAt) },
      after: { status: next, checkedInAt: toIso(booking.checked_in_at) },
    });
    emitBounded(io, 'attendance:updated', {
      bookingId,
      campId: Number(booking.camp_id),
      status: next,
    });
    res.json({ booking: publicBooking(booking), status: next });
  }),
);

/* Close a camp day: everyone still CONFIRMED becomes a NO_SHOW, the camp moves
   to COMPLETED, and any queued nudges are cancelled. Idempotent. */
app.post(
  '/api/camps/:campId/close-out',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const campId = Number(req.params.campId);

    const result = await withTransaction(async (conn) => {
      const [camps] = await conn.query('SELECT id, status FROM camps WHERE id = ? FOR UPDATE', [
        campId,
      ]);
      if (!camps.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');

      const [noShows] = await conn.query(
        `UPDATE bookings SET status = 'NO_SHOW'
         WHERE camp_id = ? AND status = 'CONFIRMED'`,
        [campId],
      );
      await conn.query(
        `UPDATE reminders r JOIN bookings b ON b.id = r.booking_id
         SET r.status = 'CANCELLED'
         WHERE b.camp_id = ? AND r.status IN ('PENDING','SENDING')`,
        [campId],
      );
      await conn.query(`UPDATE camps SET status = 'COMPLETED' WHERE id = ?`, [campId]);

      const [[counts]] = await conn.query(
        `SELECT
           SUM(status = 'CHECKED_IN') AS checked_in,
           SUM(status = 'COMPLETED') AS completed,
           SUM(status = 'NO_SHOW') AS no_show
         FROM bookings WHERE camp_id = ?`,
        [campId],
      );

      return {
        previousStatus: camps[0].status,
        noShowMarked: noShows.affectedRows,
        checkedIn: Number(counts.checked_in || 0),
        completed: Number(counts.completed || 0),
        noShow: Number(counts.no_show || 0),
      };
    });

    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'CLOSE_OUT_CAMP',
      targetType: 'camp',
      targetId: campId,
      before: { status: result.previousStatus },
      after: { status: 'COMPLETED', noShowMarked: result.noShowMarked },
    });
    emitBounded(io, 'camp:closed', { campId, ...result });
    res.json({ status: 'COMPLETED', campId, ...result });
  }),
);

/* ---------------------------------------------------------------------------
 * STAFF ASSIGNMENTS + LOAD BALANCER
 * ------------------------------------------------------------------------- */
app.get(
  '/api/camps/:campId/staff',
  asyncHandler(async (req, res) => {
    // Public endpoint — projection deliberately excludes email and phone.
    const [rows] = await pool.query(
      `SELECT sa.*, u.name
       FROM staff_assignments sa JOIN users u ON u.id = sa.user_id
       WHERE sa.camp_id = ? ORDER BY sa.role_at_camp, u.name`,
      [req.params.campId],
    );
    res.json({ staff: rows.map(publicStaff) });
  }),
);

/* ---------------------------------------------------------------------------
 * CAMP DAY CONTROL ROOM — real-time board for organizers
 * Slot fill, check-in queue, staff status, no-show countdown.
 * ------------------------------------------------------------------------- */

app.get(
  '/api/camps/:campId/control-room',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const campId = Number(req.params.campId);

    const [camps] = await pool.query(
      'SELECT id, title, venue, camp_date, start_time, end_time, status FROM camps WHERE id = ?',
      [campId],
    );
    if (!camps.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    const camp = camps[0];

    // Slot fill board
    const [slots] = await pool.query(
      `SELECT id, slot_index, start_time, end_time, capacity, booked_count
       FROM slots WHERE camp_id = ? ORDER BY slot_index`,
      [campId],
    );
    const slotBoard = slots.map((s) => ({
      id: s.id,
      slotIndex: s.slot_index,
      startTime: s.start_time,
      endTime: s.end_time,
      capacity: Number(s.capacity),
      booked: Number(s.booked_count),
      remaining: Number(s.capacity) - Number(s.booked_count),
      fillPct: Number(s.capacity) ? Math.round((Number(s.booked_count) / Number(s.capacity)) * 100) : 0,
    }));

    // Check-in queue (checked-in patients, earliest first)
    const [checkedIn] = await pool.query(
      `SELECT b.id, b.token_number, b.checked_in_at, u.name AS patient_name,
              s.start_time, s.end_time
       FROM bookings b
       JOIN users u ON u.id = b.patient_id
       JOIN slots s ON s.id = b.slot_id
       WHERE b.camp_id = ? AND b.status = 'CHECKED_IN'
        ORDER BY b.checked_in_at ASC, b.id ASC`,
      [campId],
    );

    // Explainable no-show risk score (rule-based heuristic, NOT AI prediction)
    const [history] = await pool.query(
      `SELECT patient_id,
              SUM(status = 'NO_SHOW') AS no_shows,
              SUM(status IN ('CHECKED_IN','NO_SHOW')) AS total
       FROM bookings
       GROUP BY patient_id`,
    );
    const riskByPatient = {};
    for (const h of history) {
      const total = Number(h.total || 0);
      const noShows = Number(h.no_shows || 0);
      const score = total ? noShows / total : null;
      let level = 'Low';
      let reason = 'No prior booking history';
      if (score !== null) {
        if (score > 0.6) level = 'High';
        else if (score > 0.3) level = 'Medium';
        reason = `${noShows} no-show in ${total} past booking${total === 1 ? '' : 's'}`;
      }
      riskByPatient[Number(h.patient_id)] = { level, score, reason };
    }
    const [patientIds] = await pool.query(
      `SELECT b.id AS booking_id, b.patient_id FROM bookings b WHERE b.camp_id = ? AND b.status = 'CHECKED_IN'`,
      [campId],
    );
    const riskMap = {};
    for (const p of patientIds) {
      riskMap[p.booking_id] = riskByPatient[Number(p.patient_id)] || { level: 'Low', score: null, reason: 'No prior booking history' };
    }

    // Staff status with load warnings
    const [staff] = await pool.query(
      `SELECT sa.id, sa.user_id, sa.role_at_camp, sa.shift_start, sa.shift_end,
              sa.expected_load_per_hour, sa.max_patients_per_hour, sa.duties,
              u.name
       FROM staff_assignments sa
       JOIN users u ON u.id = sa.user_id
       WHERE sa.camp_id = ?
        ORDER BY sa.role_at_camp, u.name`,
      [campId],
    );
    const staffBoard = staff.map((s) => ({
      id: s.id,
      userId: s.user_id,
      name: s.name,
      roleAtCamp: s.role_at_camp,
      shiftStart: s.shift_start,
      shiftEnd: s.shift_end,
      expectedLoadPerHour: Number(s.expected_load_per_hour),
      maxPatientsPerHour: Number(s.max_patients_per_hour),
      duties: s.duties,
      loadWarning: Number(s.expected_load_per_hour) > Number(s.max_patients_per_hour),
    }));

    // No-show / attendance stats
    const [[stats]] = await pool.query(
      `SELECT
         SUM(status = 'CHECKED_IN') AS checked_in,
         SUM(status = 'NO_SHOW') AS no_show,
         SUM(status = 'CONFIRMED') AS confirmed,
         SUM(status = 'CANCELLED') AS cancelled,
         COUNT(*) AS total
       FROM bookings WHERE camp_id = ?`,
      [campId],
    );

    const now = Date.now();
    const campStart = new Date(String(camp.camp_date) + ' ' + String(camp.start_time)).getTime();
    const minutesToStart = Math.round((campStart - now) / 60000);

    return res.json({
      camp: { id: camp.id, title: camp.title, venue: camp.venue, campDate: camp.camp_date, status: camp.status },
      slots: slotBoard,
      checkedIn: checkedIn.map((row) => {
        const risk = riskMap[row.id] || { level: 'Low', score: null, reason: 'No prior booking history' };
        return {
          id: row.id,
          tokenNumber: row.token_number,
          patientName: row.patient_name,
          checkedInAt: row.checked_in_at,
          slot: `${row.start_time} – ${row.end_time}`,
          noShowRisk: risk,
        };
      }),
      staff: staffBoard,
      stats: {
        checkedIn: Number(stats.checked_in || 0),
        noShow: Number(stats.no_show || 0),
        confirmed: Number(stats.confirmed || 0),
        cancelled: Number(stats.cancelled || 0),
        total: Number(stats.total || 0),
      },
      minutesToStart: minutesToStart > 0 ? minutesToStart : 0,
    });
  }),
);

app.get(
  '/api/staff/me',
  authenticate,
  requireRole('DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT sa.*, c.title, c.venue, c.camp_date, c.start_time AS camp_start,
              c.end_time AS camp_end, c.status
       FROM staff_assignments sa
       JOIN camps c ON c.id = sa.camp_id
       WHERE sa.user_id = ?
       ORDER BY c.camp_date ASC`,
      [req.user.id],
    );
    res.json({
      assignments: rows.map((row) => ({
        ...publicStaff({ ...row, name: req.user.name }),
        campTitle: row.title,
        venue: row.venue,
        campDate: row.camp_date,
        campStart: row.camp_start,
        campEnd: row.camp_end,
        campStatus: row.status,
      })),
    });
  }),
);

app.post(
  '/api/camps/:campId/staff',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  validateBody(schemas.staffAssignSchema),
  asyncHandler(async (req, res) => {
    const campId = Number(req.params.campId);
    const {
      userId,
      roleAtCamp = 'DOCTOR',
      shiftStart,
      shiftEnd,
      expectedLoadPerHour = 0,
      maxPatientsPerHour = 20,
      duties = '',
    } = req.body || {};

    if (!userId || !shiftStart || !shiftEnd) {
      throw new ApiError(400, 'userId, shiftStart and shiftEnd are required.', 'VALIDATION');
    }
    if (!['DOCTOR', 'VOLUNTEER', 'NURSE', 'COORDINATOR'].includes(roleAtCamp)) {
      throw new ApiError(400, 'Invalid camp role.', 'INVALID_ROLE');
    }
    if (parseTimeToMinutes(shiftEnd) <= parseTimeToMinutes(shiftStart)) {
      throw new ApiError(400, 'shiftEnd must be after shiftStart.', 'INVALID_SHIFT');
    }

    const staff = await withTransaction(async (conn) => {
      // Serialise staffing changes for this humans' calendar on the user row so
      // two organizers cannot slip overlapping shifts in at the same instant.
      const [userRows] = await conn.query(
        'SELECT id, role FROM users WHERE id = ? AND is_active = 1 FOR UPDATE',
        [userId],
      );
      if (!userRows.length) throw new ApiError(404, 'Staff user not found.', 'USER_NOT_FOUND');

      const [campRows] = await conn.query('SELECT id, camp_date FROM camps WHERE id = ?', [campId]);
      if (!campRows.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
      const campDate = campRows[0].camp_date;

      const [sameCamp] = await conn.query(
        'SELECT id FROM staff_assignments WHERE camp_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
        [campId, Number(userId)],
      );
      if (sameCamp.length) {
        throw new ApiError(409, 'This user is already assigned to the camp.', 'STAFF_ALREADY_ASSIGNED');
      }

      // Half-open interval overlap: [start, end) ∩ [start, end) ≠ ∅
      const [conflicts] = await conn.query(
        `SELECT sa.id, sa.shift_start, sa.shift_end, c.id AS camp_id, c.title, c.camp_date
         FROM staff_assignments sa
         JOIN camps c ON c.id = sa.camp_id
         WHERE sa.user_id = ? AND c.camp_date = ? AND sa.camp_id <> ?
           AND sa.shift_start < ? AND sa.shift_end > ?
         FOR UPDATE`,
        [Number(userId), campDate, campId, shiftEnd, shiftStart],
      );
      if (conflicts.length) {
        throw new ApiError(
          409,
          'This staff member is already assigned to an overlapping shift that day.',
          'STAFF_OVERLAP',
          {
            conflicts: conflicts.map((row) => ({
              assignmentId: row.id,
              campId: row.camp_id,
              campTitle: row.title,
              shiftStart: row.shift_start,
              shiftEnd: row.shift_end,
            })),
          },
        );
      }

      const [insert] = await conn.query(
        `INSERT INTO staff_assignments
           (camp_id, user_id, role_at_camp, shift_start, shift_end,
            expected_load_per_hour, max_patients_per_hour, duties)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          campId,
          Number(userId),
          roleAtCamp,
          shiftStart,
          shiftEnd,
          Number(expectedLoadPerHour),
          Number(maxPatientsPerHour),
          String(duties),
        ],
      );
      const [rows] = await conn.query(
        `SELECT sa.*, u.name
         FROM staff_assignments sa JOIN users u ON u.id = sa.user_id WHERE sa.id = ?`,
        [insert.insertId],
      );
      return publicStaff(rows[0]);
    });

    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'ASSIGN_STAFF',
      targetType: 'staff_assignment',
      targetId: staff.id,
      before: null,
      after: { campId, userId: staff.userId, roleAtCamp: staff.roleAtCamp },
    });
    emitBounded(io, 'staff:assigned', { campId, staff });
    res.status(201).json({
      staff,
      warning: staff.loadWarning
        ? {
            severity: 'CLINICAL_LOAD',
            message: `${staff.name} assigned ${staff.expectedLoadPerHour} patients/hr — exceeds ${staff.maxPatientsPerHour}/hr safe threshold. Rebalance the shift or add another doctor.`,
          }
        : null,
    });
  }),
);

app.delete(
  '/api/staff/:id',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const staffId = Number(req.params.id);
    const [beforeRows] = await pool.query('SELECT * FROM staff_assignments WHERE id = ?', [staffId]);
    if (!beforeRows.length) throw new ApiError(404, 'Assignment not found.', 'STAFF_NOT_FOUND');
    const [result] = await pool.query('DELETE FROM staff_assignments WHERE id = ?', [staffId]);
    if (!result.affectedRows) throw new ApiError(404, 'Assignment not found.', 'STAFF_NOT_FOUND');
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'REMOVE_STAFF',
      targetType: 'staff_assignment',
      targetId: staffId,
      before: beforeRows[0],
      after: null,
    });
    emitBounded(io, 'staff:removed', { staffId });
    res.json({ deleted: true, staffId: Number(req.params.id) });
  }),
);

/* ---------------------------------------------------------------------------
 * ADMIN ANALYTICS, CAPACITY ADVISOR, USER MANAGEMENT, NOTIFICATIONS, CSV
 * ------------------------------------------------------------------------- */

app.get(
  '/api/admin/analytics',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (_req, res) => {
    res.json(await buildAnalytics());
  }),
);

app.get(
  '/api/admin/capacity-advisor',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  validateQuery(schemas.advisorQuerySchema),
  asyncHandler(async (req, res) => {
    const { physicalCapacity, alphaMax } = req.query;
    res.json(await buildCapacityAdvisor(physicalCapacity, alphaMax));
  }),
);

/* ---------------------------------------------------------------------------
 * OPS READINESS + PROVIDER SELF-TEST
 * ------------------------------------------------------------------------- */

app.get(
  '/api/admin/ops/readiness',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (_req, res) => {
    res.json(await buildOpsReadiness());
  }),
);

/**
 * Operator-initiated provider check. It sends one real message through the
 * configured gateway to the signed-in admin's own address. With no gateway the
 * sandbox reports `simulated: true` — the endpoint never pretends a message
 * left the server. Every attempt is written to the audit log.
 */
app.post(
  '/api/admin/ops/delivery-test',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const channel = String(req.body?.channel || '').trim().toUpperCase();
    if (!['EMAIL', 'SMS'].includes(channel)) {
      throw new ApiError(400, 'channel must be EMAIL or SMS.', 'VALIDATION');
    }

    const [rows] = await pool.query(
      'SELECT id, name, email, phone FROM users WHERE id = ? AND is_active = 1',
      [req.user.id],
    );
    if (!rows.length) throw new ApiError(401, 'User no longer active.', 'USER_INACTIVE');

    const recipient = channel === 'EMAIL' ? rows[0].email : rows[0].phone;
    if (!recipient) {
      throw new ApiError(
        409,
        `No ${channel === 'EMAIL' ? 'email address' : 'mobile number'} is stored on this admin account.`,
        'NO_RECIPIENT',
      );
    }

    const provider = channel === 'EMAIL' ? providers.email : providers.sms;
    const testedAt = new Date().toISOString();
    const text = channel === 'SMS'
      ? `CHSC delivery test: ${channel} gateway check at ${testedAt}. Provider ${provider.name}. No booking or patient data is included.`
      : [
        'CHSC delivery configuration test',
        '',
        `Sent at: ${testedAt}`,
        `Channel: ${channel}`,
        `Provider: ${provider.name}`,
        `Public base: ${publicBaseUrl(process.env)}`,
        '',
        'This is an operator-initiated connectivity test. It contains no booking, patient or clinical data.',
        'A patient-facing message is only marked SENT when the provider accepts it.',
      ].join('\n');

    try {
      const result = await provider.send({
        to: recipient,
        subject: `CHSC delivery test · ${channel}`,
        text,
        ...(channel === 'EMAIL' ? { replyTo: process.env.MAIL_REPLY_TO || undefined } : {}),
      });
      const simulated = Boolean(result.simulated);
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'DELIVERY_TEST',
        targetType: 'provider',
        targetId: null,
        after: {
          channel,
          provider: provider.name,
          simulated,
          reference: result.reference || null,
          testedAt,
        },
      });
      res.json({
        ok: true,
        channel,
        provider: provider.name,
        live: Boolean(provider.live),
        simulated,
        delivered: !simulated,
        reference: result.reference || null,
        recipient: redactRecipient(recipient),
        testedAt,
        message: simulated
          ? 'No live provider is configured. Nothing left the server — this attempt is labelled Sandbox.'
          : 'The provider accepted the test message. Final delivery depends on the mailbox or carrier.',
      });
    } catch (error) {
      const reason = String(error?.message || error || 'Provider rejected the message.').slice(0, 300);
      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'DELIVERY_TEST_FAILED',
        targetType: 'provider',
        targetId: null,
        after: { channel, provider: provider.name, error: reason, testedAt },
      });
      throw new ApiError(
        502,
        `${provider.name} rejected the test message: ${reason}`,
        'PROVIDER_ERROR',
        { channel, provider: provider.name },
      );
    }
  }),
);

app.get(
  '/api/admin/notifications',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (req, res) => {
    const paging = parsePagination(req.query);
    if (!paging) throw new ApiError(400, 'Invalid pagination.', 'INVALID_PAGINATION');
    const [rows] = await pool.query(
      'SELECT * FROM notifications_log ORDER BY sent_at DESC, id DESC LIMIT ? OFFSET ?',
      [paging.limit, paging.offset],
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM notifications_log');
    res.json({
      notifications: rows.map(publicNotification),
      pagination: buildPagination(Number(total), paging),
    });
  }),
);

app.post(
  '/api/admin/notifications/:id/retry',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, 'Invalid notification id.', 'VALIDATION');
    }
    const [rows] = await pool.query('SELECT * FROM notifications_log WHERE id = ?', [id]);
    if (!rows.length) throw new ApiError(404, 'Notification not found.', 'NOTIFICATION_NOT_FOUND');

    const meta = providerMeta(rows[0].channel);
    if (!meta.live) {
      throw new ApiError(
        409,
        `${rows[0].channel} provider is not configured. Configure SMTP/SMS credentials before retrying a real delivery.`,
        'PROVIDER_NOT_CONFIGURED',
        { channel: rows[0].channel, provider: meta.name },
      );
    }

    const delivered = await deliverNotification(rows[0], { force: true });
    const [fresh] = await pool.query('SELECT * FROM notifications_log WHERE id = ?', [id]);
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'RETRY_NOTIFICATION',
      targetType: 'notification',
      targetId: id,
      before: { status: rows[0].status },
      after: { status: fresh[0]?.status || delivered?.status || 'UNKNOWN' },
    });
    emitBounded(io, 'admin:notifications-changed', { id, status: fresh[0]?.status });
    res.json({
      notification: publicNotification(fresh[0]),
      message:
        fresh[0]?.status === 'SENT'
          ? 'Provider accepted the message.'
          : `Delivery finished with status ${fresh[0]?.status || 'UNKNOWN'}.`,
    });
  }),
);

app.get(
  '/api/admin/users',
  authenticate,
  // Organizers need an assignable-person list for the staff matrix. Serve them
  // a minimal, PII-free projection; full account administration stays admin-only.
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (req, res) => {
    const paging = parsePagination(req.query);
    if (!paging) throw new ApiError(400, 'Invalid pagination.', 'INVALID_PAGINATION');
    const isAdmin = req.user.role === 'ADMIN';
    const columns = isAdmin
      ? 'id, name, email, phone, role, age_group, preferred_language, is_active, created_at'
      : 'id, name, role, is_active';
    const [rows] = await pool.query(
      `SELECT ${columns}
       FROM users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [paging.limit, paging.offset],
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
    res.json({
      users: rows.map((row) => (isAdmin ? safeUser(row) : {
        id: row.id,
        name: row.name,
        role: row.role,
        isActive: Boolean(row.is_active),
      })),
      pagination: buildPagination(Number(total), paging),
    });
  }),
);

app.patch(
  '/api/admin/users/:id/role',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const role = String(req.body?.role || '').toUpperCase();
    if (!['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'].includes(role)) {
      throw new ApiError(400, 'Invalid role.', 'INVALID_ROLE');
    }
    if (Number(req.params.id) === req.user.id && role !== 'ADMIN') {
      throw new ApiError(409, 'You cannot remove your own admin role.', 'SELF_DEMOTION');
    }
    const [beforeRows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (!beforeRows.length) throw new ApiError(404, 'User not found.', 'USER_NOT_FOUND');
    const previousRole = beforeRows[0].role;
    const [result] = await pool.query('UPDATE users SET role = ? WHERE id = ?', [
      role,
      req.params.id,
    ]);
    if (!result.affectedRows) throw new ApiError(404, 'User not found.', 'USER_NOT_FOUND');
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, role, age_group, preferred_language, is_active, created_at
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'CHANGE_USER_ROLE',
      targetType: 'user',
      targetId: Number(req.params.id),
      before: { role: previousRole },
      after: { role },
    });
    emitBounded(io, 'admin:users-changed', { reason: 'role', userId: Number(req.params.id) });
    res.json({ user: safeUser(rows[0]) });
  }),
);

app.patch(
  '/api/admin/users/:id/status',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const active = req.body?.isActive ? 1 : 0;
    if (Number(req.params.id) === req.user.id && !active) {
      throw new ApiError(409, 'You cannot deactivate your own account.', 'SELF_DEACTIVATION');
    }
    const [beforeRows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [req.params.id]);
    if (!beforeRows.length) throw new ApiError(404, 'User not found.', 'USER_NOT_FOUND');
    const wasActive = Boolean(beforeRows[0].is_active);
    const [result] = await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [
      active,
      req.params.id,
    ]);
    if (!result.affectedRows) throw new ApiError(404, 'User not found.', 'USER_NOT_FOUND');
    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'CHANGE_USER_STATUS',
      targetType: 'user',
      targetId: Number(req.params.id),
      before: { isActive: wasActive },
      after: { isActive: Boolean(active) },
    });
    emitBounded(io, 'admin:users-changed', { reason: 'status', userId: Number(req.params.id) });
    res.json({ userId: Number(req.params.id), isActive: Boolean(active) });
  }),
);

app.post(
  '/api/admin/reminders/run',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (_req, res) => {
    const result = await runReminderSweep('manual');
    res.json({
      ...result,
      note: 'Reminders are claimed with SELECT … FOR UPDATE SKIP LOCKED; a booking/type pair can only be sent once per claim and retries back off exponentially.',
    });
  }),
);

/** Manual, idempotent equivalent of the hold/promotion expiry cron. */
app.post(
  '/api/admin/holds/expire',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (_req, res) => {
    const result = await runHoldExpirySweep('manual');
    res.json({
      ...result,
      bookingHoldMinutes: BOOKING_HOLD_MINUTES,
      promotionHoldMinutes: PROMOTION_HOLD_MINUTES,
      note: 'Expired HELD bookings release their seat; expired promotions hand it to the next FIFO waiter.',
    });
  }),
);

app.get(
  '/api/admin/reports/export.csv',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (_req, res) => {
    // Aggregate slots and bookings in separate subqueries first. Joining both
    // detail tables directly produced a cartesian product (S × B rows), which
    // inflated capacity, booked and attendance figures.
    const [rows] = await pool.query(
      `SELECT c.title, c.venue, c.camp_date, c.status,
              COALESCE(cap.capacity, 0) AS capacity,
              COALESCE(cap.booked, 0) AS booked,
              COALESCE(att.attended, 0) AS attended,
              COALESCE(att.no_shows, 0) AS no_shows
       FROM camps c
       LEFT JOIN (
         SELECT camp_id, SUM(capacity) AS capacity, SUM(booked_count) AS booked
         FROM slots GROUP BY camp_id
       ) cap ON cap.camp_id = c.id
       LEFT JOIN (
         SELECT camp_id,
                SUM(status = 'CHECKED_IN') AS attended,
                SUM(status = 'NO_SHOW') AS no_shows
         FROM bookings GROUP BY camp_id
       ) att ON att.camp_id = c.id
       ORDER BY c.camp_date DESC`,
    );
    const header = 'Camp,Venue,Date,Status,Capacity,Booked,Attended,No-Shows,Attendance Rate %';
    const lines = rows.map((row) => {
      const checked = Number(row.attended || 0);
      const noShow = Number(row.no_shows || 0);
      const rate = checked + noShow ? ((checked / (checked + noShow)) * 100).toFixed(1) : '0.0';
      return [
        `"${String(row.title).replaceAll('"', '""')}"`,
        `"${String(row.venue).replaceAll('"', '""')}"`,
        row.camp_date,
        row.status,
        row.capacity,
        row.booked,
        checked,
        noShow,
        rate,
      ].join(',');
    });
    const csv = `\ufeff${header}\n${lines.join('\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="CHSC_Report_${todayIso()}.csv"`,
    );
    res.send(csv);
  }),
);

/* ---------------------------------------------------------------------------
 * PRIVACY: RIGHT TO ERASURE (DPDP Act 2023, data minimisation)
 * ------------------------------------------------------------------------- */

app.delete(
  '/api/users/me/purge',
  authenticate,
  asyncHandler(async (req, res) => {
    const outcome = await withTransaction(async (conn) => {
      const [users] = await conn.query('SELECT id, role FROM users WHERE id = ? FOR UPDATE', [
        req.user.id,
      ]);
      if (!users.length) throw new ApiError(404, 'User not found.', 'USER_NOT_FOUND');

      const [active] = await conn.query(
        `SELECT id, slot_id, status FROM bookings
         WHERE patient_id = ? AND status IN ('CONFIRMED','CHECKED_IN') FOR UPDATE`,
        [req.user.id],
      );

      for (const booking of active) {
        await conn.query('UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = ?', [
          booking.slot_id,
        ]);
      }
      await conn.query('UPDATE waitlist SET status = "CANCELLED" WHERE patient_id = ?', [
        req.user.id,
      ]);
      // DPDP-compliant anonymisation in place: keep the row (and therefore all
      // historical bookings, waitlist entries and analytics FKs) but destroy
      // every direct identifier. A one-way random hash makes the old password
      // unusable while the account is deactivated.
      const id = req.user.id;
      const purgeHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      await conn.query(
        `UPDATE users
         SET name = 'Purged User', email = ?, phone = ?, password_hash = ?,
             age_group = NULL, is_active = 0
         WHERE id = ?`,
        [`purged.${id}@anonymized.invalid`, `PURGED-${id}`, purgeHash, id],
      );
      // Notification history also carries recipient addresses and message bodies
      // with patient names — scrub those without deleting the audit trail.
      await conn.query(
        `UPDATE notifications_log
         SET recipient = ?, subject = NULL, message = 'Content removed by user erasure request.', payload = NULL
         WHERE user_id = ?`,
        [`purged.${id}@anonymized.invalid`, id],
      );
      // Browser push endpoints identify a device, so erasure removes every
      // subscription along with the direct contact fields.
      await conn.query('DELETE FROM push_subscriptions WHERE user_id = ?', [id]);

      return {
        purged: true,
        activeBookingsReleased: active.length,
        purgedUserId: id,
      };
    });

    await auditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'PURGE_USER_DATA',
      targetType: 'user',
      targetId: req.user.id,
      before: { identifierPresent: true },
      after: { identifierPresent: false, activeBookingsReleased: outcome.activeBookingsReleased },
    });
    emitBounded(io, 'privacy:purged', {
      userId: outcome.purgedUserId,
      at: new Date().toISOString(),
      message: 'Personal data anonymised; active seats released.',
    });
    res.json({
      ...outcome,
      message:
        'Your personal data has been purged. Only non-identifying camp capacity counters remain.',
      legalNote:
        'Data minimisation: CHSC never stores medical history, diagnosis, prescriptions or reports.',
    });
  }),
);

/* ---------------------------------------------------------------------------
 * LIVE CONCURRENCY PROOF — 50 simultaneous transactions vs one capacity-10 slot
 * Uses real InnoDB SELECT ... FOR UPDATE row locks. The temporary identities and
 * rows created for the race are removed before the response is returned, so the
 * result is real evidence without leaving seeded/demo data in the database.
 * ------------------------------------------------------------------------- */

app.post(
  '/api/admin/concurrency-proof',
  authenticate,
  requireRole('ORGANIZER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const campId = Number(req.body?.campId);
    if (!Number.isInteger(campId)) throw new ApiError(400, 'A valid campId is required.', 'VALIDATION');
    const [camps] = await pool.query('SELECT id, status FROM camps WHERE id = ?', [campId]);
    if (!camps.length) throw new ApiError(404, 'Camp not found.', 'CAMP_NOT_FOUND');
    if (camps[0].status !== 'PUBLISHED') {
      throw new ApiError(409, 'Camp must be PUBLISHED for the proof.', 'CAMP_NOT_OPEN');
    }

    const [slots] = await pool.query(
      `SELECT id, capacity, booked_count FROM slots
       WHERE camp_id = ? AND capacity = 10 AND booked_count = 0
       ORDER BY id LIMIT 1`,
      [campId],
    );
    let slotId;
    let createdSlot = false;
    if (!slots.length) {
      const [[maxIdx]] = await pool.query(
        'SELECT COALESCE(MAX(slot_index), 0) AS m FROM slots WHERE camp_id = ?',
        [campId],
      );
      const [insert] = await pool.query(
        `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
         VALUES (?, ?, '08:00:00', '08:30:00', 10, 0)`,
        [campId, Number(maxIdx.m) + 1],
      );
      slotId = insert.insertId;
      createdSlot = true;
    } else {
      slotId = slots[0].id;
    }

    const runId = Date.now().toString(36);
    const patients = [];
    const originalBookedCount = Number(slots.length ? slots[0].booked_count : 0);
    let payload;
    try {
      for (let i = 0; i < 50; i += 1) {
        const hash = await bcrypt.hash(`Proof@${runId}!${i}`, 4);
        const [result] = await pool.query(
          `INSERT INTO users (name, email, phone, password_hash, role)
           VALUES (?, ?, ?, ?, 'PATIENT')`,
          [
            `Verification Patient ${i + 1}`,
            `proof.${runId}.${i}@invalid.local`,
            String(7000000000 + (Date.now() % 1000000) * 100 + i),
            hash,
          ],
        );
        patients.push(result.insertId);
      }

      const results = await Promise.all(
        patients.map((patientId) =>
          withTransaction(async (conn) => {
            const [rows] = await conn.query(
              'SELECT id, camp_id, capacity, booked_count FROM slots WHERE id = ? FOR UPDATE',
              [slotId],
            );
            if (!rows.length) return { status: 404, patientId };
            const slot = rows[0];
            if (Number(slot.booked_count) >= Number(slot.capacity)) {
              const [w] = await conn.query(
                `SELECT COUNT(*) AS n FROM waitlist WHERE slot_id = ? AND status = 'WAITING'`,
                [slotId],
              );
              const position = Number(w[0].n) + 1;
              await conn.query(
                `INSERT INTO waitlist (slot_id, camp_id, patient_id, position, status)
                 VALUES (?, ?, ?, ?, 'WAITING')`,
                [slotId, campId, patientId, position],
              );
              return { status: 202, patientId, position };
            }
            await conn.query('UPDATE slots SET booked_count = booked_count + 1 WHERE id = ?', [slotId]);
            const [bookingInsert] = await conn.query(
              `INSERT INTO bookings
                 (slot_id, camp_id, patient_id, qr_token, token_number, status, hold_expires_at)
               VALUES (?, ?, ?, ?, ?, 'HELD', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
              [
                slotId,
                campId,
                patientId,
                `CHSC-PROOF-${crypto.randomInt(100000, 999999)}-${patientId}`,
                `P-${crypto.randomInt(100000, 999999)}`,
                BOOKING_HOLD_MINUTES,
              ],
            );
            await conn.query(
              `UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL WHERE id = ?`,
              [bookingInsert.insertId],
            );
            return { status: 201, patientId, bookingId: bookingInsert.insertId };
          }),
        ),
      );

      const confirmed = results.filter((r) => r.status === 201);
      const waitlisted = results.filter((r) => r.status === 202);
      const errors = results.filter((r) => r.status >= 500);
      const positions = waitlisted.map((r) => r.position).sort((a, b) => a - b);

      const [[slotRow]] = await pool.query(
        'SELECT booked_count, capacity FROM slots WHERE id = ?',
        [slotId],
      );
      const [[confirmedCount]] = await pool.query(
        `SELECT COUNT(*) AS total FROM bookings WHERE slot_id = ? AND status = 'CONFIRMED'`,
        [slotId],
      );
      const [[waitingCount]] = await pool.query(
        `SELECT COUNT(*) AS total FROM waitlist WHERE slot_id = ? AND status = 'WAITING'`,
        [slotId],
      );
      const zeroOverbooked =
        Number(slotRow.booked_count) <= 10 &&
        Number(confirmedCount.total) === 10 &&
        Number(waitingCount.total) === 40 &&
        errors.length === 0;

      payload = {
        slotId,
        capacity: 10,
        totalRequests: 50,
        confirmed: confirmed.length,
        waitlisted: waitlisted.length,
        errors: errors.length,
        positions,
        db: {
          booked_count: Number(slotRow.booked_count),
          capacity: Number(slotRow.capacity),
          confirmedBookings: Number(confirmedCount.total),
          waitingBookings: Number(waitingCount.total),
        },
        zeroOverbooked,
        source: 'Live MySQL transactions (SELECT ... FOR UPDATE)',
      };

      await auditLog({
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'CONCURRENCY_PROOF',
        targetType: 'camp',
        targetId: campId,
        before: null,
        after: { slotId, confirmed: payload.confirmed, waitlisted: payload.waitlisted, errors: payload.errors },
      });

    } finally {
      // Remove only the rows created for this proof. A pre-existing empty slot
      // is restored to its original counter; a slot created for the proof is
      // deleted. No patient or historical booking outside the race is touched.
      const patientIds = patients.length ? patients : [0];
      await pool.query('DELETE FROM notifications_log WHERE user_id IN (?)', [patientIds]);
      await pool.query('DELETE FROM waitlist WHERE slot_id = ? AND patient_id IN (?)', [slotId, patientIds]);
      await pool.query('DELETE FROM bookings WHERE slot_id = ? AND patient_id IN (?)', [slotId, patientIds]);
      await pool.query('DELETE FROM users WHERE id IN (?)', [patientIds]);
      if (createdSlot) await pool.query('DELETE FROM slots WHERE id = ?', [slotId]);
      else await pool.query('UPDATE slots SET booked_count = ? WHERE id = ?', [originalBookedCount, slotId]);
    }
    return res.json(payload);
  }),
);

/* ---------------------------------------------------------------------------
 * ADMIN AUDIT LOG — who changed what, and when
 * ------------------------------------------------------------------------- */

app.get(
  '/api/admin/audit-log',
  authenticate,
  requireRole('ADMIN', 'ORGANIZER'),
  asyncHandler(async (req, res) => {
    const paging = parsePagination(req.query);
    if (!paging) throw new ApiError(400, 'Invalid pagination.', 'INVALID_PAGINATION');
    const [rows] = await pool.query(
      `SELECT al.*, u.name AS actor_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ? OFFSET ?`,
      [paging.limit, paging.offset],
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM audit_log');
    res.json({
      audit: rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name || r.actor_id,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        // mysql2 already decodes JSON columns to objects; a raw string only
        // appears on older drivers. Never JSON.parse an object (it throws
        // "[object Object] is not valid JSON" and 500s the whole page).
        before: decodeJsonColumn(r.before),
        after: decodeJsonColumn(r.after),
        createdAt: r.created_at,
      })),
      pagination: buildPagination(Number(total), paging),
    });
  }),
);

/* ---------------------------------------------------------------------------
 * SOCKET.IO
 * ------------------------------------------------------------------------- */

/**
 * Handshake authentication: every socket is tied to a live DB user. Anonymous
 * visitors are rejected so no private event or room can be observed without a
 * session. The frontend treats `Authentication error` as "sign in to enable
 * realtime"; no offline or simulated data is substituted.
 */
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return next(new Error('Authentication error'));
  try {
    socket.data.user = await userFromToken(token);
    return next();
  } catch (_) {
    return next(new Error('Authentication error'));
  }
});

/** Reject malformed/oversized per-event arguments before doing any work. */
function validSocketCampId(campId) {
  const id = Number(campId);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

io.on('connection', (socket) => {
  const user = socket.data.user || anonymousSocketUser();
  emitBounded(socket, 'engine:hello', {
    service: 'CHSC Realtime Engine',
    socketId: socket.id,
    at: new Date().toISOString(),
  });

  socket.on('camp:join', async (campId, callback) => {
    const id = validSocketCampId(campId);
    if (!id) {
      if (typeof callback === 'function') callback({ ok: false, error: 'INVALID_CAMP' });
      return;
    }
    try {
      const allowed = await canJoinCampRoom(user, id);
      if (!allowed) {
        if (typeof callback === 'function') callback({ ok: false, error: 'CAMP_FORBIDDEN' });
        return;
      }
      await socket.join(`camp:${id}`);
      emitBounded(socket, 'camp:joined', { campId: id });
      if (typeof callback === 'function') callback({ ok: true, campId: id });
    } catch (_) {
      if (typeof callback === 'function') callback({ ok: false, error: 'CAMP_JOIN_FAILED' });
    }
  });

  socket.on('camp:leave', (campId) => {
    const id = validSocketCampId(campId);
    if (id) socket.leave(`camp:${id}`);
  });

  socket.on('queue:ping', async (campId, callback) => {
    const id = validSocketCampId(campId);
    if (!id) {
      if (typeof callback === 'function') callback({ ok: false, error: 'INVALID_CAMP' });
      return;
    }
    try {
      const allowed = await canJoinCampRoom(user, id);
      if (!allowed) {
        if (typeof callback === 'function') callback({ ok: false, error: 'CAMP_FORBIDDEN' });
        return;
      }
      const queue = await getQueueSnapshot(id);
      emitBounded(socket, 'queue:updated', queue);
      if (typeof callback === 'function') callback({ ok: true, queue });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false, error: 'QUEUE_UNAVAILABLE' });
    }
  });
});

/* ---------------------------------------------------------------------------
 * OPTIONAL STATIC FRONTEND + ERROR HANDLING
 * ------------------------------------------------------------------------- */

const distDir = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    return res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`, 'NOT_FOUND'));
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
  const databaseOffline =
    error.code === 'ECONNREFUSED' ||
    error.code === 'PROTOCOL_CONNECTION_LOST' ||
    error.code === 'ER_ACCESS_DENIED_ERROR' ||
    error.code === 'ER_BAD_DB_ERROR';

  if (status >= 500) {
    // Log metadata only — request bodies can carry PII and must never be echoed.
    console.error('[CHSC server error]', {
      code: error.code,
      status: error.status,
      message: String(error.message || '').slice(0, 300),
      requestId: _req.id,
    });
  }

  // Never leak raw SQL from a unique-key violation.
  let message = error.message || 'Unexpected server error.';
  let code = error.code || 'SERVER_ERROR';
  if (error.code === 'ER_DUP_ENTRY') {
    const raw = String(error.message || '');
    message = 'That record already exists.';
    code = 'DUPLICATE_RECORD';
    if (raw.includes('uq_one_active_booking_per_camp')) {
      message = 'You already have an active booking at this camp. Reschedule it instead.';
      code = 'ALREADY_BOOKED_IN_CAMP';
    } else if (raw.includes('uq_slot_patient')) {
      message = 'You already hold a booking for this slot.';
      code = 'DUPLICATE_BOOKING';
    } else if (raw.includes('uq_staff_camp_user')) {
      message = 'This user is already assigned to the camp.';
      code = 'STAFF_ALREADY_ASSIGNED';
    } else if (raw.includes('uq_users_email') || raw.includes('uq_users_phone')) {
      message = 'Email or phone is already registered.';
      code = 'USER_EXISTS';
    }
  }

  res.status(databaseOffline ? 503 : status).json({
    ok: false,
    error: databaseOffline
      ? 'MySQL is offline. This action requires a live database; no local fallback is available.'
      : message,
    code: databaseOffline ? 'DB_OFFLINE' : code,
    requestId: _req.id,
    details: databaseOffline
      ? { hint: 'Start/check the connected MySQL host and verify DB credentials. No demo fallback is enabled.' }
      : error.details || null,
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║  CHSC · Community Health Screening Camp Scheduler            ║');
  console.log('  ║  CMRIT Bengaluru · ISE Mini Project                          ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log(`  API        : http://localhost:${PORT}/api/health`);
  console.log(`  Socket.io  : ws://localhost:${PORT}`);
  console.log(`  Frontend   : ${FRONTEND_ORIGIN}`);
  console.log('  Data mode  : LIVE ONLY · demo endpoints and fallback removed');
  console.log(`  DB target  : ${process.env.DB_USER || 'root'}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'community_health_scheduler'}`);
  console.log('');
  pool
    .query('SELECT 1')
    .then(() => console.log('  ✓ MySQL pool connected. Live API is ready.'))
    .catch((error) => {
      console.error(`  ✖ MySQL not reachable (${error.code || error.message}). No demo fallback is available.`);
      console.error('    Check the database host/credentials; the API will return real errors.');
    });
  });
}

process.on('SIGINT', async () => {
  console.log('\n[CHSC] Shutting down gracefully...');
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
});

process.on('unhandledRejection', (reason) => {
  console.warn('[CHSC unhandled rejection]', String(reason && reason.message ? reason.message : reason).slice(0, 300));
});

module.exports = {
  app,
  server,
  pool,
  io,
  buildSlotPlan,
  buildCapacityAdvisor,
  loadCampBundle,
  loadCampCollection,
  publicSlot,
  publicBooking,
  remindersEngine,
  runHoldExpirySweep,
  bookingHoldMinutes: BOOKING_HOLD_MINUTES,
  promotionHoldMinutes: PROMOTION_HOLD_MINUTES,
  providers,
  limiters,
  queueDevicePush,
  pushTargetUrl,
};
