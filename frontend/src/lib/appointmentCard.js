// appointmentCard.js — build a self-contained SVG appointment card from a real
// booking. No external image service, no fabricated appointment details.
import QRCode from 'qrcode';

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const text = (value, fallback = '—') => escapeXml(value || fallback);

/**
 * @param {object} booking live booking row from /api/bookings/me
 * @returns {Promise<string>} standalone SVG markup
 */
export async function appointmentCardSvg(booking) {
  if (!booking || !booking.qrPayload || !booking.tokenNumber) {
    throw new Error('A confirmed pass with a QR token is required.');
  }
  const qr = await QRCode.toString(booking.qrPayload, {
    type: 'svg',
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });
  const qrSvg = qr.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/^<svg[^>]*>/, (tag) =>
    tag.replace('<svg', '<svg x="48" y="210"'),
  );
  const holder = booking.familyMemberName
    ? `${booking.familyMemberName} (family of ${booking.patientName || 'account holder'})`
    : booking.patientName || 'Patient';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="620" viewBox="0 0 760 620" role="img" aria-label="CHSC appointment card">
  <rect width="760" height="620" rx="24" fill="#0F172A"/>
  <rect x="2" y="2" width="756" height="616" rx="23" fill="none" stroke="#10B981" stroke-opacity=".45"/>
  <text x="48" y="72" fill="#10B981" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">CHSC · COMMUNITY HEALTH SCREENING CAMP</text>
  <text x="48" y="124" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="36" font-weight="700">${text(booking.campTitle, 'Health camp')}</text>
  <text x="48" y="162" fill="#94A3B8" font-family="Arial, sans-serif" font-size="18">${text(holder)}</text>
  <line x1="48" y1="188" x2="712" y2="188" stroke="#334155"/>
  ${qrSvg}
  <text x="420" y="240" fill="#94A3B8" font-family="Arial, sans-serif" font-size="16" letter-spacing="2">APPOINTMENT PASS</text>
  <text x="420" y="292" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="48" font-weight="700">${text(booking.tokenNumber)}</text>
  <text x="420" y="334" fill="#94A3B8" font-family="Arial, sans-serif" font-size="16">Booking #${text(booking.id)} · ${text(booking.status)}</text>
  <text x="420" y="382" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="20">${text(booking.campDate)} · ${text(booking.startTime)}–${text(booking.endTime)}</text>
  <text x="420" y="418" fill="#CBD5E1" font-family="Arial, sans-serif" font-size="18">${text(booking.venue)}</text>
  <text x="420" y="448" fill="#94A3B8" font-family="Arial, sans-serif" font-size="16">${text(booking.address)}${booking.city ? `, ${text(booking.city)}` : ''}</text>
  <line x1="48" y1="556" x2="712" y2="556" stroke="#334155"/>
  <text x="48" y="590" fill="#94A3B8" font-family="Arial, sans-serif" font-size="15">Show this pass at the camp desk. QR token: ${text(booking.qrToken)}</text>
</svg>`;
}

export function downloadSvg(svg, filename) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
