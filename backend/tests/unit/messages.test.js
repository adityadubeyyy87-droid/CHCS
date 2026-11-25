'use strict';

const { buildMessages, formatDateLabel, escapeHtml } = require('../../lib/messages');

const DETAILS = {
  patientName: 'Meera Sharma',
  bookingId: 42,
  tokenNumber: 'A-302129',
  qrToken: 'CHSC-BLR-ABCDEFGH',
  campTitle: 'Indiranagar Preventive Screening',
  campDate: '2026-11-28',
  startTime: '09:00:00',
  endTime: '09:30:00',
  venue: 'Indiranagar Community Hall',
  address: '12th Main Road, Indiranagar',
  city: 'Bengaluru',
  mapsUrl:
    'https://www.google.com/maps/dir/?api=1&destination=12.9719%2C77.6412&travelmode=driving',
  shortUrl: 'https://api.chsc.app/n/CHSC-BLR-ABCDEFGH',
};

describe('transactional message templates', () => {
  it('includes booking id, camp, date, time, full address and maps in email text', () => {
    const built = buildMessages('BOOKING_CONFIRMED', DETAILS);
    expect(built.subject).toContain('appointment confirmed');
    expect(built.text).toContain('Booking ID: #42');
    expect(built.text).toContain('A-302129');
    expect(built.text).toContain('Indiranagar Preventive Screening');
    expect(built.text).toContain('Sat, 28 Nov 2026');
    expect(built.text).toContain('9:00 AM');
    expect(built.text).toContain('Indiranagar Community Hall');
    expect(built.text).toContain('12th Main Road');
    expect(built.text).toContain(DETAILS.mapsUrl);
    expect(built.text).toContain(DETAILS.shortUrl);
  });

  it('keeps SMS logistics inside the gateway limit and includes the short link', () => {
    const built = buildMessages('BOOKING_CONFIRMED', DETAILS);
    expect(built.sms.length).toBeLessThanOrEqual(480);
    expect(built.sms).toContain('Booking ID #42');
    expect(built.sms).toContain('Sat, 28 Nov 2026');
    expect(built.sms).toContain(DETAILS.venue);
    expect(built.sms).toContain(DETAILS.shortUrl);
  });

  it('renders an inline QR image and real Maps link in the HTML email', () => {
    const built = buildMessages('BOOKING_CONFIRMED', DETAILS, { qrCid: 'chsc-ticket' });
    expect(built.html).toContain('cid:chsc-ticket');
    expect(built.html).toContain(DETAILS.mapsUrl.replaceAll('&', '&amp;'));
    expect(built.html).toContain('Open Google Maps directions');
    expect(built.html).toContain('#42');
  });

  it('escapes patient-controlled text in HTML', () => {
    const built = buildMessages('BOOKING_CONFIRMED', {
      ...DETAILS,
      patientName: '<script>alert(1)</script>',
    });
    expect(built.html).not.toContain('<script>alert(1)</script>');
    expect(built.html).toContain('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('has distinct reschedule and cancellation copy', () => {
    const rescheduled = buildMessages('RESCHEDULED', DETAILS);
    const cancelled = buildMessages('CANCELLATION', DETAILS);
    expect(rescheduled.subject).toContain('moved');
    expect(rescheduled.sms).toContain('rescheduled');
    expect(cancelled.subject).toContain('released');
    expect(cancelled.sms).toContain('No penalty');
    expect(cancelled.html).toContain('released');
  });

  it('formats dates without a UTC off-by-one', () => {
    expect(formatDateLabel('2026-11-28')).toBe('Sat, 28 Nov 2026');
    expect(formatDateLabel('2026-01-01')).toBe('Thu, 1 Jan 2026');
    expect(formatDateLabel('')).toBe('');
  });
});
