// DemoController.jsx — persistent presentation controller (bottom-left).
// Four repeatable demo scenarios + utilities. In live mode, admin-level ops
// use the real API; in demo mode they run on the local engine and are marked
// simulated. Every outcome is echoed into the Gateway Interceptor.
import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Icon } from './ui.jsx';
import { cls } from '../lib/format.js';

const SCENARIOS = [
  { id: 'concurrency', title: '1 · Last-Seat Concurrency', desc: '20 parallel requests, 1 seat — 1 confirmed, 19 waitlisted, 0 overbooked.', page: 'analytics', arena: true },
  { id: 'promotion', title: '2 · Waitlist Promotion', desc: 'Release CHSC-BLR-104 and watch the FIFO promotion + simulated SMS/email.', arena: false },
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

  if (!user) return null; // controller appears after sign-in

  async function runScenario(s) {
    setBusy(s.id);
    try {
      if (s.page) setPage(s.page);
      if (s.id === 'promotion') {
        // Admin/organizer can release any confirmed booking; find booking #1 (CHSC-BLR-104's owner).
        const res = await api.cancelBooking(1);
        setLast(res);
        toast(res.message, 'ok', res.autoPromoted ? `Promoted: ${res.promotedPatient?.name || 'first waiting patient'}` : 'No waiting patients on that slot.');
        pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'presentation controller', message: `Scenario 2 executed: ${res.message}`, status: 'SIMULATED', provider: 'Demo Controller', bookingId: 1 });
      }
      if (s.id === 'checkin') {
        const res = await api.checkin('CHSC-BLR-104');
        setLast(res);
        toast(res.message, 'ok', 'The Live Queue TV updates in real time — open it from the sidebar.');
        pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'presentation controller', message: `Scenario 3 executed: ${res.message}`, status: 'SIMULATED', provider: 'Demo Controller' });
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
        await fetch('/api/demo/reset-notice', { method: 'POST' }).catch(() => {});
        toast('Database reset uses the CLI', 'warn', 'Run: mysql -u root -p < database/schema.sql — then reload. Frontend state reset below.');
      }
      const { engine } = await import('../lib/api.js');
      engine.reset();
      setLast(null);
      toast('Local demo data reset to the deterministic seed.');
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
      toast('Rush hour simulated on camp 1', 'warn', `${res.slotsTouched.length} slots filled with synthetic demand${res.simulated ? ' (local engine)' : ''}.`);
      pushGateway({ channel: 'SYSTEM', type: 'DEMO', recipient: 'presentation controller', message: 'Simulate Rush Hour: synthetic demand added to camp 1 slots.', status: 'SIMULATED', provider: 'Demo Controller' });
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
        <div className="demo-panel" role="dialog" aria-label="Demo story controller">
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
