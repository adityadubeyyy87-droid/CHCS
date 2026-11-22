# Decision Log — CHSC Live Experience Layer

Format per entry:
1. Problem: whose pain does this solve?
2. Options: at least 2 alternatives, with trade-offs
3. Choice: what was picked and why, with evidence
4. Risk: how this could fail, and the fallback

All entries assume the strict-live runtime: real API → Express → MySQL. No demo engine, seed fixtures in production, or simulated database results were accepted.

---

## Entry 1: Row-Lock Concurrency Proof (backend, not a browser fixture)

**Problem:** Evaluators need to see the zero-overbooking guarantee, not just read about it. A terminal test is reproducible but not visual.

**Options:**
A) A browser "race" that creates temporary booking rows and animates results. (Pro: visual. Cons: pollutes real data and needs a disposable slot.)
B) Run the existing backend concurrency test against a throwaway MySQL database and show its output. (Pro: real InnoDB locks, no production data touched. Cons: terminal output.)
C) No proof. (Cons: weak evidence for the 10 implementation marks.)

**Choice:** B — the mandatory proof is `backend/tests/integration/concurrency.test.js` (50 requests / 10 seats → 10 held+confirmed, 40 waitlisted, 0 overbooked), runnable against the live database through `backend/concurrency-test.js` with proof-only row cleanup. A browser page may explain the mechanism but never fabricates a result.

**Risk:** Rate limits or lock timeouts. Fallback: run in CI/local with `RATE_LIMIT_DISABLED=true` against a throwaway database; never weaken production limits to stage a proof.

---

## Entry 2: Camp Day Control Room

**Problem:** Organizers need one real-time board for slot fill, check-in queue and staff status during a camp.

**Options:**
A) Dedicated camp-day page subscribing to Socket.io events. (Pro: live, one screen. Cons: new page to build/test.)
B) Add widgets to Manage. (Pro: no new route. Cons: Manage is already dense.)
C) No change. (Cons: organizers switch tabs under time pressure.)

**Choice:** A — dedicated control room fed by real API/Socket.io events. Fallback: poll `/api/queue/:campId` if sockets disconnect.

**Risk:** Too much real-time data overwhelms staff. Fallback: limit to current slot, next three check-ins, staff count and no-show count.

---

## Entry 3: QR Check-In Requires the API

**Problem:** Venues can have poor signal; staff want to keep checking people in.

**Options:**
A) PWA with local queue and later sync. (Pro: offline tolerance. Cons: complex; risks accepting unverified tokens.)
B) Cache valid tokens in memory with "pending sync". (Pro: simple. Cons: not durable; duplicate risk.)
C) Require a successful API call for every check-in. (Pro: no fake success, database stays authoritative. Cons: fails without connectivity.)

**Choice:** C — a failed check-in shows an error. A locally accepted "checked-in" state that never reaches MySQL would be a fabricated outcome.

**Risk:** A real venue loses connectivity. Fallback: operational (network/venue planning), not a simulated success path.

---

## Entry 4: Smart Waitlist

**Problem:** Waitlisted patients want to know their position; organizers need to see the queue.

**Options:**
A) Show real position from the waitlist table + atomic promotion + 15-minute claim window. (Pro: transparent. Cons: needs migration.)
B) Show only "you're on the waitlist". (Cons: uncertainty and support calls.)
C) Neither. (Cons: weak fairness story.)

**Choice:** A — `promotion_expires_at` and FIFO ordering under the slot row lock. Evidence: existing `waitlist` table already orders by `created_at, id`; migration 002 adds the expiry column/index.

**Risk:** Expired promotions block a seat. Fallback: hold-expiry sweep releases and promotes the next FIFO patient atomically.

---

## Entry 5: Explainable No-Show Risk Score

**Problem:** Organizers want to prioritise follow-up without claiming AI.

**Options:**
A) Deterministic rule-based Low/Medium/High score from real booking history, with a reason. (Pro: explainable. Cons: not predictive.)
B) ML model. (Rejected: explicitly out of scope and banned by the brief.)
C) No score. (Cons: no prioritisation.)

**Choice:** A — labelled "heuristic, not AI prediction", staff-facing only. Shows "No data" when a patient has no history.

**Risk:** Patients feel judged by a label. Fallback: never expose the score in patient-facing screens.

---

## Entry 6: Data Provenance Labels

**Problem:** The 8 data-collection marks require an honest account of where numbers come from.

**Options:**
A) Per-chart label naming the real MySQL source and sample size; explicit empty state. (Pro: auditable. Cons: extra UI work.)
B) One global disclaimer. (Cons: loses per-chart honesty.)
C) No labels. (Cons: unverifiable claims.)

**Choice:** A — every chart states its live source. There are no "seeded", "test" or "synthetic" series in production; local test data exists only in throwaway databases. SMTP/SMS attempts without credentials are labelled Sandbox, which is a delivery-provider status, not a data-provenance claim.

**Risk:** Empty charts look broken to evaluators. Fallback: an explicit "no real records yet" state with a link to create a real camp — never sample values.

---

## Entry 7: Multilingual UI (English + Kannada)

**Problem:** Bengaluru patients may prefer Kannada; partial translations already exist.

**Options:**
A) Translate the patient booking flow using the existing `i18n.js`/`lang` store. (Pro: reuses infra. Cons: translation effort.)
B) Full site translation. (Cons: high effort, low marginal value.)
C) English only. (Cons: misses the bilingual commitment.)

**Choice:** A — patient-facing booking flow translated; dashboards remain English. Fallback to English for missing keys.

**Risk:** Mixed-language screens. Fallback: keep a consistent language toggle and interpolate numbers with tabular numerals.

---

## Entry 8: Audit Trail

**Problem:** Admins need to know who changed a booking or camp and when.

**Options:**
A) `audit_log` table with actor, action, target and before/after JSON. (Pro: queryable. Cons: new table.)
B) Rely on `created_at`/`updated_at`. (Cons: no actor or before/after.)
C) No trail. (Cons: no accountability.)

**Choice:** A — append-only audit rows written from real mutations. Evidence: schema already had `created_by` on camps; audit extends it. Fallback: log action and target only if JSON serialisation fails.

**Risk:** Audit writes slow requests. Fallback: non-fatal logging; the primary transaction still commits.

---

## Entry 9: No Demo Scenario Loader

**Problem:** Presentations want repeatable state (full slot, active waitlist, camp day).

**Options:**
A) A scenario endpoint that upserts sample rows. (Rejected: writes non-real records into the deployed database.)
B) Re-run local schema fixtures before a talk. (Rejected in production: destructive and would wipe real data.)
C) Build a real camp/booking during the walkthrough, or use a throwaway local database for rehearsal. (Pro: honest, no production pollution.)

**Choice:** C — no scenario loader exists in production. Local development and tests may use `database/schema.sql` fixtures and `backend/seed.js`; those are never deploy steps.

**Risk:** An empty hosted database makes a talk less lively. Fallback: show the honest empty state and create real records live with a registered test account.

---

## IMPLEMENTATION CONFIRMATION

Current direction is strict live end to end:

- Live connection status instead of a mode switch; backend outages show real errors
- Row-lock concurrency proven by real MySQL tests, not a browser simulation
- Hold/confirm, FIFO promotion, QR check-in and audit trail operate on real rows
- Charts labelled with real sources; SMS/email sandbox labels limited to delivery attempts
- Production startup = migrations + bootstrap role accounts only; no seed, no sample data
- Local fixtures are confined to local development and throwaway test databases
