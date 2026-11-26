# CHSC — Test & Verification Report

_Historical evidence record from the 2026-11-22 hardening pass, with a current 2026-11-26 section below. The application is strict-live; re-run the commands here after any code change before treating results as current._

## Current pass — 2026-11-27

| Check | Result |
|---|---|
| `cd backend && npm test` | **28 files / 171 tests passed** on local MySQL 8.4.x |
| `cd frontend && npm test` | **8 tests passed** |
| `cd frontend && npm run build` | **PASS** — Vite build completed (only the pre-existing large-chunk advisory) |
| Readiness unit tests | 12 passed — provider booleans including VAPID/free path, DLT route, healthy camp, blockers, overbooking/past date, sandbox warning, capacity mismatch, date helper |
| Readiness integration tests | 5 passed — patient/doctor 403, organizer report shape, organizer self-test 403, invalid channel 400, sandbox test + `audit_log` row, redacted SMS recipient |
| Browser push unit tests | 5 passed — endpoint/key validation, redacted device view, honest sandbox, encrypted payload with expired-subscription pruning |
| Browser push integration tests | 8 passed — public config, auth, unique subscription storage, invalid endpoints, removal, refused self-test audit, `PUSH` audit channel, erasure |
| Notification status regression | 1 passed — live-provider rows start at schema-valid `QUEUED`, never the rejected `PENDING` value |
| Seat counter regression | 1 passed — cancelling a live HELD booking whose unsigned counter drifted to `0` no longer throws `ER_DATA_OUT_OF_RANGE`; repeated cancel cannot decrement twice |
| Test isolation | `backend/tests/setup.js` deletes SMTP/Fast2SMS/VAPID env values so no test can send a real email, SMS or browser push |
| Browser smoke | Login with a real local MySQL account → `#/overview`; Ops Readiness page rendered scored camps and provider cards; zero console errors |
| Motion regression | `InView(once)` now latches after first intersection, so auth forms cannot become invisible when scrolled out of view |

The live data used by the browser smoke came from the local development database. No seed command was run against MySQL 8.4.13 on Railway.

This report records the reproducible test approach for Phase 1 (Engineering Completion) and the security, reliability, accessibility and deployment hardening pass. Production contains no seeded sample data and no simulated database results.

---

## 1. Environment under test

| Component | Version / value |
|---|---|
| Node.js | 24.19.0 locally; Node 20.x in CI and on Railway |
| MySQL | 8.4.x local portable instance; 8.4.13 on Railway, InnoDB |
| Express | 4.21 |
| JWT | jsonwebtoken 9 |
| bcryptjs | 2.4.3 |
| Zod | 3.23 |
| Vitest | 2.1.9 |
| supertest | 7 |
| Frontend | React 18 + Vite 5, production build served by backend |

Health response schema used in verification (no mode flags):

```json
{
  "ok": true,
  "service": "CHSC API",
  "database": "connected",
  "dbVersion": "8.4.x",
  "socket": "ready"
}
```

Public URLs in the record:

- Frontend: `https://adityadubeyyy87-droid.github.io/CHCS/`
- Backend: `https://exemplary-strength-production-fbfcb823.up.railway.app/`
- Repository: `https://github.com/adityadubeyyy87-droid/CHCS`

---

## 2. Automated backend suite

Command: `cd backend && npm test`

| Suite | Files | Result in the recorded pass |
|---|---|---|
| Unit | `validation`, `pagination`, `reminders`, `slots`, `limits`, `security` | PASS |
| Integration | `auth`, `booking`, `holds`, `camps`, `staff`, `attendance`, `export`, `reminders`, `concurrency`, `audit`, `frontend-serve`, `security-regression` | PASS |

Recorded total at that time: **18 test files · 102 tests · 102 passing**. The current count must be re-measured with `npm test`; do not quote the old number as current evidence.

Correctness regressions covered in that pass:

- JWT role/status are reloaded from the database on each request
- Socket identity is authenticated and PII is redacted from broadcasts
- Staff lists are PII-free for organizers
- Destructive slot rebuilds remain opt-in and blocked
- Reschedule authority is restricted and never resurrects a completed reminder
- CSV fan-out, reminder re-queue safety and migration idempotency are covered
- `ALPHA_MAX` is honoured when the query parameter is absent
- Bookings are `HELD` until explicit confirm; QR check-in rejects `HELD` and accepts only `CONFIRMED`
- Doctor/volunteer HTTP mutations are restricted to assigned camps; the queue TV read remains public
- Expired holds and unclaimed FIFO promotions release seats to the next patient

Mechanical checks:

- `node --check` clean for the backend entry point and core libs
- direct `fetch(` exists only in `frontend/src/lib/api.js`
- frontend production build completes without compile errors
- CI builds the frontend before backend tests so static-serving checks run against a real `frontend/dist`

---

## 3. Database migration verification

`database/migrations/002_waitlist_expiry.sql` was rewritten without the mysql-client `DELIMITER` directive and verified through the repo's own runner:

1. Fresh local schema + `npm run db:migrate` twice → migrations applied both times.
2. Legacy-shaped `waitlist` table without the expiry column/index → migration 002 added `promotion_expires_at` and `idx_wait_expires` safely.
3. Legacy-shaped `bookings` table with the old status enum and without hold columns/indexes → migration 004 applied twice; final state contained `HELD`/`EXPIRED`, `hold_expires_at`, a `HELD`-aware `active_camp_id` expression and `idx_bookings_hold_expiry`. Re-applying changed nothing.
4. `backend/scripts/db.js` selects the connection's database before every migration file, so a `USE` line in one file cannot redirect later migrations on Railway.

Production bootstrapping uses `database/schema-production.sql`, a generated DDL-only file with zero data statements. `node scripts/generate-production-schema.mjs` regenerates it and guards against data-bearing SQL.

---

## 4. Live end-to-end verification

Script: `backend/scripts/verify-live.js` against a running Express + MySQL backend (real HTTP, no in-memory engine).

Recorded result at the time: **47 / 47 checks passed**.

Coverage includes health/database/socket, registration and real login, role guards, camp creation and slot generation, staff assignment and overlap conflicts, `HELD` booking → explicit `CONFIRMED`, duplicate-booking guards, cancel/rebook/reschedule, FIFO waitlist promotion into a bounded claim window, QR check-in of confirmed bookings only, control room, analytics, advisor labelling, notifications, audit log, CSV export, idempotent reminder sweep, camp close-out and the mandatory concurrency proof.

Concurrency proof result:

```json
{"held":10,"confirmed":10,"waitlisted":40,"errors":0,"zeroOverbooked":true}
```

---

## 5. Browser verification (production build)

Built UI served by the local backend at `http://localhost:4000/`.

| Check | Recorded result |
|---|---|
| Role/route matrix | All 5 roles × permitted routes rendered the expected headings |
| Connection status | `LIVE · MySQL` on authenticated routes; no fallback mode existed |
| Console errors | 0 |
| Failed network requests (4xx/5xx) | 0 on positive paths; expected 401/409/403 on negative tests |
| Horizontal overflow | none on checked routes |
| Nested buttons | 0 |
| Persistent error notes | 0 |
| StaffDay QR token field | visible, labelled |
| Booking flow | slot selection → commitment panel → confirmation + inline SVG passport codes |
| Public asset | `assets/index-CFkkecyO.js` at the recorded verification time (hash changes after edits) |

Lighthouse on the recorded public landing route: Accessibility 1.00, Best practices 1.00, SEO 1.00. Re-run after UI changes.

---

## 6. Public full-stack verification (Railway + GitHub Pages)

Performed against the actual public URLs after the Railway backend, Railway MySQL, GitHub variable and Pages workflow were connected. All rows came from MySQL; no seeded accounts or sample records were used.

| Check | Evidence / result |
|---|---|
| Connection status | `LIVE · MySQL` after health detection completed |
| Health | `GET /api/health` → 200, `database: connected`, `dbVersion: 8.4.13`, `socket: ready` |
| Strict live | `VITE_API_BASE` injected from repo variable `RENDER_API_URL`; no fabricated value presented as a DB result |
| Socket | `/socket.io/` handshake → 101 |
| Accounts | Registered through the real API and staff accounts from bootstrap variables, never committed fixtures |
| Booking | Real `HELD` → `CONFIRMED` flow, token/reference generated by the server |
| Duplicate guard | Inline error: “You already have an active booking at this camp. Reschedule it instead.” |
| Cancel / release | Booking moved to `CANCELLED` with `cancelledAt` |
| FIFO promotion | Cancelling a confirmed booking for a full slot promoted the first waiter atomically |
| Reschedule | Booking moved to another slot and status returned to `CONFIRMED` |
| Organizer | Created a real camp; slots generated and visible in Manage and public lists |
| Check-in | Real confirmed tokens joined the live queue |
| Real-time sync | Live Queue TV updated without reload |
| Notifications | Real audit rows; attempts labelled Sandbox because no SMTP/SMS keys were configured |
| Admin APIs | `/api/admin/analytics`, `/api/admin/users`, `/api/admin/notifications`, `/api/admin/audit-log`, `/api/admin/reports/export.csv` all 200 |
| Analytics UI | Live MySQL aggregates, Recharts charts, `Rule-Based Statistical Heuristic — NOT Black-Box AI/ML` |
| CSV export | Authenticated GET 200 with a real `text/csv` report |
| Concurrency page | The browser race is not a production data source; the invariant is proven by the backend suite against MySQL |
| Console | Fresh unauthenticated public load: 0 console errors |

There are **no seeded demo accounts** in production. Staff credentials are supplied as `BOOTSTRAP_*` secrets and patients self-register.

---

## 7. Issues fixed in the hardening pass (historical)

1. Organizer staff matrix no longer receives 403 from the admin users endpoint.
2. Connection-state detection no longer races page hooks; the UI cannot label a live path incorrectly.
3. `StaffDay` QR input restored as a visible labelled field.
4. `StaffDay` sync keyed on the active `campId`.
5. CORS defaults no longer act as an accidental local-mode opt-in; strict-live is the only runtime.
6. Migration 002 `DELIMITER` issue and database selection fixed and verified.
7. `ALPHA_MAX` hardcoded default removed.
8. Landing-page accessible names corrected.
9. `/robots.txt` served as a valid static file.
10. Decorative grid backgrounds, side-tab borders and gradient text removed.
11. `api.notifications(limit)` sends the backend's supported `pageSize` parameter.
12. The browser concurrency control no longer offers an enabled action that calls a non-existent demo endpoint; the proof is the real backend test.

---

## 8. Remaining issues / honest limitations

1. **Hosting continuity** depends on the platform plan/trial and keeping `RENDER_API_URL` in sync with the backend origin.
2. **SMTP/SMS are Sandbox** without credentials. Attempts are audited; no real delivery is claimed.
3. **Bundle-size warning** remains for the lazy-loaded 3D chunk; further splitting is future work.
4. **Lighthouse performance** was not benchmarked by the available browser tool; only accessibility, best practices and SEO were audited.
5. **Responsive checks** used the available browser viewport plus media-query review; a full device-emulator matrix was not available.
6. **The interactive browser race is not a production feature**; zero overbooking is proven by real MySQL tests, never faked.
7. Production starts with no sample records. Empty dashboards are expected until real data is created.

---

## 9. Reproduction

```bash
# backend suite + live E2E (real MySQL)
cd backend
npm test
node scripts/verify-live.js

# production frontend build
cd ../frontend
npm run build

# database migrations (idempotent, no seed)
cd ../backend
npm run db:migrate

# local full version
npm run live      # from the repository root
```

---

_Any new test must pass before the next feature ships (test-first release policy). Re-run everything after code changes; this file records past evidence, not a live status endpoint._

---

## Addendum — Maps ticket QR + transactional delivery pass (2026-11-25)

Commit: `b597205` (pushed to `master` and `main`).

Measured in this pass:

| Check | Result |
|---|---|
| Backend suite (`cd backend && npm test`) | **24 files / 139 tests passed** |
| Frontend suite (`cd frontend && npm test`) | **8 tests passed** |
| Frontend production build (`npm run build`) | PASS, `index-BzYKdfw_.js` published to Pages |
| Production schema + all 5 migrations, applied twice to a scratch MySQL 8.4 database | PASS, idempotent, 0 rows |
| GitHub Pages deploy workflow | PASS |
| Local live API: `/api/health`, `/api/camps`, `/n/<real token>` | PASS — `demoMode:false`, Maps 302 redirect |

New coverage in this pass:

- `tests/unit/maps.test.js` — coordinate/address Maps URLs, token-in-fragment QR payloads, token extraction, short links.
- `tests/unit/messages.test.js` — booking ID, camp, date, time, full address, Maps link, short link, inline QR CID, HTML escaping, reschedule/cancellation copy.
- `tests/unit/validation.test.js` — optional coordinate coercion, blank-string handling, out-of-range rejection.
- `tests/integration/ticketing.test.js` — 60-bit ticket tokens, Maps QR check-in, `/n/<token>` redirect, confirmation payload content, duplicate confirmation suppression, reschedule EMAIL+SMS, organizer coordinate update, honest sandbox retry refusal.

Honest deployment note (superseded during the final pass): the GitHub Pages frontend redeployed automatically. The Railway backend at the public URL was still serving the previous build when this addendum was written (`/n/<fake>` returned the SPA HTML instead of the API's 404). The new backend code is committed and locally verified; a Railway redeploy requires dashboard/CLI access and must be completed before the hosted backend exposes `/n/<token>` or the new notification payloads.

**Final pass update (2026-11-25):** the Railway backend was redeployed via the Railway CLI from the clean working tree at HEAD `6cef421` (deploy id `4ebfdb5c-7226-421e-8377-ddd678c29bf6`, healthcheck PASS). Post-redeploy live verification confirmed `/n/<token>` → Google Maps 302, `/n/<fake>` → 404 JSON, enriched booking-2022 notification rows (full address + short nav link, honest `SIMULATED`/`Email Sandbox`/`SMS Sandbox`), and full Maps-QR check-in → `CHECKED_IN` with idempotent duplicate handling. Real SMTP/SMS delivery remains blocked until provider credentials (and Indian DLT sender/template) are configured; rows are correctly labelled **Sandbox** until then.
