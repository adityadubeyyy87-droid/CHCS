# CHSC Deployment Guide

## Overview

CHSC is a full-stack application with three deployment components:

1. **Frontend** (React + Vite) — static build served by the backend or GitHub Pages
2. **Backend** (Node.js + Express) — API server with Socket.io
3. **Database** (MySQL 8.4) — relational data store

**Runtime policy: STRICT LIVE / REAL DATA ONLY.** There is no demo engine, no offline simulation, no one-click demo login and no seeded sample patients, camps, slots, bookings, waitlist entries, staff assignments or notifications in production. If the API is unreachable, the UI shows the real connection error. Empty tables stay empty until real users create records.

Verified public endpoints (no other URLs are implied):

- Repository: `https://github.com/adityadubeyyy87-droid/CHCS`
- Frontend: `https://adityadubeyyy87-droid.github.io/CHCS/`
- Backend: `https://exemplary-strength-production-fbfcb823.up.railway.app/`

---

## 1. Prerequisites

- Node.js >= 20 (CI, Railway and the native Tailwind binding require it)
- MySQL 8.4+ (InnoDB)
- HTTPS origin for the frontend and backend in production
- A strong, unique `JWT_SECRET` and real bootstrap credentials supplied as host secrets — never committed

---

## 2. Database setup

### Local development only

`database/schema.sql` is the local development schema and intentionally includes local-only fixtures for tests. Use it only against a local MySQL instance:

```bash
mysql -u root -p < database/schema.sql
```

`backend/seed.js` / `npm run seed` are **LOCAL ONLY**. Never run them against a hosted or production database.

### Production (hosted MySQL)

`database/schema-production.sql` is a generated, DDL-only bootstrap: `CREATE TABLE IF NOT EXISTS`, indexes, keys and constraints. It has **no data statements**, no `DROP TABLE`, no `CREATE DATABASE` and no `USE`. It is idempotent and non-destructive.

```bash
cd backend
node scripts/db.js setup-production
node scripts/bootstrap-production.js
node server.js
# or: npm run start:production
```

`setup-production` applies `database/schema-production.sql` and then every `database/migrations/*.sql` file in order. It creates/upgrades structure only; it never deletes or overwrites live rows. `bootstrap-production.js` creates only the four real staff accounts from `BOOTSTRAP_*` environment variables. Patients self-register through `POST /api/auth/register`.

If you are replacing an older seeded/demo database, set `PURGE_ON_BOOT=true` **and** `ALLOW_PRODUCTION_PURGE=true` for exactly one deployment, confirm the four real accounts and empty operational tables, then set both variables back to `false`. This is destructive and removes all existing camps, bookings, waitlist rows, notifications and non-bootstrap users.

Regenerate the production schema after DDL changes in `database/schema.sql`:

```bash
# from the repository root
node scripts/generate-production-schema.mjs
```

The generator strips the local fixture block and all data-bearing statements, and fails if forbidden statements remain in the output. Verify the result with:

```bash
Select-String -Path database/schema-production.sql -Pattern 'INSERT'   # expect 0 matches
```

---

## 3. Backend configuration

Copy `backend/.env.example` to `backend/.env` for local use and fill in real values. In hosting, set the same values in the platform dashboard. **Never commit `.env` or real secrets.**

### Required in production / Railway

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Strong random secret (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `MYSQL_URL` (or `DATABASE_URL`) | Railway MySQL connection string, supplied as a secret/reference |
| `DB_NAME` | `railway` on Railway; the connection must target the actual hosted database name |
| `FRONTEND_ORIGIN` | Exact browser origin(s) allowed by CORS/Socket.io |
| `TRUST_PROXY` | `2` on Railway (two-edge proxy chain) |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` / `BOOTSTRAP_ADMIN_NAME` | Real admin account, created once by bootstrap |
| `BOOTSTRAP_ORGANIZER_EMAIL` / `BOOTSTRAP_ORGANIZER_PASSWORD` / `BOOTSTRAP_ORGANIZER_NAME` | Real organizer account |
| `BOOTSTRAP_DOCTOR_EMAIL` / `BOOTSTRAP_DOCTOR_PASSWORD` / `BOOTSTRAP_DOCTOR_NAME` | Real doctor account |
| `BOOTSTRAP_VOLUNTEER_EMAIL` / `BOOTSTRAP_VOLUNTEER_PASSWORD` / `BOOTSTRAP_VOLUNTEER_NAME` | Real volunteer account |
| `BOOTSTRAP_PHONE_SEED` | Starting phone number for the bootstrap accounts (digits only) |

For classroom demonstrations, role accounts may follow the `role@chcs.app` pattern (`admin@chcs.app`, `organizer@chcs.app`, `doctor@chcs.app`, `volunteer@chcs.app`, plus `patient@chcs.app`) and share one strong demo password. The password is a host secret: it must never be committed to this repository or written into a workflow log. Legacy `role@chsc.app` bootstrap accounts can be deactivated through the admin API after the replacement accounts are verified.
| `PURGE_ON_BOOT` | `false` — never erase live data on restart |
| `ALLOW_PRODUCTION_PURGE` | `false` normally. Only for an intentional one-time reset together with `PURGE_ON_BOOT=true`; production refuses to purge without it. |

### Optional

| Variable | Purpose |
|---|---|
| `PORT` | Backend port (`8080` on Railway, `4000` locally) |
| `HOST` | `127.0.0.1` for local production-like PM2; leave unset in hosting |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_REPLY_TO` | Real email delivery, including the inline QR ticket |
| `FAST2SMS_API_KEY`, `SMS_PROVIDER`, `SMS_ROUTE` | Real SMS delivery. `SMS_ROUTE=t` for DLT transactional, `q` for quick route |
| `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID` | Approved Indian DLT sender + template. Required for transactional route `t`; never invent these values |
| `PUBLIC_BASE_URL` | Public backend origin used in SMS short links (`https://api.example.com/n/<token>`). Falls back to `RAILWAY_PUBLIC_DOMAIN`, then `FRONTEND_ORIGIN` |
| `JWT_EXPIRES` | Token lifetime (default `12h`) |
| `REMINDER_CRON` | Reminder sweep schedule; `off` disables automatic sweeping |
| `HOLD_EXPIRY_CRON` | Hold/promotion expiry sweep schedule |
| `RATE_LIMIT_DISABLED` | Test-only; keep unset/false in production |
| `ALLOW_DESTRUCTIVE_SLOT_REBUILD` | Keep `false`; destructive rebuilds are never a deploy step |

**SMTP/SMS honesty:** all provider credentials are optional. With none configured, notification attempts are recorded in `notifications_log` and labelled **Sandbox**. No real email or SMS delivery is claimed. Delivery is marked `SENT` only when the provider accepts the message; `FAILED` rows store the provider error and can be retried from the Notification Center (`POST /api/admin/notifications/:id/retry`) once credentials are configured.

### Enable real delivery (Gmail + Fast2SMS)

Set these in the Railway service's **Variables** tab (never in the repository, a workflow file or a chat message). Gmail needs **2-Step Verification** enabled and a 16-character **App Password** generated at <https://myaccount.google.com/apppasswords> — the normal Google password is rejected.

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` (STARTTLS) |
| `SMTP_USER` | the full Gmail address that sends the mail |
| `SMTP_PASS` | the 16-character Gmail App Password (spaces removed) |
| `MAIL_FROM` | the same Gmail address, e.g. `CMRIT Health Camp <you@gmail.com>` — Gmail rejects an unverified `no-reply@` identity |
| `MAIL_REPLY_TO` | optional monitored inbox |
| `FAST2SMS_API_KEY` | key from the Fast2SMS dashboard |
| `SMS_PROVIDER` | `Fast2SMS` |
| `SMS_ROUTE` | `q` for quick route, or `t` for DLT-compliant transactional |
| `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID` | required only for route `t`; must be the values approved for the registered Indian entity — never guess them |

Railway redeploys automatically after variables change. Verify without sending to a patient:

1. `GET /api/admin/ops/readiness` → `providers.email.live === true` and `providers.sms.live === true`.
2. `POST /api/admin/ops/delivery-test` with `{ "channel": "EMAIL" }` then `{ "channel": "SMS" }` → each returns `simulated:false`, `delivered:true` and a provider reference (Gmail message ID / Fast2SMS request ID).
3. Confirm the messages arrived in the admin inbox and on the admin phone, then create a real patient booking: confirmation email + SMS are sent to the **email and phone stored on that patient's registration**.

If Gmail returns "Username and Password not accepted", the App Password is wrong or 2-Step Verification is off. If Fast2SMS returns a DLT error, use the approved sender/template with `SMS_ROUTE=t`; the app will record the provider's exact response on a `FAILED` row instead of claiming delivery. A new Fast2SMS account also rejects API traffic until a minimum **₹100 transaction** is completed in its dashboard — the provider message is `"You need to complete one transaction of 100 INR or more before using API route."`; the self-test records this as `DELIVERY_TEST_FAILED` and never reports it as sent.

**Tickets and navigation:** each booking gets a cryptographically random `CHSC-BLR-…` token. The ticket QR encodes a real Google Maps directions URL with the token in the fragment (`#chsc=<token>`), so a phone camera opens navigation and the CHSC scanner still checks the patient in. Camp latitude/longitude are optional; without them the destination is the encoded venue, address and city. The SMS short link `/n/<token>` resolves to the same Maps destination and is never an open redirect.

### Start

```bash
cd backend
npm install --omit=dev
npm start        # or: node server.js
```

The backend serves `/api/*`, `/socket.io/*`, the built `frontend/dist/` when present, and `GET /api/health`.

Expected health response (no mode flags, no fabricated fields):

```json
{
  "ok": true,
  "service": "CHSC API",
  "database": "connected",
  "dbVersion": "8.4.x",
  "socket": "ready"
}
```

---

## 4. Frontend configuration

### Build

```bash
cd frontend
npm ci
npm run build        # → frontend/dist/
```

Static hosting must inject the backend origin at build time:

```bash
VITE_API_BASE=https://exemplary-strength-production-fbfcb823.up.railway.app npm run build
```

The GitHub Pages workflow reads the repository variable `RENDER_API_URL` and passes it as `VITE_API_BASE`:

```yaml
env:
  VITE_API_BASE: ${{ vars.RENDER_API_URL }}
```

**Required GitHub variable:** Settings → Secrets and variables → Variables → New repository variable named `RENDER_API_URL`, value `https://exemplary-strength-production-fbfcb823.up.railway.app`.

With that variable set, the build is strict-live. With no variable, the static site cannot find an API and shows an honest connection error — it does **not** fall back to a demo engine. Routing is hash-based and `base: './'`, so no server rewrite is needed on the `/CHCS/` subpath.

---

## 5. Railway deployment topology (verified)

| Setting | Value |
|---|---|
| Root directory | repository root |
| Build command | `cd frontend && npm ci && npm run build` |
| Start command | `cd backend && npm ci --omit=dev && node scripts/db.js setup-production && node scripts/bootstrap-production.js && node server.js` |
| Healthcheck path | `/api/health` |
| Port | `8080` |
| Runtime | Node 20 |
| Replicas | 1 |

All values in the environment table in section 3 are set in the Railway dashboard as secrets/references. No credentials, bootstrap passwords or database URLs live in this repository.

GitHub repository variable for Pages:

```text
RENDER_API_URL=https://exemplary-strength-production-fbfcb823.up.railway.app
```

Schema/migration notes: Railway's MySQL database is named `railway`. The schema file contains no database-selection statements; migrations are applied against the connection's selected database. Older installations gain hold/expiry columns and indexes through the idempotent migration files.

---

## 6. Local production-like process (PM2)

`ecosystem.config.cjs` runs one real backend process on loopback. It sets `NODE_ENV=production`, `PORT=4000`, `HOST=127.0.0.1`, and reads `JWT_SECRET` and database settings from `backend/.env`. No secrets are hardcoded in the PM2 file.

```powershell
npm install -g pm2
npm run build
cd backend && node scripts/db.js setup-production && node scripts/bootstrap-production.js && cd ..
npm run pm2:start
pm2 startup         # run the admin command it prints once, then pm2 save
npm run pm2:status
npm run pm2:logs
npm run pm2:stop
```

This is a local production-like process, not an internet-facing host. Use Railway (or another real host) for 24/7 availability.

---

## 7. Migrations

Incremental DDL lives in `database/migrations/*.sql` and is applied by `node scripts/db.js setup-production` (or `npm run db:migrate` from `backend/`). The runner re-selects the connection's database before each file, so a `USE` line intended for the `mysql` CLI cannot redirect a hosted connection. Migrations are idempotent. The test suite recreates a throwaway test database from `database/schema.sql`.

---

## 8. Verification checklist

Before going live:

- [ ] `GET /api/health` returns `database: connected` and `socket: ready`
- [ ] `NODE_ENV=production`, `JWT_SECRET`, `MYSQL_URL`, `DB_NAME`, `FRONTEND_ORIGIN`, `TRUST_PROXY=2` set
- [ ] All four `BOOTSTRAP_*` account triples + `BOOTSTRAP_PHONE_SEED` set; `PURGE_ON_BOOT=false` and `ALLOW_PRODUCTION_PURGE=false`
- [ ] No `DEMO_*` variables, demo endpoints or seed steps in the deploy command
- [ ] `database/schema-production.sql` contains zero data statements (`INSERT`, `REPLACE`, `TRUNCATE`, `DELETE`)
- [ ] Frontend `dist/` built with `VITE_API_BASE` from `RENDER_API_URL`
- [ ] HTTPS terminated at the proxy; CORS origins are exact
- [ ] `.env` files are ignored and no secrets are committed
- [ ] Test registration, real login, camp creation, booking → confirm, QR check-in and CSV export
- [ ] Public UI shows real connection status; a backend outage surfaces a real error
- [ ] Run `npm test` in `backend/` and `npm run build` in `frontend/` after every change (see `docs/TEST_REPORT.md` for the last recorded evidence)

---

## 9. Known operational limitations

- The public backend is on Railway's default hostname and the frontend uses the default `github.io` URL; billing/trial status is a platform concern, not a code guarantee.
- Without SMTP/SMS credentials, reminders are recorded as Sandbox attempts, not delivered messages.
- No sample data is shipped in production; dashboards are empty until real users create records.

---

*End of deployment guide.*
