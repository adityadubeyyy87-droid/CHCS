#!/usr/bin/env node
'use strict';

/**
 * Production identity bootstrap.
 *
 * Creates or updates ONLY the four operational role accounts required to run a
 * real camp. It never creates patients, camps, slots, bookings or notifications.
 * Credentials and display names come from the hosting environment, are validated
 * in memory, and are never written to disk or echoed back in logs/errors.
 *
 * Optional one-time cleanup:
 *   PURGE_ON_BOOT=true  removes all operational data and all non-bootstrap
 *                       users before creating the four accounts. Use this once
 *                       when replacing a seeded/demo database with real data.
 *                       In NODE_ENV=production this additionally requires
 *                       ALLOW_PRODUCTION_PURGE=true as a second safety gate.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { dbConnectionOptions } = require('../lib/db-config');

const ROLES = ['ADMIN', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER'];
const MIN_PASSWORD_LENGTH = 12;

function envFor(env, role, suffix) {
  return env[`BOOTSTRAP_${role}_${suffix}`];
}

/**
 * Validate and normalise the four operational accounts from an env-like object.
 * Exported so the validation rules can be unit-tested without a database.
 */
function collectAccounts(env = process.env) {
  const phoneSeed = String(env.BOOTSTRAP_PHONE_SEED || '').trim();
  if (!/^\d{10}$/.test(phoneSeed)) {
    throw new Error('BOOTSTRAP_PHONE_SEED must be exactly 10 digits.');
  }

  const accounts = ROLES.map((role, index) => {
    const email = String(envFor(env, role, 'EMAIL') || '').trim().toLowerCase();
    const name = String(envFor(env, role, 'NAME') || '').trim();
    const password = String(envFor(env, role, 'PASSWORD') || '');

    if (!email || !name || !password) {
      throw new Error(
        `Missing BOOTSTRAP_${role}_EMAIL, BOOTSTRAP_${role}_NAME or BOOTSTRAP_${role}_PASSWORD.`,
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`BOOTSTRAP_${role}_EMAIL must be a valid email address.`);
    }
    if (name.length > 120) {
      throw new Error(`BOOTSTRAP_${role}_NAME must be at most 120 characters.`);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`BOOTSTRAP_${role}_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (password.length > 72) {
      throw new Error(`BOOTSTRAP_${role}_PASSWORD must be at most 72 characters (bcrypt limit).`);
    }

    const phone = String(envFor(env, role, 'PHONE') || String(Number(phoneSeed) + index)).trim();
    if (!/^\d{10}$/.test(phone)) {
      throw new Error(`BOOTSTRAP_${role}_PHONE must be exactly 10 digits.`);
    }
    return { role, email, name, password, phone };
  });

  const emails = accounts.map((a) => a.email);
  const phones = accounts.map((a) => a.phone);
  if (new Set(emails).size !== emails.length || new Set(phones).size !== phones.length) {
    throw new Error('Bootstrap emails and phone numbers must be unique.');
  }
  return accounts;
}

async function purge(conn, keepEmails) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of [
      'notifications_log', 'reminders', 'waitlist', 'bookings',
      'staff_assignments', 'slots', 'camps', 'audit_log',
    ]) {
      const [r] = await conn.query(`DELETE FROM \`${table}\``);
      console.log(`purged ${table}: ${r.affectedRows} rows`);
    }
    const placeholders = keepEmails.map(() => '?').join(',');
    const [r] = await conn.query(`DELETE FROM users WHERE email NOT IN (${placeholders})`, keepEmails);
    console.log(`purged non-bootstrap users: ${r.affectedRows} rows`);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

async function bootstrap(env = process.env) {
  const accounts = collectAccounts(env);
  const wantsPurge = String(env.PURGE_ON_BOOT || '').toLowerCase() === 'true';
  if (wantsPurge && String(env.NODE_ENV || '').toLowerCase() === 'production') {
    const allowed = String(env.ALLOW_PRODUCTION_PURGE || '').toLowerCase() === 'true';
    if (!allowed) {
      throw new Error(
        'Refusing PURGE_ON_BOOT in production. Set ALLOW_PRODUCTION_PURGE=true only for an intentional one-time migration.',
      );
    }
  }

  const conn = await mysql.createConnection(dbConnectionOptions({ multipleStatements: false }));
  try {
    if (wantsPurge) await purge(conn, accounts.map((a) => a.email));

    for (const account of accounts) {
      // Reuse the stored hash when the configured password already matches:
      // re-hashing on every boot would make an idempotent run non-idempotent.
      const [existing] = await conn.query(
        'SELECT id, password_hash FROM users WHERE email = ? LIMIT 1',
        [account.email],
      );
      let hash = existing[0]?.password_hash;
      if (!hash || !(await bcrypt.compare(account.password, hash))) {
        hash = await bcrypt.hash(account.password, 12);
      }
      await conn.query(
        `INSERT INTO users (name, email, phone, password_hash, role, is_active)
         VALUES (?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           phone = VALUES(phone),
           password_hash = VALUES(password_hash),
           role = VALUES(role),
           is_active = 1`,
        [account.name, account.email, account.phone, hash, account.role],
      );
      // Never log the password, hash, or any file path: secrets stay in env.
      console.log(`ready: ${account.role} ${account.email}`);
    }

    const [rows] = await conn.query(
      `SELECT role, email, is_active FROM users WHERE email IN (${accounts.map(() => '?').join(',')}) ORDER BY role`,
      accounts.map((a) => a.email),
    );
    if (rows.length !== accounts.length) {
      throw new Error('Production account verification failed: expected four active accounts.');
    }
    console.log('Production accounts verified:', rows);
    return rows;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('Production bootstrap failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ROLES, MIN_PASSWORD_LENGTH, collectAccounts, purge, bootstrap };
