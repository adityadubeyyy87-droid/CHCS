# DESIGN.md

> Captured at project genesis from the committed brief. This is the source of truth for CHSC's visual world. `/impeccable document` can regenerate from code once implemented.

## World — Biophilic Clinical Precision

A dark clinical command-center world with a light patient-facing mode. Emerald is the single brand hue; everything else is slate, mint, and precise amber/red/blue signals. Nature is present as texture, not illustration: soft radial "biophilic" washes, hairline grids, fine-dot patterns. Depth comes from layered surfaces and one soft shadow system — never glow.

## Tokens

```css
--emerald-600:#059669; --emerald-700:#047857; --mint-500:#10B981;
--bg-dark:#0B1220; --surface-dark:#111C2E; --surface-dark-2:#16223A;
--bg-light:#F7FAF8; --surface-light:#FFFFFF;
--text-hi:#F1F5F9; --text-hi-light:#0F172A;
--muted:#64748B; --muted-light:#5B6B7E;
--amber:#F59E0B; --red:#DC2626; --blue:#2563EB;
--line:rgba(148,163,184,.14);
```

- Dark is default for Operate surfaces (command center feel); light default for patient booking. Both themes must pass contrast (body ≥4.5:1).
- Radius scale: 10px controls, 16px cards, 24px panels, 999px pills.
- Spacing: 8px system; more space above headings than below.
- Shadows: `0 1px 2px rgba(2,6,23,.25), 0 12px 32px -12px rgba(2,6,23,.45)` — offset + soft blur, never zero-offset halos.
- Glass is reserved for two elements only: the floating sidebar (dark, `backdrop-filter: blur(14px)`) and the digital Health Passport. Glass is meaning (floating over content, a physical pass), not decoration.

## Typography

- Headings: "Plus Jakarta Sans", weights 600–800, tracking -0.02em to -0.03em at display sizes.
- Interface/body: "Inter", 400–600, line-height 1.55 body.
- Data: Inter with `font-variant-numeric: tabular-nums` everywhere numbers align; 12px labels uppercase tracking .08em for axis/legends.
- Kannada: "Noto Sans Kannada" appended to both stacks.
- Scale (desktop): display 44–56px, h2 24–28px, h3 17px, body 14–15px, micro 12px. Body measure ≤ 72ch.

## Layout

- Asymmetric bento grids (grid-template-areas), not uniform card rows. One anchor element per screen gets the largest cell (a chart, the Live Queue TV, the passport).
- App shell: collapsible floating glass sidebar (72px ↔ 240px), top bar with contextual page title + global search + notification center + EN/ಕನ್ನಡ + theme + profile.
- Live Queue TV: full-bleed dark panel, huge token numerals, designed for a TV at the back of a waiting room.
- No nested cards. Cards are containers for real content, differentiated in size and purpose.

## Motion

- Language: state-change communication. Exponential ease-out (`cubic-bezier(.16,1,.3,1)`), 180–320ms for micro, 420–600ms for page transitions.
- One authored moment per screen: booking confirmation does a satisfying pass-seal animation (Peak-End); Concurrency Arena request nodes race, lock, resolve.
- Animated counters on KPI numbers; skeleton shimmer on load; reduced-motion media query disables non-essential motion.
- Never animate decoration; animate transitions between states.

## Components

- Buttons: 40px min height (Fitts), pill or 10px radius, emerald primary / ghost secondary; focus ring 2px emerald offset 2px.
- Badges for status: confirmed (emerald tint), waitlisted (amber), cancelled (red), checked-in (blue). A dashed "Sandbox" tag is used only for SMTP/SMS attempts when no gateway credentials are configured — never for database records.
- Toasts bottom-right, spring-in, auto-dismiss 4.5s, stackable.
- Tables: hairline rows, tabular numerals, sticky headers in long lists.

## Data viz

Recharts; emerald for primary series, amber for no-show, blue for capacity ceiling. Grid lines hairline `--line`, axis 12px muted, legends inline with swatches. Every chart labelled with units and its real MySQL source; empty data sets render an explicit "no real records yet" state rather than sample values.
