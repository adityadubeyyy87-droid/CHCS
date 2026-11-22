#!/usr/bin/env node
/**
 * CHSC workspace launcher — zero extra dependencies.
 *
 *   npm run dev      → backend :4000 + Vite :5173 (hot reload)
 *   npm run live     → fresh build + backend :4000 (the "full version")
 *   npm run backend  → backend only
 *
 * Uses the npm CLI shipped with the running Node executable, so no root
 * `npm install` is required. Child processes are killed as a tree on Ctrl+C
 * (important on Windows, where npm spawns node as a grandchild).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const IS_WIN = process.platform === 'win32';
const args = new Set(process.argv.slice(2));

const C = { info: '\x1b[33m', api: '\x1b[32m', web: '\x1b[36m', build: '\x1b[35m', ok: '\x1b[1;32m', err: '\x1b[1;31m' };
const R = '\x1b[0m';
const tag = (n) => `${C[n] || ''}[${n}]${R}`;
const children = new Set();

// Prefer the npm-cli.js next to node.exe — avoids Windows .cmd/shell quirks.
const adjacentNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npm = fs.existsSync(adjacentNpmCli)
  ? { cmd: process.execPath, args: [adjacentNpmCli] }
  : { cmd: IS_WIN ? 'npm.cmd' : 'npm', args: [], shell: true };

function pipe(name, stream, target) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.length) target.write(`${tag(name)} ${line}\n`);
  });
  stream.on('end', () => {
    if (buffer.trim()) target.write(`${tag(name)} ${buffer}\n`);
  });
}

function run(name, cwd, command, commandArgs, env = {}, shell = false) {
  const child = spawn(command, commandArgs, {
    cwd,
    shell,
    detached: IS_WIN,
    env: { ...process.env, FORCE_COLOR: '1', ...env },
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  children.add(child);
  pipe(name, child.stdout, process.stdout);
  pipe(name, child.stderr, process.stderr);
  child.once('exit', (code, signal) => children.delete(child));
  child.once('error', (err) => process.stderr.write(`${tag(name)} ${C.err}spawn failed: ${err.message}${R}\n`));
  return child;
}

function npmRun(name, cwd, npmArgs, env = {}) {
  return run(name, cwd, npm.cmd, [...npm.args, ...npmArgs], env, Boolean(npm.shell));
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))));
    child.once('error', reject);
  });
}

function killAll() {
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    try {
      if (IS_WIN) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch { /* already gone */ }
  }
  children.clear();
}

process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('SIGTERM', () => { killAll(); process.exit(143); });
process.on('exit', killAll);

async function health(timeoutMs = 30000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch('http://127.0.0.1:4000/api/health', { signal: AbortSignal.timeout(1500) });
      if (res.ok) { last = await res.json(); break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}

(async () => {
  console.log(`${tag('info')} CHSC workspace: ${ROOT}`);

  if (args.has('--build') || args.has('--full')) {
    console.log(`${tag('build')} Building the production UI (fresh dist) ...`);
    try {
      await waitForExit(npmRun('build', FRONTEND, ['run', 'build']), 'frontend build');
      console.log(`${tag('build')} ${C.ok}UI built successfully.${R}`);
    } catch (err) {
      console.error(`${tag('build')} ${C.err}${err.message}${R}`);
      process.exit(1);
    }
  }

  if (!args.has('--frontend-only')) npmRun('api', BACKEND, ['start']);
  if (!args.has('--backend-only') && !args.has('--full')) npmRun('web', FRONTEND, ['run', 'dev']);

  console.log('');
  console.log(`${tag('info')} ${C.ok}Local links${R}`);
  if (!args.has('--backend-only') && !args.has('--full')) {
    console.log(`${tag('info')}   UI  (hot reload) → http://localhost:5173/`);
  }
  console.log(`${tag('info')}   Full build       → http://localhost:4000/`);
  console.log(`${tag('info')}   Health check     → http://localhost:4000/api/health`);
  console.log(`${tag('info')} Press Ctrl+C to stop all processes.`);
  console.log('');

  const status = await health();
  if (status) {
    const dbState = status.database === 'connected' ? `${C.ok}LIVE · MySQL${R}` : `${C.info}DATABASE DISCONNECTED${R}`;
    console.log(`${tag('api')} ${C.ok}ready${R} — database: ${dbState}`);
  } else {
    console.log(`${tag('api')} ${C.err}health check timed out — see [api] log above.${R}`);
  }
})();
