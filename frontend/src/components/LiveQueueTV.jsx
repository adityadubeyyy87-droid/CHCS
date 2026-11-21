// LiveQueueTV.jsx — the dark command-center waiting-room display.
// Full-screen capable; updates over Socket.io in Mode A, engine polling in
// Mode B. Designed to be readable from across a room (TV layout).
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useFetch } from '../store.jsx';
import { cls, fmtTime12, relTime } from '../lib/format.js';
import { Badge, Button, Counter, Icon, Skeleton } from './ui.jsx';

export default function LiveQueueTV({ campId, compact = false }) {
  const { socket, socketOnline, mode, pushGateway } = useApp();
  const [flash, setFlash] = useState(null);
  const { data, loading, error, reload, setData } = useFetch(
    () => api.queue(campId), [campId], { skip: !campId }
  );

  // Mode B does not create a realtime socket; keep the display honest.
  const live = mode === 'live' && Boolean(socket) && socketOnline;
  const queue = data?.queue || {};
  const next = Array.isArray(queue.next) ? queue.next : [];
  const current = queue.current;

  // Live updates
  useEffect(() => {
    if (!campId) return undefined;
    let flashTimer;
    if (live) {
      socket.emit('camp:join', campId);
      const onUpdate = (q) => { if (q) setData({ queue: q }); };
      const onPing = () => reload();
      const onCheckin = (e) => {
        const token = e?.booking?.tokenNumber;
        if (token) {
          setFlash(token);
          clearTimeout(flashTimer);
          flashTimer = setTimeout(() => setFlash(null), 2400);
        }
        const resultMode = e?.simulated || mode !== 'live' ? 'demo' : 'live';
        pushGateway({
          channel: 'SYSTEM', type: 'CHECK_IN', recipient: 'Waiting room display',
          message: `Token ${token || 'unknown'} checked in at the desk.`,
          status: resultMode === 'live' ? 'SENT' : 'SIMULATED',
          provider: resultMode === 'live' ? 'Socket.io' : 'Local Engine',
        });
        onUpdate(e?.queue);
      };
      socket.on('queue:updated', onUpdate);
      socket.on('checkin:new', onCheckin);
      socket.on('booking:confirmed', onPing);
      socket.on('waitlist:promoted', onPing);
      return () => {
        clearTimeout(flashTimer);
        socket.emit('camp:leave', campId);
        socket.off('queue:updated', onUpdate);
        socket.off('checkin:new', onCheckin);
        socket.off('booking:confirmed', onPing);
        socket.off('waitlist:promoted', onPing);
      };
    }
    // Mode B: gentle poll of the local engine
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // setData is recreated by useFetch each render; keeping it out of deps
    // prevents needless socket re-subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, socketOnline, live, campId, mode, pushGateway]);

  if (!campId) return <div className="tv tv-empty"><p>Select a camp to display.</p></div>;
  if (loading) {
    return (
      <div className={cls('tv', compact && 'tv-compact')}>
        <Skeleton h={22} w={180} /><Skeleton h={84} /><div className="tv-next"><Skeleton h={54} /><Skeleton h={54} /></div>
      </div>
    );
  }
  if (error) return <div className="tv tv-error"><Icon name="alert" /><p>{error}</p><Button size="sm" variant="ghost" onClick={reload}>Retry</Button></div>;

  const checkedIn = Number(queue.totalCheckedIn) || 0;
  const progress = Math.min(1, (checkedIn + next.length) / 40);
  return (
    <div className={cls('tv', compact && 'tv-compact', flash && 'tv-flash')} aria-label="Waiting room display">
      <header className="tv-head">
        <div className="tv-live"><span className="live-dot" aria-hidden="true" /> {live ? 'LIVE' : 'DEMO'}</div>
        <div className="tv-title">
          <h2>Waiting Room</h2>
          <p className="muted">{live ? 'Real-time · Socket.io' : 'Real-time simulation · local engine'}</p>
        </div>
        <Badge status="CHECKED_IN">{checkedIn} checked in</Badge>
      </header>
      <span className="sr-only" aria-live="polite">{flash ? `Now serving ${flash}` : ''}</span>

      <div className="tv-main">
        <div className="tv-now">
          <small>Now serving</small>
          <strong className={cls('tv-token', flash && 'tv-token-flash')}>{current?.tokenNumber || '—'}</strong>
          <span className="muted">
            {current
              ? `${current.patientName || 'Patient'} · in for ${Number(current.waitedMinutes) || 0} min`
              : 'Awaiting first check-in'}
          </span>
        </div>
        <div className="tv-stats">
          <div><small>Avg wait</small><strong><Counter value={Number(queue.averageWaitMinutes) || 0} suffix=" min" /></strong></div>
          <div><small>Next up</small><strong>{next.length}</strong></div>
          <div><small>Updated</small><strong>{queue.updatedAt ? relTime(queue.updatedAt) : '—'}</strong></div>
        </div>
      </div>

      <div className="tv-next" aria-label="Next tokens">
        {(next.length ? next : Array.from({ length: 4 }, () => null)).map((n, i) => (
          <div key={n?.id || i} className={cls('tv-next-row', !n && 'tv-next-empty')}>
            <small>{i + 1}</small>
            <strong>{n?.tokenNumber || '···'}</strong>
            <span className="muted">{n ? n.patientName : '—'}</span>
          </div>
        ))}
      </div>

      <footer className="tv-foot">
        <div className="tv-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <p className="muted">Please stay nearby — seats are called twice, then released to the waitlist.</p>
      </footer>
    </div>
  );
}

export function LiveQueuePage() {
  const { user } = useApp();
  const [camps, setCamps] = useState(null);
  const [campId, setCampId] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    api.camps().then(({ camps }) => {
      setCamps(camps);
      const ongoing = camps.find((c) => new Date(c.campDate + 'T' + c.endTime) >= new Date() && new Date(c.campDate + 'T' + c.startTime) <= new Date());
      setCampId((prev) => prev || (ongoing || camps.find((c) => c.status === 'PUBLISHED'))?.id);
    }).catch(() => setCamps([]));
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const goFullscreen = () => {
    const el = document.getElementById('tv-stage');
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setFullscreen(false));
  };

  return (
    <div id="tv-stage" className={cls('tv-page', fullscreen && 'tv-fullscreen')}>
      <div className="tv-toolbar">
        <label className="field-label" htmlFor="tv-camp">Camp</label>
        <select id="tv-camp" className="select" value={campId || ''} onChange={(e) => setCampId(Number(e.target.value))}>
          {(camps || []).map((c) => <option key={c.id} value={c.id}>{c.title} · {c.campDate}</option>)}
        </select>
        <Button size="sm" variant="ghost" icon="radio" onClick={goFullscreen}>Full-screen TV mode</Button>
      </div>
      {campId && <LiveQueueTV campId={campId} />}
      {user && ['DOCTOR', 'VOLUNTEER'].includes(user.role) && (
        <p className="muted tv-hint"><Icon name="stetho" size={14} /> Check patients in from your Camp Day page — this display updates instantly.</p>
      )}
    </div>
  );
}
