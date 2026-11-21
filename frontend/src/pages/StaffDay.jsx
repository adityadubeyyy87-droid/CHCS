// StaffDay.jsx — camp-day check-in with an offline queue that really syncs.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, Counter, EmptyState, ErrorNote, Icon, Input, Skeleton } from '../components/ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { Magnetic, InView, Spotlight } from '../components/motion';

export default function StaffDay() {
  const { toast, pushGateway, mode } = useApp();
  const [token, setToken] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const assignments = useFetch(() => api.staffMe(), []);
  const [campId, setCampId] = useState(null);
  const [queue, setQueue] = useState(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const isOnlineRef = useRef(isOnline);
  const offlineQueueRef = useRef([]);

  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { offlineQueueRef.current = offlineQueue; }, [offlineQueue]);

  const loadQueue = useCallback(async () => {
    if (!campId) return;
    setQueueBusy(true);
    try {
      const res = await api.queue(campId);
      setQueue(res.queue || null);
    } catch { setQueue(null); }
    finally { setQueueBusy(false); }
  }, [campId]);

  const syncOffline = useCallback(async (force = false) => {
    const pending = offlineQueueRef.current;
    if (pending.length === 0) return;
    if (!isOnlineRef.current && !force) {
      toast('Still offline — scans will sync when the connection returns.', 'warn');
      return;
    }
    setOfflineQueue([]);
    for (const item of pending) {
      try {
        const res = await api.checkin(item.token);
        toast(`Synced: ${res.booking?.tokenNumber || item.token}`, 'ok');
      } catch (err) {
        setOfflineQueue((cur) => [...cur, { ...item, status: 'SYNC_FAILED' }]);
        toast(`Sync failed for ${item.token}: ${err.message}`, 'bad');
      }
    }
    await loadQueue();
  }, [loadQueue, toast]);

  useEffect(() => {
    const onOnline = () => { isOnlineRef.current = true; setIsOnline(true); syncOffline(true); };
    const onOffline = () => { isOnlineRef.current = false; setIsOnline(false); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncOffline]);

  async function doCheckin() {
    if (!token.trim()) return;
    setBusy(true);
    const t = token.toUpperCase();
    try {
      if (!isOnlineRef.current) {
        const pending = { id: Date.now(), token: t, scannedAt: new Date().toISOString(), status: 'PENDING_SYNC' };
        setOfflineQueue((q) => [...q, pending]);
        setResult({ offline: true, tokenNumber: t, message: 'Offline — scanned locally, will sync when back online.' });
        toast('Offline: queued for sync', 'warn', `Token ${t}`);
        setToken('');
        return;
      }
      const res = await api.checkin(t);
      setResult(res);
      pushGateway({ channel: 'SYSTEM', type: 'CHECK_IN', recipient: 'camp staff', message: `Token ${res.booking?.tokenNumber || t} checked in.`, status: res.simulated ? 'SIMULATED' : 'SENT', provider: res.simulated ? 'Local Engine' : 'Socket.io', bookingId: res.booking?.id });
      await loadQueue();
      toast(res.message, 'ok', `Token ${res.booking?.tokenNumber || t} checked in.`);
      setToken('');
    } catch (err) { setResult({ error: err.message }); toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const list = assignments.data?.assignments || [];
    if (list.length && !campId) setCampId(list[0].campId);
  }, [assignments.data, campId]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const duty = assignments.data?.assignments || [];
  const currentCamp = duty.find((a) => Number(a.campId) === Number(campId));
  const demoTokens = [queue?.current?.tokenNumber, ...(queue?.next || []).map((n) => n.tokenNumber)].filter(Boolean).slice(0, 4);

  return (
    <div className="split gap-6">
      <div className="split-left stack-lg">
        <Card>
          <CardHead icon="stetho" title="Staff Duty Roster" sub="Your assigned camps and shifts" />
          {assignments.loading ? <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={64} />)}</div> : assignments.error ? <ErrorNote onRetry={assignments.reload}>{assignments.error}</ErrorNote> : duty.length === 0 ? (
            <EmptyState icon="stetho" title="No duty assignments yet">An organizer can assign you to a camp from Manage → Staff matrix.</EmptyState>
          ) : (
            <div className="camp-rows">
              {duty.map((a) => (
                <InView key={a.id} once>
                  <button type="button" className={`camp-row ${campId === a.campId ? 'sel' : ''}`} onClick={() => setCampId(a.campId)}>
                    <div className="camp-date">
                      <strong>{fmtDate(a.campDate).split(',')[1] || a.campDate}</strong>
                      <small>{fmtDate(a.campDate).split(',')[0]}</small>
                    </div>
                    <div className="camp-row-main">
                      <strong>{a.campTitle || `Camp #${a.campId}`}</strong>
                      <small className="muted">{a.venue} · {fmtTime12(a.shiftStart)}–{fmtTime12(a.shiftEnd)}</small>
                    </div>
                    <Badge tone={a.loadWarning ? 'warn' : 'ok'}>{a.roleAtCamp}</Badge>
                  </button>
                </InView>
              ))}
            </div>
          )}
        </Card>

        <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}>
          <Card>
            <CardHead icon="qr" title="QR Check-In Scanner" sub="Token verifier · live queue broadcaster" />
            <div className="checkin-status">
              <span className={isOnline ? 'online-dot' : 'offline-dot'} />
              {isOnline ? 'Online' : 'Offline — scans queued locally'}
              {offlineQueue.length > 0 && <span className="muted small">· {offlineQueue.length} pending sync</span>}
              {offlineQueue.length > 0 && (
                <Button size="sm" icon="refresh" loading={!isOnline} onClick={() => syncOffline(false)}>Sync now</Button>
              )}
            </div>
            <form className="checkin-form" onSubmit={(e) => { e.preventDefault(); doCheckin(); }}>
              <div className="checkin-input">
                <Icon name="qr" size={14} />
                <Input aria-label="Booking QR token" value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} placeholder="CHSC-BLR-104999" autoComplete="off" />
                <Magnetic intensity={0.5}>
                  <Button type="submit" icon="check" loading={busy}>Verify & check in</Button>
                </Magnetic>
              </div>
            </form>
            {mode !== 'live' && demoTokens.length > 0 && (
              <div className="quick-tokens">
                <span className="muted small">Local demo tokens:</span>
                {demoTokens.map((t) => <button key={t} type="button" className="chip" onClick={() => setToken(t)}>{t}</button>)}
              </div>
            )}
            {result && (
              <div className={`checkin-result ${result.error ? 'bad' : ''}`} role={result.error ? 'alert' : 'status'}>
                <Icon name={result.error ? 'alert' : 'check'} />
                <div>
                  <strong>{result.error ? 'Check-in failed' : result.offline ? 'Queued while offline' : 'Check-in successful'}</strong>
                  <p className="muted checkin-note">{result.error || `Token ${result.tokenNumber || token} — ${result.booking?.patientName || 'patient'}.`}</p>
                </div>
              </div>
            )}
            <p className="muted checkin-note">Scan a patient's QR pass at the registration desk. The Live Queue TV updates in real time.</p>
          </Card>
        </Spotlight>
      </div>

      <div className="split-right stack-lg">
        <Card>
          <CardHead icon="radio" title="Live Waiting Room" sub={currentCamp ? `${currentCamp.campTitle} · ${fmtTime12(currentCamp.shiftStart)}` : 'Select a duty camp'} />
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
