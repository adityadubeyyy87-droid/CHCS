// ui.jsx — design-system primitives: icons, buttons, badges, cards, fields,
// modals, toasts, skeletons, animated counters, empty states.
import React, { useEffect, useId, useRef, useState } from 'react';
import { cls } from '../lib/format.js';

/* ------------------------------- icons ------------------------------- */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z',
  ticket: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Zm10-2v12',
  radio: 'M12 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm4.2-4.2a6 6 0 0 1 0 8.4m2.8-11.2a10 10 0 0 1 0 14M7.8 8.8a6 6 0 0 0 0 8.4M5 5.6a10 10 0 0 0 0 14',
  clipboard: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Zm-2 2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1M9 12h6M9 16h4',
  stetho: 'M5 3v5a5 5 0 0 0 10 0V3M10 13v3a5 5 0 0 0 10 0v-2m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  chart: 'M4 20h16M7 16v-5m5 5V7m5 9v-8',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4.5 9a2 2 0 0 0 3 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.2-1.8l2-1.5-2-3.4-2.3 1a8.5 8.5 0 0 0-3-1.8L14.5 2h-5l-.4 2.5a8.5 8.5 0 0 0-3 1.8l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 3.6l-2 1.5 2 3.4 2.3-1a8.5 8.5 0 0 0 3 1.8l.4 2.5h5l.4-2.5a8.5 8.5 0 0 0 3-1.8l2.3 1 2-3.4-2-1.5c.13-.6.2-1.2.2-1.8Z',
  search: 'M16.5 16.5 21 21m-3-9.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m14 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 1 1 10 3.5a7 7 0 0 0 10 11Z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
  x: 'M6 6l12 12M18 6 6 18',
  chevronL: 'M15 5l-7 7 7 7',
  chevronR: 'M9 5l7 7-7 7',
  chevronD: 'M6 9l6 6 6-6',
  check: 'M4.5 12.5 10 18 19.5 6.5',
  alert: 'M12 8v5m0 3.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  trash: 'M5 7h14M10 4h4m-7 3 1 13h8l1-13M10 11v6m4-6v6',
  calendar: 'M5 6h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3-4v4m8-4v4M4 11h16',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 10a8 8 0 0 1 16 0',
  shield: 'M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Zm-2.5 9 2 2 4-4.5',
  zap: 'M13 3 5 13.5h5L11 21l8-10.5h-5L13 3Z',
  flask: 'M9 3h6M10 3v5.2L5.5 17a3 3 0 0 0 2.7 4.3h7.6A3 3 0 0 0 18.5 17L14 8.2V3M7.5 14h9',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 3h3m3 0h-1.5m1.5 3h-6m6-3v-3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  users: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0m2-9a4 4 0 1 0-2.5-7.1M17 14.5a7 7 0 0 1 5 6.5',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h9',
  pin: 'M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  download: 'M12 4v10m0 0 4-4m-4 4-4-4M5 19h14',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z',
  camera: 'M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  layers: 'M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
};

export function Icon({ name, size = 18, className, strokeWidth = 1.6 }) {
  return (
    <svg className={cls('icon', className)} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.circle || 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'} />
    </svg>
  );
}

/* ------------------------------ buttons ------------------------------ */
export function Button({ variant = 'primary', size = 'md', icon, children, className, loading, ...rest }) {
  return (
    <button className={cls('btn', `btn-${variant}`, `btn-${size}`, loading && 'is-loading', className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      <span>{children}</span>
    </button>
  );
}

/* ------------------------------- badges ------------------------------ */
const TONE_MAP = {
  CONFIRMED: 'ok', COMPLETED: 'ok', PUBLISHED: 'ok', SENT: 'ok', PROMOTED: 'ok', LIVE: 'ok',
  WAITLISTED: 'warn', WAITING: 'warn', ALMOST: 'warn', REVIEW: 'warn', QUEUED: 'warn', HELD: 'warn',
  CANCELLED: 'bad', NO_SHOW: 'bad', EXPIRED: 'bad', FAILED: 'bad', CRITICAL: 'bad', DRAFT: 'muted',
  CHECKED_IN: 'info', CHECKIN: 'info', SIMULATED: 'sim', DRAFTX: 'muted',
};
export function Badge({ status, children, tone: toneProp, className }) {
  const tone = toneProp || TONE_MAP[String(status).toUpperCase()] || 'muted';
  return <span className={cls('badge', `badge-${tone}`, className)}>{children ?? status}</span>;
}

/* -------------------------------- card ------------------------------- */
export function Card({ as: Tag = 'section', className, children, ...rest }) {
  return <Tag className={cls('card', className)} {...rest}>{children}</Tag>;
}

export function CardHead({ title, sub, actions, icon, as: Heading = 'h2' }) {
  return (
    <header className="card-head">
      <div className="card-head-titles">
        {icon && <span className="card-head-icon"><Icon name={icon} /></span>}
        <div>
          <Heading>{title}</Heading>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
      </div>
      {actions && <div className="card-actions">{actions}</div>}
    </header>
  );
}

/* ------------------------------- fields ------------------------------ */
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cls('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}

export function Select({ className, children, ...rest }) {
  return <select className={cls('input', 'select', className)} {...rest}>{children}</select>;
}
export const Input = React.forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cls('input', className)} {...rest} />;
});

/* ------------------------------- modal ------------------------------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, wide, footer }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () => Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])
      .filter((el) => el.offsetParent !== null || el === document.activeElement);

    const focusFrame = requestAnimationFrame(() => {
      const nodes = focusable();
      (nodes[0] || dialogRef.current)?.focus();
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusable();
      if (nodes.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCloseRef.current?.(); }}>
      <div ref={dialogRef} tabIndex={-1} className={cls('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={() => onCloseRef.current?.()} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------- animated counter -------------------------- */
export function Counter({ value, decimals = 0, suffix = '', className }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    const to = Number(value) || 0;
    prev.current = to;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === to) { setDisplay(to); return; }
    const start = performance.now();
    const dur = 700;
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(2, -10 * p); // exponential ease-out
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={cls('counter', className)}>{display.toFixed(decimals)}{suffix}</span>;
}

/* ------------------------------ skeleton ----------------------------- */
export function Skeleton({ h = 16, w = '100%', className, style }) {
  return <span className={cls('skeleton', className)} style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function EmptyState({ icon = 'compass', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div className="error-note" role="alert">
      <Icon name="alert" />
      <div>
        <p>{children}</p>
        {onRetry && <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  );
}

/* ------------------------------- slider ------------------------------ */
export function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div className="slider">
      <div className="slider-head">
        <span className="field-label">{label}</span>
        <output className="slider-value">{format ? format(value) : value}</output>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

/* -------------------------- science annotation ------------------------ */
const SCIENCE = {
  hicks: { name: "Hick's Law", text: 'Decision time grows with the number of choices. Booking is compressed to 3 fixed steps, so each screen offers few, clear choices.' },
  miller: { name: "Miller's Law", text: 'Working memory holds ~7±2 items. Slots are grouped into Morning / Midday / Afternoon chunks instead of one long list.' },
  fitts: { name: "Fitts's Law", text: 'Time to target shrinks with size and proximity. Primary actions are at least 44px tall and sit where the eye already is.' },
  jakob: { name: "Jakob's Law", text: 'Users expect your site to work like sites they already know. The slot grid follows familiar calendar/timetable patterns.' },
  zeigarnik: { name: 'Zeigarnik Effect', text: 'Interrupted tasks are remembered better — an explicit 3-step progress indicator motivates completion of a started booking.' },
  peakend: { name: 'Peak-End Rule', text: 'People judge an experience by its peak and its end. The confirmation moment gets a satisfying, celebratory pass reveal.' },
  intent: { name: 'Implementation Intentions', text: 'Stating when/how/where ("I will arrive by auto by 09:45") measurably increases follow-through on plans (Gollwitzer, 1999).' },
  ethical: { name: 'Ethical cancellation', text: 'Releasing a seat is one tap and penalty-free, so unused capacity returns to waiting neighbours instead of being wasted.' },
  privacy: { name: 'Privacy by Design', text: 'Only name, phone, email and age group are collected — no medical history. Data minimisation per DPDP principles.' },
  fifo: { name: 'FIFO fairness', text: 'Waitlist promotions follow strict first-in-first-out order under a row lock, so nobody can jump the queue.' },
};

export function Sci({ k, children, className, as: Tag = 'span' }) {
  const s = SCIENCE[k];
  const descriptionId = useId();
  if (!s) return children;
  return (
    <Tag
      className={cls('sci', className)}
      data-sci={k}
      role="note"
      tabIndex={0}
      aria-describedby={descriptionId}
    >
      {children}
      <span className="sci-chip" aria-hidden="true">⌕ {s.name}</span>
      <span className="sci-pop" id={descriptionId} role="tooltip">{s.text}</span>
    </Tag>
  );
}
