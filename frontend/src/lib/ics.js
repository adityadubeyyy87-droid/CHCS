// ics.js — RFC 5545 calendar export for a real CHSC booking.
// No sample data: every field comes from the booking passed in by the app.

const MAX_LINE_BYTES = 75;
const TIMEZONE = 'Asia/Kolkata';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function clean(value) {
  return String(value ?? '').trim();
}

function escapeText(value) {
  return clean(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function foldLine(line) {
  const bytes = encoder.encode(line);
  if (bytes.length <= MAX_LINE_BYTES) return line;

  const parts = [];
  let offset = 0;
  let first = true;

  while (offset < bytes.length) {
    const limit = first ? MAX_LINE_BYTES : MAX_LINE_BYTES - 1; // continuation space counts
    let end = Math.min(offset + limit, bytes.length);

    // Never split a UTF-8 code point.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;

    parts.push(`${first ? '' : ' '}${decoder.decode(bytes.slice(offset, end))}`);
    offset = end;
    first = false;
  }

  return parts.join('\r\n');
}

function localTime(value, label) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(clean(value));
  if (!match) throw new Error(`A valid ${label} is required for the calendar file.`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`A valid ${label} is required for the calendar file.`);

  return `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}00`;
}

function dateStamp(value) {
  const date = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A valid camp date is required for the calendar file.');
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('A valid camp date is required for the calendar file.');
  }
  return date.replace(/-/g, '');
}

function utcStamp(now) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function calendarStatus(status) {
  return ({
    CONFIRMED: 'CONFIRMED',
    HELD: 'TENTATIVE',
    WAITLISTED: 'TENTATIVE',
    CANCELLED: 'CANCELLED',
  })[clean(status).toUpperCase()];
}

/** Build a standards-safe .ics string from a live booking row. */
export function bookingToIcs(b, now = new Date()) {
  const date = dateStamp(b.campDate);
  const start = localTime(b.startTime, 'start time');
  const end = localTime(b.endTime, 'end time');
  const uid = (clean(b.qrToken) || clean(b.tokenNumber) || 'chsc-pass')
    .replace(/[^A-Za-z0-9._-]/g, '-');
  const token = clean(b.tokenNumber);
  const title = clean(b.campTitle) || 'Community Health Camp';
  const summary = `CHSC Screening — ${title}${token ? ` (${token})` : ''}`;

  const location = [b.venue, b.address]
    .map(clean)
    .filter(Boolean)
    .map(escapeText)
    .join('\\, ');

  const description = [
    `Booking ${clean(b.qrToken) || 'pass'}.`,
    token ? `Token ${token}.` : '',
    'Arrive 10 minutes early with this pass.',
    'Free screening event. Carry a photo ID.',
  ]
    .filter(Boolean)
    .map(escapeText)
    .join('\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CHSC//Health Camp//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:CHSC Health Camps',
    `X-WR-TIMEZONE:${TIMEZONE}`,
    'BEGIN:VTIMEZONE',
    `TZID:${TIMEZONE}`,
    `X-LIC-LOCATION:${TIMEZONE}`,
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'TZNAME:IST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}@chsc.cmrit.edu`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=${TIMEZONE}:${date}T${start}`,
    `DTEND;TZID=${TIMEZONE}:${date}T${end}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    calendarStatus(b.status) ? `STATUS:${calendarStatus(b.status)}` : '',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText('CHSC camp reminder — arrive 10 minutes early')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lines.map(foldLine).join('\r\n');
}

/** Download the calendar file in a browser. */
export function downloadIcs(booking) {
  const blob = new Blob([bookingToIcs(booking)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chsc-${(clean(booking.qrToken) || 'pass').replace(/[^A-Z0-9-]/gi, '')}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
