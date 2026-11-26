// App.jsx — top-level wiring: provider → auth gate → route RBAC → shell + pages.
// Page transitions (clip-path reveal), science-on body class, CommandPalette
// (⌘K), and global audio context start on first click.
import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './store.jsx';
import Shell, { PAGE_ACCESS } from './components/Shell.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import { Badge, Button, Card, CardHead } from './components/ui.jsx';
import { startAudio } from './lib/audio.js';

const Discover = lazy(() => import('./pages/Discover.jsx'));
const MyBookings = lazy(() => import('./pages/MyBookings.jsx'));
const StaffDay = lazy(() => import('./pages/StaffDay.jsx'));
const LiveQueuePage = lazy(() =>
  import('./components/LiveQueueTV.jsx').then((module) => ({ default: module.LiveQueuePage })),
);
const Manage = lazy(() => import('./pages/Manage.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Readiness = lazy(() => import('./pages/Readiness.jsx'));
const ConcurrencyProof = lazy(() => import('./pages/ConcurrencyProof.jsx'));
const ControlRoom = lazy(() => import('./pages/ControlRoom.jsx'));
const AuditLog = lazy(() => import('./pages/AuditLog.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

const PAGES = {
  overview: Overview,
  discover: Discover,
  myBookings: MyBookings,
  staffDay: StaffDay,
  liveQueue: LiveQueuePage,
  manage: Manage,
  analytics: Analytics,
  readiness: Readiness,
  concurrencyProof: ConcurrencyProof,
  controlRoom: ControlRoom,
  auditLog: AuditLog,
  notifications: Notifications,
  settings: Settings,
};

function Routes() {
  const { user, page, science, screenshotMode, setScreenshotMode, setPage } = useApp();
  const [prevPage, setPrevPage] = React.useState(page);
  const [transitioning, setTransitioning] = React.useState(false);
  const [audioStarted, setAudioStarted] = React.useState(false);

  React.useEffect(() => {
    const start = () => { startAudio(); setAudioStarted(true); };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, []);

  React.useEffect(() => {
    document.body.classList.toggle('science-on', Boolean(science));
    return () => document.body.classList.remove('science-on');
  }, [science]);

  React.useEffect(() => {
    if (!screenshotMode) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setScreenshotMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screenshotMode, setScreenshotMode]);

  React.useEffect(() => {
    if (page === prevPage) return;
    setTransitioning(true);
    const timer = setTimeout(() => {
      setPrevPage(page);
      setTransitioning(false);
    }, 620);
    return () => clearTimeout(timer);
  }, [page, prevPage]);

  // The cinematic front door renders before the auth gate.
  if (page === 'welcome') return <Landing />;
  if (!user) return <Login />;

  const allowedRoles = PAGE_ACCESS[page];
  const authorized = Boolean(allowedRoles && allowedRoles.includes(user.role));

  return (
    <>
      {screenshotMode && (
        <button className="screenshot-exit" onClick={() => setScreenshotMode(false)} aria-label="Exit clean presentation mode">
          Exit clean mode <kbd>Esc</kbd>
        </button>
      )}
      <div className={`page-transition ${transitioning ? 'open' : ''}`} aria-hidden="true" />
      <Shell>
        <div className="page-view" style={{ opacity: transitioning ? 0 : 1 }}>
          <CommandPalette />
          <Suspense fallback={<div className="stack-lg p-8 flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>}>
            {authorized
              ? <Page page={page} />
              : <AccessDenied known={Boolean(allowedRoles)} onOverview={() => setPage('overview')} />}
          </Suspense>
        </div>
      </Shell>
    </>
  );
}

function Page({ page }) {
  const Component = PAGES[page] || Overview;
  return <Component />;
}

function AccessDenied({ known, onOverview }) {
  return (
    <Card>
      <CardHead
        icon="shield"
        title={known ? 'Access denied' : 'Page not found'}
        sub={known ? 'Your role does not have access to this workspace.' : 'That route is not part of the CHSC platform.'}
        actions={<Badge tone="bad">Restricted</Badge>}
      />
      <div className="stack-md">
        <p className="muted">Return to your dashboard to continue with the work available to your role.</p>
        <Button icon="home" onClick={onOverview}>Back to overview</Button>
      </div>
    </Card>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routes />
    </AppProvider>
  );
}
