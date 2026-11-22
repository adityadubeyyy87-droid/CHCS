# CHSC — Academic Review-2 Preparation Package

**Third Semester Project Review – 2**
Saturday, 21 November 2026 · 3:00 PM – 4:00 PM
Total marks: 18 (Implementation: 10, Data Collection: 8)

**Project:** Community Health Screening Camp Scheduler (CHSC)
**Institution:** CMR Institute of Technology, Bengaluru — Dept. of Information Science & Engineering

---

## 1. PROJECT OVERVIEW (2-minute explanation)

CHSC is a full-stack health-tech platform that digitizes community health screening camp management. It connects four user groups — patients, camp organizers, doctors/volunteers, and administrators — through a single web application.

**The problem it solves:** Today, community health camps run on paper registers, phone calls, and WhatsApp coordination. Seats are overbooked or left empty, patients don't get reminders, staff assignments overlap, and organizers have no visibility into attendance or no-show rates.

**The solution:** CHSC provides:
- **Patients:** Browse camps, view live slot availability, book/cancel/reschedule appointments, receive QR passes and SMS/email reminders
- **Organizers:** Create camps, auto-generate non-overlapping slots, assign staff, monitor capacity
- **Doctors/Volunteers:** QR check-in, live waiting-room TV, attendance recording
- **Admins:** Analytics, CSV export, user management, reminder delivery audit

**Key engineering differentiator:** Zero overbooking is guaranteed by `SELECT ... FOR UPDATE` pessimistic row locking on MySQL InnoDB, verified by a 50-way parallel booking stress test (10 seats: exactly 10 confirmed, 40 FIFO waitlisted, 0 overbooked).

---

## 2. PROBLEM STATEMENT

Community health screening camps in Bengaluru and similar urban areas are coordinated through fragmented manual processes:

1. **No centralized booking:** Patients call or walk in; organizers maintain paper registers
2. **Overbooking and empty seats:** No real-time capacity tracking leads to overcrowded slots and wasted capacity
3. **No reminders:** Patients forget appointments; no-show rates are high
4. **Staff conflicts:** Doctors and volunteers get double-booked across camps
5. **No data:** No attendance rate, no-show rate, or slot utilization metrics exist

CHSC eliminates these problems with structured, transparent, data-driven camp management.

---

## 3. EXISTING SYSTEM AND LIMITATIONS

| Current Practice | Limitation |
|---|---|
| Paper registers at camp venue | No real-time availability; data entry errors; no audit trail |
| Phone/WhatsApp coordination | No slot-level capacity tracking; overbooking common |
| No automated reminders | High no-show rate; wasted capacity |
| Manual staff rostering | Shift overlaps; doctor double-booking |
| No attendance analytics | Cannot measure camp effectiveness |

---

## 4. PROPOSED SOLUTION

CHSC is a centralized web platform with four role-based dashboards:

1. **Patient portal:** Discover camps → pick slot → confirm → QR pass → reminders
2. **Organizer dashboard:** Create camps, generate slots, assign staff, monitor bookings
3. **Doctor/Volunteer portal:** QR check-in, live queue TV, attendance state machine
4. **Admin dashboard:** Analytics, capacity advisor, CSV export, user management

---

## 5. OBJECTIVES

1. Eliminate overbooking through database-level row locking
2. Provide FIFO waitlist with atomic auto-promotion
3. Reduce no-shows via 24h and 2h SMS/email reminders
4. Enable QR-based camp-day check-in and live queue management
5. Provide administrators with attendance, no-show, and utilization analytics
6. Maintain data minimisation (name, phone, email, age group only — no medical history)

---

## 6. SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React 18 + Vite 5)              │
│  Port 5173 · Hash routing · Recharts · socket.io-client      │
│  Strict live only — no local engine or simulated fallback    │
└─────────────────────────────────────────────────────────────┘
                            │ HTTPS/WSS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Node.js + Express)               │
│  Port 4000 · JWT auth · bcrypt · zod · rate-limit            │
│  Socket.io for real-time queue & gateway events             │
│  node-cron for reminder sweeps (24h + 2h)                   │
└─────────────────────────────────────────────────────────────┘
                            │ mysql2/promise
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Database (MySQL 8, InnoDB)                 │
│  9 tables · SELECT … FOR UPDATE row locks · CHECK constraints │
│  users, camps, slots, bookings, waitlist, staff_assignments, │
│  notifications_log, audit_log, reminders                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. TECHNOLOGY STACK

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18, Vite 5 | UI framework + build tool |
| Styling | Custom CSS (design tokens) | Emerald brand hue, dark/light themes |
| Charts | Recharts | Analytics visualizations |
| Real-time | socket.io-client | Live queue, gateway interceptor |
| Backend | Node.js, Express | REST API server |
| Auth | JWT, bcryptjs | Stateless sessions, password hashing |
| Validation | Zod | Request schema validation |
| Rate limiting | express-rate-limit | Brute-force and seat-grabbing protection |
| Database | MySQL 8.4, mysql2/promise | Relational data, InnoDB row locks |
| Scheduling | node-cron | Reminder sweeps |
| Email | Nodemailer | SMTP or sandbox delivery |
| SMS | Fast2SMS (optional) | Sandbox SMS gateway when no key is configured |

---

## 8. ER DIAGRAM (Text Representation)

```
users 1:M bookings     (patient → their bookings)
users 1:M staff_assignments  (staff → their assignments)
users 1:M waitlist     (patient → waitlist entries)
users 1:M camps        (creator → camps they created)

camps 1:M slots        (camp → its time slots)
camps 1:M bookings     (camp → bookings)
camps 1:M waitlist     (camp → waitlist entries)
camps 1:M staff_assignments (camp → its staff)

slots 1:M bookings     (slot → its bookings)
slots 1:M waitlist     (slot → its waitlist)

bookings 1:1 reminders (booking → its reminder rows)
bookings 1:M notifications_log (booking → notification audit)

Key constraints:
- uq_one_active_booking_per_camp (patient_id, active_camp_id) — generated column
- uq_slot_patient (slot_id, patient_id) — no double booking
- uq_reminder_booking_type (booking_id, type) — one reminder per type
- CHECK: end_time > start_time, booked_count <= capacity, capacity > 0
```

---

## 9. DATABASE SCHEMA EXPLANATION

**9 tables** in the `community_health_scheduler` database:

1. **users** — Patients, organizers, doctors, volunteers, admins. Data-minimised: name, email, phone, password hash, role, age group, language. No medical history.

2. **camps** — Camp definition: title, venue, address, date, time window, slot duration, total/physical capacity, status (DRAFT/PUBLISHED/COMPLETED/CANCELLED).

3. **slots** — Time-slot rows within a camp. The `booked_count` column is the mutex for `SELECT ... FOR UPDATE` pessimistic booking. CHECK: `booked_count <= capacity`.

4. **bookings** — Core transactional record. A booking starts as `HELD` with `hold_expires_at` (10-minute claim window) and becomes `CONFIRMED` only through `POST /api/bookings/:id/confirm`; QR check-in requires `CONFIRMED`. Unique indexes: `uq_slot_patient` (no double booking on same slot), `uq_one_active_booking_per_camp` (generated column — one active hold/booking per patient per camp).

5. **waitlist** — FIFO waitlist ordered by `created_at, id`. Status: WAITING/PROMOTED/CANCELLED/EXPIRED. A promoted waiter receives a bounded claim window via `promotion_expires_at`; if it lapses, the seat moves to the next FIFO patient.

6. **staff_assignments** — Staff per camp with shift times and clinical load thresholds. Overlap protection via half-open interval check under row lock.

7. **notifications_log** — Audit trail for every SMS/email: channel, type, recipient, provider and delivery status. Attempts without gateway credentials are labelled Sandbox; no real delivery is claimed.

8. **audit_log** — Decoded before/after snapshots for booking, staff, check-in, close-out and system expiry transitions.

9. **reminders** — One row per booking/reminder-type. Lifecycle: PENDING → SENDING → SENT/FAILED/CANCELLED. Claimed with `FOR UPDATE SKIP LOCKED` for idempotent delivery.

---

## 10. MAJOR IMPLEMENTATION FEATURES

1. **Transactional booking** — `SELECT ... FOR UPDATE` on slot row; `booked_count <= capacity` enforced by CHECK constraint; overbooking structurally impossible
2. **Bounded 10-minute hold** — A successful booking first creates `HELD` with a live countdown; an explicit confirm commits the seat, QR pass and reminders
3. **FIFO waitlist with claim windows** — Cancellation or hold expiry atomically promotes position 1 into a bounded claim window; unclaimed promotions expire FIFO inside the same transaction
4. **Zero-guilt cancellation** — One tap, no penalty; seat flows to waiting neighbour
5. **QR Health Passport** — Inline SVG QR + `.ics` calendar export; no medical data; only `CONFIRMED` bookings can check in
6. **Live Queue TV** — Full-bleed waiting-room display with Socket.io broadcast
7. **Camp management** — Deterministic auto-slot generator; staff matrix with clinical load warnings
8. **Analytics** — KPIs, bookings vs capacity, attendance vs no-show, hourly utilisation, CSV export
9. **Capacity Advisor** — `min(ceil(C_phys/(1−p)), floor(C_phys×(1+α_max)))` — explicitly rule-based, NOT AI/ML
10. **Reminders** — 24h and 2h nudges; idempotent; retry with exponential backoff; delivery audit
11. **Privacy** — Right to erasure (DPDP-aligned); data minimisation

---

## 11. BOOKING CONCURRENCY EXPLANATION

**How zero overbooking is guaranteed:**

1. A booking request begins a transaction at `READ COMMITTED` isolation
2. `SELECT capacity, booked_count FROM slots WHERE id = ? FOR UPDATE` acquires an exclusive X-lock on the slot row
3. Concurrent requests for the same slot block at step 2 until the first transaction commits or rolls back
4. The transaction checks `booked_count < capacity`; if true, increments `booked_count` and inserts a `HELD` booking with a 10-minute expiry; if false, joins the FIFO waitlist
5. `POST /api/bookings/:id/confirm` re-locks the booking under an expiry check before committing it to `CONFIRMED`; expired holds and unclaimed FIFO promotions release the seat atomically
6. The MySQL CHECK constraint `booked_count <= capacity` is the database-level backstop

**Stress test proof:** `backend/tests/integration/concurrency.test.js` runs 50 parallel `POST /api/slots/:id/book` requests against one slot with capacity 10, then confirms the 10 held seats. Result: exactly 10 confirmed, 40 waitlisted (202) with FIFO positions 1–40, zero 500 errors, zero duplicate active bookings, `booked_count == 10 == capacity`.

---

## 12. DATA COLLECTION METHODOLOGY

**Ten data categories are collected** (see DATA_COLLECTION.md for full detail):

| Category | Origin | Purpose |
|---|---|---|
| Patient registration | Registration form | Identity, auth, reminders |
| Camp information | Organizer creation | Schedule, venue, capacity |
| Venue & scheduling | Camp creation | Where/when, slot generation |
| Slot capacity | Auto-generated | Zero-overbooking enforcement |
| Booking records | Patient booking | Seat reservation lifecycle |
| Booking status | State transitions | Attendance tracking |
| Staff assignments | Organizer assignment | Camp-day staffing |
| Attendance records | QR check-in / staff | Who actually attended |
| No-show records | Close-out / staff | No-show rate measurement |
| Reminder delivery | Cron sweep | Nudge delivery audit |

**Validation:** Zod schemas + MySQL CHECK constraints + row locks
**Storage:** MySQL 8 InnoDB with foreign keys and indexes
**Usage:** Booking flow, waitlist, reminders, analytics, CSV export

**Important distinction:** Production runs on real data only. There are no seeded patients, camps, slots or bookings in the hosted deployment; charts are empty until real records exist. No hospital partnership or medical outcome is claimed. SMTP/SMS credentials are optional and absent attempts are labelled Sandbox.

---

## 13. DATA VALIDATION AND STORAGE

- **Request validation:** Zod schemas on every mutating endpoint (registration, login, camp creation, booking, staff assignment, attendance)
- **Database constraints:** UNIQUE indexes, CHECK constraints, FOREIGN KEYS with CASCADE/SET NULL
- **Password security:** bcrypt with cost 10; never stored in plain text
- **JWT:** HS256 signed, 12h expiry, issuer claim `chsc-cmrit`
- **Rate limiting:** 10 requests/15min on auth, 30/min on booking, 300/min on API
- **Privacy:** Name, phone, email, age group only. One-tap GDPR/DPDP-aligned erasure.

---

## 14. ANALYTICS AND VISUALIZATIONS

Built with Recharts on the `/analytics` page:

1. **KPI cards:** Total registered, attendance rate, waitlist promotions, total bookings, no-show rate
2. **Bookings vs Capacity** (bar chart): Per camp, booked seats vs slot capacity
3. **Attendance vs No-Show** (bar chart): Per completed camp
4. **Hourly Utilisation** (line chart): Fill rate by hour of day
5. **Capacity Advisor** (gauge/bullet): Recommended booking capacity vs physical capacity, with explicit "Rule-Based Statistical Heuristic — NOT Black-Box AI/ML" badge

All queries run against live MySQL. Empty result sets are shown honestly; no sample values are injected.

---

## 15. TESTING EVIDENCE

| Category | Test File | Status |
|---|---|---|
| Authentication | tests/integration/auth.test.js | ✅ 5/5 pass |
| Authorization | tests/integration/auth.test.js | ✅ Role enforcement |
| Validation | tests/unit/validation.test.js | ✅ 9/9 pass |
| Camp management | tests/integration/camps.test.js | ✅ 6/6 pass |
| Slot management | tests/unit/slots.test.js | ✅ 6/6 pass |
| Booking | tests/integration/booking.test.js | ✅ 8/8 pass |
| Hold + confirm | tests/integration/holds.test.js | ✅ 3/3 pass |
| Cancellation | tests/integration/booking.test.js | ✅ FIFO promotion |
| Rescheduling | tests/integration/booking.test.js | ✅ Reminder re-queue |
| Concurrency | tests/integration/concurrency.test.js | ✅ 50→10 held+confirmed, 40 waitlisted |
| Staff conflicts | tests/integration/staff.test.js | ✅ 7/7 pass |
| Reminder scheduling | tests/integration/reminders.test.js | ✅ Idempotent delivery |
| Reminder idempotency | tests/integration/reminders.test.js | ✅ SKIP LOCKED |
| Attendance | tests/integration/attendance.test.js | ✅ Check-in / no-show |
| No-shows | tests/integration/attendance.test.js | ✅ Close-out processing |
| Analytics | tests/integration/attendance.test.js | ✅ Post-close-out analytics |
| CSV export | (endpoint implemented) | ✅ /api/admin/reports/export.csv |

**Total: 102/102 tests passing across 18 files.** Concurrency test is the mandatory proof: 50 parallel bookings vs 10 seats → exactly 10 held then confirmed, 40 waitlisted, zero overbooked. Hold-expiry and promotion-expiry tests verify the FIFO claim windows.

---

## 16. SCREENSHOTS OF WORKING APPLICATION

For the review, capture these screenshots:

1. **Login page** — real registered account sign-in, live connection status, theme toggle
2. **Discover / camp browse** — Camp cards with availability badges, 3-step booking progress
3. **Slot selection** — Morning/Midday/Afternoon groups, travel mode + pledge, 10-minute hold button
4. **Hold screen** — Live `mm:ss` countdown, confirm/release actions, FIFO-expiry explanation
5. **Confirmation / Health Passport** — QR token, token number, confetti celebration
6. **My Bookings** — List with Hold countdown / Confirm / Release / Reschedule / Pass actions
7. **Manage (organizer)** — Camp CRUD, staff assignment with load warnings
8. **Live Queue TV** — Current token, next up, average wait
9. **Analytics** — KPI cards, bar charts, line chart, Capacity Advisor
10. **Notifications** — Gateway Interceptor audit drawer with real delivery attempts and Sandbox labels where no credentials are configured
11. **Concurrency test output** — Terminal showing 10 confirmed / 40 waitlisted / 0 overbooked

---

## 17. RESULTS AND LIMITATIONS

**Results (verified by tests):**
- Zero overbooking under 50-way parallel load
- FIFO waitlist with correct positions 1–40
- Atomic cancellation → promotion in one transaction
- Idempotent reminder delivery (no double-send)
- State-machine-enforced attendance transitions
- 102/102 backend tests passing across 18 files

**Limitations (honest disclosure):**
- SMTP/SMS delivery is labelled Sandbox unless gateway credentials are configured; no real delivery is claimed
- The app requires a reachable Express + MySQL backend; there is no offline fallback
- No real medical data is collected by design (not a limitation, but a scope boundary)
- The Capacity Advisor is a statistical heuristic, not a clinical decision tool
- Hosted data starts empty; no sample patients or camps are shipped in production

---

## 18. FUTURE SCOPE

1. Real SMS/Email gateway integration (SMTP + Fast2SMS/Twilio production keys)
2. Multi-city camp support (beyond Bengaluru)
3. Mobile app (React Native) for camp-day check-in
4. Email calendar integration (Google Calendar, Outlook)
5. Waitlist position SMS updates
6. Multi-organizer camp collaboration
7. ML-based no-show prediction (explicitly labeled as optional, separate from the rule-based advisor)

---

## 20 LIKELY VIVA QUESTIONS AND ANSWERS

**Q1: How do you guarantee zero overbooking?**
A: The booking transaction runs `SELECT capacity, booked_count FROM slots WHERE id = ? FOR UPDATE`, which acquires an exclusive row lock. Concurrent requests serialize. If `booked_count >= capacity`, the patient joins the waitlist; otherwise the slot is incremented and a booking is inserted. The MySQL CHECK constraint `booked_count <= capacity` is the database-level backstop. Proof: concurrency test (50 vs 10 → 10 confirmed, 40 waitlisted, 0 overbooked).

**Q2: Is the waitlist actually FIFO?**
A: Yes. Promotion selects the lowest `position` (by `created_at, id`) under the same row lock that releases the seat. Two simultaneous cancellations cannot promote two people into one seat. Each slot has a unique `uq_slot_patient` index preventing duplicate waitlist entries.

**Q3: Where is the AI/ML?**
A: There is none, deliberately. The Capacity Advisor is a transparent closed-form heuristic: `min(ceil(C_phys/(1−p)), floor(C_phys×(1+α_max)))`, where `p` is the empirical no-show rate. It's labeled "Rule-Based Statistical Heuristic — NOT Black-Box AI/ML" on screen.

**Q4: How do you know the data is real?**
A: There is one runtime path: API → Express → MySQL. The sidebar reports the real connection status and an outage shows an error. The interceptor logs real delivery attempts; with no SMTP/SMS credentials those attempts are labelled Sandbox and no delivery is claimed.

**Q5: What personal data do you store?**
A: Name, phone, email, age group — nothing else. No medical history, diagnosis, prescriptions, or report fields exist in the schema. Users can purge everything with one tap (DPDP-aligned erasure).

**Q6: How does the FIFO waitlist auto-promotion work?**
A: When a booking is cancelled or a hold expires, the transaction decrements `booked_count`, then selects the first WAITING waitlist entry for that slot (ordered by `created_at, id`). That entry is promoted into a `HELD` claim window (`promotion_expires_at`, 15 minutes) inside the same transaction. Confirming the hold commits reminders and the QR pass; if the window lapses, the sweep releases the seat and promotes the next patient atomically. No seat is ever double-allocated.

**Q7: How are reminders prevented from being sent twice?**
A: The `reminders` table has `uq_reminder_booking_type` (one row per booking/type). The sweep claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`, marks them SENDING, increments attempts, and only marks SENT after successful delivery. A second worker can never claim the same row.

**Q8: What isolation level do you use?**
A: `READ COMMITTED` for transactions. This minimizes gap-lock surprises while `SELECT ... FOR UPDATE` still provides an exclusive X-lock on the targeted slot row. Writes use explicit row locks; reads use standard committed reads.

**Q9: How do you handle staff shift overlaps?**
A: Staff assignment checks for half-open interval overlap (`shift_start < new_end AND shift_end > new_start`) for the same user on the same day across different camps, under `FOR UPDATE` on the user row. Adjacent shifts (e.g., 09:00–12:00 and 12:00–16:00) are allowed.

**Q10: What happens during camp close-out?**
A: All remaining CONFIRMED bookings become NO_SHOW, all PENDING/SENDING reminders are CANCELLED, and the camp status becomes COMPLETED. The operation is idempotent — a second close-out changes nothing.

**Q11: Why MySQL 8 and not MongoDB/PostgreSQL?**
A: MySQL 8 InnoDB provides `SELECT ... FOR UPDATE` pessimistic row locking and CHECK constraints, which are essential for the zero-overbooking guarantee. The stack was specified for the project and is a good fit for relational camp/booking data.

**Q12: How does the one-active-booking-per-camp rule work?**
A: A generated column `active_camp_id` is non-NULL only while the booking is HELD/CONFIRMED/CHECKED_IN/COMPLETED. A UNIQUE index on `(patient_id, active_camp_id)` makes it a database invariant: a patient cannot hold two seats at the same camp, including while a checkout is in flight. The application also checks this explicitly for a precise error message.

**Q13: What is the Capacity Advisor formula?**
A: `recommended = min(ceil(C_phys / (1 - p)), floor(C_phys × (1 + α_max)))`, where `C_phys` is physical capacity, `p` is empirical no-show rate, and `α_max = 0.25` (25% max overbooking safety cap). The result is bounded between physical capacity and the safety ceiling.

**Q14: How are passwords secured?**
A: Passwords are hashed with bcrypt (cost 10) before storage. The `password_hash` column never contains plain text. Login uses `bcrypt.compare()` for constant-time comparison.

**Q15: What rate limits are in place?**
A: Auth: 10 failed attempts per 15 minutes keyed by `(IP, identifier)`, plus a 60-attempt per-IP backstop that counts all auth traffic. Booking: 30 requests per minute keyed by `(IP, authenticated user)`, so 50 patients behind one campus IP can all race for one seat. Global API: 300 requests per minute per IP as the account-cycling backstop. Rate limiting can be disabled for tests via `RATE_LIMIT_DISABLED=true`.

**Q16: How does the frontend handle backend outage?**
A: `api.js` probes `GET /api/health` and shows the real connection state. There is no local engine: a failed request surfaces the error instead of fabricated results. The Pages build injects `VITE_API_BASE` from the required GitHub variable `RENDER_API_URL`, so the public site always targets the real Railway backend.

**Q17: What is DPDP compliance in this project?**
A: The Digital Personal Data Protection Act 2023 principle of data minimisation: only name, phone, email, age group are collected. No medical history. A one-tap purge endpoint deletes user data and releases active seats. Users are informed what is collected and why.

**Q18: Can a patient have two bookings at the same camp?**
A: No. The `uq_one_active_booking_per_camp` unique index on the generated `active_camp_id` column prevents it at the database level. The application also checks and returns `ALREADY_BOOKED_IN_CAMP`.

**Q19: How do reminders survive a worker crash?**
A: If a reminder is stuck in SENDING for more than 10 minutes (stale), the sweep resets it to PENDING so another worker can claim it. Failed reminders retry with exponential backoff (`2^attempts` minutes, capped at 60).

**Q20: What is the socket.io used for?**
A: Real-time broadcast of booking confirmations, waitlist promotions, check-ins, queue updates, and gateway notifications to connected clients (Live Queue TV, Gateway Interceptor drawer, camp dashboards).

---

## 10 DIFFICULT TECHNICAL VIVA QUESTIONS

**Q1: Why READ COMMITTED instead of SERIALIZABLE?**
A: SERIALIZABLE would add gap locks and increase deadlock risk under high concurrency. READ COMMITTED with explicit `SELECT ... FOR UPDATE` row locks provides sufficient serialization for the slot mutex while allowing better throughput. The CHECK constraint is the backstop.

**Q2: What happens if two cancellations race for the same slot?**
A: Both transactions lock the booking row first. The first to commit decrements `booked_count` and promotes a waiter. The second finds the booking already CANCELLED and rejects with `NOT_ACTIVE` (409). Only one promotion occurs.

**Q3: What happens if the server crashes mid-transaction?**
A: MySQL InnoDB provides atomicity: uncommitted changes are rolled back on recovery. A booking is either fully confirmed (with reminders queued) or not at all. No partial state.

**Q4: How is deadlock prevented in rescheduling?**
A: Both slot rows are locked in ascending `id` order (`ORDER BY id ASC FOR UPDATE`), so two opposite reschedules cannot deadlock each other.

**Q5: Why not use auto-increment position for waitlist?**
A: Waitlist position is computed as `COUNT(existing waiters) + 1` at insert time under the slot lock. FIFO order is enforced by `ORDER BY created_at, id ASC` when selecting for promotion, not by a stored position number.

**Q6: What if a reminder's send_at is in the past?**
A: `scheduleForBooking()` skips types whose `sendAt` is more than 30 minutes in the past (`LATE_GRACE_MINUTES`). The sweep sends all due reminders where `send_at <= now` immediately.

**Q7: How is the `booked_count` kept consistent with actual booking rows?**
A: All mutations to `booked_count` happen inside the same transaction as the booking insert/cancel/reschedule. Row locks serialize access. The CHECK constraint and periodic reconciliation prevent drift.

**Q8: What prevents a patient from booking a slot at a non-published camp?**
A: The booking transaction checks `camp.status = 'PUBLISHED'` under the slot lock and rejects with `CAMP_NOT_OPEN` (409) otherwise.

**Q9: How does the frontend show connection state?**
A: `api.js` probes `/api/health`. The store exposes the real connection state to the sidebar, which shows `LIVE · MySQL` when connected and an honest error otherwise. There is no second mode and no simulated badge path for database results.

**Q10: Why is the frontend chunk 1.78 MB?**
A: The unminified bundle includes Three.js, Framer Motion, Recharts, and all pages in one chunk. For production, code-splitting via `import()` and `manualChunks` would reduce initial load size. This is a known optimization opportunity.

---

## 2-MINUTE PROJECT EXPLANATION

CHSC is a full-stack health-tech platform for managing community health screening camps. It connects patients, organizers, doctors, volunteers, and administrators through one web app.

Patients can browse upcoming camps, see live slot availability, book appointments, and receive QR passes with SMS/email reminders. Organizers create camps, auto-generate non-overlapping slots, and assign staff with overload warnings. Doctors and volunteers check patients in by QR token on a live waiting-room TV. Admins see attendance, no-show, and slot-utilization analytics with CSV export.

The key engineering guarantee is **zero overbooking**: every booking uses `SELECT ... FOR UPDATE` row locking on MySQL, verified by a 50-way parallel stress test where 10 seats produced exactly 10 confirmed and 40 FIFO waitlisted bookings with zero overbooked seats.

All data is minimised (name, phone, email, age group only — no medical history), and the system runs strictly against a live MySQL backend with no offline or simulated fallback.

---

## 5-MINUTE PRESENTATION SCRIPT (real data only)

Use accounts created through the real registration flow and staff accounts from the
production bootstrap. If the database is empty, show the honest empty state and
create a real camp/booking during the walkthrough — never inject sample rows.

| Time | Action | What to show |
|---|---|---|
| 0:00–0:30 | Sign in as Patient | Real account login, live connection status |
| 0:30–1:00 | Browse camps | Discover page, camp cards with real availability badges |
| 1:00–1:30 | Hold a slot | Pick camp → select slot → travel mode + pledge → reserve for 10 minutes |
| 1:30–2:00 | Confirmation | Confirm the hold, then show Health Passport with QR token |
| 2:00–2:30 | My Bookings | View the real booking, show Cancel and Reschedule actions |
| 2:30–3:00 | Reschedule | Move the booking to another real slot, verify reminders re-queued |
| 3:00–3:30 | Sign in as Organizer | Manage page: create a camp, assign staff, see load warning |
| 3:30–4:00 | Admin analytics | KPIs, charts, Capacity Advisor, CSV export from MySQL |
| 4:00–4:30 | Concurrency proof | Run the real 50-way test: 10 held+confirmed / 40 waitlisted / 0 overbooked |
| 4:30–5:00 | Q&A | Address viva questions |

---

## LIVE OPERATIONS WALKTHROUGH

**Goal:** Show real-time behaviour and the strongest evidence for the 10 implementation marks using live MySQL rows.

| Time | Action | What to show |
|---|---|---|
| 0:00–0:45 | Organizer → Control Room | Live camp-day board: real slot fill bars, check-in queue, staff load warnings |
| 0:45–1:30 | Row-lock proof | Run the backend 50-way concurrency test; show 10 confirmed, 40 waitlisted, 0 overbooked from MySQL |
| 1:30–2:00 | Real waitlist | Cancel a real confirmed booking for a full slot; first waiter is promoted in the same transaction |
| 2:00–2:45 | QR Check-In | Verify a real QR token; Live Queue TV updates over Socket.io |
| 2:45–3:15 | Smart Waitlist + No-Show Risk | Real waitlist position and rule-based no-show risk, staff-facing only |
| 3:15–3:45 | Analytics provenance | Charts labelled with their real MySQL source; empty states shown honestly |
| 3:45–4:15 | Audit Trail | `/api/admin/audit-log` shows who changed which real booking and when |
| 4:15–5:00 | Q&A | Technical viva answers below |

---

## 10 TECHNICAL VIVA ANSWERS (Live Operations)

**Q1: How do you prove zero overbooking live?**
A: The backend test fires 50 simultaneous `SELECT ... FOR UPDATE` transactions against one capacity-10 slot. The result is 10 confirmed and 40 waitlisted with FIFO positions 1–40; the test re-reads `booked_count <= capacity` from MySQL and fails unless all 50 requests are accounted for.

**Q2: Is the concurrency proof real or simulated?**
A: Real. It runs against InnoDB row locks in MySQL. There is no simulated concurrency mode.

**Q3: What happens if two staff check in the same patient simultaneously?**
A: The check-in endpoint locks the booking row with `SELECT ... FOR UPDATE`. The first check-in sets status to CHECKED_IN; the second finds it already CHECKED_IN and rejects with a clear error. No double check-in.

**Q4: What if the venue loses connectivity during check-in?**
A: Check-in requires the API. A failed request surfaces an error to the staff member; it is never silently accepted or queued as a fake success.

**Q5: How is waitlist position shown and is it really FIFO?**
A: `myBookings` returns `waitlistPosition` via a LEFT JOIN to the waitlist table. Promotion selects the lowest `position` (by `created_at, id`) under the same slot row lock that releases the seat — atomic, so two simultaneous cancellations can't promote two people into one seat.

**Q6: Is the no-show risk score AI/ML?**
A: No — explicitly a rule-based heuristic derived from real `bookings` rows, labelled "heuristic, not AI prediction" and staff-facing only.

**Q7: What is the data provenance of the charts?**
A: All charts read live MySQL aggregates. If there are no real records, the chart shows an empty state; there is no seeded or synthetic series behind it.

**Q8: How does the audit trail work without slowing requests?**
A: `auditLog()` writes to `audit_log` inside a try/catch that never throws — if audit logging fails, the primary booking/camp action still completes. It's append-only: actor, action, target, before/after JSON, timestamp.

**Q9: How is repeatable test state created without polluting production?**
A: Only the local test suite and local development fixtures create temporary records, in throwaway or local databases. Production bootstraps with migrations and role accounts only; no scenario loader inserts sample data.

**Q10: Why build these features on top of the stable core?**
A: Each feature operates on real operational data: the concurrency proof gives visual evidence for the 10 implementation marks, real-time updates improve camp-day coordination, and provenance labels defend the 8 data-collection marks honestly.

---

## PRE-MORTEM — 5 LIKELIEST PRESENTATION FAILURES & FIXES

1. **Empty DB / no real data yet** → Honest empty state; create a real camp or booking during the walkthrough. No seed injection in the deployed environment.
2. **Slow network** → The 50-way proof runs as a backend test in parallel; Socket.io falls back to polling.
3. **WebGL / 3D failure** → Visual scenes are lazy-loaded with CSS/SVG fallbacks; core workflows never depend on WebGL.
4. **Dead email/SMS service** → Notification attempts are recorded and labelled Sandbox when no credentials are set; booking does not depend on delivery.
5. **Stale data** → Control Room re-reads from MySQL on Socket.io events; the concurrency proof re-queries `booked_count` after the race.

---

*End of academic review package.*

