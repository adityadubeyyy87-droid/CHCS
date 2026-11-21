// DemoController.jsx — presentation controller docked in the top bar.
// Four repeatable demo scenarios + utilities. In live mode, admin-level ops
// use the real API; in demo mode they run on the local engine and are marked
// simulated. Every outcome is echoed into the Gateway Interceptor.
import React, { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Icon } from './ui.jsx';
import { cls } from '../lib/format.js';

const SCENARIOS = [
  { id: 'concurrency', title: '1 · Last-Seat Concurrency', desc: '50 parallel requests, 10 seats — 10 confirmed, 40 waitlisted, 0 overbooked.', page: 'analytics', arena: true },
  { id: 'promotion', title: '2 · Waitlist Promotion', desc: 'Release CHSC-BLR-104 and watch the FIFO promotion + notification.', arena: false },
  { id: 'checkin', title: '3 · QR Check-In', desc: 'Scan token CHSC-BLR-104 and broadcast it to the Live Queue TV.', arena: false },
  { id: 'analytics', title: '4 · Smart Analytics', desc: 'No-show statistics and the mathematical capacity recommendation.', page: 'analytics', arena: false },
];

const PPT_VIEWS = [
  { id: 'discover', label: 'Booking journey', page: 'discover' },
  { id: 'manage', label: 'Organizer desk', page: 'manage' },
  { id: 'analytics', label: 'Analytics + Arena', page: 'analytics' },
];

export default function DemoController() {
  const app = useApp();
  const { user, setPage, toast, pushGateway, mode, science, setScience, screenshotMode, setScreenshotMode } = app;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState(null);

  const outcome = (res) => {
    const simulated = mode !== 'live' || res?.__mode === 'demo' || res?.simulated;
    return {
      simulated,
      status: simulated ? 'SIMULATED' : 'SENT',
      provider: simulated ? 'Local Engine' : 'Gateway Interceptor',
    };
  };

  useEffect(() => {
    const onToggle = () => setOpen((value) => !value);
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('chsc:toggle-demo', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('chsc:toggle-demo', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!user) return null; // controller appears after sign-in

  async function runScenario(s) {
    setBusy(s.id);
    try {
      if (s.page) setPage(s.page);
      if (s.id === 'promotion') {
        // Admin/organizer can release any confirmed booking; this seeded
        // booking belongs to the CHSC-BLR-104 demo token.
        const res = await api.cancelBooking(1);
        const result = outcome(res);
        setLast(res);
        toast(res.message, 'ok', res.autoPromoted ? `Promoted: ${res.promotedPatient?.name || 'first waiting patient'}` : 'No waiting patients on that slot.');
        pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'presentation controller', message: `Scenario 2 executed: ${res.message}`, status: result.status, provider: result.simulated ? 'Local Engine' : 'Demo Controller', bookingId: 1 });
      }
      if (s.id === 'checkin') {
        const res = await api.checkin('CHSC-BLR-104');
        const result = outcome(res);
        setLast(res);
        toast(res.message, 'ok', 'The Live Queue TV updates in real time — open it from the sidebar.');
        pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'presentation controller', message: `Scenario 3 executed: ${res.message}`, status: result.status, provider: result.simulated ? 'Local Engine' : 'Demo Controller' });
      }
      if (s.id === 'analytics') {
        setPage('analytics');
        toast('Executive analytics open — walk through the Capacity Advisor maths.');
      }
      if (s.id === 'concurrency') {
        setPage('analytics');
        toast('Concurrency Arena is on the Analytics page — press Start race.');
      }
    } catch (err) {
      toast(err.message, 'bad', 'Try Scenario 2 from an ADMIN demo account, or reset demo data.');
    } finally {
      setBusy(null);
    }
  }

  async function doReset() {
    setBusy('reset');
    try {
      if (mode === 'live') {
        const notice = await api.demoResetNotice().catch(() => null);
        toast('Database reset uses the CLI', 'warn', notice?.message || 'Run: mysql -u root -p < database/schema.sql — then reload.');
        return;
      }
      const res = await api.demoReset();
      setLast(res);
      pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'local demo engine', message: res.message, status: 'SIMULATED', provider: 'Local Engine' });
      toast(res.message, 'ok', 'Local engine only — no database was changed.');
    } catch (err) {
      toast(err.message, 'bad');
    } finally { setBusy(null); }
  }

  function openPptView(view) {
    setPage(view.page);
    setScreenshotMode(true);
    setOpen(false);
  }

  async function doRush() {
    setBusy('rush');
    try {
      const res = await api.rush(1);
      const result = outcome(res);
      toast(result.simulated ? 'Synthetic rush hour added locally' : 'Synthetic rush hour added', 'warn', `${res.slotsTouched?.length || 0} slots filled with synthetic demand${result.simulated ? ' (local engine)' : ''}.`);
      pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'presentation controller', message: `Rush hour: synthetic demand added to ${res.slotsTouched?.length || 0} slots.`, status: result.status, provider: result.simulated ? 'Local Engine' : 'Demo Controller' });
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusy(null); }
  }

  return (
    <div className={cls('demo-ctl', open && 'open')}>
      <button className="demo-fab" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Open demo controller" title="Live Demonstration Story Controller">
        <Icon name="play" size={16} />
        <span>Demo</span>
      </button>

      {open && (
        <div className="demo-panel" role="dialog" aria-modal="false" aria-label="Demo story controller">
          <header className="demo-head">
            <h3><Icon name="zap" size={15} /> Demonstration Story Controller</h3>
            <Badge tone={mode === 'live' ? 'ok' : 'sim'}>{mode === 'live' ? 'MODE A · real MySQL' : 'MODE B · simulated'}</Badge>
          </header>

          <div className="demo-scenarios">
            {SCENARIOS.map((s) => (
              <button key={s.id} className="demo-scenario" disabled={busy === s.id} onClick={() => runScenario(s)}>
                <div>
                  <strong>{s.title}</strong>
                  <p className="muted">{s.desc}</p>
                </div>
                <Icon name="chevronR" size={15} />
              </button>
            ))}
          </div>

          <div className="demo-views">
            <span className="field-label">3 clean PPT views · Esc returns</span>
            <div>
              {PPT_VIEWS.map((v) => (
                <button key={v.id} className="demo-view" onClick={() => openPptView(v)}>
                  <Icon name="camera" size={12} /> {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="demo-utils">
            <Button size="sm" variant="ghost" icon="refresh" loading={busy === 'reset'} onClick={doReset}>Reset demo data</Button>
            <Button size="sm" variant="ghost" icon="zap" loading={busy === 'rush'} onClick={doRush}>Simulate rush hour</Button>
            <Button size="sm" variant="ghost" icon="eye" className={screenshotMode && 'active'} onClick={() => setScreenshotMode(!screenshotMode)}>Clean PPT mode</Button>
            <Button size="sm" variant="ghost" icon="flask" className={science && 'active'} onClick={() => setScience(!science)}>Science X-Ray</Button>
          </div>

          {last && (
            <footer className="demo-last">
              <small className="muted">Last result</small>
              <p>{last.message}</p>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
