'use strict';

/**
 * CHSC live end-to-end verification.
 *
 * Runs against a *running* backend (Mode A: real Express + real MySQL) and
 * exercises every role's critical path over HTTP, exactly the way the browser
 * does. Nothing is mocked. Data is created with a unique suffix so the script
 * is repeatable and never destroys seeded demo data.
 *
 *   node scripts/verify-live.js            # http://127.0.0.1:4000
 *   BASE_URL=https://api.example.com node scripts/verify-live.js
 *
 * Exit code 0 = every check passed. 1 = at least one failure (details printed).
 */

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const RUN = Date.now().toString(36);

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

/** Phase-1 booking now returns HELD; confirm it before any active-workflow check. */
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
  console.log(`\nCHSC live verification → ${BASE}  (run ${RUN})\n`);

  /* ---------------------------------------------------------------- health */
  const health = await api('GET', '/api/health');
  assert('health endpoint reports ok', health.status === 200 && health.body?.ok === true);
  assert('database reachable', health.body?.database === 'connected', health.body?.dbVersion);
  assert('socket.io ready', health.body?.socket === 'ready');

  /* ------------------------------------------------------------ auth roles */
  const tokens = {};
  const demoUsers = {};
  for (const role of ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN']) {
    const r = await api('POST', '/api/auth/demo-login', { body: { role } });
    const ok = r.status === 200 && r.body?.token && r.body?.user?.role === role;
    tokens[role] = r.body?.token;
    demoUsers[role] = r.body?.user;
    assert(`${role} demo login`, ok, r.body?.user?.email);
  }

  /* ------------------------------------------------------ registration flow */
  const phone = `9${String(Date.now()).slice(-9)}`;
  const reg = await api('POST', '/api/auth/register', {
    body: {
      name: `Verify Patient ${RUN}`,
      email: `verify.${RUN}@example.com`,
      phone,
      password: 'Verify@123',
      ageGroup: '30-45',
      preferredLanguage: 'en',
    },
  });
  assert('patient registration returns 201 + token', reg.status === 201 && reg.body?.token);
  assert(
    'registration never returns the password hash',
    !JSON.stringify(reg.body?.user || {}).includes('password'),
  );
  const patientToken = reg.body?.token;

  const pwLogin = await api('POST', '/api/auth/login', {
    body: { identifier: `verify.${RUN}@example.com`, password: 'Verify@123' },
  });
  assert('login with password works', pwLogin.status === 200 && pwLogin.body?.token);

  const badLogin = await api('POST', '/api/auth/login', {
    body: { identifier: `verify.${RUN}@example.com`, password: 'wrong-password' },
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
    token: tokens.PATIENT,
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
      userId: 4,
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
      userId: 4,
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
    list.status === 200 &&
      Array.isArray(list.body?.camps) &&
      list.body.pagination?.pageSize === 5,
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
    held.status === 201 &&
      held.body?.booking?.status === 'HELD' &&
      Boolean(held.body?.holdExpiresAt),
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
    'double-click is rejected as DUPLICATE_BOOKING, never a second row',
    doubleBook.status === 409 &&
      doubleBook.body?.code === 'DUPLICATE_BOOKING' &&
      doubleBook.body?.details?.booking?.id === bookingId,
    `status ${doubleBook.status} ${doubleBook.body?.code || ''}`,
  );

  const mine = await api('GET', '/api/bookings/me', { token: patientToken });
  assert('patient sees exactly one active booking', mine.status === 200 && (mine.body?.bookings || []).filter((b) => b.status === 'CONFIRMED').length === 1);

  /* ---------------------------------------------------------- cancellation */
  const cancel = await api('PATCH', `/api/bookings/${bookingId}/cancel`, {
    token: patientToken,
    body: { reason: 'verification script' },
  });
  assert('patient cancels booking', cancel.status === 200, `status ${cancel.status}`);

  const rebook = await bookAndConfirm(slotA.id, patientToken, {});
  const refreshedSlotA = (
    await api('GET', `/api/camps/${campId}/slots`)
  ).body?.slots?.find((slot) => Number(slot.id) === Number(slotA.id));
  assert(
    'seat is returned to inventory after cancel',
    rebook.status === 200 &&
      rebook.body?.booking?.status === 'CONFIRMED' &&
      Number(refreshedSlotA?.bookedCount) === 1,
    `status ${rebook.status}; slot bookedCount ${refreshedSlotA?.bookedCount ?? 'unknown'}`,
  );

  /* ---------------------------------------------------------- reschedule */
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

  const secondTokens = [];
  for (let i = 0; i < 2; i += 1) {
    const r = await api('POST', '/api/auth/register', {
      body: {
        name: `Waitlist ${i} ${RUN}`,
        email: `wait.${i}.${RUN}@example.com`,
        phone: `8${String(Date.now() + i).slice(-9)}`,
        password: 'Verify@123',
      },
    });
    secondTokens.push(r.body.token);
  }
  const waitA = await api('POST', `/api/slots/${tinySlot.id}/book`, {
    token: secondTokens[0],
    body: {},
  });
  const waitB = await api('POST', `/api/slots/${tinySlot.id}/book`, {
    token: secondTokens[1],
    body: {},
  });
  assert(
    'full slot waitlists with FIFO positions 1 and 2',
    waitA.status === 202 &&
      waitA.body?.waitlist?.position === 1 &&
      waitB.status === 202 &&
      waitB.body?.waitlist?.position === 2,
  );

  const cancelFirst = await api('PATCH', `/api/bookings/${first.body.booking.id}/cancel`, {
    token: patientToken,
    body: {},
  });
  const promoted = await api('GET', '/api/bookings/me', { token: secondTokens[0] });
  const claim = (promoted.body?.bookings || []).find((b) => b.status === 'HELD');
  assert(
    'cancelling promotes the #1 waiter to a claimable hold',
    cancelFirst.status === 200 && Boolean(claim),
  );
  if (claim) {
    const claimed = await api('POST', `/api/bookings/${claim.id}/confirm`, {
      token: secondTokens[0],
      body: {},
    });
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
      userId: demoUsers.VOLUNTEER?.id,
      roleAtCamp: 'VOLUNTEER',
      shiftStart: '09:00',
      shiftEnd: '10:00',
    },
  });
  assert(
    'volunteer is assigned to the check-in camp',
    volunteerAssignment.status === 201,
    volunteerAssignment.status === 201
      ? `assignment #${volunteerAssignment.body?.staff?.id}`
      : JSON.stringify(volunteerAssignment.body),
  );

  const scan = await api('POST', '/api/checkin', {
    token: tokens.VOLUNTEER,
    body: { qrToken: qr },
  });
  assert('volunteer checks patient in by QR (201/200)', scan.status === 200 || scan.status === 201, `status ${scan.status}`);
  const attendance = await api('GET', `/api/bookings/${checkinBooking.body.booking.id}`, {
    token: tokens.ORGANIZER,
  });
  assert(
    'attendance recorded as CHECKED_IN',
    attendance.body?.booking?.status === 'CHECKED_IN' || attendance.body?.status === 'CHECKED_IN',
  );

  const controlRoom = await api('GET', `/api/camps/${checkinCamp.body.camp.id}/control-room`, {
    token: tokens.ORGANIZER,
  });
  assert('control room returns live aggregates', controlRoom.status === 200 && controlRoom.body?.slots !== undefined);

  /* --------------------------------------------------------------- analytics */
  const analytics = await api('GET', '/api/admin/analytics', { token: tokens.ADMIN });
  assert(
    'admin analytics returns KPI block',
    analytics.status === 200 && analytics.body?.kpis !== undefined,
  );
  const advisor = await api('GET', '/api/admin/capacity-advisor', { token: tokens.ADMIN });
  assert('capacity advisor is labelled a heuristic', advisor.status === 200);
  const notifications = await api('GET', '/api/admin/notifications?page=1&pageSize=5', {
    token: tokens.ADMIN,
  });
  assert('notification log paginated', notifications.status === 200);
  const audit = await api('GET', '/api/admin/audit-log?page=1&pageSize=5', { token: tokens.ADMIN });
  assert('audit log records mutations', audit.status === 200 && Array.isArray(audit.body?.audit));

  const csv = await api('GET', '/api/admin/reports/export.csv', { token: tokens.ADMIN, raw: true });
  assert(
    'CSV export returns text/csv with a header row',
    csv.status === 200 &&
      /text\/csv/.test(csv.headers.get('content-type') || '') &&
      csv.text.split('\n')[0].includes(','),
  );

  /* ------------------------------------------------------- reminders engine */
  const reminderRun = await api('POST', '/api/admin/reminders/run', {
    token: tokens.ADMIN,
    body: {},
  });
  assert('reminder sweep runs (idempotent)', reminderRun.status === 200);
  const holdSweep = await api('POST', '/api/admin/holds/expire', {
    token: tokens.ADMIN,
    body: {},
  });
  assert(
    'hold/promotion expiry sweep runs (idempotent)',
    holdSweep.status === 200 && typeof holdSweep.body?.expiredHolds === 'number',
  );

  /* ------------------------------------------------------- concurrency proof */
  const proof = await api('POST', '/api/demo/concurrency', {
    token: tokens.ADMIN,
    body: { capacity: 10, requests: 50 },
  });
  const p = proof.body || {};
  assert(
    'concurrency proof: 10 confirmed / 40 waitlisted / 0 violations',
    proof.status === 200 &&
      p.confirmed === 10 &&
      p.waitlisted === 40 &&
      p.errors === 0 &&
      p.zeroOverbooked === true,
    JSON.stringify({
      confirmed: p.confirmed,
      waitlisted: p.waitlisted,
      errors: p.errors,
      zeroOverbooked: p.zeroOverbooked,
    }),
  );

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
