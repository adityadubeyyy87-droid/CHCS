// Shell.jsx — Biophilic Clinical Precision shell: hairline sidebar,
// top bar, global search, notification center, EN/ಕನ್ನಡ switch,
// theme toggle, profile menu, toasts, mode indicator.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { cls, relTime } from '../lib/format.js';
import { Badge, Button, EmptyState, Icon } from './ui.jsx';

export const NAV = [
  { id: 'overview', icon: 'home', labelKey: 'nav.overview', label: 'Overview', roles: ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'] },
  { id: 'discover', icon: 'compass', labelKey: 'nav.discover', label: 'Find Camps', roles: ['PATIENT'] },
  { id: 'myBookings', icon: 'ticket', labelKey: 'nav.myBookings', label: 'My Appointments', roles: ['PATIENT'] },
  { id: 'staffDay', icon: 'stetho', labelKey: 'nav.staff', label: 'Camp Day', roles: ['DOCTOR', 'VOLUNTEER', 'ADMIN'] },
  { id: 'liveQueue', icon: 'radio', labelKey: 'nav.liveQueue', label: 'Live Queue', roles: ['DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'] },
  { id: 'manage', icon: 'clipboard', labelKey: 'nav.manage', label: 'Camp Management', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'analytics', icon: 'chart', labelKey: 'nav.analytics', label: 'Analytics', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'readiness', icon: 'flask', labelKey: 'nav.readiness', label: 'Ops Readiness', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'controlRoom', icon: 'radio', labelKey: 'nav.controlRoom', label: 'Control Room', roles: ['ORGANIZER', 'ADMIN'] },
  { id: 'auditLog', icon: 'clipboard', labelKey: 'nav.auditLog', label: 'Audit Log', roles: ['ADMIN'] },
  { id: 'notifications', icon: 'bell', labelKey: 'nav.notifications', label: 'Notifications', roles: ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'] },
  { id: 'settings', icon: 'gear', labelKey: 'nav.settings', label: 'Settings', roles: ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'] },
];

export const PAGE_ACCESS = Object.fromEntries(NAV.map((item) => [item.id, item.roles]));

const PAGE_TITLES = {
  overview: 'Overview', discover: 'Find Health Camps', myBookings: 'My Appointments',
  staffDay: 'Camp Day', liveQueue: 'Live Queue TV', manage: 'Camp Management',
  analytics: 'Executive Analytics',
  readiness: 'Ops Readiness',
  controlRoom: 'Control Room', auditLog: 'Audit Log', notifications: 'Notification Center',
  settings: 'Settings',
};

export default function Shell({ children }) {
  const app = useApp();
  const { user, page, setPage: navigate, t, lang, setLang, theme, setTheme, mode, connectionError, refreshConnection, unread, setUnread, gateway, drawerOpen, setDrawerOpen, screenshotMode, setScreenshotMode } = app;
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const searchRef = useRef(null);
  const navRef = useRef(null);
  const profileRef = useRef(null);
  const bellRef = useRef(null);

  const items = NAV.filter((n) => user && n.roles.includes(user.role));

  async function markInboxRead(id) {
    try {
      await api.markNotificationRead(id);
      await app.refreshInbox();
    } catch (error) {
      app.toast(error.message, 'bad');
    }
  }

  async function markInboxAll() {
    setMarkingAll(true);
    try {
      const result = await api.markAllNotificationsRead();
      await app.refreshInbox();
      app.toast(result.updated ? `${result.updated} notification${result.updated === 1 ? '' : 's'} marked read.` : 'Inbox already clear.');
    } catch (error) {
      app.toast(error.message, 'bad');
    } finally {
      setMarkingAll(false);
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (inboxOpen) {
          setInboxOpen(false);
          bellRef.current?.querySelector('button')?.focus();
        }
        if (menuOpen) {
          setMenuOpen(false);
          profileRef.current?.querySelector('button')?.focus();
        }
        setDrawerOpen(false);
        setResults(null);
      }
      if (e.key === 'x' && e.altKey) setCollapsed((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inboxOpen, menuOpen, setDrawerOpen]);

  useEffect(() => {
    if (!query) { setResults(null); setSearchError(null); }
  }, [query]);

  useEffect(() => {
    if (!menuOpen && !inboxOpen) return undefined;
    const onPointerDown = (e) => {
      if (!profileRef.current?.contains(e.target)) {
        if (profileRef.current?.contains(document.activeElement)) {
          profileRef.current.querySelector('button')?.focus();
        }
        setMenuOpen(false);
      }
      if (!bellRef.current?.contains(e.target)) {
        if (bellRef.current?.contains(document.activeElement)) {
          bellRef.current.querySelector('button')?.focus();
        }
        setInboxOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen, inboxOpen]);

  async function runSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      const { camps } = await api.camps();
      const q = query.toLowerCase();
      setResults(camps.filter((c) => `${c.title} ${c.venue} ${c.area || ''} ${c.address}`.toLowerCase().includes(q)).slice(0, 5));
      setSearchError(null);
    } catch (error) {
      setResults([]);
      setSearchError(error.message);
    }
  }

  return (
    <div className={cls('shell', collapsed && 'shell-collapsed', screenshotMode && 'screenshot-active')} data-theme={theme}>
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
              <strong>CHSC</strong>
              <small>Camp Scheduler</small>
            </span>
          )}
        </div>

        <nav className="side-nav" aria-label="Primary">
          {items.map((item) => (
            <button
              key={item.id}
              className={cls('nav-item', page === item.id && 'active')}
              onClick={() => { navigate(item.id); setDrawerOpen(false); }}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </button>
          ))}
        </nav>

        {!collapsed && (
          <div className="side-foot">
            <button
              type="button"
              className={cls('mode-chip', mode === 'live' && 'mode-live', mode === 'error' && 'mode-error')}
              onClick={mode === 'error' ? refreshConnection : undefined}
              disabled={mode !== 'error'}
              title={mode === 'error' ? `${connectionError || 'Connection error'} — click to retry` : mode === 'live' ? 'Connected to the MySQL backend' : 'Checking the live backend…'}
              aria-label={mode === 'error' ? 'Connection error — retry' : 'Live backend status'}
            >
              <span className="mode-dot" />
              {mode === 'live' ? 'LIVE · MySQL' : mode === 'connecting' ? 'Connecting…' : 'Connection error'}
            </button>
            {mode === 'error' && connectionError && <p className="mode-error-text">{connectionError}</p>}
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
            <button type="button" className="search-toggle" aria-label="Open global search" onClick={() => searchRef.current?.focus()}>
              <Icon name="search" size={16} />
            </button>
            <label className="search-field">
              <span>Search</span>
              <input ref={searchRef} placeholder={t('label.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <kbd>/</kbd>
            {results && (
              <div className="search-results">
                {searchError && <p className="muted">{searchError}</p>}
                {!searchError && results.length === 0 && <p className="muted">No camps match “{query}”.</p>}
                {!searchError && results.map((c) => (
                  <button type="button" key={c.id} onClick={() => { navigate(user.role === 'PATIENT' ? 'discover' : 'manage'); setResults(null); setQuery(''); }}>
                    <strong>{c.title}</strong>
                    <span className="muted">{c.venue} · {c.campDate}</span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="topbar-actions">
            <Badge tone={mode === 'live' ? 'ok' : mode === 'error' ? 'bad' : 'muted'} className="mode-badge">
              {mode === 'live' ? 'LIVE · MySQL' : mode === 'error' ? 'Connection error' : 'Connecting…'}
            </Badge>

            <button
              className="icon-btn topbar-util"
              onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
              aria-label={`${lang === 'en' ? 'EN' : 'ಕನ್'} — switch language`}
              title="English / ಕನ್ನಡ"
            >
              <span className="lang-chip">{lang === 'en' ? 'EN' : 'ಕನ್'}</span>
            </button>

            <button className="icon-btn topbar-util" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            <div className="bell-wrap" ref={bellRef}>
              <button
                className="icon-btn bell"
                onClick={() => { setInboxOpen((open) => !open); setMenuOpen(false); }}
                aria-label={`Notifications${app.inboxUnread ? `, ${app.inboxUnread} unread` : ''}`}
                aria-expanded={inboxOpen}
                aria-controls="notification-inbox"
              >
                <Icon name="bell" />
                {app.inboxUnread > 0 && <span className="bell-dot">{app.inboxUnread > 9 ? '9+' : app.inboxUnread}</span>}
              </button>
              {inboxOpen && (
                <div id="notification-inbox" className="inbox-pop" aria-label="Notification inbox">
                  <div className="inbox-pop-head">
                    <strong>Inbox</strong>
                    <span className="muted">{app.inboxUnread} unread · live MySQL</span>
                  </div>
                  {app.inbox.length === 0 ? (
                    <EmptyState icon="bell" title="No notifications yet">
                      Real camp updates will appear here once they are queued.
                    </EmptyState>
                  ) : (
                    <div className="inbox-pop-list">
                      {app.inbox.slice(0, 6).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={cls('inbox-pop-row', !item.isRead && 'unread')}
                          onClick={() => markInboxRead(item.id)}
                          disabled={item.isRead}
                        >
                          <span>{item.message}</span>
                          <small>{relTime(item.createdAt)}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="inbox-pop-foot">
                    <button type="button" onClick={() => { navigate('notifications'); setInboxOpen(false); }}>
                      Open notification center
                    </button>
                    <button type="button" disabled={markingAll || !app.inboxUnread} onClick={markInboxAll}>
                      {markingAll ? 'Marking…' : 'Mark all read'}
                    </button>
                  </div>
                  <button type="button" className="inbox-gateway-link" onClick={() => { setDrawerOpen(true); setInboxOpen(false); }}>
                    <Icon name="radio" size={14} /> Gateway interceptor feed ({unread} new)
                  </button>
                </div>
              )}
            </div>

            <div className="profile" ref={profileRef}>
              <button className="profile-btn" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="account-menu" aria-label={`Account menu for ${user?.name || 'guest'}`}>
                <span className="avatar">{(user?.name || 'G')[0]}</span>
                <span className="profile-meta">
                  <strong>{user?.name?.split(' ')[0]}</strong>
                  <small>{user?.role}</small>
                </span>
                <Icon name="chevronD" size={14} />
              </button>
              {menuOpen && (
                <div id="account-menu" className="profile-menu" aria-label="Account menu">
                  <p className="muted profile-mail">{user?.email}</p>
                  <button onClick={() => { navigate('settings'); setMenuOpen(false); }}><Icon name="gear" size={15} /> Settings & privacy</button>
                  <button onClick={() => { app.signOut(); }}><Icon name="logout" size={15} /> Sign out</button>
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
  const { gateway, setDrawerOpen, isOrganizer } = useApp();
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const closeRef = useRef(null);
  const headingId = 'gateway-drawer-title';

  useEffect(() => {
    if (!isOrganizer) {
      setLog([]);
      setLoading(false);
      return;
    }
    api.notifications(40)
      .then((data) => setLog(data.notifications || []))
      .catch((err) => { setLog([]); setError(err.message); })
      .finally(() => setLoading(false));
  }, [isOrganizer]);

  useEffect(() => {
    const previous = document.activeElement;
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [setDrawerOpen]);

  const merged = [...gateway, ...(log || [])];
  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby={headingId}>
      <header className="drawer-head">
        <div>
          <h2 id={headingId}><Icon name="send" size={16} /> Gateway Interceptor</h2>
          <p className="muted">
            Live feed of notification records emitted by the platform.
            {!isOrganizer && ' Your session activity is shown; the platform-wide log is limited to organizers and admins.'}
          </p>
        </div>
        <button ref={closeRef} className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close gateway interceptor"><Icon name="x" /></button>
      </header>
      <div className="drawer-body">
        {loading && <p className="muted">Loading delivery log…</p>}
        {error && <p className="muted">{error}</p>}
        {!loading && !error && merged.length === 0 && (
          <p className="muted">No notifications yet. Book a slot, check in a patient, or run a reminder sweep.</p>
        )}
        {merged.map((n, i) => {
          const status = String(n.status || 'PENDING').toUpperCase();
          const tone = status === 'SENT' ? 'ok' : status === 'SIMULATED' ? 'sim' : status === 'FAILED' ? 'bad' : 'info';
          return (
            <article key={n._id || `${n.id}-${i}`} className="gw-row">
              <div className="gw-top">
                <Badge status={n.channel} tone={n.channel === 'SMS' ? 'info' : n.channel === 'SYSTEM' ? 'muted' : 'warn'}>{n.channel}</Badge>
                <Badge status={status} tone={tone}>{status}</Badge>
                <time className="muted">{relTime(n.sentAt || n.at)}</time>
              </div>
              <p className="gw-msg">{n.subject ? <strong>{n.subject} — </strong> : null}{n.message}</p>
              <p className="gw-meta muted">→ {n.recipient} · {n.provider || 'Gateway Interceptor'}{n.bookingId ? ` · booking reference ${n.bookingId}` : ''}</p>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
