#!/usr/bin/env node
'use strict';

/**
 * Local database helper.
 *
 *   node scripts/db.js start     start the portable MySQL instance (if present)
 *   node scripts/db.js setup     drop + recreate the schema and seed data (local only)
 *   node scripts/db.js setup-production  idempotent hosted schema bootstrap
 *   node scripts/db.js migrate   apply database/migrations/*.sql in order
 *
 * The portable MySQL lives in %LOCALAPPDATA%\chsc-mysql (or MYSQL_HOME).
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const { dbConnectionOptions } = require('../lib/db-config');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const MYSQL_HOME =
  process.env.MYSQL_HOME ||
  path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'chsc-mysql');
const MYSQL_VERSION = process.env.MYSQL_VERSION || 'mysql-8.0.44-winx64';

function connectionOptions(extra = {}) {
  return dbConnectionOptions({ multipleStatements: true, ...extra });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function start() {
  const port = Number(process.env.DB_PORT || 3306);
  if (await portOpen(port)) {
    console.log(`MySQL already listening on ${port}.`);
    return;
  }

  const base = path.join(MYSQL_HOME, MYSQL_VERSION);
  const mysqld = path.join(base, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');
  if (!fs.existsSync(mysqld)) {
    console.error(
      `mysqld not found at ${mysqld}.\n` +
        'Install MySQL 8 (portable zip) there, or set MYSQL_HOME/MYSQL_VERSION.',
    );
    process.exitCode = 1;
    return;
  }

  const datadir = path.join(MYSQL_HOME, 'data');
  const child = spawn(
    mysqld,
    [
      `--basedir=${base}`,
      `--datadir=${datadir}`,
      `--port=${port}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=0',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  for (let i = 0; i < 40; i += 1) {
    if (await portOpen(port)) {
      console.log(`MySQL started on 127.0.0.1:${port}.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error('MySQL did not become ready in 20s. Check the datadir.');
  process.exitCode = 1;
}

async function setup() {
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection(connectionOptions());
  try {
    await conn.query(schema);
    const [rows] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM camps) AS camps,
         (SELECT COUNT(*) FROM slots) AS slots,
         (SELECT COUNT(*) FROM bookings) AS bookings,
         (SELECT COUNT(*) FROM reminders) AS reminders`,
    );
    console.log('Schema + seed loaded:', rows[0]);
  } finally {
    await conn.end();
  }
}

async function applyMigrations(conn, dbName) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(dbName || ''))) {
    throw new Error(`Unsafe database name: ${dbName}`);
  }
  const dir = path.join(ROOT, 'database', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    // Migration 001 carries a `USE community_health_scheduler;` line for mysql
    // CLI users, but hosted installs (Railway MYSQL_URL) name the database
    // differently. Strip all standalone USE statements so the connection stays
    // on the database selected below instead of switching to a non-existent one.
    const sql = fs
      .readFileSync(path.join(dir, file), 'utf8')
      .replace(/^\s*USE\s+[^;]+;\s*$/gim, '');
    await conn.query(`USE \`${dbName}\``);
    await conn.query(sql);
    console.log(`applied ${file}`);
  }
}

async function setupProduction() {
  const options = connectionOptions();
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema-production.sql'), 'utf8');
  const conn = await mysql.createConnection(options);
  try {
    await conn.query(schema);
    // CREATE TABLE IF NOT EXISTS cannot upgrade an existing table. Always run the
    // idempotent migrations so Railway installations gain hold/expiry columns
    // on the next deploy without losing live data.
    await applyMigrations(conn, options.database);
    const [rows] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM camps) AS camps,
         (SELECT COUNT(*) FROM slots) AS slots,
         (SELECT COUNT(*) FROM bookings) AS bookings,
         (SELECT COUNT(*) FROM reminders) AS reminders`,
    );
    console.log('Production schema verified:', rows[0]);
  } finally {
    await conn.end();
  }
}

async function migrate() {
  const options = connectionOptions();
  const conn = await mysql.createConnection(options);
  try {
    await applyMigrations(conn, options.database);
  } finally {
    await conn.end();
  }
}

const command = process.argv[2];
const commands = { start, setup, 'setup-production': setupProduction, migrate };

if (!commands[command]) {
  console.error(`Usage: node scripts/db.js <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}

commands[command]().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
