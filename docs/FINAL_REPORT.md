# CHSC — Final Evidence & Deployment Report

_Last updated 2026-11-25 · status as of the final verification pass on the hosted stack._

## 1. Scope and runtime policy

The CHSC platform is a **strict live / real-data** product. No demo engine, no offline simulation, no sample patients, camps, bookings or notifications. Every result below comes from the live Express + MySQL backend or from the automated real-MySQL test suite.

## 2. Features delivered in this final pass

| Area | Implementation | Evidence |
|---|---|---|
| Tickets & navigation | QR encodes `https://www.google.com/maps/dir/?api=1&destination=…&travelmode=driving#chsc=<TOKEN>`; token in fragment, Maps ignores it | QR decoded from live hosted page: **PASS** |
| QR check-in | `/api/checkin` accepts Maps QR payload + raw token + legacy pass; camp assignment scope enforced; status transitions | **PASS** (live Maps-QR check-in → `CHECKED_IN`) |
| Short navigation | `/n/<token>` → 302 to the camp's Google Maps destination | **PASS** (`302 → maps`, fake token → `404 NAV_NOT_FOUND`) |
| Booking logistics | Confirmation/reschedule/cancel/waitlist/reminder messages carry booking ID, token, camp, date, time, full venue/address, Maps URL, short nav link; email embeds inline QR CID | **PASS** (live rows for booking #2022) |
| Delivery audit | Dedupe key, attempts/last error/provider message ID, retry endpoint (`409 PROVIDER_NOT_CONFIGURED` while sandbox) | **PASS** |
| Camp coordinates | `latitude`/`longitude` optional; fallback to encoded venue+address+city; organiser camp edit | **PASS** (live `/api/camps` returns `mapsUrl` + optional coords) |

## 3. Test evidence

| Suite | Result |
|---|---|
| Backend (`backend && npm test`) | **24 files / 139 tests passed** (auth, RBAC, booking, capacity, duplicates, cancel/reschedule, concurrency, notifications, QR/Maps, check-in, dashboards) |
| Frontend (`frontend && npm test`) | **8 tests passed** |
| Frontend production build | **PASS** (`index-BzYKdfw_.js` + `index-Dkl_y5ih.css` served on Pages) |
| Production schema + migrations (001–005) | **PASS**, idempotent re-run on scratch MySQL 8.4, 0 rows |
| Live E2E | Booking → confirm → QR passport → Maps QR check-in → duplicate protection → `/n/` → notifications |

## 4. Live deployment evidence (final pass, 2026-11-25)

| Check | Result |
|---|---|
| Backend health | `ok:true, demoMode:false, database:connected, dbVersion:8.4.13, socket:ready` — HTTP 200 |
| Public camps | 3 published camps, 13 live slots, `mapsUrl` + optional `latitude`/`longitude` present |
| `/n/CHSC-BLR-…` | HTTP 302 → Google Maps directions |
| `/n/CHSC-BLR-NOTAREALTOKEN` | HTTP 404 JSON `NAV_NOT_FOUND` (never open redirect) |
| Live booking E2E | `POST /api/slots/:id/book` → 201; `POST /api/bookings/:id/confirm` → 200 `CONFIRMED`; token `CHSC-BLR-TUQUZK5CEN3R`, Maps payload with `#chsc=` → check-in via Maps QR → `CHECKED_IN` (`A-716420`); duplicate → `ALREADY_CHECKED_IN`, queue unchanged |

## 5. Notification delivery evidence

| Item | Result |
|---|---|
| Booking confirmation rows (email + SMS) | `SIMULATED` / `Email Sandbox` / `SMS Sandbox`; address + short nav link present in message body |
| Retry while unconfigured | `409 PROVIDER_NOT_CONFIGURED` (`EMAIL provider is not configured. …`) |
| Real delivery | **BLOCKED** — no SMTP/SMS provider credentials (and Indian DLT sender/template approval) configured. Honest labels only; no real delivery claimed. |

## 6. Role + dashboard evidence (live site)

| Role | Dashboard | Result |
|---|---|---|
| Patient | Find Health Camps / Discover, My Appointments, Passport | **PASS** — live booking, Maps QR, real nav link |
| Organizer | Camp Management, Analytics, Concurrency Proof, Control Room, Audit Log, Notifications, Live Queue | **PASS** — live camp config, staff matrix, venue/coords edit |
| Doctor | Camp Day + QR Check-In Scanner, Live Queue TV | **PASS** — real check-in, queue broadcast |
| Admin | Control Room, Notifications + retry, Manage, Analytics | **PASS** — live audit rows, honest sandbox labels |

## 7. Production URLs

- Frontend: `https://adityadubeyyy87-droid.github.io/CHCS/`
- Backend: `https://exemplary-strength-production-fbfcb823.up.railway.app/`
- Login: `https://adityadubeyyy87-droid.github.io/CHCS/#/login`

## 8. Commit

- Deployed source HEAD: `6cef421d904d534579e813e8cfd9b1fab1d50262` (`docs: record Maps ticket and delivery verification pass`) — clean working tree, pushed normally to `master` and `main`.
- Final Railway deployment (backend, via Railway CLI from local source): deploy id `4ebfdb5c-7226-421e-8377-ddd678c29bf6`; build → start command (`cd backend && npm ci --omit=dev && node scripts/db.js setup-production && node scripts/bootstrap-production.js && node server.js`) → healthcheck **PASS**.

## 9. Blockers / honest limitations

1. **Real email delivery** — requires SMTP credentials; currently labelled **Email Sandbox**.
2. **Real SMS delivery** — requires Fast2SMS/SMS provider credentials and Indian DLT sender + transactional template approval; currently labelled **SMS Sandbox**.
3. **Railway free trial** — account shows trial balance near expiry ($4.45 remaining, ~27 days), so production availability is platform-budget dependent.
4. **Live data** — QA verification bookings (e.g. booking `#2022`) were created on the hosted database during E2E and remain in the live tables; production dashboards are expected to show real operational history.

## 10. Final verdict

The platform is **complete and deployed**: strict-live backend, real MySQL persistence, Maps-based ticket QR with secure token, real `/n/` navigation links, transactional notification pipeline with honest sandbox delivery, RBAC across four live dashboards, full automated suite green, and a final Railway redeploy verified end-to-end.
