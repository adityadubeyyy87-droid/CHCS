// Discover.jsx — Biophilic Future booking experience with motion primitives:
// Tilt on camp cards, InView for slot selection, Spotlight on confirm panel.
// Camp discovery → 3-step guided booking → confirmation with Digital Health Passport.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Icon, Input, Sci, Skeleton } from '../components/ui.jsx';
import { Passport } from '../components/Passport.jsx';
import Confetti from '../components/Confetti.jsx';
import { cls, fmtDate, fmtTime12, dayTone, slotTone, holdSecondsLeft, fmtCountdown } from '../lib/format.js';
import { useSound } from '../lib/audio.js';
import { Tilt, InView, Spotlight, Magnetic } from '../components/motion';

const TRAVEL = [
  { id: 'WALK', label: 'Walking', eta: 'on foot' },
  { id: 'AUTO_BUS', label: 'Auto / bus', eta: 'public transport' },
  { id: 'TWO_WHEELER', label: 'Two-wheeler', eta: 'own vehicle' },
  { id: 'WITH_FAMILY', label: 'With family', eta: 'dropped off' },
];

export default function Discover() {
  const { user, toast, setPage } = useApp();
  const { click, success, error: soundError } = useSound();
  const camps = useFetch(() => api.camps(), []);
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState(0); // 0 grid, 1 details, 2 slots, 3 confirm
  const [travel, setTravel] = useState('AUTO_BUS');
  const [pledge, setPledge] = useState(true);
  const [arrival, setArrival] = useState('');
  const [slot, setSlot] = useState(null);
  const [booking, setBooking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [celebrating, setCelebrating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const slotRefs = React.useRef(new Map());
  const travelRefs = React.useRef(new Map());

  React.useEffect(() => {
    if (camps.data && !selected) {
      const first = camps.data.camps.find((c) => c.status === 'PUBLISHED' && dayTone(c.campDate) !== 'past');
      if (first) { setSelected(first); setStep(1); }
    }
  }, [camps.data]);

  // Keep the 10-minute reservation countdown live without re-rendering the
  // rest of the discovery flow every frame.
  React.useEffect(() => {
    if (booking?.status !== 'HELD') return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [booking?.id, booking?.status]);

  const grouped = useMemo(() => {
    const g = { morning: [], midday: [], afternoon: [] };
    (selected?.slots || []).forEach((s) => {
      const h = Number(s.startTime.slice(0, 2));
      if (h < 11) g.morning.push(s);
      else if (h < 14) g.midday.push(s);
      else g.afternoon.push(s);
    });
    return g;
  }, [selected]);

  function onSlotKeyDown(e, list) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const enabled = list.filter((s) => slotTone(s.remaining, s.capacity) !== 'full');
    if (!enabled.length) return;
    const step = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1;
    const at = enabled.findIndex((s) => s.id === slot?.id);
    const next = e.key === 'Home'
      ? enabled[0]
      : e.key === 'End'
        ? enabled[enabled.length - 1]
        : enabled[(at + step + enabled.length) % enabled.length];
    if (next) {
      setSlot(next);
      requestAnimationFrame(() => slotRefs.current.get(next.id)?.focus());
    }
  }

  function onTravelKeyDown(e) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const step = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1;
    const at = TRAVEL.findIndex((t) => t.id === travel);
    const next = e.key === 'Home'
      ? TRAVEL[0]
      : e.key === 'End'
        ? TRAVEL[TRAVEL.length - 1]
        : TRAVEL[(at + step + TRAVEL.length) % TRAVEL.length];
    if (next) {
      setTravel(next.id);
      requestAnimationFrame(() => travelRefs.current.get(next.id)?.focus());
    }
  }

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const res = await api.book(slot.id, { travelMode: travel, pledge });
      if (res.status === 'HELD') {
        click();
        setBooking(res.booking || res);
        setNow(Date.now());
        setStep(3);
        toast('Seat reserved for 10 minutes.', 'ok', res.__mode === 'demo' ? 'Simulated hold (local engine).' : 'Reserved in a MySQL transaction.');
        return;
      }
      if (res.status === 'CONFIRMED') {
        success();
        setCelebrating(true);
        setBooking(res.booking || res);
        setStep(3);
        toast('Booking confirmed — your pass is ready.', 'ok', res.__mode === 'demo' ? 'Simulated booking (local engine).' : 'Locked in a MySQL transaction.');
      } else {
        soundError();
        toast(res.message, 'warn', 'You can pick another slot or wait for a promotion.');
        await camps.reload();
      }
    } catch (err) {
      soundError();
      setError(err.message);
      toast(err.message, 'bad');
    } finally { setBusy(false); }
  }

  async function confirmHold() {
    if (!booking) return;
    setBusy(true); setError(null);
    try {
      const res = await api.confirmBooking(booking.id);
      const confirmed = res.booking || booking;
      if (res.status !== 'CONFIRMED' && confirmed.status !== 'CONFIRMED') throw new Error(res.message || 'The hold could not be confirmed.');
      success();
      setCelebrating(true);
      setBooking({ ...confirmed, status: 'CONFIRMED' });
      toast('Seat confirmed — your pass is ready.', 'ok', res.__mode === 'demo' ? 'Simulated confirmation (local engine).' : 'Committed in a MySQL transaction.');
      await camps.reload();
    } catch (err) {
      soundError();
      setError(err.message);
      toast(err.message, 'bad', err.code === 'HOLD_EXPIRED' ? 'The seat was released FIFO to the next waiter.' : undefined);
      if (err.code === 'HOLD_EXPIRED') {
        setBooking(null);
        setStep(2);
        await camps.reload();
      }
    } finally { setBusy(false); }
  }

  async function releaseHold() {
    if (!booking) return;
    setBusy(true); setError(null);
    try {
      const res = await api.cancelBooking(booking.id);
      toast(res.message || 'Hold released.', 'ok', 'The seat flows to the first waiting neighbour.');
      setBooking(null);
      setStep(2);
      await camps.reload();
    } catch (err) {
      soundError();
      setError(err.message);
      toast(err.message, 'bad');
    } finally { setBusy(false); }
  }

  if (step === 3 && booking?.status === 'HELD') {
    const remaining = holdSecondsLeft(booking.holdExpiresAt || booking.hold_expires_at, now);
    return (
      <div className="hold-wrap relative">
        <div className="hold-card entrance card-tilt">
          <span className="hold-icon" aria-hidden="true"><Icon name="clock" size={26} /></span>
          <h2>Your seat is on hold</h2>
          <p className="muted">
            We reserved one screening seat at <strong>{fmtTime12(slot?.startTime || booking.startTime)}</strong>.
            Confirm before the timer ends to receive QR token <strong className="mono">{booking.qrToken}</strong>.
          </p>
          <div className="hold-timer" role="timer" aria-label={`${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds remaining`}>
            {remaining === 0 ? 'EXPIRED' : fmtCountdown(remaining)}
          </div>
          <div className="hold-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, (remaining / 600) * 100))}%` }} /></div>
          {error && <div className="error-note compact" role="alert"><Icon name="alert" size={14} /><p>{error}</p></div>}
          <div className="hold-actions">
            <Magnetic intensity={0.3}>
              <Button icon="check" loading={busy} disabled={remaining === 0} onClick={confirmHold}>Confirm my pass</Button>
            </Magnetic>
            <Magnetic intensity={0.3}>
              <Button variant="ghost" icon="refresh" disabled={busy} onClick={releaseHold}>Release hold</Button>
            </Magnetic>
          </div>
          <small className="muted">Free · no payment. If the timer expires, the seat moves automatically to the FIFO waitlist.</small>
        </div>
      </div>
    );
  }

  if (step === 3 && booking) {
    return (
      <div className="confirm-wrap relative">
        {celebrating && <Confetti active count={90} />}
        <div className="confirm-head">
          <span className="confirm-check" aria-hidden="true"><Icon name="check" size={26} /></span>
          <div>
            <h2>You're booked, {booking.patientName?.split(' ')[0] || user.name.split(' ')[0]}.</h2>
            <p className="muted">Token <strong className="mono">{booking.tokenNumber}</strong> · reference <strong className="mono">{booking.qrToken}</strong></p>
          </div>
        </div>
        <Spotlight color="rgba(16, 185, 129, 0.1)" size={400}>
          <Passport booking={booking} celebrated />
        </Spotlight>
        <div className="confirm-actions">
          <Magnetic intensity={0.4}>
            <Button icon="ticket" onClick={() => { setPage('myBookings'); }}>My appointments</Button>
          </Magnetic>
          <Magnetic intensity={0.4}>
            <Button variant="ghost" icon="compass" onClick={() => { setBooking(null); setStep(1); setSlot(null); }}>Book another camp</Button>
          </Magnetic>
        </div>
      </div>
    );
  }

  return (
    <div className="discover">
      <Sci k="zeigarnik" as="div" className="steps-wrap">
        <ol className="steps" aria-label="Booking progress">
          {['Camp', 'Choose a slot', 'Confirm'].map((label, i) => (
            <li key={label} className={cls(step > i + 0 && step !== 0 && 'done', step === i + 1 && 'current')} aria-current={step === i + 1 ? 'step' : undefined}>
              <span className="step-dot">{step > i + 1 ? <Icon name="check" size={11} /> : i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </Sci>

      <div className="discover-grid">
        <aside className="discover-list">
          <CardHead icon="compass" title="Find health camps" sub="Free screening across Bengaluru" />
          {camps.loading && <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={92} />)}</div>}
          {camps.error && <ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote>}
          {camps.data && (
            <div className="camp-cards">
              {camps.data.camps.filter((c) => c.status === 'PUBLISHED' && dayTone(c.campDate) !== 'past').map((c) => {
                const remaining = c.slotCapacity - c.bookedTotal;
                return (
                  <Tilt key={c.id} rotationFactor={8}>
                    <button className={cls('camp-card', selected?.id === c.id && 'sel')} onClick={() => { setSelected(c); setStep(1); setSlot(null); setBooking(null); }}>
                      <div className="camp-card-date">
                        <strong>{fmtDate(c.campDate).split(',')[1] || c.campDate}</strong>
                        <small>{fmtDate(c.campDate).split(',')[0]}</small>
                      </div>
                      <div>
                        <strong className="camp-card-title">{c.title}</strong>
                        <small className="muted"><Icon name="pin" size={12} /> {c.venue}</small>
                        <div className="camp-card-meta">
                          <Badge tone={remaining > 0 ? 'ok' : 'bad'}>{remaining > 0 ? `${remaining} seats free` : 'Waitlist open'}</Badge>
                          <small className="muted">{fmtTime12(c.startTime)}–{fmtTime12(c.endTime)}</small>
                        </div>
                      </div>
                    </button>
                  </Tilt>
                );
              })}
            </div>
          )}
        </aside>

        <section className="discover-detail">
          {!selected && !camps.loading && <EmptyState title="Pick a camp to begin" icon="compass" />}

          {selected && step === 1 && (
            <InView once>
              <Card className="detail-card entrance card-tilt">
                <CardHead title={selected.title} sub={`${selected.venue} · ${selected.address}`} icon="pin" />
                <p className="detail-desc">{selected.descriptionEn || 'Free community screening camp.'}</p>
                <div className="detail-facts">
                  <div><small>Date</small><strong>{fmtDate(selected.campDate)}</strong></div>
                  <div><small>Hours</small><strong>{fmtTime12(selected.startTime)}–{fmtTime12(selected.endTime)}</strong></div>
                  <div><small>Slot length</small><strong>{selected.slotDurationMins} min</strong></div>
                  <div><small>Screening seats</small><strong>{selected.physicalCapacity}</strong></div>
                </div>
                <Sci k="hicks">
                  <Button icon="chevronR" onClick={() => setStep(2)}>Choose a time slot</Button>
                </Sci>
              </Card>
            </InView>
          )}

          {selected && step === 2 && (
            <Card className="slot-card entrance card-tilt">
              <CardHead icon="clock" title={`Pick a slot — ${fmtDate(selected.campDate)}`}
                sub={`${selected.slotDurationMins} min screening windows · Miller's Law: times are grouped into three chunks, not one long list.`}
                actions={<Button size="sm" variant="ghost" icon="chevronL" onClick={() => setStep(1)}>Back</Button>} />

              {['morning', 'midday', 'afternoon'].map((band) => grouped[band].length > 0 && (
                <div key={band} className="slot-band">
                  <h4 className="band-label">{{ morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon' }[band]}</h4>
                  <div className="slot-grid" role="listbox" aria-label={`${band} slots`}>
                    {grouped[band].map((s) => {
                      const tone = slotTone(s.remaining, s.capacity);
                      const firstAvailable = grouped[band].find((x) => slotTone(x.remaining, x.capacity) !== 'full')?.id;
                      return (
                        <button
                          key={s.id}
                          ref={(el) => { if (el) slotRefs.current.set(s.id, el); else slotRefs.current.delete(s.id); }}
                          role="option"
                          aria-selected={slot?.id === s.id}
                          tabIndex={s.id === (slot?.id ?? firstAvailable) ? 0 : -1}
                          disabled={tone === 'full'}
                          className={cls('slot', `slot-${tone}`, slot?.id === s.id && 'slot-sel')}
                          onClick={() => setSlot(s)}
                          onKeyDown={(e) => onSlotKeyDown(e, grouped[band])}
                        >
                          <strong>{fmtTime12(s.startTime)}</strong>
                          <small>{tone === 'full' ? `Full · ${s.waitingCount} waiting` : tone === 'almost' ? `Hurry · ${s.remaining} left` : `${s.remaining} free`}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {slot && (
                <Spotlight color="rgba(16, 185, 129, 0.1)" size={400}>
                  <div className="commit-panel">
                    <Sci k="intent" as="div" className="sci-block">
                      <h4>Plan your visit <Badge tone="sim">commitment improves follow-through</Badge></h4>
                    </Sci>
                    <div className="travel-row" role="radiogroup" aria-label="How will you get there?">
                      {TRAVEL.map((t) => (
                        <Magnetic key={t.id} intensity={0.2} range={50}>
                          <button
                            ref={(el) => { if (el) travelRefs.current.set(t.id, el); else travelRefs.current.delete(t.id); }}
                            role="radio"
                            aria-checked={travel === t.id}
                            tabIndex={t.id === (travel ?? TRAVEL[0].id) ? 0 : -1}
                            className={cls('travel', travel === t.id && 'sel')}
                            onClick={() => setTravel(t.id)}
                            onKeyDown={onTravelKeyDown}
                          >
                            <Icon name={t.id === 'WALK' ? 'user' : t.id === 'AUTO_BUS' ? 'pin' : t.id === 'TWO_WHEELER' ? 'zap' : 'users'} size={15} />
                            <span>{t.label}</span>
                          </button>
                        </Magnetic>
                      ))}
                    </div>
                    <label className="pledge">
                      <input type="checkbox" checked={pledge} onChange={(e) => setPledge(e.target.checked)} />
                      <span>I pledge to arrive 10 minutes early by {TRAVEL.find((t) => t.id === travel).label.toLowerCase()} {arrival && `by ${arrival}`}.</span>
                    </label>
                    <Input type="time" value={arrival} onChange={(e) => setArrival(e.target.value)} aria-label="Planned arrival time" className="arrival-input" />
                    {error && <div className="error-note compact" role="alert"><Icon name="alert" size={14} /><p>{error}</p></div>}
                    <div className="slot-actions">
                      {slotTone(slot.remaining, slot.capacity) === 'full' ? (
                        <Sci k="fifo"><Magnetic intensity={0.3}><Button icon="users" loading={busy} onClick={confirm}>Join waitlist (FIFO)</Button></Magnetic></Sci>
                      ) : (
                        <Magnetic intensity={0.3}><Button icon="check" loading={busy} onClick={confirm}>Hold this seat for 10 min — {fmtTime12(slot.startTime)}</Button></Magnetic>
                      )}
                      <small className="muted">Free · no payment. Cancel anytime with one tap; a waiting neighbour takes your seat.</small>
                    </div>
                  </div>
                </Spotlight>
              )}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
