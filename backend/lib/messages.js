'use strict';

/**
 * Transactional message templates for booking confirmation, reschedule,
 * cancellation, waitlist and reminder events.
 *
 * Both channels always carry the logistics a patient needs at the gate:
 * booking ID, token, camp, date, time, full venue/address, and a navigation
 * link. Email additionally carries the ticket QR as an inline CID image.
 * No clinical or health information is ever included.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Accepts a MySQL DATE (Date or `YYYY-MM-DD...`) without timezone drift. */
function formatCampDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : String(value);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Sat, 28 Nov 2026` from a DATE value, using UTC-free arithmetic. */
function formatDateLabel(value) {
  const iso = formatCampDate(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatTime12(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}

function normaliseDetails(details = {}) {
  return {
    patientName: String(details.patientName || 'Patient').trim(),
    bookingId: details.bookingId ?? null,
    tokenNumber: String(details.tokenNumber || '').trim(),
    qrToken: String(details.qrToken || '').trim(),
    campTitle: String(details.campTitle || '').trim(),
    campDate: formatCampDate(details.campDate),
    startTime: details.startTime || '',
    endTime: details.endTime || '',
    venue: String(details.venue || '').trim(),
    address: String(details.address || '').trim(),
    city: String(details.city || '').trim(),
    mapsUrl: String(details.mapsUrl || '').trim(),
    shortUrl: String(details.shortUrl || '').trim(),
    waitlistPosition: details.waitlistPosition ?? null,
  };
}

function smsAddress(details) {
  const address = [details.address, details.city].filter(Boolean).join(', ');
  return address ? ` Address: ${address}.` : '';
}

const COPY = {
  BOOKING_CONFIRMED: {
    eyebrow: 'Appointment confirmed',
    subject: (d) => `CHSC appointment confirmed · ${d.tokenNumber || 'your pass'}`,
    sms: (d) => `CHSC confirmed: ${d.patientName}, ${d.campTitle} on ${formatDateLabel(d.campDate)} at ${formatTime12(d.startTime)}. Venue: ${d.venue}.${smsAddress(d)} Booking ID #${d.bookingId}. Ref ${d.tokenNumber}. Navigate: ${d.shortUrl || d.mapsUrl}`,
    intro: 'Your seat is confirmed. Show this QR at the gate — no printing is needed.',
  },
  WAITLIST_PROMOTED: {
    eyebrow: 'A seat is yours to claim',
    subject: (d) => `Claim your CHSC seat · ${d.tokenNumber || d.campTitle}`,
    sms: (d) => `CHSC seat released: ${d.patientName}, claim ${d.campTitle} on ${formatDateLabel(d.campDate)} at ${formatTime12(d.startTime)} within the hold window. Venue: ${d.venue}.${smsAddress(d)} Booking ID #${d.bookingId}. Ref ${d.tokenNumber}. Navigate: ${d.shortUrl || d.mapsUrl}`,
    intro: 'A neighbour released a seat. Your place is held for a short window — confirm it in My Appointments.',
  },
  WAITLIST_JOINED: {
    eyebrow: 'You are on the waitlist',
    subject: (d) => `CHSC waitlist #${d.waitlistPosition || ''} · ${d.campTitle}`,
    sms: (d) => `CHSC waitlist: ${d.patientName}, you are #${d.waitlistPosition || ''} for ${d.campTitle} on ${formatDateLabel(d.campDate)} at ${formatTime12(d.startTime)}. We will notify you if a seat is released. Venue: ${d.venue}.`,
    intro: 'The slot is full. You are in the FIFO queue and will be promoted automatically if a seat is released.',
  },
  CANCELLATION: {
    eyebrow: 'Appointment released',
    subject: (d) => `CHSC appointment released · ${d.tokenNumber || d.campTitle}`,
    sms: (d) => `CHSC cancelled: ${d.patientName}, your booking #${d.bookingId} for ${d.campTitle} on ${formatDateLabel(d.campDate)} at ${formatTime12(d.startTime)} was released. No penalty. Ref ${d.tokenNumber}.`,
    intro: 'Your seat has been released and no penalty was applied. Thank you for helping a waiting neighbour.',
  },
  RESCHEDULED: {
    eyebrow: 'Appointment rescheduled',
    subject: (d) => `CHSC appointment moved · ${d.tokenNumber || d.campTitle}`,
    sms: (d) => `CHSC rescheduled: ${d.patientName}, booking #${d.bookingId} now ${formatDateLabel(d.campDate)} at ${formatTime12(d.startTime)}. Venue: ${d.venue}.${smsAddress(d)} Ref ${d.tokenNumber}. Navigate: ${d.shortUrl || d.mapsUrl}`,
    intro: 'Your appointment has moved to a new slot. The QR pass is unchanged.',
  },
  REMINDER_24H: {
    eyebrow: 'Appointment tomorrow',
    subject: (d) => `CHSC reminder · ${d.campTitle} tomorrow`,
    sms: (d) => `CHSC reminder: ${d.patientName}, ${d.campTitle} is tomorrow at ${formatTime12(d.startTime)}. Venue: ${d.venue}. Booking ID #${d.bookingId}. Ref ${d.tokenNumber}. Navigate: ${d.shortUrl || d.mapsUrl}`,
    intro: 'Your appointment is tomorrow. Arrive 10 minutes early with your QR pass.',
  },
  REMINDER_2H: {
    eyebrow: 'Appointment in about 2 hours',
    subject: (d) => `CHSC reminder · ${d.campTitle} soon`,
    sms: (d) => `CHSC reminder: ${d.patientName}, ${d.campTitle} starts in about 2 hours at ${formatTime12(d.startTime)}. Venue: ${d.venue}. Booking ID #${d.bookingId}. Ref ${d.tokenNumber}. Navigate: ${d.shortUrl || d.mapsUrl}`,
    intro: 'Your appointment starts in about two hours. The gate opens 15 minutes before your slot.',
  },
  CHECK_IN: {
    eyebrow: 'Checked in',
    subject: (d) => `CHSC check-in · ${d.tokenNumber || d.campTitle}`,
    sms: (d) => `CHSC checked in: ${d.patientName}, ${d.campTitle} at ${formatTime12(d.startTime)}. Venue: ${d.venue}. Booking ID #${d.bookingId}. Ref ${d.tokenNumber}.`,
    intro: 'You are checked in and joined the live waiting room.',
  },
};

function copyFor(type) {
  return COPY[type] || COPY.BOOKING_CONFIRMED;
}

function detailsLines(details) {
  const lines = [
    ['Patient', details.patientName],
    ['Booking ID', details.bookingId ? `#${details.bookingId}` : ''],
    ['Ticket reference', details.tokenNumber],
    ['Camp', details.campTitle],
    ['Date', formatDateLabel(details.campDate)],
    ['Time', [formatTime12(details.startTime), formatTime12(details.endTime)].filter(Boolean).join(' – ')],
    ['Venue', details.venue],
    ['Address', [details.address, details.city].filter(Boolean).join(', ')],
  ];
  return lines.filter(([, value]) => Boolean(value));
}

function buildText(type, details) {
  const copy = copyFor(type);
  const lines = [copy.eyebrow.toUpperCase(), '', copy.intro, ''];
  for (const [label, value] of detailsLines(details)) lines.push(`${label}: ${value}`);
  if (details.mapsUrl) lines.push('', `Google Maps directions: ${details.mapsUrl}`);
  if (details.shortUrl && details.shortUrl !== details.mapsUrl) {
    lines.push(`Short navigation link: ${details.shortUrl}`);
  }
  lines.push('', 'Screening is free. No payment is ever requested.', 'CHSC · Community Health Screening, Bengaluru');
  return lines.join('\n');
}

function buildSms(type, details) {
  // Indian SMS gateways bill per 160-character segment; the short navigation
  // link keeps the essential logistics inside two segments.
  return copyFor(type).sms(details).slice(0, 480);
}

function buildHtml(type, details, { qrCid = null } = {}) {
  const copy = copyFor(type);
  const rows = detailsLines(details)
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;color:#64748b;font:600 12px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;width:38%;">${escapeHtml(label)}</td>
          <td style="padding:10px 0;color:#0f172a;font:600 14px/1.5 Arial,sans-serif;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  const qrBlock = qrCid
    ? `<div style="text-align:center;padding:8px 0 4px;">
         <img src="cid:${escapeHtml(qrCid)}" width="168" height="168" alt="CHSC ticket QR code" style="display:inline-block;border:8px solid #ffffff;border-radius:12px;background:#ffffff;" />
         <p style="margin:6px 0 0;color:#64748b;font:400 12px/1.5 Arial,sans-serif;">Scan at the gate · opens Google Maps on a phone camera</p>
       </div>`
    : '';

  const buttons = [
    details.mapsUrl
      ? `<a href="${escapeHtml(details.mapsUrl)}" style="display:inline-block;margin:4px 6px 4px 0;padding:12px 18px;background:#059669;color:#ffffff;text-decoration:none;border-radius:10px;font:700 14px/1 Arial,sans-serif;">Open Google Maps directions</a>`
      : '',
    details.shortUrl
      ? `<a href="${escapeHtml(details.shortUrl)}" style="display:inline-block;margin:4px 6px 4px 0;padding:12px 18px;background:#ecfdf5;color:#047857;text-decoration:none;border-radius:10px;font:700 14px/1 Arial,sans-serif;border:1px solid #a7f3d0;">Short navigation link</a>`
      : '',
  ].join('');

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(copy.subject(details))}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:22px 26px;background:#052e1b;color:#ecfdf5;">
                <p style="margin:0 0 6px;color:#6ee7b7;font:700 11px/1.4 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;">Community Health Screening · Bengaluru</p>
                <h1 style="margin:0;font:700 24px/1.25 Arial,sans-serif;">${escapeHtml(copy.eyebrow)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 26px 6px;">
                <p style="margin:0 0 16px;color:#334155;font:400 15px/1.6 Arial,sans-serif;">${escapeHtml(copy.intro)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${rows}</table>
                ${qrBlock}
                <div style="padding:10px 0 18px;">${buttons}</div>
                <p style="margin:0 0 8px;color:#64748b;font:400 12px/1.6 Arial,sans-serif;">
                  Screening is free — no payment is ever requested. Carry a photo ID and arrive 10 minutes early.
                  Plans changed? Release your seat from My Appointments so a waiting neighbour can be promoted.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 26px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font:400 11px/1.6 Arial,sans-serif;">
                This message contains logistics only — never medical or screening results.
                Booking reference ${escapeHtml(details.tokenNumber || '')}${details.bookingId ? ` · booking ID #${escapeHtml(details.bookingId)}` : ''}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Build every channel for one event.
 * @returns {{subject:string,text:string,html:string,sms:string}}
 */
function buildMessages(type, rawDetails, options = {}) {
  const details = normaliseDetails(rawDetails);
  return {
    details,
    subject: copyFor(type).subject(details),
    text: buildText(type, details),
    html: buildHtml(type, details, options),
    sms: buildSms(type, details),
  };
}

module.exports = {
  buildMessages,
  buildText,
  buildSms,
  buildHtml,
  normaliseDetails,
  formatCampDate,
  formatDateLabel,
  formatTime12,
  escapeHtml,
  COPY,
};
