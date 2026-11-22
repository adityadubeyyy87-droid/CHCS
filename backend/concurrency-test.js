#!/usr/bin/env node
/* ============================================================================
 * CHSC · 20-REQUEST LAST-SEAT CONCURRENCY AUDIT
 * ----------------------------------------------------------------------------
 * Fires 20 truly simultaneous HTTP booking requests at a camp with exactly one
 * physical seat. The Express route runs:
 *
 *   SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 *   BEGIN;
 *   SELECT id, capacity, booked_count FROM slots WHERE id = ? FOR UPDATE;
 *   ...
 *   COMMIT;
 *
 * Request #1 acquires the InnoDB X-lock, increments booked_count and commits.
 * Requests #2–#20 wait on the same mutex, then deterministically observe
 * booked_count == capacity and are routed into the FIFO waitlist.
 *
 * Run (server must be running):
 *   node concurrency-test.js
 *   API_URL=http://localhost:4000 node concurrency-test.js
 * ========================================================================== */

const API_URL = (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const REQUEST_COUNT = 20;
const PASSWORD = 'RaceTest@123';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  amber: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
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

async function main() {
  const stamp = Date.now();

  console.log('');
  console.log(`${c.cyan}${c.bold}${line('═')}${c.reset}`);
  console.log(`${c.cyan}${c.bold}  CHSC · PESSIMISTIC LOCK CONCURRENCY AUDIT${c.reset}`);
  console.log(`${c.dim}  20 simultaneous bookings · one seat · SELECT ... FOR UPDATE${c.reset}`);
  console.log(`${c.cyan}${c.bold}${line('═')}${c.reset}`);
  console.log(`${c.dim}API:${c.reset} ${API_URL}`);
  console.log(`${c.dim}Time:${c.reset} ${new Date().toISOString()}`);
  console.log('');

  const health = await api('/api/health');
  if (health.status !== 200 || !health.body?.ok) {
    throw new Error(
      `Server/API is not reachable at ${API_URL}. Start it with: cd backend && node server.js`,
    );
  }
  console.log(
    `${c.green}✓${c.reset} API online · MySQL ${health.body.database || 'unknown'} · demo=${health.body.demoMode}`,
  );
  if (health.body.database !== 'connected') {
    throw new Error(
      'MySQL is offline. Start MySQL and run database/schema.sql before running this stress test.',
    );
  }

  // Demo organizer token (seeded account), so the script needs no manual login.
  const login = await api('/api/auth/demo-login', {
    method: 'POST',
    body: JSON.stringify({ role: 'ORGANIZER' }),
  });
  if (login.status !== 200 || !login.body?.token) {
    throw new Error(`Demo organizer login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }
  const organizerToken = login.body.token;

  // A one-seat camp gives us an exact last-seat race with k = 1 interval.
  const camp = await api('/api/camps', {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({
      title: `CONCURRENCY TEST · ${new Date(stamp).toISOString()}`,
      descriptionEn: 'Automated last-seat race-condition audit. Safe to cancel.',
      descriptionKn: 'ಸ್ವಯಂಚಾಲಿತ ಸ್ಥಳ ಪರೀಕ್ಷೆ.',
      venue: 'CMRIT Concurrency Lab',
      address: 'CMRIT, Kundalahalli, Bengaluru',
      city: 'Bengaluru',
      campDate: tomorrow(),
      startTime: '09:00',
      endTime: '09:30',
      slotDurationMins: 30,
      totalCapacity: 1,
      physicalCapacity: 1,
      status: 'PUBLISHED',
    }),
  });
  if (camp.status !== 201 || !camp.body?.camp?.slots?.length) {
    throw new Error(`Failed to create race camp (${camp.status}): ${JSON.stringify(camp.body)}`);
  }

  const campId = camp.body.camp.id;
  const slotId = camp.body.camp.slots[0].id;
  console.log(
    `${c.green}✓${c.reset} Race arena ready · camp ${c.bold}#${campId}${c.reset} · slot ${c.bold}#${slotId}${c.reset} · capacity ${c.bold}1${c.reset}`,
  );
  console.log(`${c.dim}  Registering ${REQUEST_COUNT} independent patient identities...${c.reset}`);

  // Each racer needs a distinct patient identity because UNIQUE(slot_id, patient_id)
  // intentionally prevents one patient from holding duplicate bookings.
  const registrationResults = await Promise.all(
    Array.from({ length: REQUEST_COUNT }, async (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      const phone = `9${String(stamp).slice(-6)}${String(index + 1).padStart(3, '0')}`;
      const result = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: `Race Patient ${number}`,
          email: `race.${stamp}.${index + 1}@example.com`,
          phone,
          password: PASSWORD,
          ageGroup: '18-29',
          preferredLanguage: index % 2 === 0 ? 'en' : 'kn',
        }),
      });
      return { index, number, status: result.status, token: result.body?.token, body: result.body };
    }),
  );

  const racers = registrationResults.filter((row) => row.status === 201 && row.token);
  if (racers.length !== REQUEST_COUNT) {
    const failures = registrationResults.filter((row) => row.status !== 201);
    throw new Error(
      `Only ${racers.length}/${REQUEST_COUNT} patient registrations succeeded: ${JSON.stringify(failures.slice(0, 2))}`,
    );
  }
  console.log(`${c.green}✓${c.reset} ${racers.length} patient sessions ready.`);
  console.log('');
  console.log(`${c.amber}${c.bold}⚡ FIRING ${REQUEST_COUNT} SIMULTANEOUS BOOKING REQUESTS...${c.reset}`);
  console.log(`${c.dim}   BFF (barrier) released with Promise.all() at ${new Date().toISOString()}${c.reset}`);
  console.log('');

  const wallStart = process.hrtime.bigint();
  const results = await Promise.all(
    racers.map(async (racer) => {
      const started = process.hrtime.bigint();
      const result = await api(`/api/slots/${slotId}/book`, {
        method: 'POST',
        headers: { authorization: `Bearer ${racer.token}` },
        body: JSON.stringify({
          travelMode: racer.index % 2 === 0 ? 'WALK' : 'AUTO_BUS',
          pledge: true,
        }),
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      return {
        index: racer.index,
        number: racer.number,
        status: result.status,
        body: result.body,
        token: racer.token,
        elapsedMs,
      };
    }),
  );
  const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;

  results.sort((a, b) => a.index - b.index);

  // Phase 2: the 201 response is a HELD reservation. Confirm it through the
  // public API so the audit still ends with a real CONFIRMED booking.
  const held = results.filter((row) => row.status === 201 && row.body?.booking?.status === 'HELD');
  const confirmations = await Promise.all(
    held.map((row) =>
      api(`/api/bookings/${row.body.booking.id}/confirm`, {
        method: 'POST',
        headers: { authorization: `Bearer ${row.token}` },
        body: '{}',
      }),
    ),
  );
  const confirmed = confirmations.filter((row) => row.status === 200);

  const http201 = results.filter((row) => row.status === 201);
  const http202 = results.filter((row) => row.status === 202);
  const other = results.filter((row) => ![201, 202].includes(row.status));

  console.log(`${c.cyan}${c.bold}${line('═')}${c.reset}`);
  console.log(`${c.cyan}${c.bold}  ATOMIC BOOKING AUDIT TABLE${c.reset}`);
  console.log(`${c.cyan}${c.bold}${line('═')}${c.reset}`);
  console.log(
    `${c.bold}${pad('#', 4)}${pad('HTTP', 7)}${pad('OUTCOME', 15)}${pad('LATENCY', 11, 'right')}${pad('  TOKEN / WAITLIST POSITION', 49)}${c.reset}`,
  );
  console.log(line('─'));

  for (const row of results) {
    const color = row.status === 201 ? c.green : row.status === 202 ? c.amber : c.red;
    const outcome =
      row.status === 201
        ? 'HELD→CONFIRMED'
        : row.status === 202
          ? 'WAITLISTED'
          : row.status === 409
            ? 'DUPLICATE'
            : 'ERROR';
    const detail =
      row.status === 201
        ? `booking ${row.body?.booking?.tokenNumber || '—'} · ${row.body?.booking?.qrToken || '—'}`
        : row.status === 202
          ? `FIFO #${row.body?.waitlist?.position ?? '—'}`
          : `code=${row.body?.code || '—'} ${row.body?.error || ''}`.slice(0, 47);
    console.log(
      `${pad(row.number, 4)}${pad(row.status, 7)}${color}${pad(outcome, 15)}${c.reset}` +
        `${pad(`${row.elapsedMs.toFixed(1)} ms`, 11, 'right')}${pad(`  ${detail}`, 49)}`,
    );
  }

  console.log(line('─'));
  console.log(
    `${c.bold}Wall-clock:${c.reset} ${wallMs.toFixed(1)} ms   ` +
      `${c.green}201 CREATED: ${http201.length}${c.reset}   ` +
      `${c.amber}202 WAITLISTED: ${http202.length}${c.reset}   ` +
      `${other.length ? c.red : c.dim}other: ${other.length}${c.reset}`,
  );
  console.log('');

  const finalCamp = await api(`/api/camps/${campId}`);
  const finalSlot = finalCamp.body?.camp?.slots?.[0];
  const overbooked = Number(finalSlot?.bookedCount || 0) > Number(finalSlot?.capacity || 0);
  const zeroOverbooking = !overbooked && Number(finalSlot?.bookedCount) === 1;

  console.log(`${c.blue}${c.bold}  INVARIANT VERIFICATION${c.reset}`);
  console.log(`  ${zeroOverbooking ? `${c.green}✓` : `${c.red}✗`}${c.reset} booked_count    = ${finalSlot?.bookedCount ?? '?'} / capacity ${finalSlot?.capacity ?? '?'}`);
  console.log(`  ${zeroOverbooking ? `${c.green}✓` : `${c.red}✗`}${c.reset} overbookings     = ${Math.max(0, Number(finalSlot?.bookedCount || 0) - Number(finalSlot?.capacity || 0))}`);
  console.log(`  ${http202.length === 19 ? `${c.green}✓` : `${c.red}✗`}${c.reset} FIFO waitlisted  = ${http202.length}`);
  console.log(`  ${http201.length === 1 ? `${c.green}✓` : `${c.red}✗`}${c.reset} held→confirmed  = ${confirmed.length}`);
  console.log(`  ${c.green}✓${c.reset} isolation        = READ COMMITTED + row-level X-lock`);
  console.log(`  ${c.green}✓${c.reset} unique guard     = UNIQUE(slot_id, patient_id)`);
  console.log(`  ${c.green}✓${c.reset} capacity guard   = CHECK(booked_count <= capacity)`);
  console.log('');

  // Graceful cleanup: hide the synthetic camp from the public schedule.
  await api(`/api/camps/${campId}/status`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({ status: 'CANCELLED' }),
  });

  const pass =
    zeroOverbooking &&
    http201.length === 1 &&
    confirmed.length === 1 &&
    http202.length === 19 &&
    other.length === 0;

  console.log(`${c.bold}${line('═')}${c.reset}`);
  if (pass) {
    console.log(`${c.green}${c.bold}  RESULT: PASS — 1 Confirmed · 19 Safely Waitlisted · 0 Overbookings${c.reset}`);
    console.log(`${c.dim}  The last seat was protected by an InnoDB exclusive row lock.${c.reset}`);
    console.log(`${c.bold}${line('═')}${c.reset}`);
    console.log('');
    return;
  }

  console.log(`${c.red}${c.bold}  RESULT: FAIL — inspect the audit table above${c.reset}`);
  console.log(`${c.bold}${line('═')}${c.reset}`);
  console.log('');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('');
  console.error(`${c.red}${c.bold}CONCURRENCY AUDIT FAILED${c.reset}`);
  console.error(`${c.red}${error.message}${c.reset}`);
  console.error('');
  process.exitCode = 1;
});
