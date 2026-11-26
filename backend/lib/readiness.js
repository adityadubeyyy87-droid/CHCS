'use strict';

/**
 * Ops readiness — a transparent, rule-based assessment of (a) whether outbound
 * delivery is really configured and (b) whether each camp can safely run.
 *
 * This is deliberately NOT a model: every point subtracted below maps to a
 * named, checkable condition. The console can explain any score without
 * guessing, which is what an operations engineer actually needs at 06:30 on
 * camp day.
 *
 * Environment values are never returned — only boolean presence and the names
 * of the variables that are still missing.
 */

const EMAIL_REQUIRED = ['SMTP_HOST', 'SMTP_USER'];
const EMAIL_OPTIONAL = ['SMTP_PORT', 'SMTP_SECURE', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_REPLY_TO'];
const SMS_REQUIRED = ['FAST2SMS_API_KEY'];
const SMS_OPTIONAL = ['SMS_PROVIDER', 'SMS_ROUTE', 'SMS_SENDER_ID', 'SMS_DLT_TEMPLATE_ID'];
const PUSH_REQUIRED = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
const PUSH_OPTIONAL = ['VAPID_SUBJECT'];

function has(env, key) {
  return Boolean(String(env?.[key] ?? '').trim());
}

function presence(env, keys) {
  return Object.fromEntries(keys.map((key) => [key, has(env, key)]));
}

/**
 * Describe the configured providers without leaking a single secret.
 * `live` mirrors backend/lib/providers.js exactly: email needs SMTP_HOST and
 * SMTP_USER; SMS needs FAST2SMS_API_KEY; browser push needs both VAPID keys.
 */
function providerReadiness(env = process.env) {
  const emailPresent = presence(env, [...EMAIL_REQUIRED, ...EMAIL_OPTIONAL]);
  const smsPresent = presence(env, [...SMS_REQUIRED, ...SMS_OPTIONAL]);
  const pushPresent = presence(env, [...PUSH_REQUIRED, ...PUSH_OPTIONAL]);

  const emailLive = has(env, 'SMTP_HOST') && has(env, 'SMTP_USER');
  const smsLive = has(env, 'FAST2SMS_API_KEY');
  const pushLive = PUSH_REQUIRED.every((key) => has(env, key));

  const dltSender = has(env, 'SMS_SENDER_ID');
  const dltTemplate = has(env, 'SMS_DLT_TEMPLATE_ID');
  const route = String(env?.SMS_ROUTE || (dltSender && dltTemplate ? 't' : 'q')).trim();

  const emailMissing = EMAIL_REQUIRED.filter((key) => !emailPresent[key]);
  const smsMissing = SMS_REQUIRED.filter((key) => !smsPresent[key]);
  const allLive = emailLive && smsLive && pushLive;
  if (route === 't') {
    if (!dltSender) smsMissing.push('SMS_SENDER_ID');
    if (!dltTemplate) smsMissing.push('SMS_DLT_TEMPLATE_ID');
  }

  return {
    email: {
      channel: 'EMAIL',
      provider: emailLive ? 'SMTP' : 'Email Sandbox',
      live: emailLive,
      status: emailLive ? 'READY' : 'SANDBOX',
      required: EMAIL_REQUIRED,
      present: emailPresent,
      missing: emailMissing,
      from: String(env?.MAIL_FROM || 'CMRIT Community Health <no-reply@cmrit.edu>'),
      note: emailLive
        ? 'SMTP relay configured. A message is only marked SENT when the relay accepts it.'
        : 'No SMTP credentials. Messages are recorded as Email Sandbox and never claimed as delivered.',
    },
    sms: {
      channel: 'SMS',
      provider: smsLive ? String(env?.SMS_PROVIDER || 'Fast2SMS') : 'SMS Sandbox',
      live: smsLive,
      status: smsLive ? 'READY' : 'SANDBOX',
      route,
      dlt: { sender: dltSender, template: dltTemplate },
      required: SMS_REQUIRED,
      present: smsPresent,
      missing: smsMissing,
      note: !smsLive
        ? 'No Fast2SMS key. Messages are recorded as SMS Sandbox and never claimed as delivered.'
        : route === 't'
          ? 'Fast2SMS transactional route with an approved DLT sender and template.'
          : 'Fast2SMS quick route without DLT sender/template. Indian carriers may reject traffic that is not on a registered template.',
    },
    push: {
      channel: 'PUSH',
      provider: pushLive ? 'Web Push (VAPID)' : 'Web Push Sandbox',
      live: pushLive,
      status: pushLive ? 'READY' : 'SANDBOX',
      required: PUSH_REQUIRED,
      present: pushPresent,
      missing: PUSH_REQUIRED.filter((key) => !pushPresent[key]),
      note: pushLive
        ? 'Free browser push is configured. Each device must still grant notification permission; no SMS fee applies.'
        : 'No VAPID key pair. Browser alerts are recorded as Web Push Sandbox and never claimed as delivered.',
    },
    ready: allLive,
    // The zero-cost path stands on its own: browser push needs no SMS wallet.
    freeReady: pushLive,
    allLive,
    sandboxOnly: !emailLive && !smsLive && !pushLive,
  };
}

/** `YYYY-MM-DD` for a MySQL DATE without timezone drift. */
function isoDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value);
}

function check(id, label, status, detail, penalty = 0) {
  return { id, label, status, detail, penalty };
}

/**
 * Score one camp from real counters.
 *
 * 100 = nothing to fix. Each failed check subtracts a fixed, documented
 * penalty. The band is derived from the final score, never estimated.
 */
function evaluateCamp(input = {}) {
  const camp = input.camp || {};
  const slots = input.slots || {};
  const staff = input.staff || {};
  const bookings = input.bookings || {};
  const notifications = input.notifications || {};
  const today = input.today || isoDate(new Date());
  const oversubscribedSlots = Number(input.oversubscribedSlots || 0);

  const totalCapacity = Number(camp.totalCapacity || 0);
  const slotCapacity = Number(slots.capacity || 0);
  const futureSlots = Number(slots.future || 0);
  const doctors = Number(staff.doctors || 0);
  const volunteers = Number(staff.volunteers || 0);
  const active = Number(bookings.active || 0);
  const checkedIn = Number(bookings.checkedIn || 0);
  const waitlisted = Number(bookings.waitlisted || 0);
  const failed = Number(notifications.failed || 0);
  const simulated = Number(notifications.simulated || 0);
  const sent = Number(notifications.sent || 0);
  const status = String(camp.status || '').toUpperCase();
  const campDate = isoDate(camp.campDate);

  const checks = [];

  const hasLocation = Boolean(String(camp.venue || '').trim() && String(camp.address || '').trim());
  checks.push(hasLocation
    ? check('location', 'Venue and address', 'ok', `${camp.venue || 'Venue'} · ${camp.city || 'city not set'}`)
    : check('location', 'Venue and address', 'bad', 'A patient QR pass needs a venue and street address to open Google Maps.', 25));

  checks.push(futureSlots > 0
    ? check('schedule', 'Future screening windows', 'ok', `${futureSlots} of ${Number(slots.count || 0)} generated slots are still ahead.`)
    : check('schedule', 'Future screening windows', 'bad', 'No slot is in the future, so nothing can be booked.', 25));

  checks.push(doctors > 0
    ? check('doctor', 'Doctor coverage', 'ok', `${doctors} doctor${doctors === 1 ? '' : 's'} assigned.`)
    : check('doctor', 'Doctor coverage', 'bad', 'No doctor is assigned to this camp.', 20));

  checks.push(volunteers > 0
    ? check('volunteer', 'Volunteer coverage', 'ok', `${volunteers} volunteer${volunteers === 1 ? '' : 's'} assigned.`)
    : check('volunteer', 'Volunteer coverage', 'warn', 'No volunteer is assigned; gate check-in will be slower.', 10));

  checks.push(totalCapacity > 0
    ? check('capacity', 'Booking capacity', 'ok', `${totalCapacity} bookable seats.`)
    : check('capacity', 'Booking capacity', 'bad', 'Camp capacity is zero.', 15));

  if (slotCapacity > 0 && totalCapacity > 0 && slotCapacity !== totalCapacity) {
    checks.push(check(
      'capacity-consistency',
      'Capacity consistency',
      'warn',
      `Camp capacity ${totalCapacity} differs from generated slot capacity ${slotCapacity}.`,
      5,
    ));
  } else {
    checks.push(check('capacity-consistency', 'Capacity consistency', 'ok', 'Camp and slot capacity agree.'));
  }

  checks.push(oversubscribedSlots === 0
    ? check('oversubscription', 'Slot integrity', 'ok', 'No slot holds more confirmed patients than its capacity.')
    : check('oversubscription', 'Slot integrity', 'bad', `${oversubscribedSlots} slot(s) exceed capacity — investigate immediately.`, 20));

  checks.push(Number(bookings.stuckHolds || 0) === 0
    ? check('holds', 'Expired seat holds', 'ok', 'No abandoned hold is past its expiry.')
    : check('holds', 'Expired seat holds', 'warn', `${Number(bookings.stuckHolds)} hold(s) are expired and awaiting the sweep.`, 5));

  if (status === 'PUBLISHED' && campDate && campDate < today) {
    checks.push(check('date', 'Publication state', 'bad', `Published camp date ${campDate} is in the past.`, 15));
  } else {
    checks.push(check('date', 'Publication state', 'ok', `${status || 'UNKNOWN'} · ${campDate || 'date not set'}`));
  }

  if (failed > 0) {
    checks.push(check('notifications', 'Notification delivery', 'bad', `${failed} message(s) failed and need an admin retry.`, 10));
  } else if (active > 0 && simulated > 0 && sent === 0) {
    checks.push(check(
      'notifications',
      'Notification delivery',
      'warn',
      `${simulated} message(s) were recorded in Sandbox. Configure SMTP/Fast2SMS or enable free browser alerts.`,
      5,
    ));
  } else {
    checks.push(check(
      'notifications',
      'Notification delivery',
      'ok',
      `${sent} provider-accepted · ${simulated} sandbox · ${failed} failed.`,
    ));
  }

  const penalty = checks.reduce((sum, item) => sum + Number(item.penalty || 0), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const blockers = checks.filter((item) => item.status === 'bad').length;
  const warnings = checks.filter((item) => item.status === 'warn').length;

  return {
    score,
    band: score >= 85 ? 'READY' : score >= 60 ? 'ATTENTION' : 'BLOCKED',
    headline: score >= 85
      ? 'Ready to run'
      : score >= 60
        ? 'Run with attention'
        : 'Blocked — fix before patients arrive',
    checks,
    blockers,
    warnings,
    counters: { active, checkedIn, waitlisted, capacity: totalCapacity, doctors, volunteers },
  };
}

module.exports = { providerReadiness, evaluateCamp, isoDate };
