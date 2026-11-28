# PRODUCT.md

> Written by /impeccable init — inferred entirely from the user's explicit master build brief (no interview was run; the brief is exhaustive). Assumptions are labeled.

## Product

**Community Health Screening Camp Scheduler (CHSC)** — a HealthTech platform that digitizes community health screening camps: registration, transactional appointment booking, FIFO waitlists, QR check-in, live queue management, staff load balancing, and rule-based capacity analytics.

**Audience:** four user groups — patients/community members, camp organizers, doctors/volunteers, and system administrators. Primary users are non-technical community members in Bengaluru, India; English and Kannada are both first-class. Secondary users are camp operators under time pressure on camp day.

**Jobs to be done:**
- Patients: find a nearby screening camp, book a slot in under a minute, show a QR pass at the door, cancel ethically if plans change.
- Organizers: configure a camp (venue, timings, slot duration, capacity), auto-generate non-overlapping slots, assign staff, and see workload warnings before they become queue disasters.
- Doctors/Volunteers: verify bookings by QR, check patients in, and run a live waiting-room display.
- Admins: see attendance, no-show, waitlist-promotion and utilization truth; export CSVs; get a transparent capacity recommendation.

**What it is NOT:** a medical product. It schedules appointments; it never diagnoses, stores medical history, or collects anything beyond name, phone, email, age group. Privacy-by-design and DPDP-aware (assumption labeled: Indian Digital Personal Data Protection Act, 2023).

**Platform:** web app, desktop + tablet + mobile. Strict-live only: Express + MySQL + Socket.io with no local simulation or offline fallback. Connection status is visible; a backend outage surfaces a real error rather than fabricated data.

**Success criteria:**
- A professor can be shown SELECT … FOR UPDATE concurrency (1 confirmed / 19 waitlisted / 0 overbooked) via the backend integration test.
- A real community member can book a camp in three steps without instruction.
- Every screen is presentation-ready with real data; no dead buttons and no fabricated outcomes.

## Design

**Surface mode:** Operate (dashboards, booking flows) with one Persuade moment — the patient-facing discovery/booking experience and the digital Health Passport.

**Committed visual world — "Biophilic Clinical Precision":** premium healthcare branding, editorial typography, emerald-on-dark clinical surfaces, glass used only where it means something (floating nav, pass), generous whitespace, 8px spacing system, asymmetric bento layouts, refined motion that communicates state.

- Palette: primary emerald #059669, deep emerald #047857, mint #10B981, dark bg #0B1220, slate surface #111C2E, light bg #F7FAF8, white surface #FFFFFF, muted #64748B, amber #F59E0B, red #DC2626, blue #2563EB.
- Type: Plus Jakarta Sans for headings, Inter for interface/body, tabular numerals for all data; Kannada content in a Noto Sans Kannada stack.
- References (not templates): Linear, Stripe, Apple Health, Vercel, hospital command centers.

**Banned by brief:** generic dashboard templates, Bootstrap-style card grids, decorative gradients, fake AI claims, fake success for failed backend operations.

## Constraints

- Stack is fixed: React 18 + Vite + Recharts + socket.io-client + inline-SVG QR on the front; Node/Express/JWT/bcryptjs/node-cron/Nodemailer/Socket.io + MySQL (mysql2/promise, InnoDB) on the back. Do not substitute.
- Local development runs on Windows with MySQL 8 and the Express backend; the production bootstrap is migrations-only with no seed data.
- Behavioral-science annotations ("Viva Science X-Ray") must cite mechanisms honestly, without unsupported claims of guaranteed improvement.
- SMTP/SMS credentials are optional; with none configured, delivery attempts are labelled Sandbox and no real delivery is claimed.
- Academic context: CMR Institute of Technology, Bengaluru — B.E. ISE, 2nd year, team of 3, guide Dr. Srividya R.
