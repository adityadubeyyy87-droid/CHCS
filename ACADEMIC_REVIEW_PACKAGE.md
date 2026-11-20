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
│  Modes: LIVE (MySQL) / DEMO (local engine, SIMULATED badges)│
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
│  8 tables · SELECT … FOR UPDATE row locks · CHECK constraints │
│  7 tables + reminders + notifications_log                    │
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
| Database | MySQL 8, mysql2/promise | Relational data, InnoDB row locks |
| Scheduling | node-cron | Reminder sweeps |
| Email | Nodemailer | SMTP or sandbox delivery |
| SMS | Fast2SMS / mock | Sandbox SMS gateway |

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

**8 tables** in the `community_health_scheduler` database:

1. **users** — Patients, organizers, doctors, volunteers, admins. Data-minimised: name, email, phone, password hash, role, age group, language. No medical history.

2. **camps** — Camp definition: title, venue, address, date, time window, slot duration, total/physical capacity, status (DRAFT/PUBLISHED/COMPLETED/CANCELLED).

3. **slots** — Time-slot rows within a camp. The `booked_count` column is the mutex for `SELECT ... FOR UPDATE` pessimistic booking. CHECK: `booked_count <= capacity`.

4. **bookings** — Core transactional record. Unique indexes: `uq_slot_patient` (no double booking on same slot), `uq_one_active_booking_per_camp` (generated column — one active booking per patient per camp).

5. **waitlist** — FIFO waitlist ordered by `created_at, id`. Status: WAITING/PROMOTED/CANCELLED/EXPIRED.

6. **staff_assignments** — Staff per camp with shift times and clinical load thresholds. Overlap protection via half-open interval check under row lock.

7. **notifications_log** — Audit trail for every SMS/email: channel, type, recipient, provider, status (QUEUED/SENT/SIMULATED/FAILED).

8. **reminders** — One row per booking/reminder-type. Lifecycle: PENDING → SENDING → SENT/FAILED/CANCELLED. Claimed with `FOR UPDATE SKIP LOCKED` for idempotent delivery.

---

## 10. MAJOR IMPLEMENTATION FEATURES

1. **Transactional booking** — `SELECT ... FOR UPDATE` on slot row; `booked_count <= capacity` enforced by CHECK constraint; overbooking structurally impossible
2. **FIFO waitlist** — Cancellation atomically promotes position 1 inside the same transaction
3. **Zero-guilt cancellation** — One tap, no penalty; seat flows to waiting neighbour
4. **QR Health Passport** — Inline SVG QR + `.ics` calendar export; no medical data
5. **Live Queue TV** — Full-bleed waiting-room display with Socket.io broadcast
6. **Camp management** — Deterministic auto-slot generator; staff matrix with clinical load warnings
7. **Analytics** — KPIs, bookings vs capacity, attendance vs no-show, hourly utilisation, CSV export
8. **Capacity Advisor** — `min(ceil(C_phys/(1−p)), floor(C_phys×(1+α_max)))` — explicitly rule-based, NOT AI/ML
9. **Reminders** — 24h and 2h nudges; idempotent; retry with exponential backoff; delivery audit
10. **Privacy** — Right to erasure (DPDP-aligned); data minimisation

---

## 11. BOOKING CONCURRENCY EXPLANATION

**How zero overbooking is guaranteed:**

1. A booking request begins a transaction at `READ COMMITTED` isolation
2. `SELECT capacity, booked_count FROM slots WHERE id = ? FOR UPDATE` acquires an exclusive X-lock on the slot row
3. Concurrent requests for the same slot block at step 2 until the first transaction commits or rolls back
4. The transaction checks `booked_count < capacity`; if true, increments `booked_count` and inserts a booking row; if false, joins the FIFO waitlist
5. The MySQL CHECK constraint `booked_count <= capacity` is the database-level backstop

**Stress test proof:** `backend/concurrency-test.js` runs 50 parallel `POST /api/slots/:id/book` requests against one slot with capacity 10. Result: exactly 10 confirmed (201), 40 waitlisted (202) with FIFO positions 1–40, zero 500 errors, zero duplicate active bookings, `booked_count == 10 == capacity`.

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

**Important distinction:** All current data is seeded demonstration data. No real patient records, hospital partnerships, or medical outcomes are collected or claimed.

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

All queries run against live MySQL; simulated data is clearly tagged.

---

## 15. TESTING EVIDENCE

| Category | Test File | Status |
|---|---|---|
| Authentication | tests/integration/auth.test.js | ✅ 5/5 pass |
| Authorization | tests/integration/auth.test.js | ✅ Role enforcement |
| Validation | tests/unit/validation.test.js | ✅ 8/8 pass |
| Camp management | tests/integration/camps.test.js | ✅ 6/6 pass |
| Slot management | tests/unit/slots.test.js | ✅ 6/6 pass |
| Booking | tests/integration/booking.test.js | ✅ 8/8 pass |
| Cancellation | tests/integration/booking.test.js | ✅ FIFO promotion |
| Rescheduling | tests/integration/booking.test.js | ✅ Reminder re-queue |
| Concurrency | tests/integration/concurrency.test.js | ✅ 50→10 confirmed, 40 waitlisted |
| Staff conflicts | tests/integration/staff.test.js | ✅ 7/7 pass |
| Reminder scheduling | tests/integration/reminders.test.js | ✅ Idempotent delivery |
| Reminder idempotency | tests/integration/reminders.test.js | ✅ SKIP LOCKED |
| Attendance | tests/integration/attendance.test.js | ✅ Check-in / no-show |
| No-shows | tests/integration/attendance.test.js | ✅ Close-out processing |
| Analytics | tests/integration/attendance.test.js | ✅ Post-close-out analytics |
| CSV export | (endpoint implemented) | ✅ /api/admin/reports/export.csv |

**Total: 67/67 tests passing.** Concurrency test is the mandatory proof: 50 parallel bookings vs 10 seats → exactly 10 confirmed, 40 waitlisted, zero overbooked.

---

## 16. SCREENSHOTS OF WORKING APPLICATION

For the review, capture these screenshots:

1. **Login page** — Demo role buttons, Mode A/B indicator, theme toggle
2. **Discover / camp browse** — Camp cards with availability badges, 3-step booking progress
3. **Slot selection** — Morning/Midday/Afternoon groups, travel mode + pledge, confirm button
4. **Confirmation / Health Passport** — QR token, token number, confetti celebration
5. **My Bookings** — List with Cancel / Reschedule / Calendar / Pass actions
6. **Manage (organizer)** — Camp CRUD, staff assignment with load warnings
7. **Live Queue TV** — Current token, next up, average wait
8. **Analytics** — KPI cards, bar charts, line chart, Capacity Advisor
9. **Notifications** — Gateway Interceptor audit drawer with SIMULATED badges
10. **Concurrency test output** — Terminal showing 10 confirmed / 40 waitlisted / 0 overbooked

---

## 17. RESULTS AND LIMITATIONS

**Results (verified by tests):**
- Zero overbooking under 50-way parallel load
- FIFO waitlist with correct positions 1–40
- Atomic cancellation → promotion in one transaction
- Idempotent reminder delivery (no double-send)
- State-machine-enforced attendance transitions
- 67/67 backend tests passing

**Limitations (honest disclosure):**
- SMS/Email delivery is sandboxed (SIMULATED) unless SMTP/Fast2SMS credentials configured
- Mode B (local engine) is for demo reliability; Mode A requires MySQL
- No real medical data is collected by design (not a limitation, but a scope boundary)
- The Capacity Advisor is a statistical heuristic, not a clinical decision tool

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

**Q4: What is real vs simulated in the demo?**
A: The sidebar mode chip and every badge indicate the mode. Mode A = real MySQL transactions, real Socket.io broadcasts. Mode B = local engine with `SIMULATED` badges and "Local Engine" provider tags. Notification delivery is sandboxed in both modes; the interceptor logs metadata either way.

**Q5: What personal data do you store?**
A: Name, phone, email, age group — nothing else. No medical history, diagnosis, prescriptions, or report fields exist in the schema. Users can purge everything with one tap (DPDP-aligned erasure).

**Q6: How does the FIFO waitlist auto-promotion work?**
A: When a booking is cancelled, the transaction decrements `booked_count`, then selects the first WAITING waitlist entry for that slot (ordered by created_at). That entry is promoted to CONFIRMED inside the same transaction, with reminders re-scheduled. All atomic — no seat is ever double-allocated.

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
A: A generated column `active_camp_id` is non-NULL only while the booking is CONFIRMED/CHECKED_IN/COMPLETED. A UNIQUE index on `(patient_id, active_camp_id)` makes it a database invariant: a patient can have only one active booking per camp. The application also checks this explicitly for a precise error message.

**Q13: What is the Capacity Advisor formula?**
A: `recommended = min(ceil(C_phys / (1 - p)), floor(C_phys × (1 + α_max)))`, where `C_phys` is physical capacity, `p` is empirical no-show rate, and `α_max = 0.25` (25% max overbooking safety cap). The result is bounded between physical capacity and the safety ceiling.

**Q14: How are passwords secured?**
A: Passwords are hashed with bcrypt (cost 10) before storage. The `password_hash` column never contains plain text. Login uses `bcrypt.compare()` for constant-time comparison.

**Q15: What rate limits are in place?**
A: Auth: 10 requests per 15 minutes. Booking: 30 requests per minute. Global API: 300 requests per minute. Rate limiting can be disabled for tests via `RATE_LIMIT_DISABLED=true`.

**Q16: How does the frontend handle backend outage?**
A: `api.js` probes `GET /api/health` at startup. If the backend is down, it falls back to `engine.js` — a local in-memory demo engine that mirrors every API response shape. The mode chip shows LIVE/DEMO and all simulated results carry `SIMULATED` badges.

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

**Q9: How does the frontend know which mode it's in?**
A: `api.js` probes `/api/health` and sets `mode` to `live` or `demo`. The store exposes `mode` to all components; the sidebar shows a visible chip and all simulated results carry `SIMULATED` badges.

**Q10: Why is the frontend chunk 1.78 MB?**
A: The unminified bundle includes Three.js, Framer Motion, Recharts, and all pages in one chunk. For production, code-splitting via `import()` and `manualChunks` would reduce initial load size. This is a known optimization opportunity.

---

## 2-MINUTE PROJECT EXPLANATION

CHSC is a full-stack health-tech platform for managing community health screening camps. It connects patients, organizers, doctors, volunteers, and administrators through one web app.

Patients can browse upcoming camps, see live slot availability, book appointments, and receive QR passes with SMS/email reminders. Organizers create camps, auto-generate non-overlapping slots, and assign staff with overload warnings. Doctors and volunteers check patients in by QR token on a live waiting-room TV. Admins see attendance, no-show, and slot-utilization analytics with CSV export.

The key engineering guarantee is **zero overbooking**: every booking uses `SELECT ... FOR UPDATE` row locking on MySQL, verified by a 50-way parallel stress test where 10 seats produced exactly 10 confirmed and 40 FIFO waitlisted bookings with zero overbooked seats.

All data is minimised (name, phone, email, age group only — no medical history), and the system runs in two modes: live MySQL backend or a local demo engine for reliable offline demonstrations.

---

## 5-MINUTE DEMONSTRATION SCRIPT

| Time | Action | What to show |
|---|---|---|
| 0:00–0:30 | Login as Patient | Show demo role buttons, Mode A (live MySQL) indicator |
| 0:30–1:00 | Browse camps | Discover page, camp cards with availability badges |
| 1:00–1:30 | Book a slot | Pick camp → select slot → travel mode + pledge → confirm |
| 1:30–2:00 | Confirmation | Health Passport with QR token, confetti animation |
| 2:00–2:30 | My Bookings | View booking, show Cancel and Reschedule buttons |
| 2:30–3:00 | Reschedule | Move booking to another slot, verify reminders re-queued |
| 3:00–3:30 | Login as Organizer | Manage page: create camp, assign staff, see load warning |
| 3:30–4:00 | Admin analytics | Show KPIs, charts, Capacity Advisor, CSV export |
| 4:00–4:30 | Concurrency proof | Run `node concurrency-test.js`, show 10/40/0 result |
| 4:30–5:00 | Q&A | Address viva questions |

---

*End of academic review package.*
