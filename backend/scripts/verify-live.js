'use strict';

/**
 * CHSC live end-to-end verification — REAL DATA ONLY.
 *
 * Runs against a running backend with a real MySQL connection. No demo login,
 * no seeded sample patients, no mocked responses. The only credential read from
 * the environment is an existing operational ADMIN account:
 *
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' node scripts/verify-live.js
 *
 * All other identities are registered through the public API during the run and
 * promoted to staff roles by that admin. Exit 0 = every check passed.
 */

const crypto = require('crypto');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const RUN = Date.now().toString(36);
const STAMP = crypto.createHash('sha256').update(RUN).digest('hex').slice(0, 10);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || '');

const results = [];
let failures = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function assert(name, condition, detail = '') {
  record(name, Boolean(condition), condition ? detail : detail || 'assertion failed');
}

async function api(method, path, { token, body, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, headers: res.headers };
}

function phoneFor(key) {
  const hash = crypto.createHash('sha256').update(`${RUN}:${key}`).digest('hex');
  // Always emit exactly 10 digits: parseInt can return fewer than 9 digits.
  const suffix = (parseInt(hash.slice(0, 9), 16) % 1000000000).toString().padStart(9, '0');
  return `9${suffix}`;
}

/** Register a real patient, optionally promote it to an operational role. */
async function createIdentity(key, role = 'PATIENT', adminToken = null) {
  const email = `verify.${STAMP}.${key}@example.com`;
  const reg = await api('POST', '/api/auth/register', {
    body: {
      name: `Verify ${key} ${RUN}`,
      email,
      phone: phoneFor(key),
      password: 'Verify@12345',
      ageGroup: '30-45',
      preferredLanguage: 'en',
    },
  });
  if (reg.status !== 201 || !reg.body?.token) {
    throw new Error(`Could not register ${key}: ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  let user = reg.body.user;
  if (role !== 'PATIENT') {
    const changed = await api('PATCH', `/api/admin/users/${user.id}/role`, {
      token: adminToken,
      body: { role },
    });
    if (changed.status !== 200 || changed.body?.user?.role !== role) {
      throw new Error(`Could not promote ${key} to ${role}: ${JSON.stringify(changed.body)}`);
    }
    user = changed.body.user;
  }
  return { token: reg.body.token, user };
}

/** Phase-1 booking returns HELD; confirm it before any active-workflow check. */
async function bookAndConfirm(slotId, token, body = {}) {
  const held = await api('POST', `/api/slots/${slotId}/book`, { token, body });
  if (held.status !== 201 || held.body?.booking?.status !== 'HELD') return held;
  const confirmed = await api('POST', `/api/bookings/${held.body.booking.id}/confirm`, {
    token,
    body: {},
  });
  return { ...confirmed, held };
}

async function main() {
  console.log(`\nCHSC live verification → ${BASE}  (run ${RUN})`);
  console.log('Data source: real MySQL through HTTP. No demo endpoints.\n');

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      'Set ADMIN_EMAIL/ADMIN_PASSWORD (or BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD) for an existing operational admin account.',
    );
    process.exitCode = 1;
    return;
  }

  /* ---------------------------------------------------------------- health */
  const health = await api('GET', '/api/health');
  assert('health endpoint reports ok', health.status === 200 && health.body?.ok === true);
  assert('database reachable', health.body?.database === 'connected', health.body?.dbVersion);
  assert('socket.io ready', health.body?.socket === 'ready');
  assert('demo mode is off in health response', health.body?.demoMode === false);
  assert(
    'health exposes no simulated/sample-data claim',
    !/simulat|sample|mock|demo (data|records)/i.test(JSON.stringify(health.body || {})),
  );

  /* ------------------------------------------------------- no demo surfaces */
  for (const [label, method, url, body] of [
    ['demo login endpoint absent', 'POST', '/api/auth/demo-login', { role: 'ADMIN' }],
    ['demo rush endpoint absent', 'POST', '/api/demo/rush', { campId: 1 }],
    ['demo status endpoint absent', 'GET', '/api/demo/status', undefined],
  ]) {
    const result = await api(method, url, body === undefined ? {} : { body });
    assert(label, result.status === 404, `status ${result.status}`);
  }

  /* ------------------------------------------------------------ auth roles */
  const adminLogin = await api('POST', '/api/auth/login', {
    body: { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert(
    'operational admin login uses real credentials',
    adminLogin.status === 200 && adminLogin.body?.user?.role === 'ADMIN',
    adminLogin.body?.user?.email,
  );
  if (adminLogin.status !== 200) return;
  const tokens = { ADMIN: adminLogin.body.token };
  const users = { ADMIN: adminLogin.body.user };

  for (const role of ['ORGANIZER', 'DOCTOR', 'VOLUNTEER']) {
    const identity = await createIdentity(role.toLowerCase(), role, tokens.ADMIN);
    tokens[role] = identity.token;
    users[role] = identity.user;
    assert(`${role} identity created from real DB rows`, identity.user.role === role, identity.user.email);
  }

  const patient = await createIdentity('patient');
  const patientToken = patient.token;
  assert(
    'patient registration returns 201 + token',
    Boolean(patientToken) && !JSON.stringify(patient.user).includes('password'),
  );

  const pwLogin = await api('POST', '/api/auth/login', {
    body: { identifier: patient.user.email, password: 'Verify@12345' },
  });
  assert('login with password works', pwLogin.status === 200 && pwLogin.body?.token);
  const badLogin = await api('POST', '/api/auth/login', {
    body: { identifier: patient.user.email, password: 'definitely-wrong' },
  });
  assert('wrong password rejected (401)', badLogin.status === 401);
  const badValidation = await api('POST', '/api/auth/register', {
    body: { name: 'x', email: 'not-an-email', phone: '123', password: 'short' },
  });
  assert(
    'zod validation returns 400 with issue list',
    badValidation.status === 400 && Array.isArray(badValidation.body?.details?.issues),
  );

  /* --------------------------------------------------------- role guarding */
  const forbidden = await api('POST', '/api/camps', {
    token: patientToken,
    body: { title: 'Should not exist' },
  });
  assert('patient cannot create a camp (403)', forbidden.status === 403);
  const noToken = await api('GET', '/api/bookings/me');
  assert('unauthenticated request rejected (401)', noToken.status === 401);

  /* ---------------------------------------------------------- camp creation */
  // Unique future date per run so repeated verification runs never collide on
  // the staff-overlap rule (same person cannot work two camps the same day).
  const dayOffset = 5 + (parseInt(RUN, 36) % 60);
  const campDate = new Date(Date.now() + dayOffset * 864e5).toISOString().slice(0, 10);
  const created = await api('POST', '/api/camps', {
    token: tokens.ORGANIZER,
    body: {
      title: `Verification Camp ${RUN}`,
      descriptionEn: 'Created by scripts/verify-live.js — end-to-end proof.',
      venue: 'Verification Hall',
      address: '1 Verification Road, Bengaluru 560001',
      campDate,
      startTime: '09:00',
      endTime: '12:00',
      slotDurationMins: 30,
      totalCapacity: 60,
      status: 'PUBLISHED',
    },
  });
  assert('organizer creates camp (201)', created.status === 201, `camp #${created.body?.camp?.id}`);
  assert(
    'slot generator allocates capacity exactly (6 slots x 10)',
    Array.isArray(created.body?.slotPlan) &&
      created.body.slotPlan.length === 6 &&
      created.body.slotPlan.every((s) => s.capacity === 10),
  );
  const camp = created.body?.camp;
  const campId = camp?.id;

  const updated = await api('PATCH', `/api/camps/${campId}`, {
    token: tokens.ORGANIZER,
    body: { venue: 'Verification Hall (Renamed)' },
  });
  assert('organizer updates camp', updated.status === 200);

  /* ------------------------------------------------------------ staff + conflict */
  const staff = await api('POST', `/api/camps/${campId}/staff`, {
    token: tokens.ORGANIZER,
    body: {
      userId: users.DOCTOR.id,
      roleAtCamp: 'DOCTOR',
      shiftStart: '09:00',
      shiftEnd: '12:00',
      maxPatientsPerHour: 20,
      duties: 'General screening',
    },
  });
  assert('organizer assigns a doctor', staff.status === 201, `assignment #${staff.body?.staff?.id}`);
  const conflict = await api('POST', `/api/camps/${campId}/staff`, {
    token: tokens.ORGANIZER,
    body: {
      userId: users.DOCTOR.id,
      roleAtCamp: 'DOCTOR',
      shiftStart: '10:00',
      shiftEnd: '11:00',
    },
  });
  assert('duplicate staff assignment blocked (409)', conflict.status === 409);

  /* --------------------------------------------------------- camp discovery */
  const list = await api('GET', '/api/camps?page=1&pageSize=5');
  assert(
    'public camp list is paginated',
    list.status === 200 && Array.isArray(list.body?.camps) && list.body.pagination?.pageSize === 5,
  );
  const detail = await api('GET', `/api/camps/${campId}`);
  assert('camp detail loads with slots', detail.status === 200 && detail.body?.camp?.slots?.length === 6);

  /* ------------------------------------------------------------- booking */
  const slotA = detail.body.camp.slots[0];
  const slotB = detail.body.camp.slots[1];
  const held = await api('POST', `/api/slots/${slotA.id}/book`, {
    token: patientToken,
    body: { travelMode: 'WALK', pledge: true },
  });
  assert(
    'patient holds a slot (201 HELD with expiry)',
    held.status === 201 && held.body?.booking?.status === 'HELD' && Boolean(held.body?.holdExpiresAt),
    held.body?.booking?.tokenNumber,
  );
  const book = await api('POST', `/api/bookings/${held.body?.booking?.id}/confirm`, {
    token: patientToken,
    body: {},
  });
  assert(
    'patient confirms the hold (CONFIRMED)',
    book.status === 200 && book.body?.booking?.status === 'CONFIRMED',
    book.body?.booking?.tokenNumber,
  );
  const bookingId = book.body?.booking?.id;

  const doubleBook = await api('POST', `/api/slots/${slotA.id}/book`, {
    token: patientToken,
    body: { travelMode: 'WALK' },
  });
  assert(
    'double-click rejected as DUPLICATE_BOOKING, never a second row',
    doubleBook.status === 409 && doubleBook.body?.code === 'DUPLICATE_BOOKING',
    `status ${doubleBook.status} ${doubleBook.body?.code || ''}`,
  );
  const mine = await api('GET', '/api/bookings/me', { token: patientToken });
  assert('patient sees exactly one active booking', (mine.body?.bookings || []).filter((b) => b.status === 'CONFIRMED').length === 1);

  /* ---------------------------------------------------------- cancellation */
  const cancel = await api('PATCH', `/api/bookings/${bookingId}/cancel`, {
    token: patientToken,
    body: { reason: 'verification script' },
  });
  assert('patient cancels booking', cancel.status === 200);
  const rebook = await bookAndConfirm(slotA.id, patientToken, {});
  const refreshedSlotA = (await api('GET', `/api/camps/${campId}/slots`)).body?.slots?.find(
    (slot) => Number(slot.id) === Number(slotA.id),
  );
  assert(
    'seat returned to inventory after cancel',
    rebook.status === 200 && Number(refreshedSlotA?.bookedCount) === 1,
    `slot bookedCount ${refreshedSlotA?.bookedCount ?? 'unknown'}`,
  );
  const rescheduled = await api('PATCH', `/api/bookings/${rebook.body.booking.id}/reschedule`, {
    token: patientToken,
    body: { slotId: slotB.id },
  });
  assert('patient reschedules to another slot', rescheduled.status === 200);

  /* ------------------------------------------------------- waitlist mechanics */
  const tinyCamp = await api('POST', '/api/camps', {
    token: tokens.ORGANIZER,
    body: {
      title: `Verification Waitlist Camp ${RUN}`,
      venue: 'Verification Annex',
      address: '2 Verification Road, Bengaluru 560001',
      campDate,
      startTime: '09:00',
      endTime: '09:30',
      slotDurationMins: 30,
      totalCapacity: 1,
      status: 'PUBLISHED',
    },
  });
  const tinySlot = (await api('GET', `/api/camps/${tinyCamp.body.camp.id}`)).body.camp.slots[0];
  const first = await bookAndConfirm(tinySlot.id, patientToken, {});
  assert('first booking on capacity-1 slot confirms', first.status === 200);

  const waiters = [];
  for (let i = 0; i < 2; i += 1) {
    waiters.push(await createIdentity(`waiter${i}`, 'PATIENT', tokens.ADMIN));
  }
  const waitA = await api('POST', `/api/slots/${tinySlot.id}/book`, { token: waiters[0].token, body: {} });
  const waitB = await api('POST', `/api/slots/${tinySlot.id}/book`, { token: waiters[1].token, body: {} });
  assert(
    'full slot waitlists with FIFO positions 1 and 2',
    waitA.status === 202 && waitA.body?.waitlist?.position === 1 && waitB.status === 202 && waitB.body?.waitlist?.position === 2,
  );
  const promoted = await api('PATCH', `/api/bookings/${first.body.booking.id}/cancel`, {
    token: patientToken,
    body: {},
  });
  const waiterBookings = await api('GET', '/api/bookings/me', { token: waiters[0].token });
  const claim = (waiterBookings.body?.bookings || []).find((b) => b.status === 'HELD');
  assert('cancelling promotes #1 waiter to a claimable hold', promoted.status === 200 && Boolean(claim));
  const promotedPatient = promoted.body?.promotedPatient;
  assert(
    'promotion response exposes only id + name (no email/phone)',
    Boolean(promotedPatient) &&
      JSON.stringify(Object.keys(promotedPatient).sort()) === '["id","name"]' &&
      typeof promotedPatient.id === 'number' &&
      typeof promotedPatient.name === 'string' &&
      !promotedPatient.name.includes('@'),
    JSON.stringify(promotedPatient),
  );
  if (claim) {
    const claimed = await api('POST', `/api/bookings/${claim.id}/confirm`, { token: waiters[0].token, body: {} });
    assert('promoted waiter confirms the seat', claimed.status === 200);
  }

  /* ------------------------------------------------------------- attendance */
  const checkinCamp = await api('POST', '/api/camps', {
    token: tokens.ORGANIZER,
    body: {
      title: `Verification Check-in Camp ${RUN}`,
      venue: 'Verification Ground',
      address: '3 Verification Road, Bengaluru 560001',
      campDate,
      startTime: '09:00',
      endTime: '10:00',
      slotDurationMins: 30,
      totalCapacity: 20,
      status: 'PUBLISHED',
    },
  });
  const checkinSlot = (await api('GET', `/api/camps/${checkinCamp.body.camp.id}`)).body.camp.slots[0];
  const checkinBooking = await bookAndConfirm(checkinSlot.id, patientToken, {});
  const qr = checkinBooking.body?.booking?.qrToken || checkinBooking.body?.booking?.qr_token;
  assert('booking carries a QR token', Boolean(qr));
  const volunteerAssignment = await api('POST', `/api/camps/${checkinCamp.body.camp.id}/staff`, {
    token: tokens.ORGANIZER,
    body: {
      userId: users.VOLUNTEER.id,
      roleAtCamp: 'VOLUNTEER',
      shiftStart: '09:00',
      shiftEnd: '10:00',
    },
  });
  assert('volunteer is assigned to the check-in camp', volunteerAssignment.status === 201);
  const scan = await api('POST', '/api/checkin', { token: tokens.VOLUNTEER, body: { qrToken: qr } });
  assert('volunteer checks patient in by QR', scan.status === 200 || scan.status === 201, `status ${scan.status}`);
  const attendance = await api('GET', `/api/bookings/${checkinBooking.body.booking.id}`, { token: tokens.ORGANIZER });
  assert('attendance recorded as CHECKED_IN', attendance.body?.booking?.status === 'CHECKED_IN');
  const controlRoom = await api('GET', `/api/camps/${checkinCamp.body.camp.id}/control-room`, { token: tokens.ORGANIZER });
  assert('control room returns live aggregates', controlRoom.status === 200 && controlRoom.body?.slots !== undefined);

  /* --------------------------------------------------------------- analytics */
  const analytics = await api('GET', '/api/admin/analytics', { token: tokens.ADMIN });
  assert('admin analytics returns KPI block', analytics.status === 200 && analytics.body?.kpis !== undefined);
  assert('analytics provenance is live MySQL', analytics.body?.meta?.provenance === 'live-mysql');
  assert('no fabricated no-show reduction KPI', !('noShowReductionPct' in (analytics.body?.kpis || {})));
  const advisor = await api('GET', '/api/admin/capacity-advisor', { token: tokens.ADMIN });
  assert(
    'capacity advisor is labelled a non-AI heuristic',
    advisor.status === 200 &&
      advisor.body?.badge === 'Rule-Based Statistical Heuristic — NOT Black-Box AI/ML',
    advisor.body?.badge,
  );
  const notifications = await api('GET', '/api/admin/notifications?page=1&pageSize=5', { token: tokens.ADMIN });
  assert(
    'notification log paginated',
    notifications.status === 200 && Array.isArray(notifications.body?.notifications),
  );
  const notificationRows = notifications.body?.notifications || [];
  const providerHonest =
    notificationRows.length > 0 &&
    notificationRows.every((n) => {
      if (n.simulated) return /sandbox/i.test(n.provider) && n.status === 'SIMULATED';
      return !/sandbox/i.test(n.provider) && ['PENDING', 'SENT', 'FAILED'].includes(n.status);
    });
  assert(
    'provider metadata honest: SIMULATED only with Sandbox provider',
    providerHonest,
    notificationRows.slice(0, 2).map((n) => `${n.provider}/${n.status}`).join(', '),
  );
  const audit = await api('GET', '/api/admin/audit-log?page=1&pageSize=5', { token: tokens.ADMIN });
  assert('audit log records mutations', audit.status === 200 && Array.isArray(audit.body?.audit));
  const csv = await api('GET', '/api/admin/reports/export.csv', { token: tokens.ADMIN, raw: true });
  assert(
    'CSV export returns text/csv with a header row',
    csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || '') && csv.text.split('\n')[0].includes(','),
  );

  /* ------------------------------------------------------- reminders engine */
  const reminderRun = await api('POST', '/api/admin/reminders/run', { token: tokens.ADMIN, body: {} });
  assert('reminder sweep runs (idempotent)', reminderRun.status === 200);
  const holdSweep = await api('POST', '/api/admin/holds/expire', { token: tokens.ADMIN, body: {} });
  assert('hold/promotion expiry sweep runs', holdSweep.status === 200 && typeof holdSweep.body?.expiredHolds === 'number');

  /* ------------------------------------------------------------------ close-out */
  const closeOut = await api('POST', `/api/camps/${checkinCamp.body.camp.id}/close-out`, {
    token: tokens.ORGANIZER,
    body: {},
  });
  assert('camp close-out marks the day complete', closeOut.status === 200);

  /* ----------------------------------------------------------------- summary */
  const passed = results.length - failures;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${passed}/${results.length} checks passed${failures ? ` · ${failures} FAILED` : ''}`);
  console.log(`${'─'.repeat(64)}\n`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nVerification crashed:', error);
  process.exitCode = 1;
});
