/**
 * PM2 process definition — "alive forever" on this machine.
 *
 *   npm i -g pm2
 *   npm run pm2:start
 *   pm2 startup          # then run the admin command it prints (once)
 *
 * The backend serves frontend/dist on :4000 and restarts itself if it crashes.
 * For real MySQL traffic set DEMO_MODE=false in backend/.env first.
 */
const path = require('path');

const root = __dirname;

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
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        // This PM2 process is a local demo bound to this machine only. The
        // production guardrail requires an explicit loopback HOST or
        // ALLOW_LOCAL_DEMO=true; never copy this binding to a public host.
        HOST: '127.0.0.1',
        // DEMO_MODE: 'false', // uncomment in production once MySQL is reachable
      },
      out_file: path.join(root, 'logs', 'chsc-out.log'),
      error_file: path.join(root, 'logs', 'chsc-error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
