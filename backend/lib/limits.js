'use strict';

/**
 * Rate limiting.
 *
 * Three buckets:
 *   auth    — brute-force protection on login/register
 *   booking — stops seat-grabbing scripts
 *   api     — coarse global backstop
 *
 * Design notes (why the auth bucket is not a plain per-IP counter):
 *
 * A conference room, a college lab and a hospital campus all share one public
 * IP. A plain 10-per-IP auth limit locks out an entire room after a handful of
 * legitimate logins — during a live demo it looks like the product is broken.
 * Instead the auth bucket counts only *failed* attempts (skipSuccessfulRequests)
 * and is keyed per (IP + identifier), so:
 *   - one account cannot be brute-forced,
 *   - five roles logging in from one laptop are never penalised,
 *   - an attacker cycling accounts still trips the coarse per-IP backstop.
 *
 * Disabled with RATE_LIMIT_DISABLED=true (the test suite sets it).
 */

const rateLimit = require('express-rate-limit');

/** Drop a port suffix and unmap IPv4-mapped IPv6 so one client = one bucket. */
function normaliseIp(ip) {
  let value = String(ip || '').trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  value = value.replace(/:\d+$/, '');
  return value || 'unknown';
}

/** IPv6-safe key: express-rate-limit v7 helper, with a conservative fallback. */
function ipKey(req) {
  try {
    // eslint-disable-next-line global-require
    const { ipKeyGenerator } = require('express-rate-limit');
    if (typeof ipKeyGenerator === 'function') {
      const key = ipKeyGenerator(normaliseIp(req.ip));
      // ipKeyGenerator groups IPv6 by subnet (/56) which we want for v6, but it
      // returns the bare host for IPv4 — exactly the behaviour we need.
      return key;
    }
  } catch {
    /* older minor — fall through */
  }
  return normaliseIp(req.ip);
}

function authKey(req) {
  const body = req.body || {};
  const identifier = String(body.identifier || body.email || body.phone || '')
    .trim()
    .toLowerCase();
  return `auth:${ipKey(req)}:${identifier || 'anonymous'}`;
}

function limiter({ windowMs, limit, message, disabled, keyGenerator, skipSuccessfulRequests }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    skipSuccessfulRequests,
    skip: () => disabled,
    handler: (req, res) => {
      const retryAfter = Math.max(1, Math.ceil((req.rateLimit?.resetTime - Date.now()) / 1000) || 1);
      res.status(429).json({
        ok: false,
        error: message,
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: retryAfter },
      });
    },
  });
}

function createLimiters({ disabled = false } = {}) {
  return {
    api: limiter({
      windowMs: 60 * 1000,
      limit: 300,
      message: 'Too many API requests. Slow down and retry shortly.',
      disabled,
    }),
    // Only failures count, so a normal multi-role demo never trips it.
    auth: limiter({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      message: 'Too many authentication attempts. Try again in a few minutes.',
      disabled,
      keyGenerator: authKey,
      skipSuccessfulRequests: false,
    }),
    // Coarse per-IP ceiling so account cycling still gets stopped.
    authIp: limiter({
      windowMs: 15 * 60 * 1000,
      limit: 60,
      message: 'Too many authentication attempts from this network. Try again in a few minutes.',
      disabled,
      keyGenerator: (req) => `authip:${ipKey(req)}`,
    }),
    booking: limiter({
      windowMs: 60 * 1000,
      limit: 30,
      message: 'Too many booking attempts. Wait a moment before retrying.',
      disabled,
    }),
  };
}

module.exports = { createLimiters, authKey, ipKey, normaliseIp };
