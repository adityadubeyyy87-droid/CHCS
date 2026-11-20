// StaffDay.jsx — Biophilic Future camp-day check-in with motion primitives:
// Spotlight on QR scanner, Magnetic buttons, InView for staff cards.
import React, { useEffect, useState, useRef } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Icon, Input, Skeleton } from '../components/ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { Magnetic, InView, Spotlight } from '../components/motion';

export default function StaffDay() {
  const { user, toast, pushGateway, mode } = useApp();
  const [token, setToken] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const camps = useFetch(() => api.camps(), []);
  const [campId, setCampId] = useState(null);
  const [queue, setQueue] = useState(null);
  const [queueBusy, setQueueBusy] = useState(false);

  async function doCheckin() {
    if (!token.trim()) return;
    setBusy(true);
    try {
      const res = await api.checkin(token.toUpperCase());
      setResult(res);
      pushGateway({ channel: 'SYSTEM', type: 'CHECK_IN', recipient: 'camp staff', message: `Token ${res.booking?.tokenNumber || token} checked in.`, status: res.simulated ? 'SIMULATED' : 'SENT', provider: res.simulated ? 'Local Engine' : 'Socket.io', bookingId: res.booking?.id });
      await loadQueue();
      toast(res.message, 'ok', `Token ${res.booking?.tokenNumber || token} checked in.`);
    } catch (err) { setResult({ error: err.message }); toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  async function loadQueue() {
    if (!campId) return;
    setQueueBusy(true);
    try {
      const res = await api.queue(campId);
      setQueue(res.queue);
    } catch { setQueue(null); }
    finally { setQueueBusy(false); }
  }

  useEffect(() => {
    if (camps.data?.camps.length && !campId) setCampId(camps.data.camps[0].id);
  }, [camps.data]);

  useEffect(() => { loadQueue(); }, [campId]);

  return (
    <div className="split gap-6">
      <div className="split-left stack-lg">
        <Card>
          <CardHead icon="stetho" title="Staff Duty Roster" sub="Your assignments for today" />
          {camps.loading ? <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={64} />)}</div> : camps.error ? <ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote> : (
            <div className="camp-rows">
              {(camps.data?.camps || []).map((c) => (
                <InView key={c.id} once>
                  <button key={c.id} className={`camp-row ${campId === c.id && 'sel'}`} onClick={() => setCampId(c.id)}>
                    <div className="camp-date"><strong>{fmtDate(c.campDate).split(',')[1] || c.campDate}</strong><small>{fmtDate(c.campDate).split(',')[0]}</small></div>
                    <div className="camp-row-main">
                      <strong>{c.title}</strong>
                      <small className="muted">{c.venue} · {fmtTime12(c.startTime)}–{fmtTime12(c.endTime)}</small>
                    </div>
                    <Badge tone={c.status}>{c.status}</Badge>
                  </button>
                </InView>
              ))}
            </div>
          )}
        </Card>

        <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}>
          <Card>
            <CardHead icon="qr" title="QR Check-In Scanner" sub="Token verifier · Socket.io queue broadcaster" />
            <form className="checkin-form" onSubmit={(e) => { e.preventDefault(); doCheckin(); }}>
              <div className="checkin-input">
                <Icon name="qr" size={14} />
                <Input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} placeholder="Scan or type QR token — CHSC-BLR-104" aria-label="Booking QR token" />
                <Magnetic intensity={0.5}>
                  <Button type="submit" icon="check" loading={busy}>Verify & check in</Button>
                </Magnetic>
              </div>
            </form>
            <div className="quick-tokens">
              <span className="muted small">Quick tokens:</span>
              {['CHSC-BLR-104', 'CHSC-BLR-201', 'CHSC-BLR-202', 'CHSC-BLR-203'].map((t) => (
                <button key={t} className="chip" onClick={() => setToken(t)}>{t}</button>
              ))}
            </div>
            {result && (
              <div className={`checkin-result ${result.error ? 'bad' : ''}`} role="status">
                <Icon name={result.error ? 'alert' : 'check'} />
                <div>
                  <strong>{result.error ? 'Check-in failed' : 'Check-in successful'}</strong>
                  <p className="muted checkin-note">{result.error || `Token ${result.tokenNumber || token} — ${result.booking?.patientName || 'patient'} checked in.`}</p>
                </div>
              </div>
            )}
            <p className="muted checkin-note">Scan a patient's QR pass at the registration desk. The Live Queue TV updates in real time.</p>
          </Card>
        </Spotlight>
      </div>

      <div className="split-right stack-lg">
        <Card>
          <CardHead icon="radio" title="Live Waiting Room" sub="Socket.io TV display · camp #{campId}" />
          {queueBusy && <div className="stack-md"><Skeleton h={48} /><Skeleton h={48} /></div>}
          {queue && (
            <div className="tv-main">
              <div className="tv-now">
                <small>Now serving</small>
                <strong className="tv-token">{queue.current?.tokenNumber || '—'}</strong>
                <span className="muted">{queue.current ? `${queue.current.patientName} · waited ${queue.current.waitedMinutes} min` : 'Awaiting first check-in'}</span>
              </div>
              <div className="tv-stats">
                <div><small>Avg wait</small><strong><Counter value={queue.averageWaitMinutes} suffix=" min" /></strong></div>
                <div><small>Checked in</small><strong>{queue.totalCheckedIn}</strong></div>
                <div><small>Next up</small><strong>{queue.next?.length || 0}</strong></div>
              </div>
            </div>
          )}
          {!queue && !queueBusy && <EmptyState icon="radio" title="No queue data" />}
        </Card>

        <Card className="tips-card">
          <CardHead icon="users" title="FIFO Fairness" sub="Waitlist promotions follow strict first-in-first-out order under a row lock" />
          <ul className="math-steps">
            <li>When a seat is released, the first waiting neighbour is atomically promoted inside the same transaction.</li>
            <li>Nobody can jump the queue — position is determined by arrival time.</li>
            <li>Promoted patients receive an instant SMS/email notification through the Gateway Interceptor.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Counter({ value, decimals = 0, suffix = '', className }) {
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
      const eased = 1 - Math.pow(2, -10 * p);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`counter ${className || ''}`}>{display.toFixed(decimals)}{suffix}</span>;
}
