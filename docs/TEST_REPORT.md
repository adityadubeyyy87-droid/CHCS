# CHSC — Test & Verification Report (Release Hardening)

_Status: green as of 2026-11-21. Evidence below is from the exact working tree shipped in this release._

This is the honest, reproducible record for Phase 1 (Engineering Completion) and the
subsequent security, reliability, accessibility and deployment hardening pass.

---

## 1. Environment under test

| Component | Version / value |
|---|---|
| Node.js | 24.19.0 locally (CI uses Node 20) |
| MySQL | 8.4.9 Community Server, InnoDB, local portable instance |
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
| Mode chip | `LIVE · MySQL` on every authenticated route |
| Console errors | 0 |
| Failed network requests (4xx/5xx) | 0 (organizer staff list no longer 403s) |
| Horizontal overflow | none on checked routes at the browser's current width |
| Nested buttons | 0 |
| Persistent error notes | 0 |
| StaffDay QR token field | visible, 528×44px, correctly labelled |
| Booking flow | slot selection → commitment panel → confirmation + 4 SVG passport codes |
| Build asset | `assets/index-C2uv4Ez2.js` |

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

## 6. Bugs found and fixed in this release

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

---

## 7. Remaining issues / honest limitations

1. **No public backend or hosted MySQL** is provisioned. The GitHub Pages site therefore
   runs the clearly labelled `DEMO · LOCAL` engine by design. It is not fake production
   data and never claims to be a database result.
2. **SMTP/SMS are sandbox providers** (`SMTP_HOST` blank, `SMS_PROVIDER=Fast2SMS Sandbox`).
   Delivery attempts are recorded in `notifications_log`; no real messages are sent.
3. **Bundle-size warning remains** for the 3D/react-three-fiber chunk (>500 kB before
   gzip). It is lazy-loaded and does not block first paint; further splitting is Phase 2.
4. **Lighthouse performance was not benchmarked** by the available browser tool; only
   accessibility, best practices and SEO were audited.
5. Responsive checks were performed at the available browser viewport (785px CSS width)
   plus source-level media-query review; a device-emulator matrix was not available in
   this harness.

---

## 8. Reproduction

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

_Report generated 2026-11-21 for the release hardening pass. Any new test must pass
before the next feature ships (test-first release policy)._
