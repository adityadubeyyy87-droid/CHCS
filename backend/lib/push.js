'use strict';

/**
 * Browser push subscription storage helpers.
 *
 * Web Push is the genuinely free delivery channel: the browser vendor runs the
 * push service and the server only stores the subscription issued by the
 * browser. No patient phone number is ever sent to a paid SMS gateway for this
 * channel, and no message body or endpoint is logged.
 */

const PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'wns.windows.com',
];

/** Accept only real browser push endpoints; never turn a subscription row into an SSRF target. */
function validPushEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (!endpoint || endpoint.length > 2048) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_ENDPOINT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Validate a browser PushSubscription JSON object without mutating it. */
function parsePushSubscription(body = {}) {
  const endpoint = String(body?.endpoint || '').trim();
  const p256dh = String(body?.keys?.p256dh || '').trim();
  const auth = String(body?.keys?.auth || '').trim();
  const keyPattern = /^[A-Za-z0-9_-]{10,200}$/;

  if (!validPushEndpoint(endpoint)) {
    const error = new Error('endpoint must be a supported HTTPS browser push service URL.');
    error.code = 'INVALID_ENDPOINT';
    throw error;
  }
  if (!keyPattern.test(p256dh) || !keyPattern.test(auth)) {
    const error = new Error('keys.p256dh and keys.auth must be valid base64url values.');
    error.code = 'INVALID_KEYS';
    throw error;
  }
  return { endpoint, p256dh, auth };
}

async function loadPushSubscriptions(pool, userId) {
  if (!userId) return [];
  const [rows] = await pool.query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE user_id = ? ORDER BY id ASC`,
    [userId],
  );
  return rows.map((row) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }));
}

async function prunePushSubscriptions(pool, endpoints = []) {
  const list = [...new Set(endpoints.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!list.length) return 0;
  const [result] = await pool.query('DELETE FROM push_subscriptions WHERE endpoint IN (?)', [list]);
  return Number(result.affectedRows || 0);
}

/** Operator-safe device summary: host only, never the full endpoint or keys. */
function publicPushDevice(row) {
  let host = 'push service';
  try {
    host = new URL(row.endpoint).hostname;
  } catch {
    /* keep the safe fallback */
  }
  return {
    id: Number(row.id),
    endpointHost: host,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  PUSH_ENDPOINT_HOSTS,
  validPushEndpoint,
  parsePushSubscription,
  loadPushSubscriptions,
  prunePushSubscriptions,
  publicPushDevice,
};
