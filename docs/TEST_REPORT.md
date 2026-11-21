# CHSC — Test & Verification Report (Engineering Completion)

_Status: live, reproducible, green as of 2026-11-21._

This is the honest, current record of test evidence for Phase 1 (Engineering Completion)
and the post-hardening verification run.

---

## 1. Environment under test

| Component | Version / value |
|---|---|
| Node.js | `>=18` (local LTS channel) |
| MySQL | 8.4.9 Community Server (InnoDB) — local portable instance |
| Express | 4.21 |
| JWT | jsonwebtoken 9 |
| bcryptjs | 2.4.3 |
| Zod | 3.23 |
| Vitest | 2.1.9 |
| supertest | 7 |

Backend boots clean (`node --check` clean) and reports:
`{ ok: true, service: CHSC API, demoMode: true, database: "connected", dbVersion: "8.4.9", socket: "ready" }`

---

## 2. Automated test suite

Command: `cd backend && npm test`

| Suite | Files | Result |
|---|---|---|
| Unit | `tests/unit/validation`, `pagination`, `reminders`, `slots` | PASS |
| Unit | `tests/unit/limits` (added this sprint) | PASS |
| Integration | `tests/integration/auth`, `booking`, `camps`, `staff`, `attendance`, `export`, `reminders`, `concurrency` | PASS |
| Integration | `tests/integration/audit` (added this sprint) | PASS |

**Total: 14 test files · 79 tests · 79 passing.**

### Coverage mapped to the Phase 1 checklist

| Requirement | Evidence |
|---|---|
| Authentication / authorization | `auth.test.js` — register, bcrypt hash, JWT, role guards (403), validation envelope |
| Booking integrity / concurrency | `concurrency.test.js` — 50 parallel bookings → exactly 10 confirmed, 40 waitlisted, 0 overbooked, 0 duplicate-active |
| Cancellation / waitlist promotion | `booking.test.js` + live run — cancel releases seat, FIFO promotion fires |
| Rescheduling | `booking.test.js` — moves a booking to another slot |
| Staff conflicts | `staff.test.js` — overlapping shift → 409 `STAFF_OVERLAP` |
| Reminders | `reminders.test.js` (unit + integration) — 24h/2h sweeps, idempotency |
| Attendance / no-show | `attendance.test.js` — check-in, NO_SHOW, close-out |
| Analytics / CSV | `export.test.js` — CSV header/content, analytics aggregates |
| Rate limiting | `limits.test.js` — buckets, keying, bypass |
| Error handling / validation | `validation.test.js` — zod envelope, shared error format, 429 |

### Bugs found and fixed during this verification sprint

1. **Audit log endpoint 500'd on any row with a `before`/`after` snapshot.**
   `JSON.parse()` was applied to JSON columns that `mysql2` already decodes to objects.
   Fix: added `decodeJsonColumn()` that accepts object or string. Added regression test
   `tests/integration/audit.test.js` (3 tests).
2. **Auth rate-limit bucket was per-IP only**, which would lock out a full demo hall
   (many roles behind one NAT address) after 10 legitimate logins. Fix: bucket keyed by
   IP + identifier, coarse per-IP backstop retained. Added `tests/unit/limits.test.js`
   (7 tests).

---

## 3. Live end-to-end verification (real HTTP → real Express → real MySQL)

Script: `backend/scripts/verify-live.js`

```
node scripts/verify-live.js        # against http://127.0.0.1:4000
BASE_URL=https://api.example.com node scripts/verify-live.js
```

The script exercises the real network path (no supertest in-memory harness) and covers:

- health, MySQL connectivity, Socket.io readiness
- demo login for all five roles + register / login / wrong-password / zod validation
- authorization (patient cannot create a camp; unauthenticated rejected)
- organizer: create camp → slot allocation (6×10 for a 3h camp) → update → staff assign → overlap 409
- public camp list pagination + camp detail with slots
- patient: book (201) → double-click → 409 `DUPLICATE_BOOKING` (no second row) → bookings/me
- patient: cancel (200) → rebook (201) → reschedule (200)
- waitlist: capacity-1 camp → 2nd/3rd bookings → FIFO positions 1, 2 → cancel #1 → promotion
- QR check-in by volunteer → booking becomes `CHECKED_IN`
- control room aggregates, admin analytics KPIs, capacity advisor, notifications, audit log
- CSV export → `text/csv` with header row
- reminder sweep → idempotent
- concurrency proof: **10 confirmed / 40 waitlisted / 0 errors / 0 overbooked**
- camp close-out

**Result: 43 / 43 checks passed.**

---

## 4. Mandatory stress test (formal evidence)

- In-suite: `backend/tests/integration/concurrency.test.js` — 50 parallel bookings
  against capacity 10 → 10 confirmed, 40 waitlisted, FIFO positions 1–40, slot counter
  consistent, zero 5xx. **PASS**
- Live-server proof: `/api/demo/concurrency` (50 requests, capacity 10) →
  `confirmed: 10, waitlisted: 40, errors: 0, zeroOverbooked: true`. **PASS**

---

## 5. Known issues / outstanding hardening (honest list)

1. **SMTP/SMS providers are sandboxed** (`SMTP_HOST` blank, `SMS_PROVIDER=Fast2SMS Sandbox`).
   Reminder delivery records outcomes in `notifications_log` — delivery path is sandboxed by design.
2. **Deployment** not executed in this environment (no public hosting credentials available).
   See `DEPLOYMENT.md`.
3. **Performance budget**: frontend production bundle is ~1.31 MB / 382 KB gzip with a
   >500 kB warning (recharts + three.js). See Phase 2/5 work.
4. **`api.notifications(limit)` query param is accepted but the backend paginates via
   `page`/`pageSize`** — behaviour validated as 200 with defaults.

---

## 6. How to reproduce

```bash
mysql -u root -p < database/schema.sql
cd backend && npm test          # full suite
cd backend && npm run db:setup  # dev DB + seed
cd backend && node server.js
node scripts/verify-live.js    # live E2E evidence
cd ../frontend && npm run dev
```

---

_Report generated during the Phase 1 engineering-completion sprint, 2026-11-21._
_Any new test must pass before a feature ships (test-first release policy)._
