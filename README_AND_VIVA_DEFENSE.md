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

## 2. Quick start

### Mode A — real MySQL + Socket.io

```bash
# 1. Database (creates schema + deterministic seed data)
mysql -u root -p < database/schema.sql

# 2. Backend  (http://localhost:4000)
cd backend
copy .env.example .env      # then edit DB credentials if needed
npm install
npm run seed                # optional: reseed demo dataset
node server.js

# 3. Frontend (http://localhost:5173 — proxies /api and /socket.io to :4000)
cd ../frontend
npm install
npm run dev
```

When the backend is reachable the UI shows a green **“Backend Connected · MySQL”** chip and a `LIVE · MySQL` badge. Every write is a real InnoDB transaction.

### Mode B — local demo engine (no MySQL needed)

```bash
cd frontend
npm install
npm run dev                 # backend offline → app auto-falls back
```

`src/lib/api.js` probes `GET /api/health` at startup. When no `VITE_API_BASE` is configured and the backend is down, the same components run against `src/lib/engine.js` — an in-memory engine that mirrors every API response shape. The mode chip switches to amber **“DEMO”** and every simulated artifact is stamped `SIMULATED` (dashed badges, "Local Engine" provider tags). Simulated results are **never** presented as real database results. The deployed public bundle sets `VITE_API_BASE`, so it is strictly live and never falls back.

## 3. Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cmrit.edu` | `Admin@123` |
| Organizer | `organizer@cmrit.edu` | `Password@123` |
| Doctor | `doctor@cmrit.edu` | `Password@123` |
| Volunteer | `volunteer@cmrit.edu` | `Password@123` |
| Patient | `patient@cmrit.edu` | `Password@123` |

The Login screen also has one-click **demo role shortcuts** (they use `POST /api/auth/demo-login` in Mode A, the local engine in Mode B).

## 4. The four presentation scenarios

Use the floating **Demo** controller (bottom-left after sign-in):

1. **Last-Seat Concurrency** — the Concurrency Proof page (Analytics) races 20 requests for 1 seat in DEMO mode and labels the result `SIMULATED`. The *real* MySQL proofs are:
   ```bash
   cd backend && node concurrency-test.js   # 20 requests / 1 seat → 1 held+confirmed, 19 FIFO-waitlisted, 0 overbooked
   cd backend && npm test                   # includes 50 requests / 10 seats → 10 held+confirmed, 40 waitlisted, 0 overbooked
   ```
   The 50-way proof is the mandatory invariant and is reproduced by `backend/scripts/verify-live.js` against the running Express + MySQL stack.
2. **Waitlist Auto-Promotion** — releases demo booking `CHSC-BLR-104`; the first waiting neighbour is promoted inside the same transaction, and the Gateway Interceptor shows the simulated SMS/email.
3. **QR Check-In** — verifies token `CHSC-BLR-104` and broadcasts it to the Live Queue TV (Socket.io event `checkin:new` / `queue:updated`).
4. **Smart Analytics** — executive KPIs and the Capacity Advisor walkthrough.

Utilities: **Reset demo data** (local engine re-seeds; for MySQL re-run `database/schema.sql`), **Simulate rush hour**, **Clean PPT screenshot mode**, **Viva Science X-Ray**.

## 5. Feature map

- **Guided 3-step booking** (camp → slot → 10-minute hold → confirm) with travel-mode + on-time pledge (`implementation intentions`, Gollwitzer 1999), gated by Hick's/Miller's/Fitts's laws — visible via the Science X-Ray toggle.
- **Transactional booking** — `SELECT … FOR UPDATE` on the slot row; `booked_count ≤ capacity` enforced by a CHECK constraint; overbooking is structurally impossible.
- **Bounded reservation** — a successful book returns `HELD` with `holdExpiresAt`; `POST /api/bookings/:id/confirm` commits the QR pass and reminders. Expiry is swept by cron and on manual admin trigger.
- **FIFO waitlist with claim windows** — cancellation or hold expiry atomically promotes position 1 into a `PROMOTED` hold; an unclaimed promotion expires and flows to the next patient.
- **Zero-guilt cancellation** — one tap, no penalty; the seat flows to a waiting neighbour.
- **QR Health Passport** — inline SVG QR + `.ics` download; offline-cacheable; issued only after confirmation and check-in accepts only `CONFIRMED` bookings; glass effect reserved for the passport and sidebar only.
- **Live Queue TV** — full-bleed dark panel, huge tabular-numeral token, NOW SCREENING / UP NEXT, average-wait stats; broadcasts over Socket.io in Mode A.
- **Camp management** — deterministic auto-slot generator (`k = floor(ΔT/Δt)`, remainder spread earliest-first), staff matrix with clinical load warnings (≥25 warn / ≥30 critical per doctor-shift).
- **Analytics** — honest KPIs, bookings-vs-capacity, attendance-vs-no-show, hourly utilisation, CSV export (real endpoint in Mode A; clearly-labelled in-browser export in Mode B).
- **Capacity Advisor** — `min( ceil(C_phys/(1−p)), floor(C_phys×(1+α_max)) )`, α_max = 25%. Explicitly labelled **"Rule-Based Statistical Heuristic — NOT Black-Box AI/ML"**.
- **Notifications** — Gateway Interceptor audit log for every SMS/email; node-cron sweeps at 24h and 2h; de-duplicated per booking + type; sandboxed providers, rows stamped `SIMULATED` when not delivered by a real gateway.
- **Privacy by design** — schema holds only name, phone, email, age group. No medical history fields exist. One-tap purge (`DELETE /api/users/me/purge`, DPDP-aligned).
- **Bilingual** — English + ಕನ್ನಡ navigation and primary actions (partial localization, stated honestly).
- **Dark/light themes**, reduced-motion support, print/screenshot-ready layouts.

## 6. Project layout

```
database/schema.sql        9 InnoDB tables + CHECK constraints + seed data
backend/server.js          Express API, JWT auth, row-lock transactions, Socket.io, cron
backend/concurrency-test.js 20-way last-seat race (real MySQL proof)
backend/tests/integration/ 102 tests incl. 50-way / 10-seat proof and hold expiry
backend/seed.js            reseed helper
backend/.env.example       DB + JWT + mail configuration template
frontend/src/App.jsx       provider → auth gate → shell + pages
frontend/src/store.jsx     global state (auth, mode, theme, lang, toasts, socket)
frontend/src/lib/api.js    the ONLY network boundary — Mode A/B switching lives here
frontend/src/lib/engine.js Mode B local demo engine (mirrors API shapes)
frontend/src/components/   Shell, Passport, LiveQueueTV, ConcurrencyArena, DemoController, ui primitives
frontend/src/pages/        Login, Overview, Discover, MyBookings, StaffDay, Manage, Analytics, Notifications, Settings
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

**Q: What is real vs simulated in the demo?**
The mode chip in the sidebar and every badge tell you. Mode A = real MySQL transactions, real Socket.io broadcasts. Mode B = local engine; results carry `SIMULATED` badges and "Local Engine" provider tags. Notification delivery is a sandboxed gateway in both modes — the interceptor logs metadata either way.

**Q: What personal data do you store?**
Name, phone, email, age group — nothing else. No medical history, diagnosis, prescription or report fields exist in the schema. Users can purge everything with one tap.

**Q: Behavioral science claims?**
Each one is annotated by the Viva Science X-Ray (Hick, Miller, Fitts, Jakob, Zeigarnik, Peak-End, Gollwitzer's implementation intentions, FIFO fairness, privacy by design) — toggle the flask icon in the top bar.

**Q: Why a local engine at all?**
Viva reliability: when there is no configured backend, the full product must demo without MySQL installed, without network access, and without dead buttons. The engine mirrors API response shapes exactly, so the same UI code runs in both modes and the difference is always visible via `DEMO` badges. The deployed build pins `VITE_API_BASE` and is strictly live — a backend outage shows an error rather than simulated data.
