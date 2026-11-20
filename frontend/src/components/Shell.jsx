// Shell.jsx — Biophilic Future shell: floating glass sidebar, top bar,
// global search, notification center, EN/ಕನ್ನಡ switch, theme toggle,
// science X-ray toggle, profile menu, toasts, mode indicator.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { cls, relTime } from '../lib/format.js';
import { Badge, Button, Icon } from './ui.jsx';

const NAV = [
  { id: 'overview', icon: 'home', labelKey: 'nav.overview', label: 'Overview', roles: ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'] },
  { id: 'discover', icon: 'compass', labelKey: 'nav.discover', label: 'Find Camps', roles: ['PATIENT'] },
  { id: 'myBookings', icon: 'ticket', labelKey: 'nav.myBookings', label: 'My Appointments', roles: ['PATIENT'] },
  { id: 'staffDay', icon: 'stetho', labelKey: 'nav.staff', label: 'Camp Day', roles: ['DOCTOR', 'VOLUNTEER', 'ADMIN'] },
  { id: 'liveQueue', icon: 'radio', labelKey: 'nav.liveQueue', label: 'Live Queue', roles: ['DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'] },
  { id: 'manage', icon: 'clipboard', labelKey: 'nav.manage', label: 'Camp Management', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'analytics', icon: 'chart', labelKey: 'nav.analytics', label: 'Analytics', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'concurrencyProof', icon: 'zap', labelKey: 'nav.concurrencyProof', label: 'Concurrency Proof', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'notifications', icon: 'bell', labelKey: 'nav.notifications', label: 'Notifications', roles: ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'] },
  { id: 'settings', icon: 'gear', labelKey: 'nav.settings', label: 'Settings', roles: ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'] },
];

const PAGE_TITLES = {
  overview: 'Overview', discover: 'Find Health Camps', myBookings: 'My Appointments',
  staffDay: 'Camp Day', liveQueue: 'Live Queue TV', manage: 'Camp Management',
  analytics: 'Executive Analytics', concurrencyProof: 'Concurrency Proof', notifications: 'Notification Center', settings: 'Settings',
};

export default function Shell({ children }) {
  const app = useApp();
  const { user, page, setPage: navigate, t, lang, setLang, theme, setTheme, science, setScience, mode, unread, setUnread, gateway, drawerOpen, setDrawerOpen, screenshotMode, setScreenshotMode } = app;
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const searchRef = useRef(null);
  const navRef = useRef(null);

  const items = NAV.filter((n) => user && n.roles.includes(user.role));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') { setMenuOpen(false); setNotifOpen(false); setResults(null); }
      if (e.key === 'x' && e.altKey) setCollapsed((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (!query) setResults(null); }, [query]);

  async function runSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      const { camps } = await api.camps();
      const q = query.toLowerCase();
      setResults(camps.filter((c) => `${c.title} ${c.venue} ${c.area || ''} ${c.address}`.toLowerCase().includes(q)).slice(0, 5));
    } catch { setResults([]); }
  }

  return (
    <div className={cls('shell', collapsed && 'shell-collapsed', screenshotMode && 'screenshot-active')} data-theme={theme}>
      <div className="orbit">
        <span className="orbit-blob"></span>
        <span className="orbit-blob"></span>
      </div>
      <a href="#main" className="skip-link">Skip to main content</a>
      <aside className="sidebar" ref={navRef}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <rect x="1" y="1" width="24" height="24" rx="7" fill="#10b981" />
              <path d="M13 6.5v13M6.5 13h13" stroke="#ecfdf5" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="19.5" cy="6.8" r="2.2" fill="#34d399" stroke="#0f172a" strokeWidth="1.2" />
            </svg>
          </span>
          {!collapsed && (
            <span className="brand-name">
              <strong className="grad-text">CHSC</strong>
              <small>Camp Scheduler</small>
            </span>
          )}
        </div>

        <nav className="side-nav" aria-label="Primary">
          {items.map((item) => (
            <button
              key={item.id}
              className={cls('nav-item', page === item.id && 'active')}
              onClick={() => { navigate(item.id); setNotifOpen(false); }}
              title={collapsed ? item.label : undefined}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </button>
          ))}
        </nav>

        {!collapsed && (
          <div className="side-foot">
            <div className={cls('mode-chip', mode === 'live' ? 'mode-live' : mode === 'demo' ? 'mode-demo' : '')}>
              <span className="mode-dot" />
              {mode === 'live' ? 'Backend Connected · MySQL' : mode === 'demo' ? 'Local Demo Mode' : 'Connecting…'}
            </div>
            <button className={cls('side-mini', screenshotMode && 'active')} onClick={() => setScreenshotMode(!screenshotMode)} title="Clean PPT screenshot mode hides chrome for captures">
              <Icon name="eye" size={14} /> {screenshotMode ? 'Screenshot mode ON' : 'Clean PPT screenshot mode'}
            </button>
          </div>
        )}
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar" title="Toggle sidebar (Alt+X)">
            <Icon name={collapsed ? 'chevronR' : 'chevronL'} />
          </button>
          <h1 className="page-title">{PAGE_TITLES[page] || 'Overview'}</h1>

          <form className="search" onSubmit={runSearch} role="search">
            <Icon name="search" size={15} />
            <input ref={searchRef} placeholder={t('label.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Global search" />
            <kbd>/</kbd>
            {results && (
              <div className="search-results">
                {results.length === 0 && <p className="muted">No camps match “{query}”.</p>}
                {results.map((c) => (
                  <button type="button" key={c.id} onClick={() => { navigate(user.role === 'PATIENT' ? 'discover' : 'manage'); setResults(null); setQuery(''); }}>
                    <strong>{c.title}</strong>
                    <span className="muted">{c.venue} · {c.campDate}</span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="topbar-actions">
            <Badge tone={mode === 'live' ? 'ok' : 'sim'} className="mode-badge">
              {mode === 'live' ? 'LIVE · MySQL' : 'DEMO'}
            </Badge>

            <button className={cls('icon-btn', science && 'active')} onClick={() => setScience(!science)} aria-pressed={science} title="Biophilic Science X-Ray — annotate the science behind the interface">
              <Icon name="flask" />
            </button>

            <button className="icon-btn" onClick={() => setLang(lang === 'en' ? 'kn' : 'en')} title="English / ಕನ್ನಡ">
              <span className="lang-chip">{lang === 'en' ? 'EN' : 'ಕನ್'}</span>
            </button>

            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            <button className="icon-btn bell" onClick={() => { setDrawerOpen(true); setUnread(0); setNotifOpen(false); }} aria-label="Gateway Interceptor">
              <Icon name="bell" />
              {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
            </button>

            <div className="profile">
              <button className="profile-btn" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
                <span className="avatar">{(user?.name || 'G')[0]}</span>
                <span className="profile-meta">
                  <strong>{user?.name?.split(' ')[0]}</strong>
                  <small>{user?.role}</small>
                </span>
                <Icon name="chevronD" size={14} />
              </button>
              {menuOpen && (
                <div className="profile-menu" role="menu">
                  <p className="muted profile-mail">{user?.email}</p>
                  <button role="menuitem" onClick={() => { navigate('settings'); setMenuOpen(false); }}><Icon name="gear" size={15} /> Settings & privacy</button>
                  <button role="menuitem" onClick={() => { app.signOut(); }}><Icon name="logout" size={15} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main" className={cls('content', `page-${page}`)} key={page} tabIndex={-1}>
          {children}
        </main>
      </div>

      {/* toasts */}
      <div className="toasts" aria-live="polite">
        {app.toasts.map((tt) => (
          <div key={tt.id} className={cls('toast', `toast-${tt.tone}`)}>
            <Icon name={tt.tone === 'bad' ? 'alert' : tt.tone === 'warn' ? 'clock' : 'check'} size={16} />
            <div>
              <p>{tt.message}</p>
              {tt.detail && <small>{tt.detail}</small>}
            </div>
          </div>
        ))}
      </div>

      {/* gateway interceptor drawer */}
      {drawerOpen && <GatewayDrawer />}
    </div>
  );
}

function GatewayDrawer() {
  const { gateway, setDrawerOpen, mode } = useApp();
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (mode === 'live') {
      api.notifications(40).then((d) => setLog(d.notifications)).catch(() => setLog([])).finally(() => setLoading(false));
    } else { setLog(null); setLoading(false); }
  }, [mode]);
  const merged = [...gateway, ...(log || [])];
  return (
    <aside className="drawer" role="dialog" aria-label="Gateway Interceptor — live notification feed">
      <header className="drawer-head">
        <div>
          <h2><Icon name="send" size={16} /> Gateway Interceptor</h2>
          <p className="muted">
            Live feed of every notification the platform emits.
            {mode !== 'live' && ' Local demo engine — delivery is SIMULATED, never a real external gateway.'}
          </p>
        </div>
        <button className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close"><Icon name="x" /></button>
      </header>
      <div className="drawer-body">
        {loading && <p className="muted">Loading delivery log…</p>}
        {!loading && merged.length === 0 && <p className="muted">No notifications yet. Book a slot or run the demo controller.</p>}
        {merged.map((n, i) => (
          <article key={n._id || `${n.id}-${i}`} className="gw-row">
            <div className="gw-top">
              <Badge status={n.channel} tone={n.channel === 'SMS' ? 'info' : n.channel === 'SYSTEM' ? 'muted' : 'warn'}>{n.channel}</Badge>
              <Badge status={n.status} tone={n.status === 'SENT' ? 'ok' : 'sim'}>{n.status === 'SENT' ? 'SENT' : String(n.status || 'SIMULATED') === 'SIMULATED' ? 'SIMULATED' : n.status}</Badge>
              <time className="muted">{relTime(n.sentAt || n.at)}</time>
            </div>
            <p className="gw-msg">{n.subject ? <strong>{n.subject} — </strong> : null}{n.message}</p>
            <p className="gw-meta muted">→ {n.recipient} · {n.provider || 'Local Engine'}{n.bookingId ? ` · booking #${n.bookingId}` : ''}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
