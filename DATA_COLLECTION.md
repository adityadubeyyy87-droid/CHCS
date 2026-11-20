# CHSC Data Collection & Analytics Documentation

**Community Health Screening Camp Scheduler (CHSC)**
CMR Institute of Technology, Bengaluru — Department of Information Science & Engineering
Third Semester Project Review – 2

---

## 1. Overview

CHSC implements a complete, auditable data pipeline from patient registration through camp close-out. Every data category is defined by: (1) what is collected, (2) why, (3) origin, (4) validation, (5) storage, and (6) usage. All data is **demonstration/seeded** — no real patients, hospitals, or medical records are involved.

---

## 2. Data Categories

### 2.1 Patient Registration Data

| Attribute | Detail |
|---|---|
| **What is collected** | Name, email, phone (10-digit Indian mobile), password (bcrypt hash), role, age group, preferred language, active flag, timestamps |
| **Why** | Identity for booking, authentication, contact for reminders, role-based access control, DPDP-compliant data minimisation |
| **Origin** | `POST /api/auth/register` (patient self-registration) or seed data (demo accounts) |
| **Validation** | Zod schema: name 2–120 chars, email format, phone `^[0-9]{10}$`, password 8–72 chars with letter+number, age group enum, language enum |
| **Storage** | MySQL `users` table (InnoDB), `password_hash` via bcrypt (cost 10), unique indexes on email and phone |
| **Usage** | Login/JWT issuance, booking ownership, reminder recipients, admin user management, analytics registration counts |

### 2.2 Camp Information

| Attribute | Detail |
|---|---|
| **What is collected** | Title, descriptions (EN/KN), venue, address, city, camp date, start/end time, slot duration, total capacity, physical capacity, status, creator |
| **Why** | Define screening camp schedule, location, capacity, and lifecycle state; patients browse and book against camps |
| **Origin** | `POST /api/camps` (organizer/admin creates), seed data (3 upcoming + 3 historical Bengaluru camps) |
| **Validation** | Zod: title 3–180, venue 2–180, address 4–255, date ISO, HH:MM times, end > start, duration ≥5 min, capacity ≥1, CHECK constraints in MySQL |
| **Storage** | MySQL `camps` table, foreign key `created_by → users.id`, indexes on `(camp_date, status)` and `venue` |
| **Usage** | Public discovery, booking eligibility, analytics grouping, CSV export, staff assignment scope |

### 2.3 Venue & Scheduling Information

| Attribute | Detail |
|---|---|
| **What is collected** | Venue name, address, city, camp date, start time, end time, slot duration minutes |
| **Why** | Patients need to know where and when; organizers generate non-overlapping 30-minute slots across the camp window |
| **Origin** | Camp creation payload; deterministic slot generator (`k = floor(ΔT / Δt)`) |
| **Validation** | Time format HH:MM, interval > 0, capacity ≥ number of slots, MySQL CHECK on `end_time > start_time` |
| **Storage** | Camp fields in `camps`; per-slot rows in `slots` table with foreign key to `camps` |
| **Usage** | Slot grid display, capacity arithmetic, waitlist positioning, hourly utilisation analytics |

### 2.4 Slot Capacity

| Attribute | Detail |
|---|---|
| **What is collected** | Per-slot capacity, booked_count, slot index, start/end time |
| **Why** | Enforce zero overbooking: `booked_count ≤ capacity` via MySQL CHECK constraint + `SELECT ... FOR UPDATE` row lock |
| **Origin** | Auto-generated at camp creation; distributed as `base = floor(C/k)` seats per slot with remainder spread earliest-first |
| **Validation** | `capacity > 0`, `booked_count ≤ capacity`, `end_time > start_time` |
| **Storage** | MySQL `slots` table, unique index on `(camp_id, slot_index)`, index on `(camp_id, booked_count, capacity)` |
| **Usage** | Real-time availability display, booking gate, waitlist trigger, slot utilisation analytics |

### 2.5 Booking Records

| Attribute | Detail |
|---|---|
| **What is collected** | Slot, camp, patient, QR token, token number, status, travel mode, on-time pledge, timestamps (booked, checked-in, cancelled) |
| **Why** | The core transactional record: a reserved screening seat with verifiable identity and logistics (no medical data) |
| **Origin** | `POST /api/slots/:id/book` (patient), cancellation/reschedule promotion (system), seed data |
| **Validation** | Zod on travel mode enum; database unique indexes `uq_slot_patient` and `uq_one_active_booking_per_camp` (generated column); status enum CHECK |
| **Storage** | MySQL `bookings` table (InnoDB), foreign keys to `slots`, `camps`, `users`; indexes on `(camp_id, status)` and `(patient_id, status)` |
| **Usage** | Patient booking history, waitlist promotion, check-in, attendance analytics, no-show tracking, audit trail |

### 2.6 Booking Status

| Attribute | Detail |
|---|---|
| **What is collected** | Status enum: CONFIRMED, CANCELLED, CHECKED_IN, NO_SHOW, COMPLETED; timestamps for transitions |
| **Why** | Lifecycle tracking of every seat: reserved → attended → completed, or released → no-show; drives waitlist promotion and close-out |
| **Origin** | Booking (CONFIRMED), cancellation (CANCELLED), check-in (CHECKED_IN), close-out (NO_SHOW), attendance correction |
| **Validation** | State machine in `/api/bookings/:id/attendance`; only legal transitions allowed; MySQL CHECK on status values |
| **Storage** | `bookings.status` column; derived `active_camp_id` generated column for the one-active-booking invariant |
| **Usage** | Booking status display, waitlist auto-promotion gate, attendance rate, no-show rate, close-out processing |

### 2.7 Staff Assignments

| Attribute | Detail |
|---|---|
| **What is collected** | Camp, user, role at camp (DOCTOR/VOLUNTEER/NURSE/COORDINATOR), shift start/end, expected load/hr, max patients/hr, duties |
| **Why** | Camp-day staffing plan; clinical load balancing with warnings when expected load exceeds safe threshold |
| **Origin** | `POST /api/camps/:campId/staff` (organizer/admin), seed data (doctors + volunteers per camp) |
| **Validation** | Shift end > start; no overlapping shifts for same user on same day (`SELECT ... FOR UPDATE` half-open interval check); one assignment per user per camp |
| **Storage** | MySQL `staff_assignments` table, unique index on `(camp_id, user_id)`, foreign keys to `camps` and `users` |
| **Usage** | Staff day view, load-balancer warnings, camp-day coordination, analytics staff allocation |

### 2.8 Attendance Records

| Attribute | Detail |
|---|---|
| **What is collected** | Check-in timestamp, status transitions (CONFIRMED→CHECKED_IN→COMPLETED/NO_SHOW), QR/token used for check-in |
| **Why** | Record who actually attended vs. booked; supports no-show processing and camp-day flow management |
| **Origin** | `POST /api/checkin` (staff scans QR), `PATCH /api/bookings/:id/attendance` (staff correction), `POST /api/camps/:id/close-out` (auto no-show) |
| **Validation** | `checked_in_at` set on check-in; state machine restricts transitions; reminders cancelled on check-in/no-show |
| **Storage** | `bookings.checked_in_at`, `bookings.status`; foreign key to bookings |
| **Usage** | Check-in queue, Live Queue TV, attendance rate %, no-show rate %, per-camp participation |

### 2.9 No-Show Records

| Attribute | Detail |
|---|---|
| **What is collected** | Bookings with status NO_SHOW, no checked_in_at, reason implicit (did not arrive) |
| **Why** | Measure no-show rate for the Capacity Advisor and for camp operations improvement |
| **Origin** | `PATCH /api/bookings/:id/attendance` (status=NO_SHOW), `POST /api/camps/:id/close-out` (auto-marks remaining CONFIRMED as NO_SHOW) |
| **Validation** | Only CONFIRMED or CHECKED_IN can transition to NO_SHOW; state machine enforced |
| **Storage** | `bookings.status = 'NO_SHOW'`, `checked_in_at = NULL` |
| **Usage** | No-show rate KPI, Capacity Advisor no-show probability `p`, historical analytics |

### 2.10 Reminder Delivery Records

| Attribute | Detail |
|---|---|
| **What is collected** | Booking, type (REMINDER_24H / REMINDER_2H), send_at, status (PENDING/SENDING/SENT/FAILED/CANCELLED), attempts, last error, channel, recipient, provider, simulated flag |
| **Why** | Timely nudges 24h and 2h before appointments; audit trail for every SMS/email; idempotent, retryable delivery |
| **Origin** | `scheduleForBooking()` (on booking/confirm/reschedule), `runReminderSweep()` (cron every minute or manual admin trigger) |
| **Validation** | One row per booking/type (unique key `uq_reminder_booking_type`); max 50 attempts; stale SENDING rows recycled after 10 min |
| **Storage** | MySQL `reminders` table + `notifications_log` audit table; foreign key to `bookings`; indexes on `(status, send_at)` and `(booking_id, type)` |
| **Usage** | Patient reminders, delivery outcome tracking, retry with exponential backoff, Gateway Interceptor audit display |

---

## 3. Data Flow Diagram

```
Patient Registration
     │ (users table)
     ▼
Camp Discovery → Slot Selection → Booking
     │                    │              │
     ▼                    ▼              ▼
  camps table        slots table   bookings table
     │                    │              │
     └────────────────────┴──────────────┘
                         │
                    Waitlist (FIFO)
                         │
                         ▼
                  Reminders (24h, 2h)
                         │
                         ▼
                 Check-in / Attendance
                         │
                         ▼
                Camp Close-out → Analytics
                         │
                  CSV Export / Dashboard
```

---

## 4. Analytics Derived From Collected Data

| Metric | Formula | Source Tables |
|---|---|---|
| Total registered patients | `COUNT(*) WHERE role='PATIENT'` | `users` |
| Total bookings | `COUNT(*)` | `bookings` |
| Confirmed bookings | `COUNT(*) WHERE status='CONFIRMED'` | `bookings` |
| Waitlist count | `COUNT(*) WHERE status='WAITING'` | `waitlist` |
| Attendance rate | `CHECKED_IN / (CHECKED_IN + NO_SHOW)` | `bookings` (completed camps) |
| No-show rate | `NO_SHOW / (CHECKED_IN + NO_SHOW)` | `bookings` (completed camps) |
| Slot utilisation | `booked / capacity` per hour | `slots` + `camps` |
| Waitlist promotions | `COUNT(*) WHERE status='PROMOTED'` | `waitlist` |
| Staff allocation | `COUNT(*) per camp/role` | `staff_assignments` |
| Reminder delivery | `COUNT(*) per channel/status` | `notifications_log` |

---

## 5. Data Validation & Storage Summary

- **Authentication**: bcrypt (cost 10), JWT signed with HS256, 12h expiry
- **Validation layer**: Zod schemas on all mutating endpoints; field-level issue reporting
- **Database**: MySQL 8 InnoDB, `utf8mb4`, foreign keys with CASCADE/SET NULL, CHECK constraints
- **Concurrency**: `SELECT ... FOR UPDATE` pessimistic row locking; `READ COMMITTED` isolation
- **Integrity**: Unique indexes enforce one-active-booking-per-camp, one-booking-per-slot-patient, unique QR tokens
- **Privacy (DPDP-aligned)**: Only name, phone, email, age group stored — no medical history, diagnosis, or prescriptions. One-tap purge endpoint (`DELETE /api/users/me/purge`)

---

## 6. Seeded vs. Real Data Distinction

All data in the current deployment is **seeded demonstration data** for academic review purposes:

- **Demo accounts**: 5 seeded users (Admin, Organizer, Doctor, Volunteer, Patient) with known passwords
- **Seed camps**: 3 upcoming Bengaluru camps + 3 historical camps with deterministic slots and bookings
- **Historical no-show data**: 26 historical bookings with 5 NO_SHOW (19.23% empirical rate) used by the Capacity Advisor
- **Notification log**: Seeded SIMULATED entries showing SMS/email audit format

No real patients, hospital partnerships, survey results, or screening outcomes are collected or claimed. The system is designed so real-world deployment would collect only the minimal fields listed above, with explicit consent and DPDP compliance.

---

## 7. How Analytics Charts Are Built

All charts on the `/analytics` page are generated from live MySQL aggregate queries (not hardcoded):

1. **Bookings vs Capacity** — per camp: SUM(slot capacity) vs SUM(booked_count)
2. **Attendance vs No-Show** — per completed camp: CHECKED_IN vs NO_SHOW counts
3. **Hourly Utilisation** — SUM(booked) / SUM(capacity) grouped by HOUR(slot start time)
4. **Capacity Advisor** — `min(ceil(C_phys/(1−p)), floor(C_phys×(1+α_max)))` where `p` = empirical no-show rate from historical bookings

Each chart carries a "demonstration data" tag where seeded values are used.

---

*End of data collection documentation.*
