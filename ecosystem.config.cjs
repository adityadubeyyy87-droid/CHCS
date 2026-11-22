/**
 * PM2 process definition for a local production-like backend.
 *
 *   npm i -g pm2
 *   npm run build
 *   pm2 start ecosystem.config.cjs && pm2 save
 *   pm2 startup          # then run the admin command it prints (once)
 *
 * The backend serves frontend/dist on :4000 and restarts itself if it crashes.
 * Strict live: the API uses the MySQL instance configured in backend/.env and
 * creates no seed data. Bootstrap real staff accounts with
 * `node scripts/bootstrap-production.js` before serving users.
 *
 * No secrets are stored here. JWT_SECRET is taken from the shell environment
 * when supplied; otherwise backend/server.js reads backend/.env via dotenv.
 * Database credentials likewise come from backend/.env, never from this file.
 */
const path = require('path');

const root = __dirname;

// Pass through a shell-provided secret without ever hardcoding one. If absent,
// the backend's dotenv loader reads backend/.env at startup.
const env = {
  NODE_ENV: 'production',
  PORT: 4000,
  HOST: '127.0.0.1',
  ...(process.env.JWT_SECRET ? { JWT_SECRET: process.env.JWT_SECRET } : {}),
};

module.exports = {
  apps: [
    {
      name: 'chsc',
      script: path.join(root, 'backend', 'server.js'),
      cwd: path.join(root, 'backend'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 30,
      min_uptime: '10s',
      restart_delay: 2000,
      env,
      out_file: path.join(root, 'logs', 'chsc-out.log'),
      error_file: path.join(root, 'logs', 'chsc-error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
