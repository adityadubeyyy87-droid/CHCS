#!/usr/bin/env node
/* ============================================================================
 * CHSC · 50-REQUEST / 10-SEAT CONCURRENCY AUDIT
 * ----------------------------------------------------------------------------
 * Fires 50 parallel booking transactions at one capacity-10 slot through the
 * production-capable, admin-guarded `/api/admin/concurrency-proof` endpoint:
 *
 *   SELECT id, capacity, booked_count FROM slots WHERE id = ? FOR UPDATE;
 *   ... increment or FIFO-waitlist, then COMMIT;
 *
 * Ten transactions win a seat; the other forty are deterministically placed on
 * the FIFO waitlist. Zero overbooking is asserted against the live database.
 *
 * This is a LIVE audit: there is no demo login and no seeded identity. A real
 * ADMIN session is read from the environment, one temporary camp is created via
 * the real API, and only the rows this script created are removed afterwards.
 *
 * Run (server must be running with a live MySQL connection):
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' node concurrency-test.js
 *   API_URL=http://localhost:4000 node concurrency-test.js
 * ========================================================================== */

require('dotenv').config();

const path = require('path');
const mysql = require('mysql2/promise');
const { dbConnectionOptions } = require(path.join(__dirname, 'lib', 'db-config'));

const API_URL = (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const REQUEST_COUNT = 50;
const SEAT_COUNT = 10;
const ADMIN_EMAIL = String(
  process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '',
).trim();
const ADMIN_PASSWORD = String(
  process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
);

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  amber: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function line(char = '─', width = 92) {
  return char.repeat(width);
}

function pad(value, width, align = 'left') {
  const text = String(value);
  if (text.length >= width) return text.slice(0, width);
  if (align === 'right') return ' '.repeat(width - text.length) + text;
  if (align === 'center') {
    const left = Math.floor((width - text.length) / 2);
    return ' '.repeat(left) + text + ' '.repeat(width - text.length - left);
  }
  return text + ' '.repeat(width - text.length);
}

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { response, status: response.status, body };
}

function invariant(ok, label, value) {
  console.log(`  ${ok ? `${c.green}✓` : `${c.red}✗`}${c.reset} ${pad(label, 26)}${value}`);
  return ok;
}

async function main() {
  console.log('');
  console.log(`${c.cyan}${c.bold}${line('═')}${c.reset}`);
  console.log(`${c.cyan}${c.bold}  CHSC · PESSIMISTIC LOCK CONCURRENCY AUDIT${c.reset}`);
  console.log(
    `${c.dim}  ${REQUEST_COUNT} parallel booking transactions · one capacity-${SEAT_COUNT} slot · real MySQL${c.reset}`,
  );
  console.log(`${c.cyan}${c.bold}${line('═')}${c.reset}`);
  console.log(`${c.dim}API:${c.reset} ${API_URL}`);
  console.log(`${c.dim}Time:${c.reset} ${new Date().toISOString()}`);
  console.log('');

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'Set ADMIN_EMAIL (or BOOTSTRAP_ADMIN_EMAIL) and ADMIN_PASSWORD (or BOOTSTRAP_ADMIN_PASSWORD) for an existing admin account.',
    );
  }

  const health = await api('/api/health');
  if (health.status !== 200 || !health.body?.ok) {
    throw new Error(
      `Server/API is not reachable at ${API_URL}. Start it with: cd backend && node server.js`,
    );
  }
  if (health.body.demoMode !== false) {
    throw new Error('Backend must report demoMode:false; this audit never uses demo identities.');
  }
  if (health.body.database !== 'connected') {
    throw new Error('MySQL is offline. This audit requires a live database; no demo fallback exists.');
  }
  console.log(
    `${c.green}✓${c.reset} API online · MySQL ${health.body.database} · demoMode=${health.body.demoMode}`,
  );

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (login.status !== 200 || !login.body?.token || login.body?.user?.role !== 'ADMIN') {
    throw new Error(`Admin login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }
  const adminToken = login.body.token;
  console.log(`${c.green}✓${c.reset} Real admin session established for ${login.body.user.email}`);

  // One temporary published camp with exactly one capacity-10 slot. The proof
  // endpoint reuses this slot and restores booked_count to zero before returning.
  const camp = await api('/api/camps', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: `CONCURRENCY AUDIT · ${new Date().toISOString()}`,
      descriptionEn: 'Automated 50-request / 10-seat row-lock audit. Removed after the run.',
      venue: 'CHSC Concurrency Lab',
      address: 'CMRIT, Kundalahalli, Bengaluru 560037',
      city: 'Bengaluru',
      campDate: tomorrow(),
      startTime: '09:00',
      endTime: '09:30',
      slotDurationMins: 30,
      totalCapacity: SEAT_COUNT,
      status: 'PUBLISHED',
    }),
  });
  if (camp.status !== 201 || !camp.body?.camp?.slots?.length) {
    throw new Error(`Failed to create audit camp (${camp.status}): ${JSON.stringify(camp.body)}`);
  }
  const campId = camp.body.camp.id;
  const slotId = camp.body.camp.slots[0].id;
  console.log(
    `${c.green}✓${c.reset} Temporary camp #${campId} · slot #${slotId} · capacity ${SEAT_COUNT}`,
  );

  let proof;
  let cleanupAudit = null;
  try {
    const wallStart = process.hrtime.bigint();
    proof = await api('/api/admin/concurrency-proof', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ campId }),
    });
    proof.wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;
  } finally {
    // Delete only the camp/slot this script created. The proof endpoint already
    // removed its own temporary patients, bookings and waitlist entries and
    // restored the reused slot's booked_count. Audit rows are append-only by
    // design and are intentionally left as evidence of the run.
    const conn = await mysql.createConnection(dbConnectionOptions({ multipleStatements: false }));
    try {
      await conn.query('DELETE FROM slots WHERE camp_id = ?', [campId]);
      await conn.query('DELETE FROM camps WHERE id = ?', [campId]);
      const [[counts]] = await conn.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE email LIKE 'proof.%@invalid.local') AS tempUsers,
           (SELECT COUNT(*) FROM bookings WHERE camp_id = ?) AS tempBookings,
           (SELECT COUNT(*) FROM waitlist WHERE camp_id = ?) AS tempWaiters`,
        [campId, campId],
      );
      cleanupAudit = counts;
    } finally {
      await conn.end();
    }
  }

  if (proof.status !== 200) {
    throw new Error(`Concurrency proof failed (${proof.status}): ${JSON.stringify(proof.body)}`);
  }
  const p = proof.body;
  if (Array.isArray(p.positions) && p.positions.length === REQUEST_COUNT - SEAT_COUNT) {
    console.log(`${c.dim}  FIFO waitlist positions: ${p.positions.join(', ')}${c.reset}`);
  }
  console.log(`${c.dim}  Wall-clock: ${proof.wallMs.toFixed(1)} ms${c.reset}`);
  console.log('');

  const after = await api(`/api/camps/${campId}/slots`);
  const finalSlot = after.body?.slots?.[0];

  console.log(`${c.blue}${c.bold}  INVARIANT VERIFICATION${c.reset}`);
  const checks = [
    invariant(p.totalRequests === REQUEST_COUNT, 'total requests', p.totalRequests),
    invariant(p.capacity === SEAT_COUNT, 'slot capacity', p.capacity),
    invariant(p.confirmed === SEAT_COUNT, 'confirmed seats', p.confirmed),
    invariant(p.waitlisted === REQUEST_COUNT - SEAT_COUNT, 'FIFO waitlisted', p.waitlisted),
    invariant(p.errors === 0, 'transaction errors', p.errors),
    invariant(p.zeroOverbooked === true, 'zero overbooking', p.zeroOverbooked),
    // The `db` block is evidence captured before the endpoint's finally-cleanup.
    invariant(p.db?.capacity === SEAT_COUNT, 'DB evidence capacity', p.db?.capacity),
    invariant(p.db?.booked_count === SEAT_COUNT, 'DB evidence seats taken', p.db?.booked_count),
    invariant(
      p.db?.confirmedBookings === SEAT_COUNT,
      'DB evidence confirmed',
      p.db?.confirmedBookings,
    ),
    invariant(
      p.db?.waitingBookings === REQUEST_COUNT - SEAT_COUNT,
      'DB evidence waiters',
      p.db?.waitingBookings,
    ),
    invariant(
      after.status === 200 && Array.isArray(after.body?.slots) && !finalSlot,
      'temporary camp removed',
      'camp deleted',
    ),
    invariant(
      Number(cleanupAudit?.tempUsers) === 0,
      'temp users removed',
      cleanupAudit?.tempUsers,
    ),
    invariant(
      Number(cleanupAudit?.tempBookings) === 0,
      'temp bookings removed',
      cleanupAudit?.tempBookings,
    ),
    invariant(
      Number(cleanupAudit?.tempWaiters) === 0,
      'temp waiters removed',
      cleanupAudit?.tempWaiters,
    ),
  ];
  console.log('');

  const pass = checks.every(Boolean);
  console.log(`${c.bold}${line('═')}${c.reset}`);
  if (pass) {
    console.log(
      `${c.green}${c.bold}  RESULT: PASS — ${SEAT_COUNT} Confirmed · ${REQUEST_COUNT - SEAT_COUNT} Safely Waitlisted · 0 Overbookings${c.reset}`,
    );
    console.log(`${c.dim}  Protected by live InnoDB row locks. No synthetic rows remain.${c.reset}`);
  } else {
    console.log(`${c.red}${c.bold}  RESULT: FAIL — inspect the invariant table above${c.reset}`);
    process.exitCode = 1;
  }
  console.log(`${c.bold}${line('═')}${c.reset}`);
  console.log('');
}

main().catch((error) => {
  console.error('');
  console.error(`${c.red}${c.bold}CONCURRENCY AUDIT FAILED${c.reset}`);
  console.error(`${c.red}${error.message}${c.reset}`);
  console.error('');
  process.exitCode = 1;
});
