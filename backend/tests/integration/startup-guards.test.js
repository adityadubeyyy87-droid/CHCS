'use strict';

/**
 * Startup and deployment guardrails: mandatory JWT secret, local-only seeders,
 * and an idempotent production bootstrap that never seeds sample data.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('child_process');
const { pool, countRows } = require('../helpers/api');

const BACKEND = path.resolve(__dirname, '..', '..');
const NODE = process.execPath;

function run(script, args, envOverrides = {}, cwd = BACKEND) {
  return spawnSync(NODE, [script, ...args], {
    cwd,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
}

/** Fail if any generated secret was persisted anywhere in the backend tree. */
function secretsOnDisk(directory, secrets) {
  const skippedDirs = new Set(['node_modules', '.git', 'dist', 'coverage']);
  const skippedExtensions = /\.(png|jpe?g|gif|ico|pdf|zip|gz|woff2?|ttf|eot)$/i;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skippedDirs.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (secretsOnDisk(full, secrets)) return true;
    } else if (entry.isFile() && !skippedExtensions.test(entry.name)) {
      let content;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (secrets.some((secret) => content.includes(secret))) return true;
    }
  }
  return false;
}

describe('startup and deployment guards', () => {
  it('refuses to start the server without JWT_SECRET', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chsc-no-env-'));
    try {
      // dotenv resolves .env from cwd; this directory has none, so the mandatory
      // secret check is exercised instead of the checked-in local dev value.
      const result = run(path.join(BACKEND, 'server.js'), [], { JWT_SECRET: '' }, emptyDir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('JWT_SECRET is required');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('refuses the local seeder in production or against a hosted MySQL URL', () => {
    const prod = run('scripts/db.js', ['setup'], { NODE_ENV: 'production' });
    expect(prod.status).not.toBe(0);
    expect(prod.stderr + prod.stdout).toMatch(/Refusing to seed a hosted\/production database/);

    const hosted = run('scripts/db.js', ['setup'], {
      NODE_ENV: 'test',
      MYSQL_URL: 'mysql://root@127.0.0.1:3306/community_health_scheduler',
    });
    expect(hosted.status).not.toBe(0);
    expect(hosted.stderr + hosted.stdout).toMatch(/Refusing to seed/);

    const legacySeed = run('seed.js', [], { NODE_ENV: 'production' });
    expect(legacySeed.status).not.toBe(0);
    expect(legacySeed.stderr + legacySeed.stdout).toMatch(/Refusing to seed/);
  });

  it('bootstraps only four staff accounts, is idempotent and writes no secrets', async () => {
    const suffix = Date.now().toString(36);
    const passwords = {
      ADMIN: `Admin-Live-${suffix}-Pass`,
      ORGANIZER: `Organizer-Live-${suffix}-Pass`,
      DOCTOR: `Doctor-Live-${suffix}-Pass`,
      VOLUNTEER: `Volunteer-Live-${suffix}-Pass`,
    };
    const emails = {
      ADMIN: `admin.${suffix}@bootstrap.test`,
      ORGANIZER: `organizer.${suffix}@bootstrap.test`,
      DOCTOR: `doctor.${suffix}@bootstrap.test`,
      VOLUNTEER: `volunteer.${suffix}@bootstrap.test`,
    };
    const names = {
      ADMIN: 'Live Camp Administrator',
      ORGANIZER: 'Live Camp Organizer',
      DOCTOR: 'Live Camp Doctor',
      VOLUNTEER: 'Live Camp Volunteer',
    };
    const env = {
      NODE_ENV: 'test',
      PURGE_ON_BOOT: 'false',
      BOOTSTRAP_PHONE_SEED: '9555500000',
    };
    for (const role of Object.keys(emails)) {
      env[`BOOTSTRAP_${role}_EMAIL`] = emails[role];
      env[`BOOTSTRAP_${role}_NAME`] = names[role];
      env[`BOOTSTRAP_${role}_PASSWORD`] = passwords[role];
    }

    const before = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM camps) AS camps,
         (SELECT COUNT(*) FROM slots) AS slots,
         (SELECT COUNT(*) FROM bookings) AS bookings,
         (SELECT COUNT(*) FROM notifications_log) AS notifications`,
    );

    const first = run('scripts/bootstrap-production.js', [], env);
    expect(first.status).toBe(0);
    for (const value of Object.values(passwords)) {
      expect(first.stdout + first.stderr).not.toContain(value);
    }

    const placeholders = Object.values(emails).map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT role, email, name, is_active, password_hash FROM users
       WHERE email IN (${placeholders}) ORDER BY role`,
      Object.values(emails),
    );
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.role).sort()).toEqual([
      'ADMIN',
      'DOCTOR',
      'ORGANIZER',
      'VOLUNTEER',
    ]);
    for (const row of rows) {
      expect(Number(row.is_active)).toBe(1);
      expect(row.name).toBe(names[row.role]);
      expect(row.password_hash).not.toBe(passwords[row.role]);
      expect(await bcrypt.compare(passwords[row.role], row.password_hash)).toBe(true);
    }

    const after = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM camps) AS camps,
         (SELECT COUNT(*) FROM slots) AS slots,
         (SELECT COUNT(*) FROM bookings) AS bookings,
         (SELECT COUNT(*) FROM notifications_log) AS notifications`,
    );
    expect(Number(after[0][0].users)).toBe(Number(before[0][0].users) + 4);
    for (const key of ['camps', 'slots', 'bookings', 'notifications']) {
      expect(Number(after[0][0][key])).toBe(Number(before[0][0][key]));
    }

    const hashes = rows.map((row) => row.password_hash).sort();
    const second = run('scripts/bootstrap-production.js', [], env);
    expect(second.status).toBe(0);
    const [again] = await pool.query(
      `SELECT password_hash FROM users WHERE email IN (${placeholders}) ORDER BY role`,
      Object.values(emails),
    );
    expect(again.map((row) => row.password_hash).sort()).toEqual(hashes);
    expect(await countRows('SELECT COUNT(*) AS n FROM users')).toBe(Number(after[0][0].users));

    const source = fs.readFileSync(path.join(BACKEND, 'scripts', 'bootstrap-production.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"]fs['"]\)|writeFile|appendFile|createWriteStream/);
    expect(secretsOnDisk(BACKEND, Object.values(passwords))).toBe(false);

    const guarded = run('scripts/bootstrap-production.js', [], {
      ...env,
      NODE_ENV: 'production',
      PURGE_ON_BOOT: 'true',
    });
    expect(guarded.status).not.toBe(0);
    expect(guarded.stderr + guarded.stdout).toMatch(/Refusing PURGE_ON_BOOT in production/);
  });
});
