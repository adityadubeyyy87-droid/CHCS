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

## Mode A (live) vs Mode B (local demo engine)

- `frontend/src/lib/api.js` is the **only** network boundary. It probes `GET /api/health` at startup; if the backend is down it falls back to `frontend/src/lib/engine.js` (in-memory engine mirroring API shapes exactly).
- The sidebar shows a visible mode chip (`LIVE · MySQL` / `DEMO`). Simulated results carry `simulated: true` and `SIMULATED` badges — never presented as real.
- Backend serves `frontend/dist/` automatically when present (line ~2220 of `backend/server.js`).

---

## Key conventions

- Pages consume `useApp()` from `frontend/src/store.jsx`; never call `fetch` directly — use `api.*`.
- Route hash-based: `#/overview`, `#/discover`, `#/myBookings`, `#/staffDay`, `#/liveQueue`, `#/manage`, `#/analytics`, `#/notifications`, `#/settings`.
- Nav IDs must match `PAGES` in `frontend/src/App.jsx` and `NAV` in `frontend/src/components/Shell.jsx`.
- Status badges use `ui.jsx` `Badge` tone map: `ok`/`warn`/`bad`/`info`/`muted`/`sim`.
- Science annotations via `Sci` from `ui.jsx` — toggle body class `science-on`.
- Kannada strings are partial localization (nav + primary actions only); long-form clinical copy stays English.

---

## Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cmrit.edu` | `Admin@123` |
| Organizer | `organizer@cmrit.edu` | `Password@123` |
| Doctor | `doctor@cmrit.edu` | `Password@123` |
| Volunteer | `volunteer@cmrit.edu` | `Password@123` |
| Patient | `patient@cmrit.edu` | `Password@123` |

---

## How to run

```powershell
# Backend (MySQL required for Mode A)
mysql -u root -p < database/schema.sql   # seed once
cd backend && node server.js              # :4000, serves frontend/dist/ if present

# Frontend
cd frontend && npm run dev                # :5173, proxies /api + /socket.io to :4000
```

Without MySQL, run only the frontend — it auto-falls back to Mode B (local demo engine).

---

## Anti-patterns to avoid

- No `fetch` outside `api.js`; no `<div onClick>` (use `<button>`); no fake AI claims (Capacity Advisor is explicitly "Rule-Based Statistical Heuristic — NOT Black-Box AI/ML").
- No `outline: none` without `focus-visible` replacement; no `transition: all`; no `user-scalable=no`.
- Every icon-only button needs `aria-label`; toasts use `aria-live="polite"`; form inputs have visible labels.
- Simulated outputs are stamped `SIMULATED` (dashed badge) — never pretend a demo result is a real database result.
