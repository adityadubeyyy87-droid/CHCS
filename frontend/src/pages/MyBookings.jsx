// MyBookings.jsx — Biophilic Future booking management with motion primitives:
// Magnetic buttons, InView booking rows, Spotlight on passport.
// Supports confirm → view pass → cancel → reschedule → calendar export.
import React, { useEffect, useRef, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Modal, Skeleton } from '../components/ui.jsx';
import { AppointmentCardButton, FeedbackButton, PreScreeningCard } from '../components/PatientWorkflows.jsx';
import { Passport, downloadIcs } from '../components/Passport.jsx';
import { fmtDate, fmtTime12, cls, slotTone, holdSecondsLeft, fmtCountdown } from '../lib/format.js';
import { Magnetic, InView, Spotlight } from '../components/motion';

export default function MyBookings() {
  const { toast, setPage } = useApp();
  const bookings = useFetch(() => api.myBookings(), []);
  const [pass, setPass] = useState(null);
  const [screeningTarget, setScreeningTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [newSlotId, setNewSlotId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const slotRefs = useRef(new Map());

  const hasHold = (bookings.data?.bookings || []).some((b) => b.status === 'HELD');
  useEffect(() => {
    if (!hasHold) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasHold]);

  async function confirmHold(b) {
    setBusy(true);
    try {
      const res = await api.confirmBooking(b.id);
      toast(res.message || 'Seat confirmed — your pass is ready.', 'ok');
      await bookings.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  async function release(b) {
    setCancelTarget(b);
  }

  async function doCancel() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      const res = await api.cancelBooking(cancelTarget.id);
      toast(res.message, 'ok', res.autoPromoted ? `Promoted: ${res.promotedPatient?.name || 'first waiting patient'}` : 'No waiting patients on that slot.');
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
      // One atomic server transaction: no cancel-then-book gap where a failed
      // second call could cost the patient their original seat.
      const res = await api.rescheduleBooking(rescheduleTarget.id, newSlotId);
      if (res.status !== 'RESCHEDULED') throw new Error('The booking could not be moved.');
      toast(res.message || 'Booking moved to the new slot.', 'ok');
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
        <CardHead icon="ticket" title="My Appointments" sub={bookings.data?.bookings.length || 0 ? 'Your live pass, QR token, reschedule and zero-guilt release buttons.' : 'Your first step is above.'}
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
                      {b.status === 'HELD' && (
                        <span className="qr-hint hold-hint">
                          Confirm in {fmtCountdown(holdSecondsLeft(b.holdExpiresAt || b.hold_expires_at, now))}
                        </span>
                      )}
                      {b.status === 'WAITLISTED' && b.waitlistPosition && <span className="qr-hint">Position {b.waitlistPosition}</span>}
                      {b.status === 'CONFIRMED' && <span className="qr-hint">QR: {b.qrToken}</span>}
                      {b.familyMemberName && <Badge tone="info">For {b.familyMemberName}</Badge>}
                      {b.prescreened && <Badge tone="ok">Screened</Badge>}
                    </div>
                  </div>
                  <div className="booking-actions">
                    {b.status === 'HELD' && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" icon="check" disabled={busy} onClick={() => confirmHold(b)}>Confirm</Button>
                      </Magnetic>
                    )}
                    {b.status !== 'HELD' && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" variant="ghost" icon="qr" onClick={() => setPass(b)}>Pass</Button>
                      </Magnetic>
                    )}
                    {['HELD', 'CONFIRMED', 'CHECKED_IN'].includes(b.status) && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" variant="ghost" icon="clipboard" onClick={() => setScreeningTarget(b)}>
                          {b.prescreened ? 'Edit screening' : 'Pre-screen'}
                        </Button>
                      </Magnetic>
                    )}
                    {b.status === 'CONFIRMED' && <AppointmentCardButton booking={b} />}
                    {['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status) && (
                      <FeedbackButton booking={b} onSubmitted={bookings.reload} />
                    )}
                    <Magnetic intensity={0.3}>
                      <Button size="sm" variant="ghost" icon="download" onClick={() => downloadIcs(b)}>Calendar</Button>
                    </Magnetic>
                    {b.status === 'CONFIRMED' && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" variant="ghost" icon="refresh" onClick={() => openReschedule(b)}>Reschedule</Button>
                      </Magnetic>
                    )}
                    {(b.status === 'CONFIRMED' || b.status === 'HELD') && (
                      <Magnetic intensity={0.3}>
                        <Button size="sm" variant="danger" icon="refresh" onClick={() => release(b)}>Release</Button>
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
        {pass && <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}><Passport booking={pass} embedded /></Spotlight>}
      </Modal>

      <Modal open={screeningTarget !== null} onClose={() => setScreeningTarget(null)} title="Pre-screening details" wide>
        {screeningTarget && (
          <PreScreeningCard booking={screeningTarget} onSaved={bookings.reload} />
        )}
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
              <div className="slot-grid" role="radiogroup" aria-label="Available slots">
                {slots.map((s) => (
                  <button
                    key={s.id}
                    ref={(el) => { if (el) slotRefs.current.set(s.id, el); else slotRefs.current.delete(s.id); }}
                    role="radio"
                    aria-checked={newSlotId === s.id}
                    tabIndex={s.id === (newSlotId ?? slots.find((x) => x.remaining > 0)?.id) ? 0 : -1}
                    disabled={s.remaining <= 0}
                    className={cls('slot', `slot-${slotTone(s.remaining, s.capacity)}`, newSlotId === s.id && 'slot-sel')}
                    onClick={() => setNewSlotId(s.id)}
                    onKeyDown={(e) => {
                      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
                      e.preventDefault();
                      const enabled = slots.filter((x) => x.remaining > 0);
                      if (!enabled.length) return;
                      const step = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1;
                      const at = enabled.findIndex((x) => x.id === (newSlotId ?? enabled[0]?.id));
                      const next = e.key === 'Home'
                        ? enabled[0]
                        : e.key === 'End'
                          ? enabled[enabled.length - 1]
                          : enabled[(at + step + enabled.length) % enabled.length];
                      if (next) {
                        setNewSlotId(next.id);
                        requestAnimationFrame(() => slotRefs.current.get(next.id)?.focus());
                      }
                    }}>
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
