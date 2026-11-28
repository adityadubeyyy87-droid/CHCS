// StaffDay.jsx — camp-day check-in against the live API, with optional QR
// camera capture. Every check-in is written to MySQL; nothing is queued or
// accepted locally when the backend cannot be reached.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, Counter, EmptyState, ErrorNote, Icon, Input, Skeleton } from '../components/ui.jsx';
import { ManualLookupCard, ServiceQueueCard, WalkinCard } from '../components/StaffWorkflows.jsx';
import { useCampRoom } from '../components/useCampRoom.js';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { Magnetic, InView, Spotlight } from '../components/motion';

const NativeBarcodeDetector = typeof window !== 'undefined' ? window.BarcodeDetector : null;
const FALLBACK_SCAN_INTERVAL_MS = 160;

export default function StaffDay() {
  const { toast, pushGateway, socket } = useApp();
  const [token, setToken] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const assignments = useFetch(() => api.staffMe(), []);
  const [campId, setCampId] = useState(null);
  const campJoined = useCampRoom(campId);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const jsQrRef = useRef(null);
  const lastFallbackScanRef = useRef(0);
  const scanFrameRef = useRef(null);
  const scanningRef = useRef(false);

  const stopScanner = useCallback(() => {
    scanningRef.current = false;
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    scanFrameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    lastFallbackScanRef.current = 0;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  /** Lazy-loaded decoder for browsers without the native BarcodeDetector API. */
  const loadFallbackDecoder = useCallback(async () => {
    if (jsQrRef.current) return jsQrRef.current;
    const module = await import('jsqr');
    const decoder = module.default || module;
    if (typeof decoder !== 'function') {
      throw new Error('The fallback QR decoder could not be loaded.');
    }
    jsQrRef.current = decoder;
    return decoder;
  }, []);

  const scanFrame = useCallback(async () => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      try {
        let raw = null;
        if (detectorRef.current) {
          const codes = await detectorRef.current.detect(video);
          raw = codes.find((item) => item.rawValue?.trim())?.rawValue.trim() || null;
        } else if (jsQrRef.current && canvasRef.current) {
          // jsQR is CPU-bound, so sample a few frames per second rather than
          // decoding every animation frame.
          const now = performance.now();
          if (now - lastFallbackScanRef.current >= FALLBACK_SCAN_INTERVAL_MS) {
            lastFallbackScanRef.current = now;
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (width && height) {
              const canvas = canvasRef.current;
              canvas.width = width;
              canvas.height = height;
              const context = canvas.getContext('2d', { willReadFrequently: true });
              context.drawImage(video, 0, 0, width, height);
              const image = context.getImageData(0, 0, width, height);
              const found = jsQrRef.current(image.data, image.width, image.height);
              raw = found?.data?.trim() || null;
            }
          }
        }
        if (raw) {
          setToken(raw);
          stopScanner();
          toast('QR captured — review the token and verify check-in.', 'ok', raw);
          return;
        }
      } catch {
        // A dropped frame is not a failed scan; keep the camera running.
      }
    }
    scanFrameRef.current = requestAnimationFrame(scanFrame);
  }, [stopScanner, toast]);

  async function startScanner() {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser. Enter the token manually.');
      return;
    }
    try {
      if (NativeBarcodeDetector) {
        detectorRef.current = new NativeBarcodeDetector({ formats: ['qr_code'] });
      } else {
        await loadFallbackDecoder();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      streamRef.current = stream;
      scanningRef.current = true;
      setScanning(true);
      const video = videoRef.current;
      if (!video) throw new Error('The camera preview is not ready.');
      video.srcObject = stream;
      await video.play();
      scanFrameRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      stopScanner();
      setCameraError(err.message || 'The camera could not be started.');
    }
  }

  useEffect(() => () => {
    scanningRef.current = false;
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const loadQueue = useCallback(async () => {
    if (!campId) return;
    setQueueBusy(true);
    setQueueError(null);
    try {
      const res = await api.queue(campId);
      setQueue(res.queue || null);
    } catch (err) {
      setQueue(null);
      setQueueError(err.message);
    } finally {
      setQueueBusy(false);
    }
  }, [campId]);

  async function doCheckin() {
    if (!token.trim()) return;
    setBusy(true);
    const entered = token.trim().toUpperCase();
    try {
      const res = await api.checkin(entered);
      setResult(res);
      pushGateway({
        channel: 'SYSTEM', type: 'CHECK_IN', localActivity: true,
        message: `Token ${res.booking?.tokenNumber || entered} checked in.`,
        bookingId: res.booking?.id,
      });
      await loadQueue();
      toast(res.message || 'Check-in recorded.', 'ok', `Token ${res.booking?.tokenNumber || entered} checked in.`);
      setToken('');
    } catch (err) {
      setResult({ error: err.message });
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const list = assignments.data?.assignments || [];
    if (list.length && !campId) setCampId(list[0].campId);
  }, [assignments.data, campId]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => {
    if (!socket || !campJoined) return undefined;
    const reload = () => loadQueue();
    socket.on('queue:updated', reload);
    socket.on('checkin:new', reload);
    socket.on('service:queue:updated', reload);
    return () => {
      socket.off('queue:updated', reload);
      socket.off('checkin:new', reload);
      socket.off('service:queue:updated', reload);
    };
  }, [socket, campJoined, loadQueue]);

  const duty = assignments.data?.assignments || [];
  const currentCamp = duty.find((a) => Number(a.campId) === Number(campId));
  const resultTitle = result?.error
    ? 'Check-in failed'
    : result?.status === 'ALREADY_CHECKED_IN'
      ? 'Already checked in'
      : 'Check-in successful';

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
              <span className="online-dot" />
              Direct API write · successful check-ins broadcast to the waiting room over Socket.io
            </div>

            <div className="scanner-panel">
              <video
                ref={videoRef}
                className="qr-video"
                playsInline
                muted
                hidden={!scanning}
                aria-label="QR camera preview"
              />
              <canvas ref={canvasRef} hidden aria-hidden="true" />
              {!scanning && (
                <Button size="sm" icon="camera" onClick={startScanner}>
                  Scan QR with camera
                </Button>
              )}
              {scanning && (
                <Button size="sm" variant="ghost" icon="x" onClick={stopScanner}>
                  Stop camera
                </Button>
              )}
              <p className="muted small">
                Camera scanning uses the browser's native QR detector, with a bundled fallback decoder
                when it is unavailable. If the camera is blocked, enter the reference from the patient's pass below.
              </p>
              {cameraError && <ErrorNote>{cameraError}</ErrorNote>}
            </div>

            <form className="checkin-form" onSubmit={(e) => { e.preventDefault(); doCheckin(); }}>
              <div className="checkin-input">
                <Icon name="qr" size={14} />
                <label className="inline-field qr-token-field">
                  <span>Ticket reference</span>
                  <Input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} placeholder="CHSC-BLR-104999" autoComplete="off" />
                </label>
                <Magnetic intensity={0.5}>
                  <Button type="submit" icon="check" loading={busy} disabled={!token.trim()}>Verify & check in</Button>
                </Magnetic>
              </div>
            </form>
            {result && (
              <div className={`checkin-result ${result.error ? 'bad' : ''}`} role={result.error ? 'alert' : 'status'}>
                <Icon name={result.error ? 'alert' : 'check'} />
                <div>
                  <strong>{resultTitle}</strong>
                  <p className="muted checkin-note">{result.error || `Token ${result.booking?.tokenNumber || token} — ${result.booking?.patientName || 'patient'}.`}</p>
                </div>
              </div>
            )}
            <p className="muted checkin-note">Scan a patient's QR pass at the registration desk. The Live Queue TV updates in real time.</p>
          </Card>
        </Spotlight>

        <ManualLookupCard campId={campId} onCheckedIn={() => { loadQueue(); }} />
      </div>

      <div className="split-right stack-lg">
        <Card>
          <CardHead icon="radio" title="Live Waiting Room" sub={currentCamp ? `${currentCamp.campTitle} · ${fmtTime12(currentCamp.shiftStart)}` : 'Select a duty camp'} />
          {queueBusy && <div className="stack-md"><Skeleton h={48} /><Skeleton h={48} /></div>}
          {queueError && <ErrorNote onRetry={loadQueue}>{queueError}</ErrorNote>}
          {!queueError && queue && (
            <div className="tv-main">
              <div className="tv-now">
                <small>Now serving</small>
                <strong className="tv-token">{queue.current?.tokenNumber || '—'}</strong>
                <span className="muted">{queue.current ? `${queue.current.patientName} · waited ${queue.current.waitedMinutes} min` : 'Awaiting first check-in'}</span>
              </div>
              <div className="tv-stats">
                <div><small>Avg wait</small><strong><Counter value={Number(queue.averageWaitMinutes) || 0} suffix=" min" /></strong></div>
                <div><small>Checked in</small><strong>{Number(queue.totalCheckedIn) || 0}</strong></div>
                <div><small>Next up</small><strong>{queue.next?.length || 0}</strong></div>
              </div>
            </div>
          )}
          {!queue && !queueBusy && !queueError && <EmptyState icon="radio" title="No queue data" />}
        </Card>

        <ServiceQueueCard campId={campId} />
        <WalkinCard campId={campId} onRegistered={() => { loadQueue(); }} />

        <Card className="tips-card">
          <CardHead icon="users" title="FIFO Fairness" sub="Waitlist promotions follow strict first-in-first-out order under a row lock" />
          <ul className="math-steps">
            <li>When a seat is released, the first waiting neighbour is atomically promoted inside the same transaction.</li>
            <li>Nobody can jump the queue — position is determined by arrival time.</li>
            <li>Promoted patients receive an instant notification through the Gateway Interceptor.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
