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

## Design world: "Biophilic Clinical Precision"

- Single brand hue: emerald `#059669` / mint `#10b981`. Everything else is slate, mint, precise amber/red/blue signals.
- Dark clinical default; light theme available. Glass reserved for the floating sidebar and the Health Passport only.
- Bento grids, hairline grids, one soft shadow system — never glow.
- Tokens in `frontend/src/index.css`. Typography: Inter + Plus Jakarta Sans + Noto Sans Kannada + JetBrains Mono.
- Motion communicates state (exponential ease-out, 180–320ms micro, 420–600ms page). Honor `prefers-reduced-motion`.

---

## Strict-live runtime model

- There is no Mode B, no local in-memory engine and no simulation fallback. `frontend/src/lib/api.js` is the **only** network boundary. A failed health probe or API call surfaces the real error; it never fabricates a response.
- The sidebar shows `LIVE · MySQL` when the backend is connected and an honest connection error otherwise. No `DEMO` chip, one-click demo login, demo controller or `/api/demo/*` endpoints exist.
- Every row in the UI comes from MySQL. Empty lists are real empty states, not fixtures.
- Staff accounts are created only by `backend/scripts/bootstrap-production.js` from `BOOTSTRAP_*` environment variables. Patients self-register. `backend/seed.js` / `npm run seed` are **LOCAL ONLY** and must never be run against a hosted or production database.
- Backend serves `frontend/dist/` automatically when present (line ~2220 of `backend/server.js`).

---

## Key conventions

- Pages consume `useApp()` from `frontend/src/store.jsx`; never call `fetch` directly — use `api.*`.
- Route hash-based: `#/overview`, `#/discover`, `#/myBookings`, `#/staffDay`, `#/liveQueue`, `#/manage`, `#/analytics`, `#/notifications`, `#/settings`.
- Nav IDs must match `PAGES` in `frontend/src/App.jsx` and `NAV` in `frontend/src/components/Shell.jsx`.
- Status badges use `ui.jsx` `Badge` tone map: `ok`/`warn`/`bad`/`info`/`muted`. Any sandbox delivery label applies only to SMTP/SMS attempts without credentials, never to database results.
- Science annotations via `Sci` from `ui.jsx` — toggle body class `science-on`.
- Kannada strings are partial localization (nav + primary actions only); long-form clinical copy stays English.

---

## Production startup (no seed)

```bash
cd backend
node scripts/db.js setup-production
node scripts/bootstrap-production.js
node server.js
# or: npm run start:production (from backend/)
```

`setup-production` applies `database/schema-production.sql` and `database/migrations/*.sql` only. No sample users, camps, slots, bookings, waitlist entries, staff assignments or notifications are inserted. Regenerate the DDL-only file with `node scripts/generate-production-schema.mjs`.

Railway variables that must be set in the dashboard (never committed): `NODE_ENV=production`, `JWT_SECRET`, `MYSQL_URL` / `DB_NAME=railway`, `FRONTEND_ORIGIN`, `TRUST_PROXY=2`, the four `BOOTSTRAP_{ADMIN,ORGANIZER,DOCTOR,VOLUNTEER}_{EMAIL,PASSWORD,NAME}` triples, `BOOTSTRAP_PHONE_SEED`, and `PURGE_ON_BOOT=false`. A one-time seeded-database reset also needs `ALLOW_PRODUCTION_PURGE=true` alongside `PURGE_ON_BOOT=true`, then both return to `false`. SMTP/SMS variables are optional; without them, notification rows are labelled Sandbox and no real delivery is claimed. The Pages workflow needs the GitHub repository variable `RENDER_API_URL` for `VITE_API_BASE`.

---

## Anti-patterns to avoid

- No `fetch` outside `api.js`; no `<div onClick>` (use `<button>`); no fake AI claims (Capacity Advisor is explicitly "Rule-Based Statistical Heuristic — NOT Black-Box AI/ML").
- No simulated database results, no fake links, no committed secrets, no seed fixtures in production.
- No `outline: none` without `focus-visible` replacement; no `transition: all`; no `user-scalable=no`.
- Every icon-only button needs `aria-label`; toasts use `aria-live="polite"`; form inputs have visible labels.
