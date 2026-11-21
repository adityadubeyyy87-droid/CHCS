# CHSC — Test & Verification Report (Release Hardening)

_Status: green as of 2026-11-22. Evidence below is from the exact working tree shipped in this release._

This is the honest, reproducible record for Phase 1 (Engineering Completion) and the
subsequent security, reliability, accessibility and deployment hardening pass.

---

## 1. Environment under test

| Component | Version / value |
|---|---|
| Node.js | 24.19.0 locally; Node 20.20.2 in CI and on Railway |
| MySQL | 8.4.9 local portable instance; 8.4.13 on Railway, InnoDB |
| Express | 4.21 |
| JWT | jsonwebtoken 9 |
| bcryptjs | 2.4.3 |
| Zod | 3.23 |
| Vitest | 2.1.9 |
| supertest | 7 |
| Frontend | React 18 + Vite 5, production build served by backend |

Local backend health:

```json
{
  "ok": true,
  "service": "CHSC API",
  "demoMode": true,
  "database": "connected",
  "dbVersion": "8.4.9",
  "socket": "ready"
}
```

The local PM2 process is online as `chsc`, bound to `127.0.0.1:4000` via
`ecosystem.config.cjs` (the explicit local-demo opt-in). Demo login still works
locally; production deployments with `NODE_ENV=production` require
`ALLOW_LOCAL_DEMO=true` or a loopback `HOST`.

Public production health (Railway, 2026-11-21):

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

Public URLs:

- Frontend: `https://adityadubeyyy87-droid.github.io/CHCS/`
- Backend: `https://exemplary-strength-production-fbfcb823.up.railway.app/`
- Repository: `https://github.com/adityadubeyyy87-droid/CHCS`

---

## 2. Automated backend suite

Command: `cd backend && npm test`

| Suite | Files | Result |
|---|---|---|
| Unit | `validation`, `pagination`, `reminders`, `slots`, `limits`, `security` | PASS |
| Integration | `auth`, `booking`, `camps`, `staff`, `attendance`, `export`, `reminders`, `concurrency`, `audit`, `frontend-serve`, `security-regression` | PASS |

**Total: 17 test files · 98 tests · 98 passing.**

Security/correctness regressions added or extended in this pass:

- production demo guardrail cannot be satisfied by loopback-only CORS defaults
- organizer staff list is PII-free and no longer returns 403
- JWT role/status are reloaded from the database on each request
- socket identity is authenticated and PII is redacted from broadcasts
- destructive slot rebuilds remain opt-in and blocked
- reschedule authority is restricted and never resurrects a `SENT` reminder
- CSV fan-out, reminder re-queue safety and migration idempotency are covered
- `ALPHA_MAX` is honoured when the query parameter is absent

Additional mechanical checks:

- `node --check` clean for `server.js`, `lib/security.js`, `lib/validation.js`,
  `lib/reminders.js`, `scripts/db.js` and `scripts/verify-live.js`
- `git diff --check` clean (only CRLF normalization warnings)
- direct `fetch(` exists only in `frontend/src/lib/api.js`
- production build succeeds: 1793 modules transformed, no compile errors
- CI builds the frontend before backend tests so the static-serving regression runs
  against a real `frontend/dist` in the runner too

---

## 3. Database migration verification

`database/migrations/002_waitlist_expiry.sql` was rewritten without the mysql-client
`DELIMITER` directive and verified through the repo's own runner:

1. Fresh schema + `npm run db:migrate` twice → all three migrations applied both times.
2. Legacy-shaped `waitlist` table without the expiry column/index → migration added
   `promotion_expires_at` and `idx_wait_expires` safely.
3. `backend/scripts/db.js` now selects `DB_NAME` before every migration file, so an
   earlier file's `USE` statement cannot redirect later migrations.

---

## 4. Live end-to-end verification

Script: `backend/scripts/verify-live.js` against `http://127.0.0.1:4000`
(real HTTP → Express → MySQL).

**Result: 43 / 43 checks passed.**

Coverage includes health/database/socket, demo login for all five roles, register/login
and validation, role guards, camp creation and slot generation, staff assignment and
overlap 409, booking/duplicate-booking/cancel/rebook/reschedule, FIFO waitlist
promotion, QR check-in, control room, analytics, advisor labelling, notifications,
audit log, CSV export, idempotent reminder sweep, camp close-out and the mandatory
concurrency proof.

Concurrency proof result:

```json
{"confirmed":10,"waitlisted":40,"errors":0,"zeroOverbooked":true}
```

---

## 5. Browser verification (production build)

Built UI served by the local backend at `http://localhost:4000/`.

| Check | Result |
|---|---|
| Role/route matrix | All 5 roles × all permitted routes render the expected `<h1>` |
| Mode chip | `LIVE · MySQL` on every authenticated route, including public Pages after the live backend was connected |
| Demo sign-in navigation | updates hash to `#/overview` for one-click sessions and normal login |
| Console errors | 0 |
| Failed network requests (4xx/5xx) | 0 (organizer staff list no longer 403s) |
| Horizontal overflow | none on checked routes at the browser's current width |
| Nested buttons | 0 |
| Persistent error notes | 0 |
| StaffDay QR token field | visible, 528×44px, correctly labelled |
| Booking flow | slot selection → commitment panel → confirmation + 4 SVG passport codes |
| Build asset | local `assets/index-C2uv4Ez2.js`; public live asset `assets/index-CFkkecyO.js` |

The one intentional 409 observed during manual exploration was a legitimate duplicate
camp booking, shown inline as "You already have an active booking at this camp.
Reschedule it instead." A second booking on a different camp succeeded and produced a
Digital Health Passport.

Lighthouse on the public landing route:

| Category | Score |
|---|---|
| Accessibility | 1.00 |
| Best practices | 1.00 |
| SEO | 1.00 |
| Failures | none |

The Impeccable detector returned an empty finding list for `frontend/src` after the
side-tab, decorative-grid and gradient-text cleanups.

---

## 6. Public full-stack verification (Railway + GitHub Pages)

Performed against the actual public URLs on 2026-11-21 after the Railway backend,
Railway MySQL, GitHub variable and Pages workflow were connected. This is
**authoritative data**, not the local demo engine.

| Check | Evidence / result |
|---|---|
| Mode chip | `LIVE · MySQL` after health detection completed; public bundle `assets/index-CFkkecyO.js` |
| Health | `GET /api/health` → 200, `demoMode: false`, `database: connected`, `dbVersion: 8.4.13`, `socket: ready` |
| Strict-live | `VITE_API_BASE` injected from repo variable `RENDER_API_URL`; no `SIMULATED` value is presented as a DB result |
| Socket | `wss://…/socket.io/` handshake → 101 |
| Public aggregates | Initially 7 camps / 45 slots / 121 bookings / 3 waitlists / 20 registered patients; all from MySQL |
| Sign-in | Patient `Meera Sharma` (id 6), organizer `Nandini Rao` (id 2), doctor `Dr. Ananya Rao` (id 3), admin `Kavya Rao` (id 1) |
| Booking | Camp `Indiranagar Primary Health Camp`, 10:30 AM → token `D-978410`, reference `CHSC-BLR-735528`, booking id `2001` |
| Duplicate guard | Immediate inline error: “You already have an active booking at this camp. Reschedule it instead.” |
| Cancel / release | Booking `2001` → `CANCELLED` with `cancelledAt`; toast correctly reported no waiting patient to promote |
| FIFO promotion | Camp 1, 09:30 slot: cancelling booking `9` atomically promoted booking `2007` (`Deepa Shetty`) and moved counts from 6 booked / 3 waiting to 6 booked / 2 waiting |
| Reschedule | Patient booking `1` moved 10:00 → 10:30 slot (`5 → 6`) and status became `CONFIRMED` |
| Organizer | Created camp id `101`, `Railway Live Verification Camp`, 12 booking capacity / 10 physical seats; slots generated and camp visible in Manage and public lists |
| Check-in | API check-ins `F-855031`, `E-705326`, `D-390601`, `E-449470`; booking `2002` joined the live queue |
| Real-time sync | Live Queue TV changed 1 → 3 checked in without reload, added `D-390601`, banner `Now serving D-390601` |
| Staff Day | Doctor roster and `Online` scanner rendered; labelled QR form submitted `E-449470` with toast `Token E-449470 joined the live waiting room.` |
| Notifications | Real notification rows rendered with `SIMULATED` sandbox badges for Nodemailer/Fast2SMS and gateway-interceptor copy |
| Settings | Theme, language and science-annotation controls work; `science-on` applied and reverted cleanly |
| Admin APIs | `/api/admin/analytics`, `/api/admin/users`, `/api/admin/notifications`, `/api/admin/audit-log`, `/api/admin/reports/export.csv` all 200 |
| Analytics UI | Live MySQL aggregates, Recharts SVG charts, `Rule-Based Statistical Heuristic — NOT Black-Box AI/ML`, CSV report section |
| Control Room | Live camp fill board, check-in queue and staff status |
| CSV export | Public button produced an OPTIONS 204 then authenticated GET 200 with a real `text/csv` report |
| Concurrency page | The interactive 50-way race is demo-only; it returned 403 in strict-live production. The button is now explicitly disabled there with a test-backed explanation, so no enabled control produces a simulated/forbidden result. Server invariant remains proven locally at 10 / 40 / 0 |
| Console | Fresh unauthenticated public load: 0 console errors. Intentional 401/409/403s during negative tests were expected and surfaced in-UI |

Seeded demo accounts are intentionally retained for verification and must be
changed or removed before accepting real patients:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cmrit.edu` | `Admin@123` |
| Organizer | `organizer@cmrit.edu` | `Password@123` |
| Doctor | `doctor@cmrit.edu` | `Password@123` |
| Volunteer | `volunteer@cmrit.edu` | `Password@123` |
| Patient | `patient@cmrit.edu` | `Password@123` |

---

## 7. Bugs found and fixed in this release

1. Organizer staff matrix received a 403 from the admin users endpoint; organizers now
   get a minimal PII-free projection.
2. Mode detection could race page hooks and let a request hit Mode B while the chip was
   still "Connecting"; `withFallback()` now awaits memoized detection.
3. `StaffDay` QR input was clipped by `sr-only`; restored as a visible labelled input.
4. `StaffDay` offline sync captured a stale `campId`; queue reload is now keyed on it.
5. Production demo guardrail failed open with the shipped loopback CORS defaults; now
   requires explicit opt-in.
6. Migration 002 used `DELIMITER`, which mysql2 cannot parse, and `db.js` did not select
   a database for migrations; both fixed and verified.
7. `ALPHA_MAX` was silently overridden by a hardcoded query default; removed.
8. Landing-page accessible names did not include visible text; corrected.
9. `/robots.txt` fell through to the SPA HTML; a valid static file is now shipped.
10. Decorative grid backgrounds, side-tab borders and gradient text were removed in
    favour of the established hairline-card system.
11. `api.notifications(limit)` now sends the backend's supported `pageSize` parameter.
12. The strict-live Concurrency Proof page no longer offers an enabled button that calls
    the demo-only `/api/demo/concurrency` endpoint; it explains that the invariant is
    covered by real MySQL tests instead.
13. A child page could trigger the memoised health probe before the app provider
    registered its mode listener, leaving a live build labelled `DEMO` while live data
    loaded. `AppProvider` now adopts the resolved mode directly, so the chip and every
    `simulated` badge match the actual API path.

---

## 8. Remaining issues / honest limitations

1. **Railway is on a trial** showing roughly **30 days or $5.00 left**. The public URLs
   work now, but uninterrupted 24/7 availability needs a paid Railway plan or migration.
   There is no custom domain: Pages uses the default `github.io` URL and the backend uses
   the default Railway hostname. Continued operation also requires keeping the GitHub
   variable `RENDER_API_URL` in sync with the backend origin.
2. **Seeded demo accounts remain publicly usable** (see section 6). They exist for
   reproducible verification, not for real patient intake; rotate/remove them before
   production use and replace with an approved registration workflow.
3. **SMTP/SMS are sandbox providers** (`SMTP_HOST` blank, `SMS_PROVIDER=Fast2SMS Sandbox`).
   Delivery attempts are recorded in `notifications_log` and the UI labels them
   `SIMULATED`; no real email or SMS is sent.
4. **Bundle-size warning remains** for the 3D/react-three-fiber chunk (>500 kB before
   gzip). It is lazy-loaded and does not block first paint; further splitting is Phase 2.
5. **Lighthouse performance was not benchmarked** by the available browser tool; only
   accessibility, best practices and SEO were audited (1.00 / 1.00 / 1.00).
6. Responsive checks were performed at the available browser viewport (785px CSS width)
   plus source-level media-query review; a device-emulator matrix was not available in
   this harness.
7. The interactive zero-overbooking race is intentionally unavailable in strict-live
   production; its result is never faked. The backend suite still proves the invariant
   against real MySQL.

---

## 9. Reproduction

```bash
# backend suite + live E2E
cd backend
npm test
node scripts/verify-live.js

# production frontend build
cd ../frontend
npm run build

# database migrations (idempotent)
cd ../backend
npm run db:migrate

# local full version
npm run live      # from the repository root
```

---

_Report generated 2026-11-21, updated 2026-11-22 with public full-stack evidence.
Any new test must pass before the next feature ships (test-first release policy)._
