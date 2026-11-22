import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingToIcs } from '../src/lib/ics.js';

const now = new Date('2026-11-22T15:55:46.000Z');

function unfold(ics) {
  return ics.split('\r\n').map((line) => (line.startsWith(' ') ? line.slice(1) : line)).join('');
}

const booking = {
  qrToken: 'CHSC-BLR-750882',
  tokenNumber: 'C-233074',
  campTitle: 'Community Health Camp',
  campDate: '2026-11-25',
  startTime: '08:00:00',
  endTime: '08:30:00',
  venue: 'CMRIT Main Auditorium',
  address: '',
  status: 'CONFIRMED',
};

test('builds a polished, standards-safe calendar invite', () => {
  const ics = bookingToIcs(booking, now);

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('\r\nEND:VCALENDAR'));
  assert.ok(!ics.replace(/\r\n/g, '').includes('\n'), 'all line breaks must be CRLF');

  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /CALSCALE:GREGORIAN/);
  assert.match(ics, /METHOD:PUBLISH/);
  assert.match(ics, /X-WR-CALNAME:CHSC Health Camps/);
  assert.match(ics, /X-WR-TIMEZONE:Asia\/Kolkata/);
  assert.ok(ics.indexOf('BEGIN:VTIMEZONE') < ics.indexOf('BEGIN:VEVENT'));
  assert.match(ics, /TZID:Asia\/Kolkata/);
  assert.match(ics, /TZOFFSETTO:\+0530/);
  assert.match(ics, /TZNAME:IST/);

  assert.match(ics, /UID:CHSC-BLR-750882@chsc\.cmrit\.edu/);
  assert.match(ics, /DTSTAMP:20261122T155546Z/);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261125T080000/);
  assert.match(ics, /DTEND;TZID=Asia\/Kolkata:20261125T083000/);
  assert.match(ics, /SUMMARY:CHSC Screening — Community Health Camp \(C-233074\)/);
  assert.match(ics, /LOCATION:CMRIT Main Auditorium\r\n/);
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.match(ics, /TRANSP:OPAQUE/);
  assert.match(ics, /BEGIN:VALARM\r\nTRIGGER:-PT60M\r\nACTION:DISPLAY/);
  assert.ok(!ics.includes('undefined'));
  assert.ok(!ics.includes('null'));
});

test('does not leave a dangling comma when the venue has no address', () => {
  const ics = bookingToIcs({ ...booking, address: '   ' }, now);
  assert.ok(!ics.includes('Auditorium, '));
  assert.match(ics, /LOCATION:CMRIT Main Auditorium\r\n/);
});

test('includes a real address and escapes ICS text correctly', () => {
  const ics = bookingToIcs({
    ...booking,
    campTitle: 'Free; Camp, Main\\Hall',
    address: '12th Main, Rajiv Gandhi Nagar',
  }, now);

  assert.ok(ics.includes('SUMMARY:CHSC Screening — Free\\; Camp\\, Main\\\\Hall (C-233074)'));
  assert.ok(ics.includes('LOCATION:CMRIT Main Auditorium\\, 12th Main\\, Rajiv Gandhi Nagar'));
});

test('uses a multi-line description that renders cleanly in calendar apps', () => {
  const unfolded = unfold(bookingToIcs(booking, now));
  assert.ok(unfolded.includes('DESCRIPTION:Booking CHSC-BLR-750882.\\nToken C-233074.'));
  assert.ok(unfolded.includes('Arrive 10 minutes early with this pass.\\nFree screening event. Carry a photo ID.'));
});

test('folds long lines at 75 octets without breaking UTF-8 characters', () => {
  const ics = bookingToIcs({
    ...booking,
    campTitle: 'Community Health Camp — Bengaluru '.repeat(8),
    address: 'A long street address '.repeat(10),
  }, now);

  const lines = ics.split('\r\n');
  assert.ok(lines.some((line) => line.startsWith(' ')), 'expected at least one folded line');
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line exceeds 75 octets: ${line}`);
  }
});

test('maps booking states to honest calendar status values', () => {
  assert.match(bookingToIcs({ ...booking, status: 'HELD' }, now), /STATUS:TENTATIVE/);
  assert.match(bookingToIcs({ ...booking, status: 'CANCELLED' }, now), /STATUS:CANCELLED/);
  assert.ok(!bookingToIcs({ ...booking, status: '' }, now).includes('STATUS:'));
});

test('falls back to the token when the QR reference is absent', () => {
  const ics = bookingToIcs({ ...booking, qrToken: '' }, now);
  assert.match(ics, /UID:C-233074@chsc\.cmrit\.edu/);
  assert.ok(!ics.includes('UID:@'));
});

test('rejects invalid live data instead of inventing a time', () => {
  assert.throws(() => bookingToIcs({ ...booking, campDate: '25-11-2026' }, now), /valid camp date/);
  assert.throws(() => bookingToIcs({ ...booking, startTime: '8' }, now), /valid start time/);
  assert.throws(() => bookingToIcs({ ...booking, endTime: '25:70' }, now), /valid end time/);
});
