# CHSC — Final A–N Audit Report

**Report date:** 2026-11-22

**Pre-audit baseline:** `f73fc55917f9965a1793eb4210c58b3b3a612fcb`

**Application commit delivered:** `eb60b350531dcacbe0404f23a3f5874e158cdd5d`

**Runtime policy:** **STRICT LIVE / REAL DATA ONLY**. No demo engine, no offline database substitute, no seeded production records, no fabricated KPI, no fake delivery claim, no invented URL.

> **Overall result:** A–M are **PASS**. N is **BLOCKED only on the Railway dashboard redeploy/configuration**; the code and frontend deployment are verified, but this environment has no `RAILWAY_TOKEN`, `RAILWAY_API_TOKEN`, `gh`, `railway` CLI, `GITHUB_TOKEN` or `GH_TOKEN`. The currently hosted Railway backend is therefore still the previous deployment and must be redeployed with the variables and start command in section N.

---

## 1. A–N status

| # | Area | Before (`f73fc55`) | After / evidence | Status |
|---|---|---|---|---|
| **A** | Strict-live runtime and demo removal | **FAIL.** `backend/server.js` had `DEMO_MODE` defaulting to `true`, `/api/auth/demo-login`, `/api/demo/*` guards, and an analytics note saying values came from “seeded demonstration data”. Frontend had `frontend/src/lib/engine.js` (612 lines), `DemoController.jsx` (176), `ConcurrencyArena.jsx` (134) and demo-session gateway events. | All three files deleted; demo endpoints/flags deleted; `JWT_SECRET` is mandatory; health reports `demoMode:false`; verifier proves demo endpoints return 404; local health is `{"ok":true,"demoMode":false,"database":"connected","dbVersion":"8.4.9","socket":"ready"}`. | **PASS** |
| **B** | Single network boundary and connection honesty | **FAIL.** Multiple frontend surfaces could source substitute state; demo sessions produced fake gateway events. | Only `frontend/src/lib/api.js` contains `fetch(` (2 occurrences); `store.jsx` uses `connecting | live | error`; unavailable API surfaces the real error; updates come through authenticated Socket.io only; no polling/fake timers were reintroduced. | **PASS** |
| **C** | Auth, roles and route guards | **PARTIAL.** Role rules existed but demo login bypassed real identity. | Demo login removed; route-level RBAC in `App.jsx`/`Shell.jsx`; API role guards reloaded from MySQL; admin and patient browser E2E used real accounts; negative role checks verified by `verify-live.js`. | **PASS** |
| **D** | Booking lifecycle, QR passport, cancel/waitlist | **PARTIAL.** Two-phase flow existed, but QR/camp context and UI states needed proof. | Real E2E: register → discover → slot → `HELD` → `CONFIRMED` → QR passport with real venue **and street address** → My Appointments → Pass modal → `CANCELLED`; separate full-slot join produced backend-assigned `FIFO position #2`. QR check-in rejects `HELD`; QR token/reference are real DB values. | **PASS** |
| **E** | Concurrency and overbooking safety | **MISSING.** Browser proof had a fake arena; the real script was a smaller 20-way demonstration. | Production-capable `/api/admin/concurrency-proof` with proof-only cleanup; UI proof page reads live results. Local script: `RESULT: PASS — 10 Confirmed · 40 Safely Waitlisted · 0 Overbookings`; DB evidence `capacity=10, seats taken=10, confirmed=10, waiters=40`; temp rows removed. | **PASS** |
| **F** | Dashboards, analytics, management data | **FAIL.** Analytics contained `Modelled no-show reduction`; Overview could show premature zeros; Manage did not use the role-gated manage scope. | Fabricated KPI removed; loading skeletons/`—` replace premature zeros; provenance is `live-mysql`; Manage uses `GET /api/camps?scope=manage` (HTTP 200, `scope=manage`, 36 real camps); DRAFT camps are role-gated and covered by regression tests. | **PASS** |
| **G** | Notifications and provider honesty | **PARTIAL.** Sandbox/SIMULATED labels existed, but needed end-to-end assertions. | No credentials ⇒ notifications are logged and labelled `SIMULATED` with `Email Sandbox`/`SMS Sandbox`; real providers only when configured. Verifier output: `provider metadata honest: SIMULATED only with Sandbox provider`. No real delivery is claimed. | **PASS** |
| **H** | Production schema and bootstrap | **MISSING.** `schema-production.sql` contained 12 standalone `INSERT` statements; no env-driven four-account bootstrap. | Generated schema is DDL-only: generator reports `0 INSERT/REPLACE/TRUNCATE/DELETE/UPDATE/DROP/CREATE DATABASE/USE/SET @`; precise statement scan `DATA_STATEMENTS=0`, `CREATE_TABLE_IF_NOT_EXISTS=10`. `bootstrap-production.js` creates only 4 staff accounts from env vars and is idempotent; purge needs both `PURGE_ON_BOOT=true` and `ALLOW_PRODUCTION_PURGE=true`. Seed remains local-only. | **PASS** |
| **I** | Build, CI and Pages injection | **PARTIAL.** Pages did not have a guaranteed live API base; CI still set demo flags. | `RENDER_API_URL` is injected as `VITE_API_BASE`; CI no longer sets `DEMO_MODE`; CI workflow run `45038411261` and Pages workflow run `45038411263` both succeeded for `eb60b35`. Final hosted build asset is `assets/index-CV8Ijz1F.js`; lazy chunks verified online. | **PASS** |
| **J** | Design system and accessibility | **PARTIAL.** Last detector/accessibility pass had outstanding issues; full slot buttons were disabled and skipped keyboard focus. | Fixed full slots to remain focusable while unavailable; waitlist action works by keyboard/click; icon-only buttons have labels; toasts use `aria-live="polite"`; no `transition: all`, no `outline:none` without focus-visible, no `user-scalable=no`. Impeccable detector over 15 changed frontend targets returned `[]`. | **PASS** |
| **K** | Automated tests and live verification | **PARTIAL.** Historical record showed 18 files/102 tests and 47/47 live checks. | Final rerun: **21 files / 117 tests passed**, duration **76.85s**; `verify-live.js`: **58/58 checks passed**; `concurrency-test.js`: PASS; `git diff --check`: exit 0. | **PASS** |
| **L** | Manual browser E2E | **PARTIAL.** Admin routes had been checked; patient booking/waitlist/QR pass had not. | Admin routes all rendered with `LIVE · MySQL`, zero `role=alert`, zero console errors. Patient E2E completed registration, booking, passport, appointments, cancel and FIFO waitlist with zero console errors. Public Pages tab: `LIVE · MySQL`, health call 200, zero console errors. | **PASS** |
| **M** | Repository hygiene and secrets | **PARTIAL.** Docs still named deleted `ConcurrencyArena` and an obsolete 20-way proof. | Stale docs corrected; only tracked env file is `backend/.env.example` (placeholder `DB_PASSWORD=your_mysql_password`); `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, `node_modules/`, `dist/`; no secret values in commits; normal pushes only, no force-push. | **PASS** |
| **N** | Deployment and public URLs | **PARTIAL.** URLs existed, but Railway was still the previous deployment and hosted camera policy was `camera=()`. | Pages frontend is deployed and verified at `eb60b35`; GitHub repo and both branches verified; Railway health/CORS/Socket.io verified reachable. Railway still needs the dashboard variables/start command below; after redeploy, `permissions-policy` must change from `camera=()` to `camera=(self)`. | **BLOCKED — dashboard action required** |

---

## 2. Real test output (final rerun)

### Backend suite

```text
$ cd backend && npm test
Test Files  21 passed (21)
Tests       117 passed (117)
Duration    76.85s
EXITCODE=0
```

New regression coverage includes strict-live health, demo-endpoint absence, provider honesty, DRAFT privacy/manage scope, booking address/context, startup guards, env-driven bootstrap and purge safety.

### Live MySQL verifier

```text
$ ADMIN_EMAIL=admin@cmrit.edu ADMIN_PASSWORD=Admin@123 node scripts/verify-live.js
PASS  analytics provenance is live MySQL
PASS  no fabricated no-show reduction KPI
PASS  capacity advisor is labelled a non-AI heuristic
PASS  provider metadata honest: SIMULATED only with Sandbox provider
PASS  concurrency proof: 50 requests / 10 confirmed / 40 waitlisted / 0 violations
PASS  proof records live pre-cleanup DB evidence
PASS  proof cleanup restored the reused slot booked_count to 0

58/58 checks passed
```

### 50-way race proof

```text
$ ADMIN_EMAIL=admin@cmrit.edu ADMIN_PASSWORD=Admin@123 node concurrency-test.js
✓ total requests            50
✓ slot capacity             10
✓ confirmed seats           10
✓ FIFO waitlisted           40
✓ transaction errors        0
✓ zero overbooking          true
✓ DB evidence capacity      10
✓ DB evidence seats taken   10
✓ temp users removed        0
✓ temp bookings removed     0

RESULT: PASS — 10 Confirmed · 40 Safely Waitlisted · 0 Overbookings
Protected by live InnoDB row locks. No synthetic rows remain.
```

### Frontend build and static checks

```text
$ cd frontend && npm run build
✓ built in 22.98s
EXITCODE=0
# asset: assets/index-BNrsVVd9.js (local API base)

$ VITE_API_BASE=https://exemplary-strength-production-fbfcb823.up.railway.app npm run build
✓ built in 17.76s
EXITCODE=0
# asset: assets/index-CV8Ijz1F.js (exact Pages build)
```

Only the pre-existing chunk-size advisory remains; it is not a compile error.

```text
$ git diff --check
DIFFCHECK_EXIT=0

$ node scripts/generate-production-schema.mjs
Wrote database\schema-production.sql
Verified: 0 INSERT/REPLACE/TRUNCATE/DELETE/UPDATE/DROP/CREATE DATABASE/USE/SET @ statements.
DATA_STATEMENTS=0
CREATE_TABLE_IF_NOT_EXISTS=10

$ impeccable detect --json <15 changed frontend targets>
[]
```

### Codebase leakage search

- `fetch(` in `frontend/src`: only `frontend/src/lib/api.js` lines 68 and 216.
- Strict pattern for `/api/demo`, `DEMO_MODE`, `DemoController`, `ConcurrencyArena`, `lib/engine`, `lorem ipsum`, `faker(`, `mockImplementation`, `TODO`, `FIXME`: no application-code hits. Remaining matches are explicit prohibitions in `AGENTS.md`/`CLAUDE.md` or negative assertions in `verify-live.js` and `live-only.test.js`.
- No `TODO`/`FIXME` in frontend or backend source.

---

## 3. Browser E2E evidence

### Admin role (local production build at `http://localhost:4000/`)

- Login: `admin@cmrit.edu` / `Admin@123`.
- `LIVE · MySQL` visible.
- Routes rendered: `overview`, `staffDay`, `liveQueue`, `manage`, `analytics`, `concurrencyProof`, `controlRoom`, `auditLog`, `notifications`, `settings`.
- Real rows visible: 36 camps, 133 slots, 386 patients, audit log entries (including the E2E `CANCEL BOOKING` row), notifications, settings, live-queue camp dropdowns.
- Manage API request: `GET /api/camps?scope=manage` → HTTP 200, `scope=manage`.
- UI proof: `10 CONFIRMED`, `40 WAITLISTED (FIFO)`, `0 ERRORS / 500S`, `DB BOOKED_COUNT 10`, `ZERO OVERBOOKING — PASS`.
- Console errors: **0**; persistent `role=alert` elements: **0**.

### Patient role (real registration through the API)

- Registered a new patient from the UI; no demo account or seeded identity was used.
- Discover showed real camps/slots; selected a live slot.
- Commitment panel → hold → `Confirm my pass` → confirmed passport.
- Passport showed real camp, date, slot, venue, street address, token `D-818175` and reference `CHSC-BLR-447012`.
- My Appointments showed the confirmed booking; Pass modal reopened the same live passport.
- `Release` changed the booking to `CANCELLED` in the UI and audit log.
- Selecting a genuinely full slot and joining the waitlist returned backend-assigned `FIFO position #2`.
- Console errors: **0**.
- Fix applied during E2E: unavailable full slots remain keyboard-focusable so users can still reach the FIFO waitlist action; build and route checks were rerun afterward.

---

## 4. Verified URLs and deployment state

| URL | Verified result |
|---|---|
| `https://github.com/adityadubeyyy87-droid/CHCS` | HTTP 200; repository reachable. |
| `https://adityadubeyyy87-droid.github.io/CHCS/` | HTTP 200; fresh browser tab loaded `assets/index-CV8Ijz1F.js`, showed `LIVE · MySQL`, called hosted `/api/health` with 200, zero console errors. |
| `https://exemplary-strength-production-fbfcb823.up.railway.app/api/health` | HTTP 200; `{"ok":true,"service":"CHSC API","demoMode":false,"database":"connected","dbVersion":"8.4.13","socket":"ready"}`. |
| Hosted CORS preflight from Pages origin | HTTP 204; `access-control-allow-origin: https://adityadubeyyy87-droid.github.io`. |
| Hosted Socket.io polling handshake | HTTP 200; valid Engine.IO `sid` with websocket upgrade. |

**Important distinction:** the hosted Railway backend is still the previous deployment. It currently returns `permissions-policy: camera=()`; the new code returns `camera=(self)` locally. The Pages frontend is current at `eb60b35`, and the backend source is pushed at `eb60b35`, but Railway has not been redeployed from this environment.

### Git hygiene and push

```text
ed24cb3 feat(backend): enforce strict-live API and production bootstrap
f87bb01 feat(frontend): remove demo surfaces and harden live booking UX
eb60b35 ci(docs): pin hosted API and document strict-live deployment

To https://github.com/adityadubeyyy87-droid/CHCS.git
   f73fc55..eb60b35  master -> master
   f73fc55..eb60b35  master -> main

refs/heads/main   eb60b350531dcacbe0404f23a3f5874e158cdd5d
refs/heads/master eb60b350531dcacbe0404f23a3f5874e158cdd5d
```

No force-push was used. CI run `45038411261` (`CHSC CI`) and Pages run `45038411263` (`Deploy CHSC (free public site)`) both completed with `conclusion: success` for `eb60b35`.

---

## 5. Exactly what is needed for N to become PASS

You chose to set Railway variables in the dashboard. From this environment there is no Railway/GitHub deployment credential, so please apply the following in Railway and redeploy.

### Required Railway variables

```text
NODE_ENV=production
JWT_SECRET=<strong random secret>
MYSQL_URL=<Railway MySQL secret/reference>
DB_NAME=railway
FRONTEND_ORIGIN=https://adityadubeyyy87-droid.github.io
TRUST_PROXY=2
BOOTSTRAP_ADMIN_EMAIL=<real address>
BOOTSTRAP_ADMIN_PASSWORD=<real strong password>
BOOTSTRAP_ADMIN_NAME=<real name>
BOOTSTRAP_ORGANIZER_EMAIL=<real address>
BOOTSTRAP_ORGANIZER_PASSWORD=<real strong password>
BOOTSTRAP_ORGANIZER_NAME=<real name>
BOOTSTRAP_DOCTOR_EMAIL=<real address>
BOOTSTRAP_DOCTOR_PASSWORD=<real strong password>
BOOTSTRAP_DOCTOR_NAME=<real name>
BOOTSTRAP_VOLUNTEER_EMAIL=<real address>
BOOTSTRAP_VOLUNTEER_PASSWORD=<real strong password>
BOOTSTRAP_VOLUNTEER_NAME=<real name>
BOOTSTRAP_PHONE_SEED=<10-digit starting phone>
PURGE_ON_BOOT=false
ALLOW_PRODUCTION_PURGE=false
```

SMTP/SMS variables are optional. Without them, keep the honest **Sandbox** labels.

### Railway settings

```text
Root directory: repository root
Build command: cd frontend && npm ci && npm run build
Start command: cd backend && npm ci --omit=dev && node scripts/db.js setup-production && node scripts/bootstrap-production.js && node server.js
Healthcheck path: /api/health
Port: 8080
Runtime: Node 20
Replicas: 1
```

The current hosted start command is reported as missing `node scripts/bootstrap-production.js`; add it before redeploying.

### Optional one-time reset of the old seeded database

Only if you intentionally want to replace the old seeded database:

1. Set `PURGE_ON_BOOT=true` and `ALLOW_PRODUCTION_PURGE=true`.
2. Deploy once. Confirm only the four bootstrap staff accounts exist and operational tables are empty.
3. Set **both** variables back to `false` and redeploy.

Never run `backend/seed.js` or `npm run seed` against hosted MySQL.

### Post-redeploy verification checklist

After Railway redeploys, these must be rechecked against the live URL:

1. `GET /api/health` → `ok:true`, `demoMode:false`, `database:connected`.
2. `permissions-policy` → `camera=(self), microphone=(), geolocation=()`.
3. CORS preflight from `https://adityadubeyyy87-droid.github.io` → 204 with the exact allowed origin.
4. Socket.io polling handshake → 200 with a valid `sid`.
5. Fresh Pages browser tab → `LIVE · MySQL`, no console errors, health 200.
6. Sign in with a real bootstrap account; confirm no demo surfaces and Sandbox-only provider labels.
7. If real SMTP/SMS credentials are supplied, recheck provider metadata: `SIMULATED` must no longer appear for those channels.

---

## 6. Conclusion

The application code is fully strict-live, tested, committed and pushed; the frontend is deployed and verified on GitHub Pages. Every A–M finding from the pre-audit baseline has been fixed and re-tested with real MySQL output. The only remaining item is the Railway dashboard redeploy described above; no fake success or invented deployment credential is claimed.

---

## 7. Post-report calendar export polish

After the A–N report above, the `.ics` invite generator was hardened in `frontend/src/lib/ics.js`:

- added an explicit `VTIMEZONE` for `Asia/Kolkata` (IST, `+0530`) so the event stays pinned to the camp’s local time in every calendar client;
- replaced the dangling `Venue, ` line with a clean `LOCATION` when no address exists;
- escaped RFC 5545 text (`\\`, `;`, `,`, newlines) and folded long lines at 75 octets without splitting UTF-8 characters;
- added honest `STATUS` mapping (`CONFIRMED`, `TENTATIVE`, `CANCELLED`) and `TRANSP:OPAQUE`;
- made object-URL cleanup reliable in `downloadIcs()`;
- added 8 frontend unit tests (`frontend/tests/ics.test.mjs`) and wired them into `npm test` and CI.

This does not change any A–N status. N remains blocked only on the Railway dashboard redeploy. A corrected copy of the reported invite was generated from its real fields at `C:\Users\COMPUTER WORLD\Downloads\chsc-CHSC-BLR-750882-fixed.ics`. No address or booking detail was invented.

---

## 8. Finalisation addendum — `11bde03`

The last UI change made the camp facts, slot tiles and generated slot-plan blocks symmetric: four equal columns on desktop, two equal columns below `900px`. It touched only:

- `frontend/src/index.css`
- `frontend/src/pages/Discover.jsx`
- `frontend/src/pages/Manage.jsx`

Browser geometry was measured against live MySQL rows: equal cell widths/heights and zero horizontal overflow on both Discover and Manage. `npm test` passed 8/8, both local and hosted `RENDER_API_URL` builds passed, the design detector returned no findings, and the browser console had zero errors.

Final Git state:

```text
11bde03 fix(frontend): make camp and slot blocks symmetrical
<final docs-only commit>  docs: finalize audit addendum for 11bde03
```

`master` and `main` resolve to the same final docs-only commit; the deployed application code remains `11bde03`. No force-push was used.

Final GitHub deployment evidence:

| Item | Result |
|---|---|
| `CHSC CI` run `45044084810` for `11bde03` | `completed` / `success` |
| `Deploy CHSC (free public site)` run `45044084863` for `11bde03` | `completed` / `success` |
| Published Pages entry | `assets/index-BgATRaIV.js` + `assets/index-C2NpWuvB.css` |
| Published CSS contains symmetric layout rules | `fact-grid-4`, `repeat(var(--slot-cols,4),...)`, 4-column `.slot-plan` — all present |
| Fresh hosted browser load | `LIVE · MySQL`, real camp rows, login screen reachable, zero console errors |
| Hosted CORS preflight | HTTP `204`, `access-control-allow-origin: https://adityadubeyyy87-droid.github.io` |
| Hosted Socket.io polling handshake | HTTP `200`, valid Engine.IO `sid` |
| Hosted public camps API | HTTP `200`, real MySQL camp rows returned |
| Backend health | HTTP `200`, `demoMode:false`, `database:connected`, `dbVersion:8.4.13`, `socket:ready` |

### Final published links

- App: `https://adityadubeyyy87-droid.github.io/CHCS/`
- Repository: `https://github.com/adityadubeyyy87-droid/CHCS`
- Deployed app commit: `https://github.com/adityadubeyyy87-droid/CHCS/commit/11bde038a6031d1724fb373907f6ae94e17256a0`
- Final repository HEAD: `https://github.com/adityadubeyyy87-droid/CHCS/commits/master`
- Backend health: `https://exemplary-strength-production-fbfcb823.up.railway.app/api/health`

### Remaining honest deployment gap

A–M remain **PASS**. N remains **BLOCKED** on the Railway dashboard redeploy. At final verification the Railway health endpoint still returned `permissions-policy: camera=(), microphone=(), geolocation=()`, while the committed backend unconditionally serves `camera=(self), microphone=(), geolocation=()`. The backend is live and connected to MySQL, but it is not yet running the current commit. No fake deployment success is claimed. To close N, set the Railway start command from section 5 and redeploy, then confirm the permission header listed in section 5.
