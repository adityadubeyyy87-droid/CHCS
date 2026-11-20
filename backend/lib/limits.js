'use strict';

/**
 * Rate limiting.
 *
 * Three buckets:
 *   auth    — brute-force protection on login/register
 *   booking — stops seat-grabbing scripts
 *   api     — coarse global backstop
 *
 * Disabled with RATE_LIMIT_DISABLED=true (the test suite sets it).
 */

const rateLimit = require('express-rate-limit');

function limiter({ windowMs, limit, message, disabled }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
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
    auth: limiter({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      message: 'Too many authentication attempts. Try again in a few minutes.',
      disabled,
    }),
    booking: limiter({
      windowMs: 60 * 1000,
      limit: 30,
      message: 'Too many booking attempts. Wait a moment before retrying.',
      disabled,
    }),
  };
}

module.exports = { createLimiters };
