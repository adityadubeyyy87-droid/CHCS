'use strict';

const { providerReadiness, evaluateCamp, isoDate } = require('../../lib/readiness');

function healthyCamp(overrides = {}) {
  return {
    camp: {
      id: 1,
      title: 'Healthy Camp',
      status: 'PUBLISHED',
      venue: 'Town Hall',
      address: '1 Main Road',
      city: 'Bengaluru',
      campDate: '2099-01-01',
      totalCapacity: 40,
    },
    slots: { count: 4, capacity: 40, future: 4 },
    staff: { doctors: 1, volunteers: 2, total: 3 },
    bookings: { active: 5, checkedIn: 0, stuckHolds: 0 },
    notifications: { sent: 5, simulated: 0, failed: 0 },
    oversubscribedSlots: 0,
    today: '2098-12-01',
    ...overrides,
  };
}

describe('providerReadiness', () => {
  it('reports sandbox and the exact missing variables when nothing is configured', () => {
    const result = providerReadiness({});
    expect(result.ready).toBe(false);
    expect(result.sandboxOnly).toBe(true);
    expect(result.email.live).toBe(false);
    expect(result.email.status).toBe('SANDBOX');
    expect(result.email.missing).toEqual(['SMTP_HOST', 'SMTP_USER']);
    expect(result.sms.live).toBe(false);
    expect(result.sms.missing).toEqual(['FAST2SMS_API_KEY']);
    expect(result.email.present.SMTP_PASS).toBe(false);
  });

  it('marks email live from host + user and never exposes a secret value', () => {
    const result = providerReadiness({
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'ops@example.com',
      SMTP_PASS: 'super-secret',
    });
    expect(result.email.live).toBe(true);
    expect(result.email.missing).toEqual([]);
    expect(result.email.present.SMTP_PASS).toBe(true);
    // Only presence is reported; the value itself must not appear anywhere.
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(JSON.stringify(result)).not.toContain('smtp.example.com');
  });

  it('requires a DLT sender and template for the transactional route', () => {
    const result = providerReadiness({ FAST2SMS_API_KEY: 'key', SMS_ROUTE: 't' });
    expect(result.sms.live).toBe(true);
    expect(result.sms.route).toBe('t');
    expect(result.sms.missing).toContain('SMS_SENDER_ID');
    expect(result.sms.missing).toContain('SMS_DLT_TEMPLATE_ID');
  });

  it('infers the quick route when only an API key exists', () => {
    const result = providerReadiness({ FAST2SMS_API_KEY: 'key' });
    expect(result.sms.route).toBe('q');
    expect(result.sms.missing).toEqual([]);
    expect(result.sms.note).toMatch(/quick route/i);
  });
});

describe('evaluateCamp', () => {
  it('scores a fully staffed, mapped camp as ready', () => {
    const result = evaluateCamp(healthyCamp());
    expect(result.score).toBe(100);
    expect(result.band).toBe('READY');
    expect(result.blockers).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.checks.every((item) => item.status === 'ok')).toBe(true);
  });

  it('blocks a camp with no address and no doctor', () => {
    const input = healthyCamp({
      camp: { ...healthyCamp().camp, venue: '', address: '' },
      staff: { doctors: 0, volunteers: 1, total: 1 },
    });
    const result = evaluateCamp(input);
    expect(result.score).toBe(55);
    expect(result.band).toBe('BLOCKED');
    expect(result.blockers).toBe(2);
    expect(result.checks.find((item) => item.id === 'location').status).toBe('bad');
    expect(result.checks.find((item) => item.id === 'doctor').status).toBe('bad');
  });

  it('penalises oversubscription, failed delivery and a past published date', () => {
    const result = evaluateCamp(healthyCamp({
      camp: { ...healthyCamp().camp, campDate: '2020-01-01' },
      oversubscribedSlots: 2,
      notifications: { sent: 1, simulated: 0, failed: 3 },
    }));
    expect(result.checks.find((item) => item.id === 'oversubscription').status).toBe('bad');
    expect(result.checks.find((item) => item.id === 'notifications').status).toBe('bad');
    expect(result.checks.find((item) => item.id === 'date').status).toBe('bad');
    expect(result.score).toBe(55);
  });

  it('flags sandbox-only delivery as a warning without blocking the camp', () => {
    const result = evaluateCamp(healthyCamp({
      notifications: { sent: 0, simulated: 5, failed: 0 },
    }));
    expect(result.score).toBe(95);
    expect(result.band).toBe('READY');
    expect(result.warnings).toBe(1);
    expect(result.checks.find((item) => item.id === 'notifications').status).toBe('warn');
  });

  it('warns when camp capacity and slot capacity disagree', () => {
    const result = evaluateCamp(healthyCamp({ slots: { count: 4, capacity: 36, future: 4 } }));
    const check = result.checks.find((item) => item.id === 'capacity-consistency');
    expect(check.status).toBe('warn');
    expect(result.score).toBe(95);
  });

  it('marks a camp with no future slots as blocked', () => {
    const result = evaluateCamp(healthyCamp({ slots: { count: 4, capacity: 40, future: 0 } }));
    expect(result.checks.find((item) => item.id === 'schedule').status).toBe('bad');
    expect(result.score).toBe(75);
  });
});

describe('isoDate', () => {
  it('formats a MySQL DATE without timezone drift', () => {
    expect(isoDate('2026-11-28T00:00:00.000Z')).toBe('2026-11-28');
    expect(isoDate(new Date(2026, 10, 28))).toBe('2026-11-28');
    expect(isoDate(null)).toBe('');
  });
});
