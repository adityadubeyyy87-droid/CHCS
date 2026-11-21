# CHSC — Community Health Screening Camp Scheduler

Full-stack HealthTech platform for running free community health screening camps. Built as a CMRIT ISE academic project (Third Semester Project Review – 2).

## What it does

CHSC connects **patients, camp organizers, doctors/volunteers, and administrators** through one web platform:
- **Patients:** Browse camps → view live slot availability → book → QR pass → SMS/email reminders → cancel/reschedule
- **Organizers:** Create camps → auto-generate non-overlapping slots → assign staff → monitor capacity
- **Doctors/Volunteers:** QR check-in → live waiting-room TV → attendance recording
- **Admins:** Analytics → capacity advisor → CSV export → user management → reminder audit log

## Key engineering guarantee — zero overbooking

Every booking uses `SELECT ... FOR UPDATE` pessimistic row locking on MySQL InnoDB. A mandatory 50-way parallel stress test against one slot with capacity 10 produces **exactly 10 confirmed, 40 FIFO waitlisted, 0 overbooked**.

## Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cmrit.edu` | `Admin@123` |
| Organizer | `organizer@cmrit.edu` | `Password@123` |
| Doctor | `doctor@cmrit.edu` | `Password@123` |
| Volunteer | `volunteer@cmrit.edu` | `Password@123` |
| Patient | `patient@cmrit.edu` | `Password@123` |

## Quick start

### Mode A — real MySQL + Socket.io
```bash
# 1. Database
mysql -u root -p < database/schema.sql

# 2. Backend (http://localhost:4000)
cd backend
cp .env.example .env   # edit DB credentials
npm install
npm run seed           # optional reseed
node server.js

# 3. Frontend (http://localhost:5173)
cd ../frontend
npm install
npm run dev            # proxies /api + /socket.io to :4000
```

### Mode B — local demo engine (no MySQL)
```bash
cd frontend
npm install
npm run dev            # auto-falls back to local engine when backend is offline
```

## Test suite

Full automated suite (unit + integration against a throwaway MySQL test database):

```bash
cd backend
npm test               # 79/79 tests pass (14 files: unit + integration)
npm run test:unit
npm run test:integration
```

### Live end-to-end verification

```bash
cd backend && node server.js          # real Express + MySQL
node scripts/verify-live.js          # 43/43 live HTTP checks across all roles
```

Both the mandatory concurrency proof (50 → 10 confirmed / 40 waitlisted / 0 overbooked)
and the full suite must stay green before any release. See `docs/TEST_REPORT.md` for the
current evidence record.

## Project structure

```
database/schema.sql        8 InnoDB tables + CHECK constraints + seed data
database/migrations/       Incremental migration scripts
backend/server.js          Express API, JWT auth, row-lock transactions, Socket.io, cron
backend/lib/               validation, pagination, rate limits, providers, reminder engine
backend/tests/             79 unit + integration tests (unit: validation, pagination, reminders, slots, limits; integration: auth, booking, camps, staff, attendance, export, reminders, concurrency, audit)
backend/concurrency-test.js 50-way parallel booking proof (10/40/0)
backend/.env.example       Production environment template
backend/chsc-postman-collection.json  Postman collection for all API endpoints
frontend/                  React 18 + Vite app (Mode A / Mode B)
frontend/dist/             Production build (served by backend)
DATA_COLLECTION.md         Data collection methodology (8 marks — academic review)
ACADEMIC_REVIEW_PACKAGE.md Speaking script, viva questions, demo scripts (18 marks)
DEPLOYMENT.md              Production deployment guide
presentation.html          HTML slide deck for the review
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, socket.io-client, inline-SVG QR |
| Backend | Node.js, Express, JWT, bcryptjs, node-cron, Nodemailer, Socket.io |
| Database | MySQL 8, mysql2/promise, InnoDB, SELECT … FOR UPDATE row locks |

## Modes

- **Mode A (LIVE · MySQL):** Backend connected — real InnoDB transactions, real Socket.io broadcasts
- **Mode B (DEMO):** Backend offline — local in-memory engine; all results carry `SIMULATED` badges, never presented as real

## Documentation

- `AGENTS.md` — agent guidance & conventions
- `DESIGN.md` — "Biophilic Clinical Precision" visual system
- `DESIGN-SYSTEM-UUPM.md` — applied UX/accessibility rules
- `PRODUCT.md` — product vision & constraints
- `README_AND_VIVA_DEFENSE.md` — full viva defense & feature map
- `DATA_COLLECTION.md` — data collection methodology (8 marks)
- `ACADEMIC_REVIEW_PACKAGE.md` — speaking script, viva questions, demo scripts
- `DEPLOYMENT.md` — production deployment guide

## License

Academic project — CMR Institute of Technology, Bengaluru, Dept. of ISE.
