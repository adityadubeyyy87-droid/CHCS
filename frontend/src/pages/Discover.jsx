// Discover.jsx — Biophilic Future booking experience with motion primitives:
// Tilt on camp cards, InView for slot selection, Spotlight on confirm panel.
// Camp discovery → 3-step guided booking → confirmation with Digital Health Passport.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Icon, Input, Sci, Skeleton } from '../components/ui.jsx';
import { Passport } from '../components/Passport.jsx';
import Confetti from '../components/Confetti.jsx';
import { cls, fmtDate, fmtTime12, dayTone, slotTone } from '../lib/format.js';
import { useSound, startAudio } from '../lib/audio.js';
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

  React.useEffect(() => { startAudio(); }, []);

  React.useEffect(() => {
    if (camps.data && !selected) {
      const first = camps.data.camps.find((c) => c.status === 'PUBLISHED' && dayTone(c.campDate) !== 'past');
      if (first) { setSelected(first); setStep(1); }
    }
  }, [camps.data]);

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

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const res = await api.book(slot.id, { travelMode: travel, pledge });
      if (res.status === 'CONFIRMED') {
        success();
        setCelebrating(true);
        setBooking(res.booking);
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

  if (step === 3 && booking) {
    return (
      <div className="confirm-wrap relative">
        {celebrating && <Confetti active count={90} />}
        <div className="confirm-head">
          <span className="confirm-check" aria-hidden="true"><Icon name="check" size={26} /></span>
          <div>
            <h2 className="grad-text">You're booked, {booking.patientName?.split(' ')[0] || user.name.split(' ')[0]}.</h2>
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
      <Sci k="zeigarnik" className="steps-wrap">
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
                      return (
                        <button key={s.id} role="option" aria-selected={slot?.id === s.id}
                          disabled={tone === 'full'}
                          className={cls('slot', `slot-${tone}`, slot?.id === s.id && 'slot-sel')}
                          onClick={() => setSlot(s)}>
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
                    <Sci k="intent">
                      <h4>Plan your visit <Badge tone="sim">commitment improves follow-through</Badge></h4>
                    </Sci>
                    <div className="travel-row" role="radiogroup" aria-label="How will you get there?">
                      {TRAVEL.map((t) => (
                        <Magnetic key={t.id} intensity={0.2} range={50}>
                          <button key={t.id} role="radio" aria-checked={travel === t.id} className={cls('travel', travel === t.id && 'sel')} onClick={() => setTravel(t.id)}>
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
                        <Magnetic intensity={0.3}><Button icon="check" loading={busy} onClick={confirm}>Confirm booking — {fmtTime12(slot.startTime)}</Button></Magnetic>
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
