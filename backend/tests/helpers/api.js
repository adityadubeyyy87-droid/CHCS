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
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

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

/** Book via the real API and assert nothing about the result. */
async function book({ token, slotId, body = {} }) {
  return request(app)
    .post(`/api/slots/${slotId}/book`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
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
  countRows,
  tokenFor,
  uniqueEmail,
  localDate,
  localTime,
};
