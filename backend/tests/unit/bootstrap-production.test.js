'use strict';

const {
  ROLES,
  MIN_PASSWORD_LENGTH,
  collectAccounts,
} = require('../../scripts/bootstrap-production');

function validEnv(overrides = {}) {
  return {
    BOOTSTRAP_PHONE_SEED: '9000000000',
    BOOTSTRAP_ADMIN_EMAIL: 'Admin@Hospital.org',
    BOOTSTRAP_ADMIN_NAME: '  Camp Administrator  ',
    BOOTSTRAP_ADMIN_PASSWORD: 'Admin-Live-Pass-2026',
    BOOTSTRAP_ORGANIZER_EMAIL: 'organizer@hospital.org',
    BOOTSTRAP_ORGANIZER_NAME: 'Camp Organizer',
    BOOTSTRAP_ORGANIZER_PASSWORD: 'Organizer-Live-Pass-2026',
    BOOTSTRAP_DOCTOR_EMAIL: 'doctor@hospital.org',
    BOOTSTRAP_DOCTOR_NAME: 'Camp Doctor',
    BOOTSTRAP_DOCTOR_PASSWORD: 'Doctor-Live-Pass-2026',
    BOOTSTRAP_VOLUNTEER_EMAIL: 'volunteer@hospital.org',
    BOOTSTRAP_VOLUNTEER_NAME: 'Camp Volunteer',
    BOOTSTRAP_VOLUNTEER_PASSWORD: 'Volunteer-Live-Pass-2026',
    ...overrides,
  };
}

describe('production bootstrap env validation', () => {
  it('requires exactly the four operational roles and uses each *_NAME value', () => {
    const accounts = collectAccounts(validEnv());
    expect(accounts.map((a) => a.role)).toEqual(ROLES);
    expect(accounts.map((a) => a.name)).toEqual([
      'Camp Administrator',
      'Camp Organizer',
      'Camp Doctor',
      'Camp Volunteer',
    ]);
    expect(accounts[0].email).toBe('admin@hospital.org');
    expect(accounts.map((a) => a.phone)).toEqual([
      '9000000000',
      '9000000001',
      '9000000002',
      '9000000003',
    ]);
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('honours explicit per-role phone overrides', () => {
    const accounts = collectAccounts(validEnv({ BOOTSTRAP_DOCTOR_PHONE: '9876543210' }));
    expect(accounts.find((a) => a.role === 'DOCTOR').phone).toBe('9876543210');
  });

  it('rejects a missing name for any role and names the offending variable', () => {
    expect(() => collectAccounts(validEnv({ BOOTSTRAP_DOCTOR_NAME: '   ' }))).toThrow(
      /BOOTSTRAP_DOCTOR_NAME/,
    );
    expect(() => collectAccounts(validEnv({ BOOTSTRAP_ADMIN_NAME: undefined }))).toThrow(
      /BOOTSTRAP_ADMIN_NAME/,
    );
  });

  it('rejects weak credentials, malformed emails and bad phone seeds', () => {
    expect(() => collectAccounts(validEnv({ BOOTSTRAP_ADMIN_PASSWORD: 'short' }))).toThrow(
      /at least 12 characters/,
    );
    expect(() => collectAccounts(validEnv({ BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' }))).toThrow(
      /valid email address/,
    );
    expect(() => collectAccounts(validEnv({ BOOTSTRAP_PHONE_SEED: '123' }))).toThrow(
      /exactly 10 digits/,
    );
    expect(() => collectAccounts(validEnv({ BOOTSTRAP_VOLUNTEER_PHONE: '12345' }))).toThrow(
      /BOOTSTRAP_VOLUNTEER_PHONE must be exactly 10 digits/,
    );
  });

  it('rejects duplicate emails and phones', () => {
    expect(() =>
      collectAccounts(validEnv({ BOOTSTRAP_DOCTOR_EMAIL: 'ADMIN@HOSPITAL.ORG' })),
    ).toThrow(/unique/);
    expect(() =>
      collectAccounts(validEnv({ BOOTSTRAP_DOCTOR_PHONE: '9000000000' })),
    ).toThrow(/unique/);
  });

  it('never includes a password value in validation errors', () => {
    const env = validEnv({ BOOTSTRAP_ORGANIZER_EMAIL: 'organizer@hospital.org' });
    try {
      collectAccounts({ ...env, BOOTSTRAP_VOLUNTEER_EMAIL: env.BOOTSTRAP_ADMIN_EMAIL });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error.message).toMatch(/unique/);
      for (const [key, value] of Object.entries(env)) {
        if (key.endsWith('_PASSWORD')) expect(error.message).not.toContain(value);
      }
    }
  });
});
