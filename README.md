# CHSC — Community Health Screening Camp Scheduler

Full-stack HealthTech platform for running free community health screening camps. Built as a CMRIT ISE academic project (Third Semester Project Review – 2).

**Runtime policy: STRICT LIVE / REAL DATA ONLY.** The app talks to a real Express + MySQL backend. There is no demo engine, no offline simulation, no sample patient/camp/booking data in production, and no fake links. A backend outage shows a real error; it never substitutes fabricated results.

## What it does

CHSC connects **patients, camp organizers, doctors/volunteers, and administrators** through one web platform:
- **Patients:** Browse camps → view live slot availability → book → QR pass with Google Maps directions → free browser alert or SMS/email confirmation → cancel/reschedule
- **Organizers:** Create camps → set venue coordinates → auto-generate non-overlapping slots → assign staff → monitor capacity
- **Doctors/Volunteers:** QR check-in (Maps QR or human token) → live waiting-room TV → attendance recording
- **Admins:** Analytics → capacity advisor → CSV export → user management → notification delivery audit with retry

Every confirmed booking, reschedule and cancellation writes real EMAIL + SMS rows to `notifications_log`, plus a **PUSH** row when the patient has opted in a browser device. Rows include booking ID, camp, date/time, full venue/address, ticket reference and a navigation link. The QR encodes a Google Maps directions URL with the opaque ticket token in the fragment, so one scan both navigates and checks in. Email additionally embeds the ticket QR inline. Browser alerts use free Web Push/VAPID and never require an SMS wallet. With no provider credentials the rows are honestly marked **Sandbox**; `SENT` is written only when the provider accepts the message.

## Key engineering guarantee — zero overbooking

Every booking uses `SELECT ... FOR UPDATE` pessimistic row locking on MySQL InnoDB. The mandatory 50-way parallel proof against one slot with capacity 10 produces **exactly 10 confirmed, 40 FIFO waitlisted, 0 overbooked**. See `docs/TEST_REPORT.md` for the test evidence; re-run it after any code change.

## Verified public deployment

| Layer | URL / status |
|---|---|
| Frontend | `https://adityadubeyyy87-droid.github.io/CHCS/` |
| Backend | `https://exemplary-strength-production-fbfcb823.up.railway.app/` |
| Repository | `https://github.com/adityadubeyyy87-droid/CHCS` |

The Pages build injects the backend origin from the GitHub repository variable `RENDER_API_URL` as `VITE_API_BASE`. That variable is **required**: with no value, the static site cannot reach an API and shows an honest connection error. It does not fall back to demo mode.

## Quick start — one command (VS Code)

Open the project root in VS Code and press **Ctrl+Shift+B** (or run `npm run dev` in the integrated terminal):

```powershell
npm run dev
```

That starts **backend :4000 + frontend :5173 (hot reload)** in one terminal, against your local MySQL. Open **http://localhost:5173/** for development, or **http://localhost:4000/** for the production build served by the backend.

Other one-liners from the project root:

```powershell
npm run live          # fresh UI build, then full version at http://localhost:4000/
npm run mysql:start   # start local MySQL 8 (local development only)
npm test              # backend suite
npm run pm2:start     # keep :4000 alive (after: npm i -g pm2, pm2 startup)
npm run pm2:stop      # free :4000 before using the hot-reload dev command
```

With PM2 already running, use `npm run dev -- --frontend-only` for Vite hot reload against the permanent backend. `npm run mysql:start` prepares a **local** portable datadir; recovery may rebuild it. Any seeding it performs is local-development only and must never be pointed at a hosted database.

### Local full stack (manual)

```bash
# 1. Local database — schema.sql includes LOCAL-ONLY fixtures for development/tests
mysql -u root -p < database/schema.sql

# 2. Backend
cd backend
cp .env.example .env   # edit DB credentials and JWT_SECRET
npm install
node server.js         # http://localhost:4000

# 3. Frontend
cd ../frontend
npm install
npm run dev            # http://localhost:5173, proxies /api + /socket.io to :4000
```

`backend/seed.js` / `npm run seed` are **LOCAL ONLY**. They must never run in production or against a hosted MySQL instance.

### Production startup (migrations only, no seed)

```bash
cd backend
node scripts/db.js setup-production
node scripts/bootstrap-production.js
node server.js
# or: npm run start:production
```

`setup-production` applies `database/schema-production.sql` (DDL only) plus `database/migrations/*.sql`. It never drops data and never inserts sample records. `bootstrap-production.js` creates only the four real staff accounts from `BOOTSTRAP_*` environment variables; patients self-register. Regenerate the production DDL with `node scripts/generate-production-schema.mjs`.

Required Railway variables (set in the dashboard; never commit values): `NODE_ENV=production`, `JWT_SECRET`, `MYSQL_URL` / `DB_NAME=railway`, `FRONTEND_ORIGIN`, `TRUST_PROXY=2`, `BOOTSTRAP_ADMIN_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_ORGANIZER_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_DOCTOR_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_VOLUNTEER_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_PHONE_SEED`, `PURGE_ON_BOOT=false`. To replace an older seeded database, set `PURGE_ON_BOOT=true` and `ALLOW_PRODUCTION_PURGE=true` for one deployment, then return both to `false`. SMTP/SMS variables are optional; without credentials, delivery is labelled Sandbox and no real delivery is claimed. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `PUSH_APP_URL` for free browser alerts. Full reference: `DEPLOYMENT.md`.

## Test suite

```bash
cd backend
npm test               # unit + integration against a throwaway MySQL test database
npm run test:unit
npm run test:integration
```

Live end-to-end verification (real Express + MySQL):

```bash
cd backend && node server.js
node scripts/verify-live.js
```

Both the mandatory concurrency proof (50 → 10 held then confirmed / 40 waitlisted / 0 overbooked) and the full suite must stay green before any release. See `docs/TEST_REPORT.md` for the recorded evidence.

## Project structure

```text
database/schema.sql         Local development schema + LOCAL-ONLY fixtures
database/schema-production.sql  Generated DDL-only production bootstrap (no data rows)
database/migrations/        Incremental DDL migrations (applied by setup-production)
scripts/generate-production-schema.mjs  Regenerates the data-free production schema
backend/server.js           Express API, JWT auth, row-lock transactions, Socket.io, cron
backend/scripts/db.js       Local setup + idempotent production schema/migrations
backend/scripts/bootstrap-production.js  Creates real staff accounts from env vars
backend/seed.js             LOCAL ONLY — never run in production
backend/tests/              Unit + integration tests, incl. 50-way / 10-seat proof
frontend/                   React 18 + Vite app (strict live, no fallback engine)
frontend/dist/              Production build (served by backend)
DATA_COLLECTION.md          Data collection methodology (8 marks — academic review)
ACADEMIC_REVIEW_PACKAGE.md  Speaking script, viva questions (18 marks)
DEPLOYMENT.md               Production deployment guide
presentation.html           HTML slide deck for the review
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, socket.io-client, inline-SVG QR |
| Backend | Node.js, Express, JWT, bcryptjs, node-cron, Nodemailer, Socket.io |
| Database | MySQL 8, mysql2/promise, InnoDB, SELECT … FOR UPDATE row locks |

## Documentation

- `AGENTS.md` — agent guidance & conventions
- `DESIGN.md` — "Biophilic Clinical Precision" visual system
- `DESIGN-SYSTEM-UUPM.md` — applied UX/accessibility rules
- `PRODUCT.md` — product vision & constraints
- `README_AND_VIVA_DEFENSE.md` — full viva defense & feature map
- `DATA_COLLECTION.md` — data collection methodology (8 marks)
- `ACADEMIC_REVIEW_PACKAGE.md` — speaking script, viva questions
- `DEPLOYMENT.md` — production deployment guide
- `docs/TEST_REPORT.md` — test evidence
- `docs/decision-log.md` — engineering decisions

## License

Academic project — CMR Institute of Technology, Bengaluru, Dept. of ISE.
