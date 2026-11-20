# CHSC — Community Health Screening Camp Scheduler

Full-stack HealthTech platform for running free community health screening camps in Bengaluru — built as a CMRIT ISE mini project. Four roles (Patient, Organizer, Doctor, Volunteer, Admin), transactional seat booking under row locks, FIFO waitlist auto-promotion, QR check-in, a live waiting-room TV, and a rule-based Capacity Advisor.

---

## 1. Stack (exactly as specified)

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, socket.io-client, inline-SVG QR (`qrcode` renders to SVG; no images) |
| Backend | Node.js, Express, JWT (`jsonwebtoken`), `bcryptjs`, `node-cron`, Nodemailer, Socket.io |
| Database | MySQL 8, `mysql2/promise`, InnoDB, `SELECT … FOR UPDATE` row locks |
| Design | "Biophilic Future — Intelligent Healthcare for Everyone" — premium Apple-inspired minimalism, futuristic medical technology, organic 3D environments, sophisticated glass surfaces, cinematic visual storytelling, emerald & mint lighting, Inter + Plus Jakarta Sans + Noto Sans Kannada, dark clinical default |
| Motion | `motion` (Framer Motion v11) — cinematic page transitions, scroll reveals, magnetic buttons, 3D tilt effects, text shimmer/scramble/morph, animated number counters, spotlight effects, confetti celebrations |
| 3D | Three.js + React Three Fiber — cinematic 3D health emblem on login, 3D health data visualizations on analytics, biophilic orb backgrounds |

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

`src/lib/api.js` probes `GET /api/health` at startup. If the backend is down, the same components run against `src/lib/engine.js` — an in-memory engine that mirrors every API response shape. The mode chip switches to amber **“Local Demo Mode”** and every simulated artifact is stamped `SIMULATED` (dashed badges, "Local Engine" provider tags). Simulated results are **never** presented as real database results.

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

1. **Last-Seat Concurrency** — the Concurrency Arena (Analytics page) races 20 requests for 1 seat through the exact `FOR UPDATE` transaction path: 1 confirmed, 19 FIFO-waitlisted, **0 overbooked**. The *real* MySQL verification is `backend/concurrency-test.js`:
   ```bash
   cd backend && node concurrency-test.js
   ```
   Expect: 20 parallel `POST /api/slots/:id/book` with `mysql2` pool → exactly 1 `CONFIRMED`, 19 `WAITLISTED` in arrival order.
2. **Waitlist Auto-Promotion** — releases demo booking `CHSC-BLR-104`; the first waiting neighbour is promoted inside the same transaction, and the Gateway Interceptor shows the simulated SMS/email.
3. **QR Check-In** — verifies token `CHSC-BLR-104` and broadcasts it to the Live Queue TV (Socket.io event `checkin:new` / `queue:updated`).
4. **Smart Analytics** — executive KPIs and the Capacity Advisor walkthrough.

Utilities: **Reset demo data** (local engine re-seeds; for MySQL re-run `database/schema.sql`), **Simulate rush hour**, **Clean PPT screenshot mode**, **Viva Science X-Ray**.

## 5. Feature map

- **Guided 3-step booking** (camp → slot → commit) with travel-mode + on-time pledge (`implementation intentions`, Gollwitzer 1999), gated by Hick's/Miller's/Fitts's laws — visible via the Science X-Ray toggle.
- **Transactional booking** — `SELECT … FOR UPDATE` on the slot row; `booked_count ≤ capacity` enforced by a CHECK constraint; overbooking is structurally impossible.
- **FIFO waitlist** — one cancellation atomically promotes position 1 inside the same transaction and notifies them.
- **Zero-guilt cancellation** — one tap, no penalty; the seat flows to a waiting neighbour.
- **QR Health Passport** — inline SVG QR + `.ics` download; offline-cacheable; glass effect reserved for the passport and sidebar only.
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
database/schema.sql        7 InnoDB tables + CHECK constraints + seed data
backend/server.js          Express API, JWT auth, row-lock transactions, Socket.io, cron
backend/concurrency-test.js 20-way parallel booking race (real MySQL proof)
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
The booking transaction does `SELECT capacity, booked_count FROM slots WHERE id=? FOR UPDATE`, aborts if `booked_count >= capacity`, otherwise increments and commits. The InnoDB row lock serialises concurrent bookings; the CHECK constraint `booked_count <= capacity` is the database-level backstop. Proof: `backend/concurrency-test.js` (20 parallel requests, 0 overbooked).

**Q: Is the waitlist actually FIFO?**
Yes — promotion takes the lowest `position` with status `WAITING` under the same row lock that releases the seat, so two simultaneous cancellations cannot promote two people into one seat, and nobody can jump the queue.

**Q: Where is the AI/ML?**
There is none, deliberately. The Capacity Advisor is a transparent closed-form heuristic with an explicit safety ceiling; its inputs (empirical no-show rate) and formula are displayed on screen. The no-show *reduction* KPI is labelled "modelled" (Gollwitzer meta-analytic range), not measured causally.

**Q: What is real vs simulated in the demo?**
The mode chip in the sidebar and every badge tell you. Mode A = real MySQL transactions, real Socket.io broadcasts. Mode B = local engine; results carry `SIMULATED` badges and "Local Engine" provider tags. Notification delivery is a sandboxed gateway in both modes — the interceptor logs metadata either way.

**Q: What personal data do you store?**
Name, phone, email, age group — nothing else. No medical history, diagnosis, prescription or report fields exist in the schema. Users can purge everything with one tap.

**Q: Behavioral science claims?**
Each one is annotated by the Viva Science X-Ray (Hick, Miller, Fitts, Jakob, Zeigarnik, Peak-End, Gollwitzer's implementation intentions, FIFO fairness, privacy by design) — toggle the flask icon in the top bar.

**Q: Why a local engine at all?**
Viva reliability: the full product must demo without MySQL installed, without network access, and without dead buttons. The engine mirrors API response shapes exactly, so the same UI code runs in both modes and the difference is always visible to the viewer.
