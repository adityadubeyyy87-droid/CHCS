'use strict';

const {
  parseTrustProxy,
  computeDemoAvailability,
  buildCsp,
  redactRecipient,
  redactNotificationForSocket,
  limitSocketPayload,
} = require('../../lib/security');

describe('security helpers', () => {
  it('trust proxy is opt-in and parses explicit values', () => {
    expect(parseTrustProxy()).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('10.0.0.1, 10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('production demo guardrail needs an explicit opt-in — loopback origins are not enough', () => {
    const shippedDefaults = {
      nodeEnv: 'production',
      demoMode: true,
      allowLocalDemo: undefined,
      host: undefined,
      allowedOrigins: ['http://localhost:5173', 'http://localhost:4000'],
    };
    expect(computeDemoAvailability(shippedDefaults).endpointsEnabled).toBe(false);

    expect(
      computeDemoAvailability({ ...shippedDefaults, allowLocalDemo: 'true' }).endpointsEnabled,
    ).toBe(true);
    expect(computeDemoAvailability({ ...shippedDefaults, host: '127.0.0.1' }).endpointsEnabled).toBe(true);
    expect(
      computeDemoAvailability({
        ...shippedDefaults,
        host: '0.0.0.0',
        allowedOrigins: ['https://chsc.example.org'],
      }).endpointsEnabled,
    ).toBe(false);
  });

  it('demo endpoints stay enabled outside production', () => {
    expect(
      computeDemoAvailability({
        nodeEnv: 'test',
        demoMode: true,
        host: '0.0.0.0',
        allowedOrigins: ['https://chsc.example.org'],
      }).endpointsEnabled,
    ).toBe(true);
  });

  it('CSP blocks frames/eval in production and allows Vite dev websockets locally', () => {
    const prod = buildCsp({ isDev: false });
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).not.toContain('unsafe-eval');
    const dev = buildCsp({ isDev: true, allowedOrigins: ['http://localhost:5173'] });
    expect(dev).toContain('ws://localhost:5173');
    expect(dev).toContain('unsafe-eval');
  });

  it('redacts recipients and never forwards message bodies over sockets', () => {
    expect(redactRecipient('patient@example.org')).toBe('p***@example.org');
    expect(redactRecipient('9876543210')).toBe('***10');
    const safe = redactNotificationForSocket({
      id: 7,
      bookingId: 9,
      userId: 3,
      channel: 'SMS',
      type: 'REMINDER_2H',
      recipient: '9876543210',
      message: 'SECRET PATIENT NAME',
      status: 'SIMULATED',
    });
    expect(safe.recipient).toBe('***10');
    expect(safe).not.toHaveProperty('message');
    expect(safe).not.toHaveProperty('bookingId');
    expect(safe).not.toHaveProperty('userId');
  });

  it('replaces oversized socket payloads with a bounded notice', () => {
    const small = { ok: true };
    expect(limitSocketPayload(small, 1024)).toBe(small);
    const large = limitSocketPayload({ blob: 'x'.repeat(5000) }, 1024);
    expect(large).toEqual({ redacted: true, reason: 'PAYLOAD_TOO_LARGE' });
  });
});
