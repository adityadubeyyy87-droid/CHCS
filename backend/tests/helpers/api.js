'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { app, pool } = require('../../server');

// One cheap hash for every test fixture — authentication speed only.
const TEST_HASH = bcrypt.hashSync('Test@1234', 4);

function suffix() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function uniqueEmail(prefix = 'user') {
  return `${prefix}.${suffix()}@test.local`;
}

function tokenFor(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'chsc-cmrit' },
  );
}

async function insertUser({ role = 'PATIENT', name = 'Test User', email } = {}) {
  const address = email || uniqueEmail(role.toLowerCase());
  const phone = `9${String(crypto.randomInt(100000000, 999999999))}`;
  const [result] = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
    [name, address, phone, TEST_HASH, role],
  );
  const user = { id: result.insertId, name, email: address, phone, role };
  return { ...user, token: tokenFor(user) };
}

async function createPatient() {
  return insertUser({ role: 'PATIENT', name: 'Test Patient' });
}

async function createOrganizer() {
  return insertUser({ role: 'ORGANIZER', name: 'Test Organizer' });
}

async function createDoctor() {
  return insertUser({ role: 'DOCTOR', name: 'Dr Test' });
}

function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

/**
 * A published camp with exactly one slot, so capacity arithmetic is explicit.
 */
async function createCampAt({
  organizerId = 2,
  capacity = 6,
  campDate,
  startTime,
  endTime,
  status = 'PUBLISHED',
  slotCapacity = capacity,
  title = 'Test Screening Camp',
} = {}) {
  const [campResult] = await pool.query(
    `INSERT INTO camps
       (title, description_en, description_kn, venue, address, city, camp_date,
        start_time, end_time, slot_duration_mins, total_capacity, physical_capacity,
        status, created_by)
     VALUES (?, '', '', ?, 'Test address, Bengaluru', 'Bengaluru', ?, ?, ?, 60, ?, ?, ?, ?)`,
    [
      `${title} ${suffix()}`,
      'Test Venue',
      campDate,
      startTime,
      endTime,
      capacity,
      capacity,
      status,
      organizerId,
    ],
  );

  const [slotResult] = await pool.query(
    `INSERT INTO slots (camp_id, slot_index, start_time, end_time, capacity, booked_count)
     VALUES (?, 1, ?, ?, ?, 0)`,
    [campResult.insertId, startTime, endTime, slotCapacity],
  );

  return {
    campId: campResult.insertId,
    slotId: slotResult.insertId,
    campDate,
    startTime,
    endTime,
    capacity,
    slotCapacity,
  };
}

/**
 * Convenience wrapper: a one-slot camp starting `startsInHours` from now.
 */
async function createCampFixture(options = {}) {
  const { startsInHours = 72, durationMinutes = 60, campDate, startTime, endTime } = options;
  const startsAt = new Date(Date.now() + startsInHours * 3600 * 1000);
  startsAt.setSeconds(0, 0);
  let endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

  // The camps table requires end_time > start_time on the same calendar day.
  // Near midnight a normal "now + N hours" fixture would wrap to 00:xx and
  // violate that check, so move such fixtures to a deterministic morning slot.
  if (localTime(endsAt) <= localTime(startsAt)) {
    startsAt.setHours(8, 0, 0, 0);
    endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  }

  // Explicit times make time-sensitive assertions (e.g. reminder ordering)
  // deterministic regardless of the wall-clock hour the suite is run at.
  const fixture = await createCampAt({
    ...options,
    campDate: campDate || localDate(startsAt),
    startTime: startTime || localTime(startsAt),
    endTime: endTime || localTime(endsAt),
  });

  return { ...fixture, startsAt, endsAt };
}

/** Adds supertest-style .expect() to a plain response promise. */
function withExpect(promise) {
  const wrapped = promise.then((response) => response);
  wrapped.expect = (status) =>
    wrapped.then((response) => {
      if (response.status !== status) {
        const error = new Error(
          `Expected HTTP ${status}, received ${response.status}: ${JSON.stringify(response.body)}`,
        );
        error.response = response;
        throw error;
      }
      return response;
    });
  return wrapped;
}

/** Create only the timed hold, without confirming it. */
function hold({ token, slotId, body = {} }) {
  return withExpect(
    request(app)
      .post(`/api/slots/${slotId}/book`)
      .set('Authorization', `Bearer ${token}`)
      .send(body),
  );
}

/** Confirm a held booking through the real two-phase API. */
function confirm({ token, bookingId }) {
  return withExpect(
    request(app)
      .post(`/api/bookings/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({}),
  );
}

/**
 * Book via the real API and confirm the hold by default. Older integration
 * tests keep their "booking means an active seat" semantics; hold-specific
 * tests pass { confirmHold: false } to inspect the intermediate state.
 */
function book({ token, slotId, body = {}, confirmHold = true }) {
  return withExpect(
    (async () => {
      const created = await hold({ token, slotId, body });
      if (!confirmHold || created.status !== 201 || created.body?.booking?.status !== 'HELD') {
        return created;
      }
      const confirmed = await confirm({ token, bookingId: created.body.booking.id });
      // Older suites treat booking as one action returning 201. Keep that
      // contract while still exercising the real two-phase network flow.
      return { ...created, status: 201, body: confirmed.body };
    })(),
  );
}

/** Direct fixture: assign staff to a camp for check-in scope tests. */
async function assignStaff(user, campId, roleAtCamp = 'DOCTOR') {
  await pool.query(
    `INSERT INTO staff_assignments
       (camp_id, user_id, role_at_camp, shift_start, shift_end, expected_load_per_hour)
     VALUES (?, ?, ?, '00:00:00', '23:59:00', 0)
     ON DUPLICATE KEY UPDATE role_at_camp = VALUES(role_at_camp)`,
    [campId, user.id, roleAtCamp],
  );
  return user;
}

async function countRows(sql, params = []) {
  const [[row]] = await pool.query(sql, params);
  return Number(Object.values(row)[0]);
}

module.exports = {
  app,
  pool,
  request,
  insertUser,
  createPatient,
  createOrganizer,
  createDoctor,
  createCampFixture,
  createCampAt,
  book,
  hold,
  confirm,
  assignStaff,
  countRows,
  tokenFor,
  uniqueEmail,
  localDate,
  localTime,
};
