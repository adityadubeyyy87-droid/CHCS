// Landing.jsx — the cinematic front door for CHSC.
//
// Composes CinematicScene (fixed WebGL sunrise) with a scroll-driven story:
// hero → why camps stall → a camp day → design targets → honesty note →
// working camp-alert signup. Everything is real content from this project:
// no invented "AI" claims, no fake results, simulated state clearly labelled.
//
// Routing: #/welcome renders this page before the auth gate. "Enter" sends
// the visitor to #/login; a signed-in visitor goes straight to #/overview.
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { sceneDrive } from '../lib/sceneDrive.js';
import CineFallback from '../components/CineFallback.jsx';
import { Icon } from '../components/ui.jsx';
import '../landing.css';

/* three.js is a heavy dependency; keep it out of the first paint so the hero
   copy (the LCP element) is never waiting on a WebGL compile. */
const CinematicScene = lazy(() => import('../components/CinematicScene.jsx'));

class SceneBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <CineFallback />;
    return this.props.children;
  }
}

const NAV_LINKS = [
  { id: 'why', label: 'Why camps stall' },
  { id: 'day', label: 'A camp day' },
  { id: 'targets', label: 'By the numbers' },
  { id: 'alerts', label: 'Camp alerts' },
];

const TICKER = [
  'Free screenings',
  'QR check-in',
  'Waitlist promotion',
  'Live queue board',
  'Capacity advisor',
  'Camp analytics',
  'Kannada + English',
  'Five roles, one board',
];

const FAILURES = [
  {
    n: '01',
    icon: 'clock',
    title: 'The 7 a.m. bottleneck',
    body: 'Paper registers, duplicated slots and no shared view of who is already inside. Every camp loses its first hour to the same queue.',
    answer: 'Row-locked slot allocation — SELECT … FOR UPDATE — so the chair is only ever promised once.',
  },
  {
    n: '02',
    icon: 'users',
    title: 'The empty-chair problem',
    body: 'Someone cancels at 08:40 and the slot dies with them. The next person on the list never hears about it in time.',
    answer: 'Cancellations auto-promote the waitlist and notify the next patient in the same minute.',
  },
  {
    n: '03',
    icon: 'chart',
    title: 'The invisible camp',
    body: 'At 16:00 the tent comes down and the day disappears. Nothing measured, nothing carried into the next ward.',
    answer: 'Attendance, no-shows and station dwell time land in analytics the moment the camp closes.',
  },
];

const CAMP_DAY = [
  {
    time: '06:15',
    title: 'Site setup',
    body: 'The organiser publishes the station map for the day. Volunteers scan in and see exactly which desk is theirs.',
    tag: 'Organiser · Volunteer',
  },
  {
    time: '07:30',
    title: 'Gates open',
    body: 'QR check-in goes live. The queue board fills in real time, so nobody has to guess whether they are next.',
    tag: 'Volunteer · Live queue',
  },
  {
    time: '09:00',
    title: 'First screening wave',
    body: 'Doctors move patients between stations. A cancellation promotes the next person on the waitlist before the chair cools.',
    tag: 'Doctor · Patient',
  },
  {
    time: '12:30',
    title: 'The afternoon dip',
    body: 'The Capacity Advisor reads booking velocity and no-show history, then flags the gap in plain language.',
    tag: 'Organizer · Heuristic',
  },
  {
    time: '16:00',
    title: 'Close-out',
    body: 'Attendance, station dwell time and waitlist conversions land in analytics. The next camp starts with evidence, not memory.',
    tag: 'Admin · Analytics',
  },
];

const TARGETS = [
  { value: '0', unit: '', label: 'Double-booked slots', note: 'Row locks, not hope.' },
  { value: '3', unit: ' min', label: 'Check-in target', note: 'Scan, verify, seat.' },
  { value: '5', unit: '', label: 'Roles, one board', note: 'Patient to admin.' },
  { value: '100', unit: '%', label: 'Simulated results labelled', note: 'Never dressed as real.' },
];

/* -------------------------------------------------------------------------- */
/* small building blocks                                                       */
/* -------------------------------------------------------------------------- */
function Reveal({ as: Tag = 'div', delay = 0, className = '', children, ...rest }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOn(true);
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setOn(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.16, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`ln-reveal ${on ? 'is-on' : ''} ${className}`} style={{ '--d': `${delay}ms` }} {...rest}>
      {children}
    </Tag>
  );
}

function SectionHead({ eyebrow, title, lead, align = 'left' }) {
  return (
    <Reveal className={`ln-head ln-head--${align}`}>
      <p className="ln-eyebrow"><span className="ln-dot" aria-hidden="true" />{eyebrow}</p>
      <h2 className="ln-h2">{title}</h2>
      {lead && <p className="ln-lead">{lead}</p>}
    </Reveal>
  );
}

/* -------------------------------------------------------------------------- */
/* page                                                                        */
/* -------------------------------------------------------------------------- */
export default function Landing() {
  const { mode, user, setPage } = useApp();
  const progressRef = useRef(null);
  const clockRef = useRef(null);
  const phaseRef = useRef(null);
  const navRef = useRef(null);
  const rootRef = useRef(null);

  const enter = () => setPage(user ? 'overview' : 'login');
  const jump = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* body class + document title: forces the cinematic dark shell, restored on exit */
  useEffect(() => {
    const previousTitle = document.title;
    document.body.classList.add('landing-on');
    document.title = 'CHSC — A camp day that begins with the sun';
    return () => {
      document.body.classList.remove('landing-on');
      document.title = previousTitle;
    };
  }, []);

  /* scroll → scene drive, progress rail, sun clock, nav condense */
  useEffect(() => {
    let frame = 0;
    let condensed = false;

    const read = () => {
      frame = 0;
      const y = window.scrollY || 0;
      const vh = window.innerHeight || 800;
      const max = Math.max(1, document.documentElement.scrollHeight - vh);

      sceneDrive.scroll = Math.min(1, y / (vh * 1.15));

      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${Math.min(1, y / max)})`;
      }
      if (clockRef.current) {
        const t = Math.min(1, y / (vh * 1.15));
        const minutes = Math.round(6 * 60 + 12 + t * 528); // 06:12 → 15:00
        const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
        const mm = String(minutes % 60).padStart(2, '0');
        clockRef.current.textContent = `${hh}:${mm}`;
        if (phaseRef.current) {
          phaseRef.current.textContent =
            t < 0.18 ? 'first light' : t < 0.4 ? 'gates open' : t < 0.62 ? 'screening' : t < 0.82 ? 'afternoon' : 'close-out';
        }
      }
      const next = y > 24;
      if (next !== condensed) {
        condensed = next;
        navRef.current?.classList.toggle('is-condensed', condensed);
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    const onPointer = (e) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      sceneDrive.mx = (e.clientX / w) * 2 - 1;
      sceneDrive.my = -((e.clientY / h) * 2 - 1);
    };

    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pointermove', onPointer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="landing" ref={rootRef}>
      <a
        className="ln-skip"
        href="#landing-main"
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById('landing-main');
          if (!el) return;
          el.focus({ preventScroll: true });
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >
        Skip to content
      </a>

      <SceneBoundary>
        <Suspense fallback={<CineFallback />}>
          <CinematicScene />
        </Suspense>
      </SceneBoundary>
      <div className="cine-grade" aria-hidden="true" />
      <div className="cine-bloom" aria-hidden="true" />
      <div className="cine-vignette" aria-hidden="true" />
      <div className="cine-grain" aria-hidden="true" />

      <div className="ln-progress" aria-hidden="true">
        <span ref={progressRef} />
      </div>

      <header className="ln-nav" ref={navRef}>
        <div className="ln-nav-inner">
          <button className="ln-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <span className="ln-sunmark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="30" height="30" role="presentation">
                <circle cx="16" cy="16" r="6.2" fill="url(#lnSunGrad)" />
                <g stroke="#ffd7a0" strokeWidth="1.5" strokeLinecap="round" opacity="0.9">
                  <path d="M16 3.6v3.1M16 25.3v3.1M3.6 16h3.1M25.3 16h3.1" />
                  <path d="M7.2 7.2l2.2 2.2M22.6 22.6l2.2 2.2M24.8 7.2l-2.2 2.2M9.4 22.6l-2.2 2.2" opacity="0.55" />
                </g>
                <defs>
                  <radialGradient id="lnSunGrad" cx="42%" cy="38%">
                    <stop offset="0%" stopColor="#fff6df" />
                    <stop offset="70%" stopColor="#ffc36f" />
                    <stop offset="100%" stopColor="#ff9b4a" />
                  </radialGradient>
                </defs>
              </svg>
            </span>
            <span className="ln-brand-text">
              <strong>CHSC</strong>
              <em>Community Health Screening Camps</em>
            </span>
          </button>

          <nav className="ln-links" aria-label="Sections">
            {NAV_LINKS.map((l) => (
              <button key={l.id} type="button" className="ln-navlink" onClick={() => jump(l.id)}>
                {l.label}
              </button>
            ))}
          </nav>

          <div className="ln-nav-actions">
            <span className={`ln-mode ln-mode--${mode || 'demo'}`} title={mode === 'live' ? 'Connected to the MySQL backend' : 'Local demo engine — no database attached'}>
              <span className="ln-mode-dot" aria-hidden="true" />
              {mode === 'live' ? 'LIVE · MySQL' : mode === 'connecting' ? 'PROBING…' : 'DEMO · LOCAL'}
            </span>
            <button type="button" className="ln-btn ln-btn--ghost ln-btn--sm" onClick={enter}>
              {user ? 'Open dashboard' : 'Sign in'}
            </button>
            <button type="button" className="ln-btn ln-btn--primary ln-btn--sm" onClick={enter}>
              Enter platform <Icon name="chevronR" size={14} />
            </button>
          </div>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        {/* ------------------------------- hero ------------------------------- */}
        <section className="ln-hero" aria-labelledby="ln-hero-title">
          <div className="ln-hero-scrim" aria-hidden="true" />
          <div className="ln-hero-inner">
            <p className="ln-eyebrow ln-eyebrow--hero">
              <span className="ln-dot" aria-hidden="true" />
              Community health screening · Bengaluru
            </p>

            <h1 id="ln-hero-title" className="ln-h1">
              A camp day that
              <br />
              begins with the <em>sun.</em>
            </h1>

            <p className="ln-hero-copy">
              CHSC runs free screening camps end to end — discovery, slots, waitlists,
              QR check-in, live queues and the analytics that survive the tent coming down.
              Five roles, one unhurried morning.
            </p>

            <div className="ln-hero-cta">
              <button type="button" className="ln-btn ln-btn--primary ln-btn--lg" onClick={enter}>
                {user ? 'Open the dashboard' : 'Enter the platform'}
                <Icon name="chevronR" size={16} />
              </button>
              <button type="button" className="ln-btn ln-btn--glass ln-btn--lg" onClick={() => jump('day')}>
                <Icon name="play" size={15} />
                Walk through a camp day
              </button>
            </div>

            <dl className="ln-hero-stats">
              <div>
                <dt>Camp clock</dt>
                <dd><span ref={clockRef} className="ln-mono">06:12</span> <small ref={phaseRef}>first light</small></dd>
              </div>
              <div>
                <dt>Doors</dt>
                <dd><span className="ln-mono">07:30</span> <small>QR check-in</small></dd>
              </div>
              <div>
                <dt>Cut-off</dt>
                <dd><span className="ln-mono">16:00</span> <small>camp close-out</small></dd>
              </div>
            </dl>

            <button type="button" className="ln-scrollcue" onClick={() => jump('why')} aria-label="Scroll — the sun keeps rising">
              <span className="ln-scrollcue-line" aria-hidden="true" />
              <span>Scroll — the sun keeps rising</span>
            </button>
          </div>
        </section>

        {/* ------------------------------ ticker ------------------------------ */}
        <div className="ln-ticker" aria-hidden="true">
          <div className="ln-ticker-track">
            {[0, 1].map((pass) => (
              <div className="ln-ticker-row" key={pass}>
                {TICKER.map((t) => (
                  <span key={`${pass}-${t}`} className="ln-ticker-item">
                    <span className="ln-ticker-star">✳</span>{t}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ------------------------------- why -------------------------------- */}
        <section id="why" className="ln-section ln-section--veil" aria-labelledby="ln-why-title">
          <div className="ln-wrap">
            <SectionHead
              eyebrow="The honest problem"
              title={<span id="ln-why-title">Three failures every camp knows by heart.</span>}
              lead="None of them are exotic. They are queue, capacity and memory — the three things a spreadsheet cannot hold for a morning."
            />

            <div className="ln-cards">
              {FAILURES.map((f, i) => (
                <Reveal as="article" className="ln-card" delay={i * 90} key={f.n}>
                  <div className="ln-card-top">
                    <span className="ln-card-num ln-mono">{f.n}</span>
                    <span className="ln-card-icon"><Icon name={f.icon} size={18} /></span>
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                  <p className="ln-card-answer">
                    <Icon name="check" size={14} />
                    <span>{f.answer}</span>
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------- day -------------------------------- */}
        <section id="day" className="ln-section" aria-labelledby="ln-day-title">
          <div className="ln-wrap ln-day-grid">
            <div className="ln-day-intro">
              <SectionHead
                eyebrow="One camp, hour by hour"
                title={<span id="ln-day-title">Sunrise to close-out, in five movements.</span>}
                lead="The camp day is the product. Every screen in CHSC exists to protect one of these moments."
              />
              <Reveal className="ln-queue-card" delay={120}>
                <div className="ln-queue-card-head">
                  <span className="ln-live"><span className="ln-live-dot" aria-hidden="true" />Queue preview</span>
                  <span className="ln-sim">SIMULATED</span>
                </div>
                <div className="ln-queue-rows">
                  {[
                    { n: 'A-014', s: 'In screening', w: '72%' },
                    { n: 'A-015', s: 'Next', w: '54%' },
                    { n: 'A-016', s: 'Waiting', w: '38%' },
                  ].map((r) => (
                    <div className="ln-queue-row" key={r.n}>
                      <span className="ln-mono">{r.n}</span>
                      <span className="ln-queue-bar" aria-hidden="true"><i style={{ width: r.w }} /></span>
                      <span className="ln-queue-state">{r.s}</span>
                    </div>
                  ))}
                </div>
                <p className="ln-fine">Illustrative only — a live board appears inside the app.</p>
              </Reveal>
            </div>

            <ol className="ln-timeline">
              {CAMP_DAY.map((step, i) => (
                <Reveal as="li" className="ln-step" delay={i * 70} key={step.time}>
                  <div className="ln-step-time ln-mono">{step.time}</div>
                  <div className="ln-step-body">
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                    <span className="ln-step-tag">{step.tag}</span>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------ targets ----------------------------- */}
        <section id="targets" className="ln-section ln-section--tint" aria-labelledby="ln-targets-title">
          <div className="ln-wrap">
            <SectionHead
              eyebrow="Design targets, stated plainly"
              title={<span id="ln-targets-title">What “working” has to mean.</span>}
              lead="These are the commitments the system is built against — not a claim of measured outcomes from a live camp."
            />

            <div className="ln-targets">
              {TARGETS.map((t, i) => (
                <Reveal className="ln-target" delay={i * 80} key={t.label}>
                  <p className="ln-target-value">
                    {t.value}<span>{t.unit}</span>
                  </p>
                  <p className="ln-target-label">{t.label}</p>
                  <p className="ln-target-note">{t.note}</p>
                </Reveal>
              ))}
            </div>

            <Reveal className="ln-honesty" delay={80}>
              <div className="ln-honesty-badge">
                <Icon name="flask" size={16} />
                <span>Capacity Advisor</span>
              </div>
              <div>
                <h3>Rule-based statistical heuristic — not black-box AI/ML.</h3>
                <p>
                  It reads booking velocity, no-show history and station throughput, then states
                  its reasoning in plain language. No model card, no mystery score, no pretending.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------ alerts ------------------------------ */}
        <section id="alerts" className="ln-section" aria-labelledby="ln-alerts-title">
          <div className="ln-wrap ln-alerts">
            <div>
              <SectionHead
                eyebrow="Camp alerts"
                title={<span id="ln-alerts-title">Know when the next camp opens near you.</span>}
                lead="Leave an email and this device will remember it. On the demo engine nothing leaves the browser — no account, no mailing list, no hidden backend."
              />
              <p className="ln-alerts-meta">
                <Icon name="shield" size={14} />
                Stored in <code>localStorage</code> under <code>chsc_alert_signups</code>. Clear it any time from Settings.
              </p>
            </div>
            <AlertForm />
          </div>
        </section>

        {/* -------------------------------- cta ------------------------------- */}
        <section className="ln-cta" aria-labelledby="ln-cta-title">
          <Reveal className="ln-cta-inner">
            <p className="ln-eyebrow"><span className="ln-dot" aria-hidden="true" />The doors are open</p>
            <h2 id="ln-cta-title" className="ln-h2">Bring a camp to your ward.</h2>
            <p className="ln-lead">
              Sign in with a demo role and run a full camp morning — publish, book, waitlist,
              check in, watch the queue move, then read the day back in analytics.
            </p>
            <div className="ln-hero-cta">
              <button type="button" className="ln-btn ln-btn--primary ln-btn--lg" onClick={enter}>
                {user ? 'Open the dashboard' : 'Enter the platform'} <Icon name="chevronR" size={16} />
              </button>
              <button type="button" className="ln-btn ln-btn--ghost ln-btn--lg" onClick={() => jump('alerts')}>
                Just send me camp alerts
              </button>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="ln-footer">
        <div className="ln-wrap ln-footer-grid">
          <div>
            <p className="ln-footer-brand">CHSC</p>
            <p className="ln-fine">
              Community Health Screening Camp Scheduler · CMR Institute of Technology,
              Bengaluru · Dept. of Information Science &amp; Engineering
            </p>
          </div>
          <div className="ln-footer-cols">
            <div>
              <p className="ln-footer-head">Explore</p>
              {NAV_LINKS.map((l) => (
                <button key={l.id} type="button" className="ln-footer-link" onClick={() => jump(l.id)}>{l.label}</button>
              ))}
            </div>
            <div>
              <p className="ln-footer-head">Platform</p>
              <button type="button" className="ln-footer-link" onClick={enter}>Sign in</button>
              <button type="button" className="ln-footer-link" onClick={enter}>Dashboard</button>
              <button type="button" className="ln-footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to sunrise</button>
            </div>
          </div>
        </div>
        <div className="ln-wrap ln-footer-base">
          <p className="ln-fine">Cinematic build · React Three Fiber · custom GLSL sun · no stock video</p>
          <p className="ln-fine">
            {mode === 'live'
              ? 'Connected to the live backend.'
              : mode === 'connecting'
                ? 'Checking for the live backend…'
                : 'Running in demo mode — simulated data is always labelled.'}
          </p>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* camp alert form — actually persists, actually validates                     */
/* -------------------------------------------------------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const STORE_KEY = 'chsc_alert_signups';

function readSignups() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function AlertForm() {
  const [email, setEmail] = useState('');
  const [ward, setWard] = useState('Jayanagar');
  const [status, setStatus] = useState('idle'); // idle | error | saving | done
  const [message, setMessage] = useState('');
  const [count, setCount] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    setCount(readSignups().length);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();

    if (!EMAIL_RE.test(value)) {
      setStatus('error');
      setMessage('That email does not look right. Try name@example.com.');
      inputRef.current?.focus();
      return;
    }

    setStatus('saving');
    setMessage('Saving on this device…');

    window.setTimeout(() => {
      const list = readSignups();
      const next = list.some((row) => row.email === value)
        ? list
        : [...list, { email: value, ward, savedAt: new Date().toISOString() }];
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
        setCount(next.length);
        setStatus('done');
        setMessage(`Saved. ${ward} is on your list — this browser will remember it.`);
        setEmail('');
      } catch {
        setStatus('error');
        setMessage('This browser blocked local storage, so nothing was saved.');
      }
    }, 420);
  };

  return (
    <form className="ln-form" onSubmit={submit} noValidate>
      <div className="ln-form-row">
        <label className="ln-field">
          <span>Email address</span>
          <input
            ref={inputRef}
            id="alert-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }}
            aria-invalid={status === 'error'}
            aria-describedby="alert-status"
            disabled={status === 'saving'}
            required
          />
        </label>
        <label className="ln-field ln-field--ward">
          <span>Nearest ward</span>
          <select value={ward} onChange={(e) => setWard(e.target.value)} disabled={status === 'saving'}>
            {['Jayanagar', 'Basavanagudi', 'Koramangala', 'Whitefield', 'Hebbal', 'Yeshwanthpur'].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="ln-form-actions">
        <button type="submit" className="ln-btn ln-btn--primary" disabled={status === 'saving'}>
          {status === 'saving' ? <span className="ln-spinner" aria-hidden="true" /> : <Icon name="send" size={15} />}
          {status === 'saving' ? 'Saving…' : 'Notify me'}
        </button>
        <p className="ln-form-count">
          {count === 1 ? '1 email on this device' : `${count} emails on this device`}
        </p>
      </div>

      <p
        id="alert-status"
        className={`ln-form-status ${status === 'error' ? 'is-error' : ''} ${status === 'done' ? 'is-done' : ''}`}
        role={status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {message || 'No spam, no account. This is a local demo signup.'}
      </p>
    </form>
  );
}
