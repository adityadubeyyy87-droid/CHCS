// MyBookings.jsx — Biophilic Future booking management with motion primitives:
// Magnetic buttons, InView booking rows, Spotlight on passport.
// Supports confirm → view pass → cancel → reschedule → calendar export.
import React, { useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Icon, Modal, Select, Skeleton } from '../components/ui.jsx';
import { PassportModal } from '../components/Passport.jsx';
import { downloadIcs } from '../components/Passport.jsx';
import { fmtDate, fmtTime12, cls } from '../lib/format.js';
import { Magnetic, InView, Spotlight } from '../components/motion';

function slotTone(remaining, capacity) {
  if (remaining <= 0) return 'full';
  if (remaining <= capacity * 0.3) return 'almost';
  return 'open';
}

export default function MyBookings() {
  const { toast, pushGateway, user, mode, setPage } = useApp();
  const bookings = useFetch(() => api.myBookings(), []);
  const [pass, setPass] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [newSlotId, setNewSlotId] = useState(null);
  const [busy, setBusy] = useState(false);

  async function release(b) {
    setCancelTarget(b);
  }

  async function doCancel() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      const res = await api.cancelBooking(cancelTarget.id);
      toast(res.message, 'ok', res.autoPromoted ? `Promoted: ${res.promotedPatient?.name || 'first waiting patient'}` : 'No waiting patients on that slot.');
      pushGateway({ channel: 'SYSTEM', type: 'CANCELLATION', recipient: 'you', message: res.message, status: res.simulated ? 'SIMULATED' : 'SENT', provider: res.simulated ? 'Local Engine' : 'MySQL + Socket.io', bookingId: cancelTarget.id });
      setCancelTarget(null);
      await bookings.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  async function openReschedule(b) {
    setRescheduleTarget(b);
    setNewSlotId(null);
    setSlots([]);
    setSlotLoading(true);
    try {
      const camp = await api.camp(b.campId);
      if (camp.camp?.slots) {
        setSlots(camp.camp.slots.filter((s) => s.id !== b.slotId));
      }
    } catch (err) { toast(err.message, 'bad'); }
    finally { setSlotLoading(false); }
  }

  async function doReschedule() {
    if (!rescheduleTarget || !newSlotId) return;
    setBusy(true);
    try {
      const res = await api.cancelBooking(rescheduleTarget.id);
      // Cancel succeeded; now book the new slot
      const booked = await api.book(newSlotId, {});
      toast(res.message, 'ok');
      toast(`Moved to slot ${booked.booking?.tokenNumber || 'confirmed'}. Reminders re-queued.`, 'ok');
      setRescheduleTarget(null);
      setNewSlotId(null);
      setSlots([]);
      await bookings.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack-lg">
      <Card>
        <CardHead icon="ticket" title="My Appointments" sub={bookings.data?.bookings.length || 0 ? 'Your offline pass, QR token, reschedule and zero-guilt release buttons.' : 'Your first step is above.'}
          actions={<Button size="sm" icon="compass" onClick={() => setPage('discover')}>Find a camp</Button>} />
        {bookings.loading ? <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={92} />)}</div> : bookings.error ? <ErrorNote onRetry={bookings.reload}>{bookings.error}</ErrorNote> : bookings.data.bookings.length === 0 ? (
          <EmptyState icon="ticket" title="No active bookings yet"
            action={<Button size="sm" icon="compass" className="btn-primary" onClick={() => setPage('discover')}>Find a camp</Button>}>
            Free screening camps run every week across Bengaluru.
          </EmptyState>
        ) : (
          <div className="booking-rows">
            {bookings.data.bookings.map((b) => (
              <InView key={b.id} once>
                <div className={cls('booking-row', b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 'row-inactive' : '')}>
                  <div className="booking-main">
                    <strong>{b.campTitle}</strong>
                    <div className="booking-when">{fmtDate(b.campDate)} · {fmtTime12(b.startTime)}–{fmtTime12(b.endTime)}</div>
                    <div className="booking-meta">
                      <Badge status={b.status}>{b.status.replace('_', ' ')}</Badge>
                      {b.status === 'WAITLISTED' && b.waitlistPosition && <span className="qr-hint">Position #{b.waitlistPosition}</span>}
                      {b.status === 'CONFIRMED' && <span className="qr-hint">QR: {b.qrToken}</span>}
                    </div>
                  </div>
                  <div className="booking-actions">
                    <Magnetic intensity={0.3}>
                      <Button size="sm" variant="ghost" icon="qr" onClick={() => setPass(b)}>Pass</Button>
                    </Magnetic>
                    <Magnetic intensity={0.3}>
                      <Button size="sm" variant="ghost" icon="download" onClick={() => downloadIcs(b)}>Calendar</Button>
                    </Magnetic>
                    {b.status === 'CONFIRMED' && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" variant="ghost" icon="refresh" onClick={() => openReschedule(b)}>Reschedule</Button>
                      </Magnetic>
                    )}
                    {b.status === 'CONFIRMED' && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" variant="ghost" icon="refresh" tone="bad" onClick={() => release(b)}>Release</Button>
                      </Magnetic>
                    )}
                  </div>
                </div>
              </InView>
            ))}
          </div>
        )}
      </Card>

      <Modal open={pass !== null} onClose={() => setPass(null)} title="Digital Health Passport" wide>
        {pass && <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}><PassportModal booking={pass} onClose={() => setPass(null)} /></Spotlight>}
      </Modal>

      <Modal open={cancelTarget !== null} onClose={() => setCancelTarget(null)} title="Release your seat">
        {cancelTarget && (
          <>
            <p>
              Releasing your seat for <strong>{cancelTarget.campTitle}</strong> at {fmtTime12(cancelTarget.startTime)} on {fmtDate(cancelTarget.campDate)}.
              There is no penalty — your seat flows to a waiting neighbour immediately.
            </p>
            <p className="muted">
              Token <strong className="mono">{cancelTarget.tokenNumber}</strong> · Reference <strong className="mono">{cancelTarget.qrToken}</strong>
            </p>
            <div className="modal-foot">
              <Button variant="ghost" onClick={() => setCancelTarget(null)}>Keep my booking</Button>
              <Magnetic intensity={0.4}>
                <Button variant="danger" icon="refresh" loading={busy} onClick={doCancel}>Release seat</Button>
              </Magnetic>
            </div>
          </>
        )}
      </Modal>

      <Modal open={rescheduleTarget !== null} onClose={() => setRescheduleTarget(null)} title="Pick a new slot">
        {rescheduleTarget && (
          <>
            <p>Moving your booking for <strong>{rescheduleTarget.campTitle}</strong>. Choose a new time within the same camp.</p>
            {slotLoading ? <div className="stack"><Skeleton h={92} /><Skeleton h={92} /></div> : slots.length === 0 ? (
              <EmptyState icon="clock" title="No other slots available" action={<Button variant="ghost" onClick={() => setRescheduleTarget(null)}>Back</Button>} />
            ) : (
              <div className="slot-grid">
                {slots.map((s) => (
                  <button key={s.id} role="radio" aria-checked={newSlotId === s.id}
                    disabled={s.remaining <= 0}
                    className={cls('slot', `slot-${slotTone(s.remaining, s.capacity)}`, newSlotId === s.id && 'slot-sel')}
                    onClick={() => setNewSlotId(s.id)}>
                    <strong>{fmtTime12(s.startTime)}</strong>
                    <small>{s.remaining <= 0 ? 'Full' : `${s.remaining} free`}</small>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-foot">
              <Button variant="ghost" onClick={() => setRescheduleTarget(null)}>Keep current slot</Button>
              <Magnetic intensity={0.4}>
                <Button variant="primary" disabled={!newSlotId || busy} loading={busy} onClick={doReschedule}>Move booking</Button>
              </Magnetic>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
