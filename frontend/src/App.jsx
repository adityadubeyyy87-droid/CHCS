// App.jsx — top-level wiring: global provider → auth gate → shell + pages.
// Page transitions (clip-path reveal), DemoController float, science-on body
// class, CommandPalette (⌘K), and global audio context start on first click.
import React from 'react';
import { AppProvider, useApp } from './store.jsx';
import Shell from './components/Shell.jsx';
import DemoController from './components/DemoController.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Discover from './pages/Discover.jsx';
import MyBookings from './pages/MyBookings.jsx';
import StaffDay from './pages/StaffDay.jsx';
import Manage from './pages/Manage.jsx';
import { LiveQueuePage } from './components/LiveQueueTV.jsx';
import Analytics from './pages/Analytics.jsx';
import Notifications from './pages/Notifications.jsx';
import Settings from './pages/Settings.jsx';
import { startAudio } from './lib/audio.js';

const PAGES = {
  overview: Overview,
  discover: Discover,
  myBookings: MyBookings,
  staffDay: StaffDay,
  liveQueue: LiveQueuePage,
  manage: Manage,
  analytics: Analytics,
  notifications: Notifications,
  settings: Settings,
};

function Routes() {
  const { user, page, science } = useApp();
  const [prevPage, setPrevPage] = React.useState(page);
  const [transitioning, setTransitioning] = React.useState(false);
  const [audioStarted, setAudioStarted] = React.useState(false);

  // Start audio context on first user interaction (browser requirement).
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
    if (page === prevPage) return;
    setTransitioning(true);
    const t = setTimeout(() => {
      setPrevPage(page);
      setTransitioning(false);
    }, 620);
    return () => clearTimeout(t);
  }, [page, prevPage]);

  // The cinematic front door renders before the auth gate: anyone can walk
  // the sunrise story, and only "Enter the platform" asks them to sign in.
  if (page === 'welcome') return <Landing />;
  if (!user) return <Login />;

  return (
    <>
      <div className={`page-transition ${transitioning ? 'open' : ''}`} aria-hidden="true" />
      <Shell>
        <div className="page-view" style={{ opacity: transitioning ? 0 : 1 }}>
          <CommandPalette />
          <Page page={page} />
        </div>
      </Shell>
      <DemoController />
    </>
  );
}

function Page({ page }) {
  const Page = PAGES[page] || Overview;
  return <Page />;
}

export default function App() {
  return (
    <AppProvider>
      <Routes />
    </AppProvider>
  );
}
