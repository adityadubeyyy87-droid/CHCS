// maps.js — ticket navigation helpers.
//
// The backend is the source of truth and returns `mapsUrl`/`qrPayload` for
// every camp and booking. These fallbacks keep older cached payloads usable:
// the QR still opens real Google Maps directions, and the scanner still reads
// the ticket token from the URL fragment.

const MAPS_DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1';

function coordinates(booking) {
  const lat = Number(booking?.latitude);
  const lng = Number(booking?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return `${lat},${lng}`;
}

export function mapsUrlFor(booking = {}) {
  if (booking.mapsUrl) return booking.mapsUrl;
  const destination =
    coordinates(booking) ||
    [booking.venue, booking.address, booking.city].filter(Boolean).join(', ');
  if (!destination) return null;
  return `${MAPS_DIRECTIONS_BASE}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

export function qrPayloadFor(booking = {}) {
  if (booking.qrPayload) return booking.qrPayload;
  const mapsUrl = mapsUrlFor(booking);
  const token = String(booking.qrToken || '').trim();
  if (!mapsUrl) return token;
  if (!token) return mapsUrl;
  const separator = mapsUrl.includes('#') ? '&' : '#';
  return `${mapsUrl}${separator}chsc=${encodeURIComponent(token)}`;
}
