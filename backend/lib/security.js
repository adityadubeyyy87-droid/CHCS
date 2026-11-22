'use strict';

/**
 * Small, dependency-free hardening helpers shared by the Express app and its
 * tests. Kept deliberately pure so the security posture can be unit-tested
 * without booting a server or a database.
 */

const DEFAULT_MAX_SOCKET_PAYLOAD_BYTES = 64 * 1024;

/**
 * Trust proxy is opt-in. `false` (the default) means req.ip is the direct peer;
 * 'loopback', a number of hops, or an explicit list/subnet can be configured
 * with TRUST_PROXY when the API really does sit behind a known reverse proxy.
 */
function parseTrustProxy(raw) {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!value || value === 'false' || value === '0' || value === 'off') return false;
  if (value === 'true' || value === '1' || value === 'on') return true;
  if (value === 'loopback') return 'loopback';
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return entries.length ? entries : false;
}

/**
 * CSP for the built React app: external Google Fonts are the only third-party
 * asset origin; React inline style attributes need 'unsafe-inline' for styles.
 * Eval is only enabled outside production (Vite dev tooling), never in prod.
 */
function buildCsp({ isDev = false, allowedOrigins = [] } = {}) {
  const devOrigins = isDev
    ? allowedOrigins
        .flatMap((origin) => {
          try {
            const url = new URL(origin);
            const wsScheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
            return [origin, `${wsScheme}//${url.host}`];
          } catch {
            return [];
          }
        })
        .join(' ')
    : '';
  return [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ws: wss:${devOrigins ? ` ${devOrigins}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function redactRecipient(recipient = '') {
  const text = String(recipient || '');
  if (text.includes('@')) {
    const [local, domain] = text.split('@');
    return `${local.slice(0, 1)}***@${domain || 'invalid'}`;
  }
  return text ? `***${text.slice(-2)}` : 'hidden';
}

/** Strip direct identifiers from a notification before any socket broadcast. */
function redactNotificationForSocket(notification) {
  if (!notification || typeof notification !== 'object') return notification;
  return {
    id: notification.id,
    channel: notification.channel,
    type: notification.type,
    recipient: redactRecipient(notification.recipient),
    provider: notification.provider,
    status: notification.status,
    sentAt: notification.sentAt,
    simulated: Boolean(notification.simulated),
  };
}

/**
 * Last line of defence for socket emissions: oversized payloads are replaced by
 * an operator-safe notice so a bug can never flood every connected client.
 */
function limitSocketPayload(payload, maxBytes = DEFAULT_MAX_SOCKET_PAYLOAD_BYTES) {
  if (payload === undefined) return payload;
  try {
    if (Buffer.byteLength(JSON.stringify(payload)) <= maxBytes) return payload;
  } catch {
    /* circular structures are never emitted deliberately */
  }
  console.warn('[socket] payload exceeded size limit; emitting redacted notice');
  return { redacted: true, reason: 'PAYLOAD_TOO_LARGE' };
}

module.exports = {
  DEFAULT_MAX_SOCKET_PAYLOAD_BYTES,
  parseTrustProxy,
  buildCsp,
  redactRecipient,
  redactNotificationForSocket,
  limitSocketPayload,
};
