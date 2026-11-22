# CHSC — Community Health Screening Camp Scheduler

Full-stack HealthTech platform for running free community health screening camps in Bengaluru — built as a CMRIT ISE mini project. Five roles (Patient, Organizer, Doctor, Volunteer, Admin), bounded transactional seat holds under row locks, FIFO waitlist auto-promotion, QR check-in, a live waiting-room TV, and a rule-based Capacity Advisor.

---

## 1. Stack (exactly as specified)

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, socket.io-client, inline-SVG QR (`qrcode` renders to SVG; no images) |
| Backend | Node.js, Express, JWT (`jsonwebtoken`), `bcryptjs`, `node-cron`, Nodemailer, Socket.io |
| Database | MySQL 8.4, `mysql2/promise`, InnoDB, `SELECT … FOR UPDATE` row locks |
| Design | "Biophilic Clinical Precision" — emerald/mint signal system on slate, hairline grids, bento layouts, one quiet shadow system, glass reserved for sidebar and Health Passport, Inter + Plus Jakarta Sans + Noto Sans Kannada + JetBrains Mono, dark clinical default with a light theme |
| Motion | `motion` (Framer Motion v11) — cinematic page transitions, scroll reveals, magnetic buttons, 3D tilt effects, text shimmer/scramble/morph, animated number counters, spotlight effects, confetti celebrations |
| 3D | Three.js + React Three Fiber — emerald diagnostic cell on sign-in and a scroll-linked clinical beacon on the welcome page; both lazy-loaded with CSS/SVG fallbacks and reduced-motion support |

## 2. Quick start — strict live

The application has one runtime mode: real Express + MySQL + Socket.io. There is no local engine, no demo login and no offline simulation. A failed backend request shows the real error.

### Local development

```bash
# 1. Local MySQL — schema.sql includes LOCAL-ONLY fixtures for development/tests
mysql -u root -p < database/schema.sql

# 2. Backend  (http://localhost:4000)
cd backend
copy .env.example .env      # then edit DB credentials and JWT_SECRET
npm install
node server.js

# 3. Frontend (http://localhost:5173 — proxies /api and /socket.io to :4000)
cd ../frontend
npm install
npm run dev
```

`backend/seed.js` / `npm run seed` are **LOCAL ONLY**; never run them against a hosted or production database.

### Production (migrations only, no seed)

```bash
cd backend
node scripts/db.js setup-production
node scripts/bootstrap-production.js
node server.js
# or: npm run start:production
```

`setup-production` applies `database/schema-production.sql` (DDL only) and `database/migrations/*.sql`. No sample users, camps, slots, bookings, waitlist rows, staff assignments or notifications are inserted. `bootstrap-production.js` creates only the real staff accounts from `BOOTSTRAP_*` variables; patients self-register. Regenerate the data-free DDL with `node scripts/generate-production-schema.mjs`.

Required Railway variables: `NODE_ENV=production`, `JWT_SECRET`, `MYSQL_URL` / `DB_NAME=railway`, `FRONTEND_ORIGIN`, `TRUST_PROXY=2`, `BOOTSTRAP_ADMIN_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_ORGANIZER_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_DOCTOR_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_VOLUNTEER_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_PHONE_SEED`, `PURGE_ON_BOOT=false`. To replace an older seeded database, set `PURGE_ON_BOOT=true` and `ALLOW_PRODUCTION_PURGE=true` for one deployment, then return both to `false`. SMTP/SMS variables are optional; without credentials, delivery is labelled Sandbox and no real email/SMS delivery is claimed.

## 3. Accounts

There are no seeded accounts. Four staff accounts (admin, organizer, doctor, volunteer) are created once by `bootstrap-production.js` from the `BOOTSTRAP_*` environment variables. Patients create their own accounts through `POST /api/auth/register`. Never commit bootstrap passwords or use sample credentials in a deployed environment.

## 4. The four presentation scenarios (real data only)

These use records created through the API in the running MySQL instance. Never fabricate a scenario with sample rows in a deployed environment.

1. **Last-Seat Concurrency** — run the real row-lock proofs:
   ```bash
   cd backend && node concurrency-test.js   # 20 requests / 1 seat → 1 held+confirmed, 19 FIFO-waitlisted, 0 overbooked
   cd backend && npm test                   # includes 50 requests / 10 seats → 10 held+confirmed, 40 waitlisted, 0 overbooked
   ```
   The 50-way proof is the mandatory invariant and is reproduced by `backend/scripts/verify-live.js` against the running Express + MySQL stack.
2. **Waitlist Auto-Promotion** — cancel a real confirmed booking for a full slot; the first waiting neighbour is promoted inside the same transaction, and the notification audit log records the attempt (Sandbox-labelled when no gateway credentials are configured).
3. **QR Check-In** — verify a real QR token from a confirmed booking and watch the Live Queue TV update over Socket.io (`checkin:new` / `queue:updated`).
4. **Smart Analytics** — executive KPIs and the Capacity Advisor computed from real MySQL aggregates.

Utilities: **Viva Science X-Ray** and screenshot-friendly layouts. There is no scenario loader, no simulated rush hour and no demo-data reset button.

## 5. Feature map

- **Guided 3-step booking** (camp → slot → 10-minute hold → confirm) with travel-mode + on-time pledge (`implementation intentions`, Gollwitzer 1999), gated by Hick's/Miller's/Fitts's laws — visible via the Science X-Ray toggle.
- **Transactional booking** — `SELECT … FOR UPDATE` on the slot row; `booked_count ≤ capacity` enforced by a CHECK constraint; overbooking is structurally impossible.
- **Bounded reservation** — a successful book returns `HELD` with `holdExpiresAt`; `POST /api/bookings/:id/confirm` commits the QR pass and reminders. Expiry is swept by cron and on manual admin trigger.
- **FIFO waitlist with claim windows** — cancellation or hold expiry atomically promotes position 1 into a `PROMOTED` hold; an unclaimed promotion expires and flows to the next patient.
- **Zero-guilt cancellation** — one tap, no penalty; the seat flows to a waiting neighbour.
- **QR Health Passport** — inline SVG QR + `.ics` download; offline-cacheable; issued only after confirmation and check-in accepts only `CONFIRMED` bookings; glass effect reserved for the passport and sidebar only.
- **Live Queue TV** — full-bleed dark panel, huge tabular-numeral token, NOW SCREENING / UP NEXT, average-wait stats; broadcasts over Socket.io from live bookings.
- **Camp management** — deterministic auto-slot generator (`k = floor(ΔT/Δt)`, remainder spread earliest-first), staff matrix with clinical load warnings (≥25 warn / ≥30 critical per doctor-shift).
- **Analytics** — KPIs, bookings-vs-capacity, attendance-vs-no-show and hourly utilisation computed from real MySQL aggregates, plus server-side CSV export.
- **Capacity Advisor** — `min( ceil(C_phys/(1−p)), floor(C_phys×(1+α_max)) )`, α_max = 25%. Explicitly labelled **"Rule-Based Statistical Heuristic — NOT Black-Box AI/ML"**.
- **Notifications** — Gateway Interceptor audit log for every SMS/email; node-cron sweeps at 24h and 2h; de-duplicated per booking + type. With no SMTP/SMS credentials configured, attempts are labelled **Sandbox**; no real delivery is claimed.
- **Privacy by design** — schema holds only name, phone, email, age group. No medical history fields exist. One-tap purge (`DELETE /api/users/me/purge`, DPDP-aligned).
- **Bilingual** — English + ಕನ್ನಡ navigation and primary actions (partial localization, stated honestly).
- **Dark/light themes**, reduced-motion support, print/screenshot-ready layouts.

## 6. Project layout

```
database/schema.sql              Local development schema + LOCAL-ONLY fixtures
database/schema-production.sql   Generated DDL-only production bootstrap (no data rows)
database/migrations/            Incremental DDL migrations
backend/scripts/db.js            Local setup + idempotent production schema/migrations
backend/scripts/bootstrap-production.js  Creates real staff accounts from env vars
backend/server.js                Express API, JWT auth, row-lock transactions, Socket.io, cron
backend/concurrency-test.js      50-way last-seat race (10/40/0, real MySQL proof)
backend/tests/integration/       50-way / 10-seat proof and hold-expiry tests
backend/seed.js                  LOCAL ONLY — never run in production
backend/.env.example             DB + JWT + mail configuration template
frontend/src/App.jsx             provider → auth gate → shell + pages
frontend/src/store.jsx           global state (auth, status, theme, lang, toasts, socket)
frontend/src/lib/api.js          the ONLY network boundary — strict live, no fallback
frontend/src/components/         Shell, Passport, LiveQueueTV, ui primitives
frontend/src/pages/              Login, Overview, Discover, MyBookings, StaffDay, Manage, Analytics, ConcurrencyProof, ControlRoom, AuditLog, Notifications, Settings
```

## 7. Production build

```bash
cd frontend && npm run build     # → frontend/dist
node ../backend/server.js        # backend serves dist/ automatically when present
```

## 8. Viva defense — quick answers

**Q: How do you guarantee zero overbooking?**
The booking transaction does `SELECT capacity, booked_count FROM slots WHERE id=? FOR UPDATE`, aborts if `booked_count >= capacity`, otherwise increments and inserts a `HELD` reservation with a 10-minute expiry. `POST /api/bookings/:id/confirm` re-locks the row and expires stale holds before committing. The InnoDB row lock serialises concurrent bookings; the CHECK constraint `booked_count <= capacity` is the database-level backstop. Proof: 20 requests / 1 seat and 50 requests / 10 seats both end 0 overbooked.

**Q: Is the waitlist actually FIFO?**
Yes — promotion takes the lowest `position` with status `WAITING` under the same row lock that releases the seat, so two simultaneous cancellations cannot promote two people into one seat. Promotions are bounded by `promotion_expires_at`; if unclaimed, the sweep releases the seat and promotes the next patient atomically.

**Q: Where is the AI/ML?**
There is none, deliberately. The Capacity Advisor is a transparent closed-form heuristic with an explicit safety ceiling; its inputs (empirical no-show rate) and formula are displayed on screen. The no-show *reduction* KPI is labelled "modelled" (Gollwitzer meta-analytic range), not measured causally.

**Q: How do you know the data is real?**
There is only one runtime path: API → Express → MySQL. The sidebar reports live connection status; an outage produces a real error. Analytics and queues read real tables. The only sandbox label is for SMTP/SMS attempts when no gateway credentials are configured — it never refers to database records.

**Q: What personal data do you store?**
Name, phone, email, age group — nothing else. No medical history, diagnosis, prescription or report fields exist in the schema. Users can purge everything with one tap.

**Q: Behavioral science claims?**
Each one is annotated by the Viva Science X-Ray (Hick, Miller, Fitts, Jakob, Zeigarnik, Peak-End, Gollwitzer's implementation intentions, FIFO fairness, privacy by design) — toggle the flask icon in the top bar.

**Q: What happens if the backend is unreachable?**
The app shows the real network error. There is no local engine to switch to, because fabricated results would be indistinguishable from real bookings. The Pages build pins `VITE_API_BASE` from the required GitHub variable `RENDER_API_URL`, so the public site always targets the real Railway backend.
