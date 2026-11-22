// Landing.jsx — the cinematic front door for CHSC.
//
// Composes CinematicScene (fixed WebGL clinical beacon) with a scroll-driven story:
// hero → why camps stall → a camp day → design targets → honesty note →
// sign-in path. Everything is real content from this project: no invented
// "AI" claims and no fabricated results.
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
    document.title = 'CHSC — A camp day that begins with a clear signal';
    return () => {
      document.body.classList.remove('landing-on');
      document.title = previousTitle;
    };
  }, []);

  /* scroll → scene drive, progress rail, camp clock, nav condense */
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
            t < 0.18 ? 'signal acquired' : t < 0.4 ? 'gates open' : t < 0.62 ? 'screening' : t < 0.82 ? 'afternoon' : 'close-out';
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
      <div className="cine-vignette" aria-hidden="true" />
      <div className="cine-grain" aria-hidden="true" />

      <div className="ln-progress" aria-hidden="true">
        <span ref={progressRef} />
      </div>

      <header className="ln-nav" ref={navRef}>
        <div className="ln-nav-inner">
          <button className="ln-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <span className="ln-beaconmark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="30" height="30" role="presentation">
                <circle cx="16" cy="16" r="3.2" fill="#e7fff4" />
                <circle cx="16" cy="16" r="8.2" fill="none" stroke="#6ee7b7" strokeWidth="1.4" opacity="0.9" />
                <circle cx="16" cy="16" r="12.4" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.55" />
                <path d="M16 1.5v5M16 25.5v5M1.5 16h5M25.5 16h5" stroke="#a7f3d0" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
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
            <span className={`ln-mode ln-mode--${mode}`} title={mode === 'live' ? 'Connected to the MySQL backend' : mode === 'connecting' ? 'Checking the live backend' : 'Backend connection failed'}>
              <span className="ln-mode-dot" aria-hidden="true" />
              {mode === 'live' ? 'LIVE · MySQL' : mode === 'connecting' ? 'PROBING…' : 'CONNECTION ERROR'}
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
              begins with a <em>clear signal.</em>
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

            <button type="button" className="ln-scrollcue" onClick={() => jump('why')} aria-label="Scroll — the beacon keeps rising">
              <span className="ln-scrollcue-line" aria-hidden="true" />
              <span>Scroll — the beacon keeps rising</span>
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
                title={<span id="ln-day-title">First signal to close-out, in five movements.</span>}
                lead="The camp day is the product. Every screen in CHSC exists to protect one of these moments."
              />
              <Reveal className="ln-queue-card" delay={120}>
                <div className="ln-queue-card-head">
                  <span className="ln-live"><span className="ln-live-dot" aria-hidden="true" />Live queue</span>
                  <span className="ln-fine">Inside the platform</span>
                </div>
                <p className="ln-queue-note">
                  The waiting-room board is fed by QR check-ins over Socket.io. Tokens, names and wait times come from
                  the selected camp's real queue — no illustrative rows are shown here.
                </p>
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

        {/* -------------------------------- cta ------------------------------- */}
        <section className="ln-cta" aria-labelledby="ln-cta-title">
          <Reveal className="ln-cta-inner">
            <p className="ln-eyebrow"><span className="ln-dot" aria-hidden="true" />The doors are open</p>
            <h2 id="ln-cta-title" className="ln-h2">Bring a camp to your ward.</h2>
            <p className="ln-lead">
              Sign in with your account and run a camp morning — publish, book, waitlist,
              check in, watch the queue move, then read the day back in analytics.
            </p>
            <div className="ln-hero-cta">
              <button type="button" className="ln-btn ln-btn--primary ln-btn--lg" onClick={enter}>
                {user ? 'Open the dashboard' : 'Enter the platform'} <Icon name="chevronR" size={16} />
              </button>
              <button type="button" className="ln-btn ln-btn--ghost ln-btn--lg" onClick={() => jump('targets')}>
                See the design targets
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
              <button type="button" className="ln-footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to the top</button>
            </div>
          </div>
        </div>
        <div className="ln-wrap ln-footer-base">
          <p className="ln-fine">Cinematic build · React Three Fiber · custom GLSL beacon · no stock video</p>
          <p className="ln-fine">
            {mode === 'live'
              ? 'Connected to the live backend.'
              : mode === 'connecting'
                ? 'Checking for the live backend…'
                : 'The backend is unavailable. The platform reports the connection error instead of showing substitute data.'}
          </p>
        </div>
      </footer>
    </div>
  );
}
