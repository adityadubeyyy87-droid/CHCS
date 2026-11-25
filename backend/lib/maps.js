'use strict';

/**
 * Google Maps navigation helpers.
 *
 * A ticket QR is a real Google Maps directions URL. The secure ticket token is
 * appended as a URL fragment (`#chsc=...`), which Google Maps ignores but the
 * CHSC scanner can read. That keeps one scannable code useful for both jobs:
 * a phone camera opens navigation, while camp staff scan the same code to check
 * the patient in. When exact coordinates are unavailable the destination falls
 * back to the encoded venue + street address, which Google resolves reliably.
 */

const MAPS_DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1';

function coordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function validCoordinates(latitude, longitude) {
  const lat = coordinate(latitude);
  const lng = coordinate(longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // 0,0 is the Atlantic Ocean and is never a Bengaluru camp; treat it as unset.
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

/** Human-readable destination used when coordinates are not supplied. */
function addressDestination({ venue, address, city } = {}) {
  const parts = [venue, address, city]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  // Avoid repeating the city when the address already ends with it.
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.join(', ');
}

/**
 * Official Google Maps directions URL.
 * @returns {string|null} null when there is not enough information to navigate.
 */
function buildMapsUrl(camp = {}) {
  const coordinates = validCoordinates(camp.latitude, camp.longitude);
  const destination = coordinates
    ? `${coordinates.latitude},${coordinates.longitude}`
    : addressDestination(camp);
  if (!destination) return null;
  return `${MAPS_DIRECTIONS_BASE}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/**
 * QR payload: the Maps URL plus the opaque ticket token in the fragment.
 * The token never reaches Google because fragments are not sent to servers.
 */
function buildTicketQrPayload(mapsUrl, ticketToken) {
  const token = String(ticketToken || '').trim();
  if (!mapsUrl) return token;
  if (!token) return mapsUrl;
  const separator = mapsUrl.includes('#') ? '&' : '#';
  return `${mapsUrl}${separator}chsc=${encodeURIComponent(token)}`;
}

/**
 * Accept a raw ticket token, a Maps QR payload, or any URL carrying `chsc` in
 * its query or fragment. Returns the ticket token for the database lookup.
 */
function extractTicketToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get('chsc') || url.searchParams.get('ticket');
      if (fromQuery) return fromQuery.trim();

      const fragment = url.hash.replace(/^#/, '');
      if (fragment) {
        const params = new URLSearchParams(fragment);
        const fromHash = params.get('chsc') || params.get('ticket');
        if (fromHash) return fromHash.trim();
        // Also tolerate `#CHSC-BLR-...` without an `=`.
        const bare = fragment.match(/CHSC-[A-Z0-9-]{4,}/i);
        if (bare) return bare[0].toUpperCase();
      }
    } catch {
      /* fall through to a token-shaped match */
    }
    const match = raw.match(/CHSC-[A-Z0-9-]{4,}/i);
    if (match) return match[0].toUpperCase();
    return raw;
  }

  return raw;
}

/**
 * Public base URL used for short navigation links in SMS. Prefers an explicit
 * setting, then the host platform's public domain, then the frontend origin.
 */
function publicBaseUrl(env = process.env) {
  const explicit =
    env.PUBLIC_BASE_URL ||
    env.APP_BASE_URL ||
    env.BACKEND_PUBLIC_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    env.FRONTEND_ORIGIN?.split(',')[0] ||
    '';
  const trimmed = String(explicit).trim().replace(/\/+$/, '');
  if (trimmed) return trimmed;
  return `http://localhost:${Number(env.PORT || 4000)}`;
}

/** Short link that redirects to the camp's Google Maps destination. */
function buildShortNavigationUrl(baseUrl, ticketToken) {
  const token = String(ticketToken || '').trim();
  if (!token) return null;
  return `${String(baseUrl || '').replace(/\/+$/, '')}/n/${encodeURIComponent(token)}`;
}

module.exports = {
  MAPS_DIRECTIONS_BASE,
  buildMapsUrl,
  buildTicketQrPayload,
  extractTicketToken,
  addressDestination,
  validCoordinates,
  publicBaseUrl,
  buildShortNavigationUrl,
};
