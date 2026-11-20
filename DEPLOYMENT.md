# CHSC Deployment Guide

## Overview

CHSC is a full-stack application with three deployment components:
1. **Frontend** (React + Vite) — static build served by the backend or a CDN
2. **Backend** (Node.js + Express) — API server with Socket.io
3. **Database** (MySQL 8) — relational data store

The application supports two modes:
- **Mode A (Live):** Backend connected to MySQL — real transactions, Socket.io
- **Mode B (Demo):** Backend offline — local in-memory engine, clearly labeled `SIMULATED`

---

## 1. Prerequisites

- Node.js >= 18
- MySQL 8.0+ (for Mode A)
- A domain with HTTPS (for production)

---

## 2. Database Setup

### Local development
```bash
mysql -u root -p < database/schema.sql
```

### Production (hosted MySQL)
1. Provision a MySQL 8 database (e.g., AWS RDS, Azure MySQL, DigitalOcean Managed DB)
2. Note the host, port, user, password, and database name
3. Run the schema against the production database:
```bash
mysql -h <PROD_HOST> -P <PORT> -u <USER> -p<PASSWORD> < database/schema.sql
```

---

## 3. Backend Deployment

### Install dependencies
```bash
cd backend
npm install --production
```

### Configure environment
Copy `.env.example` to `.env` and set production values:

```bash
PORT=4000
NODE_ENV=production
DEMO_MODE=false
FRONTEND_ORIGIN=https://yourdomain.com

# MySQL (production hosted instance)
DB_HOST=<PROD_HOST>
DB_PORT=3306
DB_USER=<PROD_USER>
DB_PASSWORD=<PROD_PASSWORD>
DB_NAME=community_health_scheduler

# JWT — MUST change for production (generate a strong random secret)
JWT_SECRET=<generate-a-32-byte-random-secret>
JWT_EXPIRES=12h

# Reminders
REMINDER_MAX_ATTEMPTS=5
REMINDER_CRON=* * * * *

# Capacity Advisor
ALPHA_MAX=0.25

# Optional real email gateway (leave blank for sandbox)
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-user>
SMTP_PASS=<smtp-pass>
MAIL_FROM=CHSC <no-reply@yourdomain.com>

# Optional real SMS gateway
SMS_PROVIDER=Fast2SMS
FAST2SMS_API_KEY=<your-api-key>
```

### Security notes
- **Never commit `.env`** to version control
- **Generate a strong `JWT_SECRET`** for production (use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- **Set `NODE_ENV=production`** to disable verbose error output
- **Set `DEMO_MODE=false`** in production to disable demo login
- **Configure CORS** `FRONTEND_ORIGIN` to your actual production domain(s)

### Start the backend
```bash
cd backend
npm start        # or: node server.js
```

The backend listens on port 4000 and:
- Serves the API at `/api/*`
- Serves Socket.io at `/socket.io/*`
- Serves the built frontend from `frontend/dist/` (when present)
- Exposes health check at `GET /api/health`

---

## 4. Frontend Deployment

### Build
```bash
cd frontend
npm install
npm run build    # → frontend/dist/
```

### Option A: Served by backend (recommended)
Copy `frontend/dist/` into the backend or ensure the backend can find it at `../frontend/dist/`. The backend's `server.js` serves `frontend/dist/` automatically at runtime (see lines 2630-2637).

### Option B: Standalone static hosting
Deploy `frontend/dist/` to any static host (Vercel, Netlify, S3+CloudFront, GitHub Pages). Set `VITE_API_BASE` to your backend URL:
```bash
VITE_API_BASE=https://api.yourdomain.com
```

The frontend will call the backend API directly and fall back to Mode B (demo engine) if unreachable.

---

## 5. Production Build & Deploy (One Command)

```bash
# 1. Build the frontend
cd frontend && npm run build

# 2. Install backend deps
cd ../backend && npm install --production

# 3. Configure .env (copy from .env.example, set production values)
cp .env.example .env
# edit .env with production DB host, JWT_SECRET, CORS origin

# 4. Run schema against production DB
mysql -h <HOST> -u <USER> -p < database/schema.sql

# 5. Start backend
npm start
```

---

## 6. Health Check

```bash
curl https://api.yourdomain.com/api/health
```

Expected response:
```json
{
  "ok": true,
  "service": "CHSC API",
  "demoMode": false,
  "database": "connected",
  "dbVersion": "8.4.x",
  "socket": "ready"
}
```

---

## 7. CORS Configuration

CORS is configured in `backend/server.js` via `FRONTEND_ORIGIN`. For production:

```env
FRONTEND_ORIGIN=https://yourfrontend.com,https://www.yourfrontend.com
```

The backend checks the `Origin` header against this list. Socket.io uses the same allowed origins.

---

## 8. Environment Variables Reference

| Variable | Production Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables production error handling |
| `DEMO_MODE` | `false` | Disables demo login shortcuts |
| `JWT_SECRET` | strong random secret | JWT signing key — CHANGE FROM DEFAULT |
| `DB_HOST` | your MySQL host | Production database host |
| `DB_PASSWORD` | strong password | Production database password |
| `FRONTEND_ORIGIN` | your frontend domain(s) | CORS allowed origins |
| `SMTP_*` | real SMTP credentials | Optional — leaves blank = sandbox |
| `FAST2SMS_API_KEY` | real API key | Optional — leaves blank = sandbox |

---

## 9. No Development Credentials in Production

- `.env.example` contains placeholder values only
- The default `JWT_SECRET` in `.env.example` says "change-me" — **must be replaced**
- `DEMO_MODE=true` must be set to `false` in production
- No real SMTP/SMS keys are stored in the repo

---

## 10. Database Migrations

Schema changes are managed via `database/schema.sql` (full rebuild). For incremental changes, use `database/migrations/`. The test suite recreates the test database from `schema.sql` on every run.

---

## 11. Verification Checklist

Before going live:
- [ ] `GET /api/health` returns `database: connected`
- [ ] `NODE_ENV=production` is set
- [ ] `DEMO_MODE=false` is set
- [ ] `JWT_SECRET` is a strong random value
- [ ] `FRONTEND_ORIGIN` matches your production domain
- [ ] Frontend `dist/` is built and served by backend (or static host)
- [ ] SSL/HTTPS is terminated at the load balancer or reverse proxy
- [ ] `.env` is not committed to version control
- [ ] Test patient registration and login
- [ ] Test booking flow end-to-end
- [ ] Run `npm test` — all 67 backend tests pass

---

## 12. Local Production Simulation

To test the production build locally:
```bash
cd frontend && npm run build
cd ../backend && npm start
# Open http://localhost:4000 — the backend serves the built frontend
```

---

*End of deployment guide.*
