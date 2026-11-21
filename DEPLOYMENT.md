# CHSC Deployment Guide

## Overview

CHSC is a full-stack application with three deployment components:
1. **Frontend** (React + Vite) — static build served by the backend or a CDN
2. **Backend** (Node.js + Express) — API server with Socket.io
3. **Database** (MySQL 8) — relational data store

The application supports two modes:
- **Mode A (Live):** Backend connected to MySQL — real transactions, Socket.io
- **Mode B (Demo):** Backend offline — local in-memory engine, clearly labeled `SIMULATED`

---

## 1. Prerequisites

- Node.js >= 18
- MySQL 8.0+ (for Mode A)
- A domain with HTTPS (for production)

---

## 2. Database Setup

### Local development
```bash
mysql -u root -p < database/schema.sql
```

### Production (hosted MySQL)
1. Provision a MySQL 8 database (e.g., AWS RDS, Azure MySQL, DigitalOcean Managed DB)
2. Note the host, port, user, password, and database name
3. Run the schema against the production database:
```bash
mysql -h <PROD_HOST> -P <PORT> -u <USER> -p<PASSWORD> < database/schema.sql
```

---

## 3. Backend Deployment

### Install dependencies
```bash
cd backend
npm install --production
```

### Configure environment
Copy `.env.example` to `.env` and set production values:

```bash
PORT=4000
NODE_ENV=production
DEMO_MODE=false
FRONTEND_ORIGIN=https://yourdomain.com

# MySQL (production hosted instance)
DB_HOST=<PROD_HOST>
DB_PORT=3306
DB_USER=<PROD_USER>
DB_PASSWORD=<PROD_PASSWORD>
DB_NAME=community_health_scheduler

# JWT — MUST change for production (generate a strong random secret)
JWT_SECRET=<generate-a-32-byte-random-secret>
JWT_EXPIRES=12h

# Reminders
REMINDER_MAX_ATTEMPTS=5
REMINDER_CRON=* * * * *

# Capacity Advisor
ALPHA_MAX=0.25

# Optional real email gateway (leave blank for sandbox)
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-user>
SMTP_PASS=<smtp-pass>
MAIL_FROM=CHSC <no-reply@yourdomain.com>

# Optional real SMS gateway
SMS_PROVIDER=Fast2SMS
FAST2SMS_API_KEY=<your-api-key>
```

### Security notes
- **Never commit `.env`** to version control
- **Generate a strong `JWT_SECRET`** for production (use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- **Set `NODE_ENV=production`** to disable verbose error output
- **Set `DEMO_MODE=false`** in production to disable demo login. If you intentionally run a
  production-env demo, you must explicitly set `ALLOW_LOCAL_DEMO=true` or bind `HOST` to
  `127.0.0.1`/`localhost`/`::1`; a loopback-only `FRONTEND_ORIGIN` is the shipped default and is
  **not** an opt-in. Otherwise `/api/demo/*` and demo admin login stay closed.
- **Configure CORS** `FRONTEND_ORIGIN` to your actual production domain(s)
- **Leave `TRUST_PROXY=false`** unless the API is behind a known reverse proxy
- **Keep `ALLOW_DESTRUCTIVE_SLOT_REBUILD=false`**; normal slot regeneration preserves bookings

### Start the backend
```bash
cd backend
npm start        # or: node server.js
```

The backend listens on port 4000 and:
- Serves the API at `/api/*`
- Serves Socket.io at `/socket.io/*`
- Serves the built frontend from `frontend/dist/` (when present)
- Exposes health check at `GET /api/health`

---

## 4. Frontend Deployment

### Build
```bash
cd frontend
npm install
npm run build    # → frontend/dist/
```

### Option A: Served by backend (recommended)
Copy `frontend/dist/` into the backend or ensure the backend can find it at `../frontend/dist/`. The backend's `server.js` serves `frontend/dist/` automatically at runtime (see lines 2630-2637).

### Option B: Standalone static hosting
Deploy `frontend/dist/` to any static host (Vercel, Netlify, S3+CloudFront, GitHub Pages). Set `VITE_API_BASE` to your backend URL:
```bash
VITE_API_BASE=https://api.yourdomain.com
```

The frontend will call the backend API directly and fall back to Mode B (demo engine) if unreachable.

---

## 5. Production Build & Deploy (One Command)

```bash
# 1. Build the frontend
cd frontend && npm run build

# 2. Install backend deps
cd ../backend && npm install --production

# 3. Configure .env (copy from .env.example, set production values)
cp .env.example .env
# edit .env with production DB host, JWT_SECRET, CORS origin

# 4. Run schema against production DB
mysql -h <HOST> -u <USER> -p < database/schema.sql

# 5. Start backend
npm start
```

---

## 6. Health Check

```bash
curl https://api.yourdomain.com/api/health
```

Expected response:
```json
{
  "ok": true,
  "service": "CHSC API",
  "demoMode": false,
  "database": "connected",
  "dbVersion": "8.4.x",
  "socket": "ready"
}
```

---

## 7. CORS Configuration

CORS is configured in `backend/server.js` via `FRONTEND_ORIGIN`. For production:

```env
FRONTEND_ORIGIN=https://yourfrontend.com,https://www.yourfrontend.com
```

The backend checks the `Origin` header against this list. Socket.io uses the same allowed origins.

---

## 8. Environment Variables Reference

| Variable | Production Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables production error handling |
| `DEMO_MODE` | `false` | Disables demo login shortcuts |
| `JWT_SECRET` | strong random secret | JWT signing key — CHANGE FROM DEFAULT |
| `DB_HOST` | your MySQL host | Production database host |
| `DB_PASSWORD` | strong password | Production database password |
| `FRONTEND_ORIGIN` | your frontend domain(s) | CORS allowed origins |
| `TRUST_PROXY` | `false` | Opt-in reverse-proxy trust (`loopback`, hop count, or IP list) |
| `HOST` | unset / `127.0.0.1` | Bind address; loopback enables the local-demo safety allowance |
| `ALLOW_LOCAL_DEMO` | unset in prod | Explicit opt-in for `DEMO_MODE=true` on a non-local host |
| `ALLOW_DESTRUCTIVE_SLOT_REBUILD` | `false` | Allows ADMIN-only destructive slot regeneration when paired with `destructive:true` |
| `SMTP_*` | real SMTP credentials | Optional — leaves blank = sandbox |
| `FAST2SMS_API_KEY` | real API key | Optional — leaves blank = sandbox |

---

## 9. No Development Credentials in Production

- `.env.example` contains placeholder values only
- The default `JWT_SECRET` in `.env.example` says "change-me" — **must be replaced**
- `DEMO_MODE=true` must be set to `false` in production
- No real SMTP/SMS keys are stored in the repo

---

## 10. Database Migrations

Schema changes are managed via `database/schema.sql` (full rebuild). For incremental changes, use `database/migrations/`. Apply them with `npm run db:migrate` from `backend/`; the runner selects `DB_NAME` for every file and the migration SQL is idempotent (safe to apply twice). The test suite recreates the test database from `schema.sql` on every run.

The bundled `ecosystem.config.cjs` binds the local PM2 demo to `127.0.0.1` and is the explicit local-demo opt-in. Do not reuse that binding for a public deployment.

---

## 11. Verification Checklist

Before going live:
- [ ] `GET /api/health` returns `database: connected`
- [ ] `NODE_ENV=production` is set
- [ ] `DEMO_MODE=false` is set
- [ ] `JWT_SECRET` is a strong random value
- [ ] `FRONTEND_ORIGIN` matches your production domain
- [ ] Frontend `dist/` is built and served by backend (or static host)
- [ ] SSL/HTTPS is terminated at the load balancer or reverse proxy
- [ ] `.env` is not committed to version control
- [ ] Test patient registration and login
- [ ] Test booking flow end-to-end
- [ ] Run `npm test` — all 98 backend tests pass (see `docs/TEST_REPORT.md`)

---

## 12. Local Production Simulation

To test the production build locally:
```bash
cd frontend && npm run build
cd ../backend && npm start
# Open http://localhost:4000 — the backend serves the built frontend
```

---

## 13. Current Verification Status (2026-11-21)

The full backend suite is green (**98/98 tests**, 17 files) and the live
end-to-end harness passes **43/43 checks** (`backend/scripts/verify-live.js`).

**Public frontend deployment is live** at
`https://adityadubeyyy87-droid.github.io/CHCS/`. There is no public backend or
hosted MySQL in this environment: the Pages build therefore runs the explicitly
labelled `DEMO · LOCAL` engine. The local PM2 backend at `http://localhost:4000`
is healthy against MySQL 8.4.9 and reports `demoMode: true`.

To add a real public backend later:

1. Provision a hosted MySQL instance (RDS / Azure / DigitalOcean / PlanetScale-style managed).
2. Set production env vars (see section 3) and run `database/schema.sql`.
3. Deploy the backend (Render / Railway / Fly / AWS Elastic Beanstalk / a VPS with PM2).
4. Add the backend origin as the repository variable `RENDER_API_URL`; the Pages
   workflow injects it as `VITE_API_BASE`.
5. Set `DEMO_MODE=false` and add `https://` origins to `FRONTEND_ORIGIN` plus TLS termination.
6. Re-run the Pages workflow, then the verification checklist above and open the public URL.

---

---

## 14. Run locally in VS Code — one command, every time

From the **project root** (the folder containing `backend/`, `frontend/`, `package.json`):

```powershell
npm run dev
```

Press **Ctrl+Shift+B** instead if you prefer the VS Code task — the default build task
is `CHSC: Dev (API + UI)` (see `.vscode/tasks.json`).

| Link | What it is |
|---|---|
| `http://localhost:5173/` | Vite dev server, hot reload, API + Socket.io proxied to :4000 |
| `http://localhost:4000/` | Express serving `frontend/dist/` — the “full version” |
| `http://localhost:4000/api/health` | Mode + database status |

Other root commands:

```powershell
npm run live          # build UI fresh, then serve full version at :4000
npm run mysql:start   # start installed MySQL 8 (needed for LIVE · MySQL)
npm run mysql:stop
npm test              # backend suite
npm run build         # rebuild frontend/dist only
```

To get the **real database** locally:

```powershell
npm run mysql:start
# once ever, to create/seed the schema:
mysql -u root -p < database/schema.sql
npm run dev
```

The sidebar chip reads `LIVE · MySQL` when `database: "connected"`; otherwise it
reads `DEMO` and every simulated result carries a `SIMULATED` badge. Both are
intentional — neither produces a blank page.

`scripts/dev.mjs` has no extra dependencies: it uses the npm CLI that ships with
your Node install and kills the whole process tree on Ctrl+C (Windows-safe).

---

## 15. Keep it alive permanently on this machine (PM2)

```powershell
npm install -g pm2
npm run build
npm run pm2:start       # starts backend :4000 with auto-restart
pm2 startup             # run the admin command it prints — once — for boot start
pm2 save
```

`ecosystem.config.cjs` already sets `restart_delay`, `max_restarts`, log files and
`NODE_ENV=production`. If the process crashes, PM2 brings it straight back; after
`pm2 startup`, it also returns after a Windows reboot.

```powershell
npm run pm2:status
npm run pm2:logs
npm run pm2:stop
```

For real MySQL mode, set `DEMO_MODE=false` in `backend/.env` (and make sure
`npm run mysql:start` succeeded) before `pm2:start`.

> A laptop that is switched off cannot serve the internet. True 24/7 availability
> needs a host — see section 16.

---

## 16. Publish for free — a public link that works on every device

### 16.1 Recommended: GitHub Pages (free forever, no card, no black screen)

1. Push this repo to GitHub (branch `main`, `master` or `phase1-verify-hardening`).
2. `.github/workflows/deploy-pages.yml` builds `frontend/` and force-pushes the
   result to the `gh-pages` branch. GitHub Pages serves that branch, so there is
   **no manual Settings → Pages switch** to make. (A ready-built `gh-pages`
   branch is already published as a fallback.)
3. Every later push to a source branch rebuilds and republishes the site automatically.
4. Public URL: `https://adityadubeyyy87-droid.github.io/CHCS/`.

Why this never goes black:

- The Vite build uses `base: './'`, so assets load from the `/CHCS/` subpath.
- Routing is hash-based (`#/welcome`, `#/discover`, …), so no server rewrite is needed.
- `api.js` probes `/api/health`; on a static host there is no API, so it switches to
  the local demo engine. The site stays fully usable and clearly says `DEMO`.
- The old hard-coded `http://localhost:4000/socket.io/...` script tag was removed;
  Socket.io is now imported from the bundled `socket.io-client` package, so there is
  no mixed-content/console error on HTTPS. Socket connections only open in LIVE mode.

Optional — make the same public site use a real backend when it is available:

- Add a repository variable **Settings → Secrets and variables → Variables → New
  repository variable** named `RENDER_API_URL` with your backend origin,
  e.g. `https://chsc-api.onrender.com`.
- Re-run the workflow. The build injects `VITE_API_BASE`; the app uses LIVE mode when
  the backend answers and falls back to DEMO when it sleeps. No black screen either way.

### 16.2 Full LIVE mode on a free/cheap host — the honest 2026 picture

| Need | Reality |
|---|---|
| Free managed MySQL | **Retired** (Aiven’s free MySQL plan is gone; Render Postgres expires after 30 days). |
| Free Node web service | Render still has a free tier (sleeps after ~15 min, 750 h/month); Railway gives $1/month after a short trial; Fly.io has no free tier for new accounts. |
| Truly free + always on | Oracle Cloud **Always Free** ARM VM (4 OCPU / 24 GB) — install MySQL + Node there. |

Cheapest dependable path: **GitHub Pages UI (16.1) + a $5/mo MySQL Developer instance**,
or **Oracle Always Free VM** if you want $0 and can handle the setup. On any host:

```env
NODE_ENV=production
DEMO_MODE=false
FRONTEND_ORIGIN=https://<you>.github.io,https://<your-backend>.onrender.com
DB_HOST=<host>
DB_NAME=community_health_scheduler
JWT_SECRET=<32-byte random: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

On a VPS/Oracle VM, run the schema (`mysql -u root -p < database/schema.sql`), build
the UI (`npm run build`), then `npm run pm2:start` and put Nginx + Let’s Encrypt in
front. `FRONTEND_ORIGIN` must contain every exact browser origin (including the
backend’s own origin if it serves `dist`), otherwise CORS produces a blank page.

### 16.3 Verify after publishing

```powershell
curl https://<your-backend>/api/health
# expect: {"ok":true,"database":"connected","demoMode":false,...}
```

Open the public URL on a phone and a laptop. Landing page must render, the mode chip
must show `LIVE · MySQL` or `DEMO`, and DevTools Console must have **zero red errors**.
Test demo login → booking → QR pass → CSV export (admin). If the backend sleeps and
wakes, the page must silently continue in DEMO mode rather than going blank.

---

*End of deployment guide.*
