'use strict';

/**
 * Rate-limit configuration guard.
 *
 * The auth bucket must count only *failed* attempts and be keyed per
 * (IP + identifier). A plain per-IP counter locks out a whole lab/office behind
 * one NAT address after ten legitimate logins — which reads as "the product is
 * broken" during a live demo.
 */

const { createLimiters, authKey, bookingKey, ipKey, normaliseIp } = require('../../lib/limits');

describe('rate limiters', () => {
  const limiters = createLimiters({ disabled: false });

  it('exposes an api, auth, authIp and booking bucket', () => {
    expect(Object.keys(limiters).sort()).toEqual(['api', 'auth', 'authIp', 'booking']);
  });

  it('all buckets are middleware functions', () => {
    for (const bucket of Object.values(limiters)) {
      expect(typeof bucket).toBe('function');
    }
  });

  it('keys the auth bucket per IP and identifier, not per IP alone', () => {
    const a = authKey({ ip: '10.0.0.5', body: { identifier: 'alice@cmrit.edu' } });
    const b = authKey({ ip: '10.0.0.5', body: { identifier: 'bob@cmrit.edu' } });
    const c = authKey({ ip: '10.0.0.6', body: { identifier: 'alice@cmrit.edu' } });

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // Case/whitespace variants of one address must share a bucket.
    expect(authKey({ ip: '10.0.0.5', body: { identifier: ' ALICE@cmrit.edu ' } })).toBe(a);
  });

  it('falls back to email/phone identifiers used by the login schema', () => {
    const viaEmail = authKey({ ip: '10.0.0.5', body: { email: 'alice@cmrit.edu' } });
    const viaIdentifier = authKey({ ip: '10.0.0.5', body: { identifier: 'alice@cmrit.edu' } });
    expect(viaEmail).toBe(viaIdentifier);
  });

  it('keys the coarse auth backstop per IP only', () => {
    const a = ipKey({ ip: '10.0.0.5' });
    const b = ipKey({ ip: '10.0.0.5' });
    expect(a).toBe(b);
  });

  it('counts every attempt against the per-identifier bucket', () => {
    const key = authKey({ ip: '10.0.0.5', body: { identifier: 'alice@cmrit.edu' } });
    expect(key).toContain('alice@cmrit.edu');
  });

  it('keys the booking bucket per authenticated user, not per IP alone', () => {
    const req = { ip: '10.0.0.5', user: { id: 41 } };
    const a = bookingKey(req);
    const b = bookingKey({ ...req, user: { id: 42 } });
    const anon = bookingKey({ ip: '10.0.0.5' });

    expect(a).not.toBe(b);
    expect(a).not.toBe(anon);
    expect(bookingKey({ ...req, user: { id: 41 } })).toBe(a);
  });

  it('normalises IPv6-mapped addresses so the bucket cannot be side-stepped', () => {
    expect(normaliseIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(normaliseIp('10.0.0.5:443')).toBe('10.0.0.5');
    expect(normaliseIp('')).toBe('unknown');
  });
});
