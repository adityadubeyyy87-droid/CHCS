# CHSC — Community Health Screening Camp Scheduler

Agent guidance for anyone working on this project. Read before editing.

---

## Stack (do not substitute)

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, socket.io-client, inline-SVG QR (`qrcode`) |
| Backend | Node.js, Express, JWT (`jsonwebtoken`), `bcryptjs`, `node-cron`, Nodemailer, Socket.io |
| Database | MySQL 8, `mysql2/promise`, InnoDB, `SELECT … FOR UPDATE` row locks |

---

## Runtime model: STRICT LIVE / REAL DATA ONLY

- There is no local demo engine and no offline simulation fallback. `frontend/src/lib/api.js` is the **only** network boundary. It calls the configured backend and surfaces a real connection error when the API is unavailable; it never substitutes fabricated results.
- The sidebar shows the live backend status (`LIVE · MySQL`). There is no `DEMO` mode, no one-click demo login, no demo controller and no `/api/demo/*` endpoints.
- All screens show real MySQL rows. Empty states mean no real records exist yet — never fill them with sample patients, camps, slots, bookings or notifications.
- `database/schema.sql` is the **local development** schema and still carries local-only fixtures for tests. `database/schema-production.sql` is generated from it with `node scripts/generate-production-schema.mjs` and is **DDL only** (no data statements). `backend/seed.js` and `npm run seed` are **LOCAL ONLY** and must never run against a hosted or production database.
- Backend serves `frontend/dist/` automatically when present.

---

## Design world: "Biophilic Clinical Precision"

- Single brand hue: emerald `#059669` / mint `#10b981`. Everything else is slate, mint, precise amber/red/blue signals.
- Dark clinical default; light theme available. Glass reserved for the floating sidebar and the Health Passport only.
- Bento grids, hairline grids, one soft shadow system — never glow.
- Tokens in `frontend/src/index.css`. Typography: Inter + Plus Jakarta Sans + Noto Sans Kannada + JetBrains Mono.
- Motion communicates state (exponential ease-out, 180–320ms micro, 420–600ms page). Honor `prefers-reduced-motion`.

---

## Key conventions

- Pages consume `useApp()` from `frontend/src/store.jsx`; never call `fetch` directly — use `api.*`.
- Route hash-based: `#/welcome` (cinematic landing, default when signed out), `#/overview`, `#/discover`, `#/myBookings`, `#/staffDay`, `#/liveQueue`, `#/manage`, `#/analytics`, `#/notifications`, `#/settings`.
- Nav IDs must match `PAGES` in `frontend/src/App.jsx` and `NAV` in `frontend/src/components/Shell.jsx`.
- Status badges use `ui.jsx` `Badge` tone map: `ok`/`warn`/`bad`/`info`/`muted` (the `sim` tone is reserved for honest SMTP/SMS sandbox labels, never for database results).
- Kannada strings are partial localization (nav + primary actions only); long-form clinical copy stays English.

---

## Production startup (migrations only, no seed)

```bash
cd backend
node scripts/db.js setup-production
node scripts/bootstrap-production.js
node server.js
# or, when configured: npm run start:production
```

`setup-production` applies `database/schema-production.sql` plus `database/migrations/*.sql`. It creates tables/indexes only; it never drops data and never inserts sample records. `bootstrap-production` creates only the real staff accounts supplied through environment variables. Patients self-register through the API.

Required Railway/host variables (values are secrets, never committed):

`NODE_ENV=production`, `JWT_SECRET`, `MYSQL_URL` (or `DATABASE_URL`) with `DB_NAME=railway`, `FRONTEND_ORIGIN`, `TRUST_PROXY=2`, `BOOTSTRAP_ADMIN_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_ORGANIZER_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_DOCTOR_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_VOLUNTEER_EMAIL/PASSWORD/NAME`, `BOOTSTRAP_PHONE_SEED`, `PURGE_ON_BOOT=false`. To replace an old seeded database, set `PURGE_ON_BOOT=true` **and** `ALLOW_PRODUCTION_PURGE=true` for one intentional deployment, then return both to `false`.

SMTP/SMS variables are optional. With no credentials, delivery attempts are labelled **Sandbox** in the notification audit log; no real email or SMS is claimed as delivered. See `DEPLOYMENT.md` for the full variable reference and the required GitHub `RENDER_API_URL` repository variable used by the Pages build.

---

## Anti-patterns to avoid

- No `fetch` outside `api.js`; no `<div onClick>` (use `<button>`); no fake AI claims (Capacity Advisor is explicitly "Rule-Based Statistical Heuristic — NOT Black-Box AI/ML").
- No simulated database results, no fake links, no committed credentials, no seed fixtures in production.
- No `outline: none` without `focus-visible` replacement; no `transition: all`; no `user-scalable=no`.
- Every icon-only button needs `aria-label`; toasts use `aria-live="polite"`; form inputs have visible labels.
