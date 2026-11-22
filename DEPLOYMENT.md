# CHSC Deployment Guide

## Overview

CHSC is a full-stack application with three deployment components:
1. **Frontend** (React + Vite) — static build served by the backend or a CDN
2. **Backend** (Node.js + Express) — API server with Socket.io
3. **Database** (MySQL 8.4) — relational data store

The application supports two modes:
- **Mode A (Live):** Backend connected to MySQL — real transactions, Socket.io
- **Mode B (Demo):** No configured `VITE_API_BASE` and backend offline — local in-memory engine, clearly labeled `SIMULATED`. Production builds pin the API URL and are strictly live.

---

## 1. Prerequisites

- Node.js >= 20 (Railway and CI are pinned to Node 20; Tailwind's native
  `@tailwindcss/oxide` binding requires it)
- MySQL 8.4+ (for Mode A; CI and Railway use MySQL 8.4)
- A domain with HTTPS (for production)

---

## 2. Database Setup

### Local development
```bash
mysql -u root -p < database/schema.sql
```

### Production (hosted MySQL)
1. Provision a MySQL 8.4 database (e.g., AWS RDS, Azure MySQL, DigitalOcean Managed DB)
2. Note the host, port, user, password, and database name
3. Run the schema against the production database. Use the idempotent hosted
   schema (non-destructive bootstrap) when the host only exposes one SQL string:
```bash
mysql -h <PROD_HOST> -P <PORT> -u <USER> -p<PASSWORD> < database/schema-production.sql
```
   Railway runs this automatically on every deploy via
   `node scripts/db.js setup-production`, which creates missing tables/seeds and
   never drops live data.

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

The frontend will call the backend API directly. When `VITE_API_BASE` is injected
into a **production** build, the app is **strict-live**: it never substitutes the
local demo engine if that backend is unavailable, and surfaces the real network
error instead. Only builds without an API base (or local development) may fall
back to the clearly labelled demo engine.

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
| `BOOKING_HOLD_MINUTES` | `10` | Booking reservation window before explicit confirm |
| `PROMOTION_HOLD_MINUTES` | `15` | FIFO promotion claim window |
| `HOLD_EXPIRY_CRON` | `* * * * *` | Expiry sweep schedule; `off` disables automatic sweeping |
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

Schema changes are managed via `database/schema.sql` (full rebuild). For incremental changes, use `database/migrations/`; `004_booking_holds.sql` adds the 10-minute hold and promotion-expiry columns/indexes. Apply them with `npm run db:migrate` from `backend/`; the runner selects `DB_NAME` for every file and the migration SQL is idempotent (safe to apply twice). The test suite recreates the test database from `schema.sql` on every run.

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
- [ ] Confirm the mode chip reads `LIVE · MySQL` on the public site
- [ ] Confirm Socket.io handshake returns `101` and live queue updates without reload
- [ ] Confirm strict-live mode never shows `SIMULATED` data as a database result
- [ ] Run `npm test` — all 98 backend tests pass (see `docs/TEST_REPORT.md`)
- [ ] Run `npm run build` in `frontend/` — no compile errors

---

## 12. Local Production Simulation

To test the production build locally:
```bash
cd frontend && npm run build
cd ../backend && npm start
# Open http://localhost:4000 — the backend serves the built frontend
```

---

## 13. Current Verification Status (2026-11-22)

The full backend suite is green (**102/102 tests**, 18 files) and the live
end-to-end harness passes **47/47 checks** (`backend/scripts/verify-live.js`).

The public deployment is now **real full-stack**, not a static demo:

| Layer | Live endpoint / status |
|---|---|
| Frontend | `https://adityadubeyyy87-droid.github.io/CHCS/` — `LIVE · MySQL` |
| Backend | `https://exemplary-strength-production-fbfcb823.up.railway.app/` — Node 20, Railway |
| Database | Railway MySQL 8.4.13, persistent volume, `database: connected` |
| Realtime | `wss://exemplary-strength-production-fbfcb823.up.railway.app/socket.io/` — `101` |
| GitHub | `https://github.com/adityadubeyyy87-droid/CHCS` |

Public health response:

```json
{
  "ok": true,
  "service": "CHSC API",
  "demoMode": false,
  "database": "connected",
  "dbVersion": "8.4.13",
  "socket": "ready"
}
```

The Pages site is a production build with `VITE_API_BASE` supplied from the
GitHub repository variable `RENDER_API_URL`, so it is **strict-live** and cannot
silently fall back to the demo engine. The full public verification record is in
`docs/TEST_REPORT.md` and the deployment topology is in section 17 below.

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
npm run mysql:start   # start installed MySQL 8.4 (needed for LIVE · MySQL)
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

The sidebar chip reads `LIVE · MySQL` when `database: "connected"`; in a local
build with no pinned API URL it reads `DEMO` and every simulated result carries a
`SIMULATED` badge. The deployed Pages build pins `VITE_API_BASE`, so a backend
outage is surfaced as an error rather than silently falling back to `DEMO`.

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
- `api.js` probes `/api/health`. A static-only build with no injected API base switches
  to the local demo engine and clearly says `DEMO`; the connected production build below
  stays strictly live instead.
- The old hard-coded `http://localhost:4000/socket.io/...` script tag was removed;
  Socket.io is now imported from the bundled `socket.io-client` package, so there is
  no mixed-content/console error on HTTPS. Socket connections only open in LIVE mode.

Optional — make the same public site use a real backend when it is available:

- Add a repository variable **Settings → Secrets and variables → Variables → New
  repository variable** named `RENDER_API_URL` with your backend origin,
  e.g. `https://chsc-api.onrender.com`.
- Re-run the workflow. The build injects `VITE_API_BASE`; because this is a
  production build, the app runs in **strict-live** mode. It does not fall back to
  DEMO if the backend is unreachable — the real error is shown instead. This is
  deliberate so simulated output can never be mistaken for database output.

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
must show `LIVE · MySQL` (or `DEMO` only for a static-only build), and DevTools
Console must have **zero red errors**. Test sign-in → booking → QR pass → CSV
export (admin). With `VITE_API_BASE` injected into a production build, a backend
outage must surface a real error; it must **not** switch to DEMO.

---

## 17. Verified public deployment (Railway + GitHub Pages)

This is the actual topology serving the public site on 2026-11-21. It replaces
the earlier “public backend later” notes in section 13.

### 17.1 Identifiers

| Item | Value |
|---|---|
| GitHub repo | `https://github.com/adityadubeyyy87-droid/CHCS` |
| Branches kept in sync | `main`, `master`, `phase1-verify-hardening` |
| Railway project | `incredible-dream` |
| Project ID | `cdb51e74-44c1-4945-918d-00d4a67c91bd` |
| Environment ID | `dec51402-000f-4cdb-8335-99cdbfb9d61f` |
| Primary service | `exemplary-strength` (`f8f6e479-57a4-4e78-b6a4-7e6320dfcff0`) |
| MySQL service | `9ba75faa-fc4e-4ef0-bd96-ffdb72cd8605`, persistent volume `06c69882-5308-4702-9e84-6955ef3638d4` |
| Active deployment at verification | `235cd05e-8186-45e7-a0ab-dde33d8e8dc3` for commit `2e63cab` |
| Public backend | `https://exemplary-strength-production-fbfcb823.up.railway.app/` |
| Public frontend | `https://adityadubeyyy87-droid.github.io/CHCS/` |

A first, failed duplicate service named `CHCS`
(`7667726a-ffa6-4ddc-b2bf-f9c18327ecd0`) was removed from the Railway
environment after the primary service was verified. No `railway.json` is used;
Railway config-as-code is deprecated for new services and is intentionally
managed in the dashboard.

### 17.2 Railway settings

```text
Root directory:        repository root
Builder:               Railpack with custom commands
Custom build command:  cd frontend && npm ci && npm run build
Custom start command:  cd backend && npm ci --omit=dev && node scripts/db.js setup-production && node server.js
Healthcheck path:      /api/health
Port / target port:    8080
Runtime:               node@20.20.2 (NODE_VERSION=20)
Replicas:              1
```

Environment variables (values delivered as Railway secrets/references, never in
this repository):

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Production error handling |
| `DEMO_MODE=false` | Closes all `/api/demo/*` endpoints and demo login |
| `TRUST_PROXY=2` | Trust Railway's two-edge proxy chain for secure cookies/IP |
| `NODE_VERSION=20` | Required by Tailwind's native oxide binding |
| `PORT=8080` | Railway target port |
| `JWT_SECRET` | Hidden 32-byte random secret |
| `MYSQL_URL` | Railway secret reference to the MySQL connection string |
| `FRONTEND_ORIGIN` | Pages origin plus the Railway origin for CORS/socket auth |

GitHub repository variable:

```text
RENDER_API_URL=https://exemplary-strength-production-fbfcb823.up.railway.app
```

`.github/workflows/deploy-pages.yml` injects it as `VITE_API_BASE`. Workflow run
`#24` on `main` completed successfully after the variable was set; the published
bundle switched from the old demo asset `index-SWvLevdZ.js` to live asset
`index-CFkkecyO.js`. A production build with `VITE_API_BASE` is strict-live by
design (`frontend/src/lib/api.js`).

### 17.3 Bootstrap and schema

`node scripts/db.js setup-production` reads `MYSQL_URL` (or `DATABASE_URL`),
parses Railway's SSL requirements and applies
`database/schema-production.sql` idempotently. It creates missing tables,
indexes and the seeded role accounts; it never drops existing data. It then
applies all `database/migrations/*.sql` files in order, so an older installation
gains `HELD`/`EXPIRED` booking states, `hold_expires_at`,
`idx_bookings_hold_expiry`, `promotion_expires_at` and `idx_wait_expires` on the
next deploy. The migrations are idempotent and re-select the database from
`MYSQL_URL` before each file. The source schema remains `database/schema.sql`
and the production copy is regenerated by
`scripts/generate-production-schema.mjs`.

### 17.4 Post-deploy verification

- `GET /api/health` → `ok: true`, `demoMode: false`, `database: connected`,
  `dbVersion: 8.4.13`, `socket: ready`.
- Public Pages UI shows `LIVE · MySQL`; `/api/health`, `/api/camps` and
  `/api/bookings/me` return real responses and the socket handshake is `101`.
- Real DB aggregates (at verification time): 7 camps, 45 slots, 121 bookings
  and FIFO waitlists.
- All role workflows, 10-minute hold → explicit confirm, cancel/reschedule,
  FIFO promotion with claim expiry, confirmed-only QR check-in, live-queue
  socket updates, admin analytics and CSV export were exercised against MySQL.
  An interactive demo-only concurrency button is explicitly disabled in
  strict-live mode; the real row-lock invariant remains covered by `npm test`
  (50 requests / 10 seats → 10 held+confirmed / 40 waitlisted / 0 violations).
- Detailed workflow evidence: `docs/TEST_REPORT.md`.

### 17.5 Trial and billing disclosure

Railway is currently on a trial showing **30 days or about $5.00 left**. The
public URL is live now, but continued 24/7 availability after the trial requires
a paid Railway plan or a migration to another host. There is no custom domain;
the public frontend uses the default `github.io` URL and the backend uses the
default Railway hostname.

---

*End of deployment guide.*
