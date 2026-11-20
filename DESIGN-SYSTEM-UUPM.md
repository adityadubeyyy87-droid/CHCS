# CHSC Design System (applied from UI/UX Pro Max reasoning)

**Product type:** Medical Clinic / Community Health Screening Scheduler  
**Source:** nextlevelbuilder/ui-ux-pro-max-skill — product rule #58 (Medical Clinic), style rules #1/#8/#28/#29, chart rules #1/#2/#8/#19/#21, UX guidelines #28–46/#70–108/#111–120  
**Applies to:** `frontend/src/index.css`, `frontend/src/components/Shell.jsx`, `frontend/src/App.jsx`, all pages

---

## 1. Style recommendations (per product rule #58)

| Attribute | Recommendation | CHSC status |
|---|---|---|
| Primary style | Accessible & Ethical + Minimalism & Swiss Style | Implemented in `index.css` tokens; needs skip link + focus fixes (see §4) |
| Secondary styles | Neumorphism, Soft UI Evolution | Glass sidebar + passport (Soft UI) — no pure Neumorphism (high-contrast risk in healthcare) |
| Dashboard style | Healthcare Analytics (data-dense) | Analytics page: bento grid, Recharts, tabular nums — matches #28 Data-Dense Dashboard |
| Color focus | Medical Blue (#0077B6) + Trust White + Calm Green | CHSC uses emerald (#059669) health green — clinically appropriate; keep as single brand hue |
| Accessibility | WCAG AAA target (7:1+ contrast), 16px+ body, keyboard-only, screen reader | Partially — focus ring + contrast need hardening (see §4) |
| Touch targets | 44×44px minimum | 40px min buttons — increase to 44px on primary actions |

## 2. Chart selection for Analytics (per charts.csv)

| CHSC need | Recommended chart (charts.csv #) | Rationale |
|---|---|---|
| Hourly utilisation | Line Chart (#1 Trend Over Time) | Time axis, rise/fall over continuous period |
| Bookings vs capacity | Bar Chart (#2 Compare Categories) | Discrete categories by magnitude, ≤15 categories |
| Attendance vs no-show | Bar Chart (#2) | Same as above |
| Capacity advisor (p vs ceiling) | Gauge / Bullet Chart (#8 Performance vs Target) | Single KPI vs defined target/threshold — perfect fit |
| Fill-rate / part-to-whole | Waffle Chart (#19 Proportional/Percentage) | Accessible percentage alternative to pie |

CHSC Analytics already implements all five correctly.

## 3. UX guidelines applied (ux-guidelines.csv)

| # | Rule | CHSC implementation |
|---|---|---|
| 28 | Focus states | `:focus-visible` ring on all interactive elements (§4 hardens it) |
| 29 | Hover states | `:hover` backgrounds on all buttons |
| 30 | Active states | `:active` scale/press feedback |
| 31 | Disabled states | `opacity-50 cursor-not-allowed` |
| 32 | Loading buttons | `disabled` + `btn-spinner` during async |
| 33 | Error feedback | `.error-note` + `role="alert"` near problem |
| 34 | Success feedback | Toast + pass-seal animation |
| 35 | Confirmation dialogs | Purge modal + "Keep my data" escape hatch |
| 36 | Color contrast | 4.5:1+ dark/light; emerald tints tested |
| 37 | Color only | Icons/text always accompany color (badges + labels) |
| 40 | ARIA labels | Icon buttons have `aria-label` (§4 adds 2 missing) |
| 43 | Form labels | Visible `<label>` on every input |
| 44 | Error messages | `role="alert"`, inline, connected via `aria-describedby` |
| 45 | Skip links | **Added** — "Skip to main content" (§4) |
| 70 | Touch friendly | 40px+ buttons, larger on mobile |
| 99/100 | Focus not obscured | `scroll-padding-top` added (§4) |
| 102 | Focus appearance | 2px ring, 3:1 contrast (§4) |
| 111 | Long token wrapping | `overflow-wrap: anywhere` + `min-inline-size: 0` (§4) |
| 114 | Compact label semantics | Badges = status (static), chips = values/actions (interactive buttons) |
| 115 | Chip collection reflow | Flex-wrap on chip collections (§4) |
| 118 | Live badge updates | Atomic `role="status"` messages in Gateway Interceptor |
| 119 | Cancellable transitions | Motion cancelled on state change (Concurrency Arena) |
| 120 | IME Composition Enter | Not applicable (no chat/search compose) |

## 4. Code changes implemented

See the edits to `frontend/src/index.css` and `frontend/src/components/Shell.jsx`:

- **Skip-to-main link** (`#skip-to-content`) — Guideline #45
- **`scroll-padding-top`** on `html` — Guideline #100 (sticky topbar never covers focus)
- **Focus ring** — 2px `var(--mint-500)`, `outline-offset: 2px`, `border-radius: 4px` — Guideline #102
- **`cursor: pointer`** on every interactive element — Guideline #29
- **`overflow-wrap: anywhere`** on `.mono`, QR tokens, booking refs — Guideline #111
- **Interactive chips** — converted to `<button role="button" aria-pressed>` with visible focus — Guideline #117
- **Chip collections** — `flex-wrap` + `+n` overflow disclosure — Guideline #115

## 5. What was NOT changed (and why)

| UX Pro Max suggestion | CHSC decision | Reason |
|---|---|---|
| Neumorphism primary style | Not adopted | High-contrast risk in healthcare dashboards; Soft UI (glass) preferred |
| Liquid Glass / shaders | Not adopted | CHSC is a clinical tool, not a tech/marketing page — motion is reserved for state change |
| 7:1 contrast everywhere | 4.5:1 baseline | WCAG AA is the project's committed target; 7:1 where feasible |
| 44px touch targets | 40px baseline | 40px meets Fitts's Law commitment; 44px on primary actions only |
