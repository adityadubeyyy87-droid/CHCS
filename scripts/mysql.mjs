#!/usr/bin/env node
/**
 * Local MySQL helper for CHSC (Windows-friendly, zero dependencies).
 *   npm run mysql:start   → start installed MySQL 8 (initialises a portable
 *                           data directory on first run) in the background
 *   npm run mysql:stop    → graceful shutdown, with a forced fallback
 *
 * The UI works without MySQL (DEMO mode). This only exists so LIVE · MySQL is
 * one command away when you want the real database.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTABLE_DATA = path.join(ROOT, 'backend', '.mysql-data');

const MYSQLD_CANDIDATES = [
  'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqld.exe',
  'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe',
  'C:\\Program Files\\MySQL\\bin\\mysqld.exe',
  'mysqld',
];
const INI_CANDIDATES = [
  'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini',
  'C:\\ProgramData\\MySQL\\MySQL Server 8.4\\my.ini',
];

const first = (list) => list.find((p) => p === 'mysqld' || fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port = 3306, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function cleanOrphanUndo() {
  // MySQL 8.4 on Windows can leave an orphan undo_002 (with no undo_001) after
  // an unclean shutdown. InnoDB then refuses to boot. Safe to clear because the
  // portable data directory is only ever used for this local demo database.
  const undo2 = path.join(PORTABLE_DATA, 'undo_002');
  if (!fs.existsSync(undo2)) return false;
  fs.rmSync(undo2, { force: true });
  fs.rmSync(path.join(PORTABLE_DATA, 'undo_2_trunc.log'), { force: true });
  console.log('Cleared a stale InnoDB undo file and retrying.');
  return true;
}

function initializePortable(mysqld) {
  fs.mkdirSync(PORTABLE_DATA, { recursive: true });
  console.log('Initialising a portable MySQL data directory (one time) ...');
  const result = spawnSync(mysqld, [
    '--initialize-insecure',
    `--basedir=${path.dirname(mysqld)}`,
    `--datadir=${PORTABLE_DATA}`,
    `--innodb_undo_directory=${PORTABLE_DATA}`,
    '--console',
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('MySQL initialisation failed');
  cleanOrphanUndo();
}

async function boot(mysqld, args, timeoutMs = 16000) {
  const child = spawn(mysqld, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => {}); // reported by the port probe below
  child.unref();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(500);
    if (await portOpen()) return true;
  }
  return false;
}

async function start() {
  if (await portOpen()) { console.log('MySQL is already listening on :3306.'); return; }
  const mysqld = first(MYSQLD_CANDIDATES);
  if (!mysqld) { console.error('mysqld.exe not found. Install MySQL 8 or stay in DEMO mode.'); process.exit(1); }

  if (mysqld !== 'mysqld' && !fs.existsSync(PORTABLE_DATA)) initializePortable(mysqld);
  const portable = mysqld !== 'mysqld' && fs.existsSync(PORTABLE_DATA);
  const ini = portable ? null : first(INI_CANDIDATES);
  const args = portable
    ? [`--datadir=${PORTABLE_DATA}`, `--innodb_undo_directory=${PORTABLE_DATA}`, `--basedir=${path.dirname(mysqld)}`, '--port=3306', '--console']
    : ini ? [`--defaults-file=${ini}`, '--console'] : ['--console'];

  console.log(`Starting ${mysqld}${portable ? ' with the portable data directory' : ini ? ` with ${ini}` : ''} ...`);
  if (await boot(mysqld, args)) { console.log('MySQL is up on :3306.'); return; }

  if (portable && cleanOrphanUndo() && await boot(mysqld, args)) {
    console.log('MySQL is up on :3306.');
    return;
  }
  console.error('MySQL did not start. Run the mysqld command printed by the backend log manually to see why.');
  process.exit(1);
}

async function stop() {
  const mysqld = first(MYSQLD_CANDIDATES);
  const admin = mysqld && mysqld !== 'mysqld'
    ? path.join(path.dirname(mysqld), process.platform === 'win32' ? 'mysqladmin.exe' : 'mysqladmin')
    : 'mysqladmin';
  if (fs.existsSync(admin) || admin === 'mysqladmin') {
    spawnSync(admin, ['-u', 'root', '--port=3306', 'shutdown'], { stdio: 'ignore' });
  }
  for (let i = 0; i < 20 && await portOpen(); i++) await sleep(300);

  if (process.platform === 'win32' && await portOpen()) {
    const netstat = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of netstat.stdout.split(/\r?\n/)) {
      if (/127\.0\.0\.1:3306\s+.*LISTENING/i.test(line) || /0\.0\.0\.0:3306\s+.*LISTENING/i.test(line)) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') pids.add(pid);
      }
    }
    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
      console.log(`Stopped MySQL process ${pid}.`);
    }
  }
  console.log(await portOpen() ? 'MySQL is still listening on :3306.' : 'MySQL stopped.');
}

const action = process.argv[2];
if (action === 'start') start();
else if (action === 'stop') await stop();
else { console.log('Usage: node scripts/mysql.mjs <start|stop>'); process.exit(1); }
