#!/usr/bin/env node
// seed.js — installs database/schema.sql into MySQL and verifies the demo seed.
// Usage:  cd backend && npm run seed
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: false,
  });

  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*\r?\n/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);

  console.log(`Applying database/schema.sql (${statements.length} statements)…`);
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (error) {
      console.error('FAILED:', stmt.slice(0, 90).replace(/\n/g, ' '));
      throw error;
    }
  }

  const dbName = process.env.DB_NAME || 'community_health_scheduler';
  const [counts] = await conn.query(
    `SELECT
       (SELECT COUNT(*) FROM \`${dbName}\`.users) AS users,
       (SELECT COUNT(*) FROM \`${dbName}\`.camps) AS camps,
       (SELECT COUNT(*) FROM \`${dbName}\`.slots) AS slots,
       (SELECT COUNT(*) FROM \`${dbName}\`.bookings) AS bookings,
       (SELECT COUNT(*) FROM \`${dbName}\`.waitlist) AS waitlist,
       (SELECT COUNT(*) FROM \`${dbName}\`.notifications_log) AS notifications`,
  );
  await conn.end();

  console.log('Seed complete ✔');
  console.table ? console.table(counts[0]) : console.log(counts[0]);
  console.log('Demo logins → admin@cmrit.edu / Admin@123 · all others / Password@123');
  console.log('Or use POST /api/auth/demo-login { "role": "PATIENT" } etc.');
})().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
