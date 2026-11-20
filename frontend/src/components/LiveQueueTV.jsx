// LiveQueueTV.jsx — the dark command-center waiting-room display.
// Full-screen capable; updates over Socket.io in Mode A, engine polling in
// Mode B. Designed to be readable from across a room (TV layout).
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useFetch } from '../store.jsx';
import { cls, fmtTime12, relTime } from '../lib/format.js';
import { Badge, Button, Counter, Icon, Skeleton } from './ui.jsx';

export default function LiveQueueTV({ campId, compact = false }) {
  const { socket, mode, pushGateway } = useApp();
  const [flash, setFlash] = useState(null);
  const { data, loading, error, reload, setData } = useFetch(
    () => api.queue(campId), [campId], { skip: !campId }
  );
  const queue = data?.queue;

  // Live updates
  useEffect(() => {
    if (!campId) return;
    if (socket) {
      socket.emit('camp:join', campId);
      const onUpdate = (q) => setData({ queue: q });
      const onPing = () => reload();
      socket.on('queue:updated', onUpdate);
      socket.on('checkin:new', (e) => {
        setFlash(e.booking?.tokenNumber || null);
        pushGateway({ channel: 'SYSTEM', type: 'CHECK_IN', recipient: 'Waiting room display', message: `Token ${e.booking?.tokenNumber} checked in at the desk.`, status: 'SIMULATED', provider: 'Socket.io' });
        setTimeout(() => setFlash(null), 2400);
        onUpdate(e.queue);
      });
      socket.on('booking:confirmed', onPing);
      socket.on('waitlist:promoted', onPing);
      return () => {
        socket.off('queue:updated', onUpdate);
        socket.off('checkin:new');
        socket.off('booking:confirmed', onPing);
        socket.off('waitlist:promoted', onPing);
      };
    }
    // Mode B: gentle poll of the local engine
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, campId]);

  if (!campId) return <div className="tv tv-empty"><p>Select a camp to display.</p></div>;
  if (loading) {
    return (
      <div className={cls('tv', compact && 'tv-compact')}>
        <Skeleton h={22} w={180} /><Skeleton h={84} /><div className="tv-next"><Skeleton h={54} /><Skeleton h={54} /></div>
      </div>
    );
  }
  if (error) return <div className="tv tv-error"><Icon name="alert" /><p>{error}</p><Button size="sm" variant="ghost" onClick={reload}>Retry</Button></div>;

  const progress = Math.min(1, (queue.totalCheckedIn + (queue.next?.length || 0)) / 40);
  return (
    <div className={cls('tv', compact && 'tv-compact', flash && 'tv-flash')} aria-label="Live waiting room display">
      <header className="tv-head">
        <div className="tv-live"><span className="live-dot" aria-hidden="true" /> LIVE</div>
        <div className="tv-title">
          <h2>Waiting Room</h2>
          <p className="muted">{mode === 'live' ? 'Real-time · Socket.io' : 'Real-time simulation · local engine'}</p>
        </div>
        <Badge status="CHECKED_IN">{queue.totalCheckedIn} checked in</Badge>
      </header>

      <div className="tv-main">
        <div className="tv-now">
          <small>Now serving</small>
          <strong className={cls('tv-token', flash && 'tv-token-flash')}>{queue.current?.tokenNumber || '—'}</strong>
          <span className="muted">{queue.current ? `${queue.current.patientName} · in for ${queue.current.waitedMinutes} min` : 'Awaiting first check-in'}</span>
        </div>
        <div className="tv-stats">
          <div><small>Avg wait</small><strong><Counter value={queue.averageWaitMinutes} suffix=" min" /></strong></div>
          <div><small>Next up</small><strong>{queue.next?.length || 0}</strong></div>
          <div><small>Updated</small><strong>{relTime(queue.updatedAt)}</strong></div>
        </div>
      </div>

      <div className="tv-next" aria-label="Next tokens">
        {(queue.next?.length ? queue.next : Array.from({ length: 4 }, () => null)).map((n, i) => (
          <div key={i} className={cls('tv-next-row', !n && 'tv-next-empty')}>
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

  const goFullscreen = () => {
    const el = document.getElementById('tv-stage');
    if (el?.requestFullscreen) el.requestFullscreen();
    setFullscreen(true);
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
