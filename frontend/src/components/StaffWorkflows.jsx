// StaffWorkflows.jsx — manual check-in lookup, live service queue with ETA and
// completion records, quick clinical notes, and volunteer/organizer walk-ins.
// All reads and writes go through api.js; Socket.io only triggers real reloads.
import React, { useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Input, Modal, Select, Skeleton } from './ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { useCampRoom } from './useCampRoom.js';

/* -------------------------------------------------------------------------- */
/* Manual lookup — mobile-friendly alternative to scanning a QR                */
/* -------------------------------------------------------------------------- */

export function ManualLookupCard({ campId, onCheckedIn }) {
  const { toast, socket } = useApp();
  const [mode, setMode] = useState('phone');
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState(null);

  async function lookup(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMatches(null);
    try {
      const res = await api.checkinLookup({
        ...(mode === 'phone' ? { phone: phone.trim() } : { token: token.trim().toUpperCase() }),
        ...(campId ? { campId: Number(campId) } : {}),
      });
      setMatches(res.matches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkIn(match) {
    setCheckingId(match.id);
    try {
      const res = await api.checkin(match.qrToken);
      toast(res.message || `${match.patientName} checked in.`, 'ok', 'Written to MySQL and broadcast to the queue.');
      setMatches((current) => current?.map((m) => m.id === match.id ? { ...m, status: 'CHECKED_IN' } : m));
      onCheckedIn?.(res);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="search" title="Manual patient lookup"
        sub="Find a confirmed patient by phone or ticket reference on a phone-sized screen." />
      <div className="lookup-tabs" role="group" aria-label="Lookup method">
        <button type="button" aria-pressed={mode === 'phone'} className={mode === 'phone' ? 'chip active' : 'chip'} onClick={() => { setMode('phone'); setMatches(null); }}>By phone</button>
        <button type="button" aria-pressed={mode === 'token'} className={mode === 'token' ? 'chip active' : 'chip'} onClick={() => { setMode('token'); setMatches(null); }}>By ticket reference</button>
      </div>
      <form className="lookup-form" onSubmit={lookup}>
        {mode === 'phone' ? (
          <Field label="Patient phone">
            <Input inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="9876543210" required pattern="[0-9]{10}" />
          </Field>
        ) : (
          <Field label="QR token or ticket number">
            <Input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} placeholder="A-042 or CHSC-BLR-…" required />
          </Field>
        )}
        <Button type="submit" icon="search" loading={busy}>Find patient</Button>
      </form>
      {error && <ErrorNote>{error}</ErrorNote>}
      {matches && matches.length === 0 && (
        <EmptyState icon="search" title="No confirmed patient found">
          Check the number or reference. Only active bookings at camps within your scope are shown.
        </EmptyState>
      )}
      {matches && matches.length > 0 && (
        <div className="lookup-results" role="list">
          {matches.map((match) => (
            <div key={match.id} role="listitem" className="lookup-row">
              <div>
                <strong>{match.patientName}</strong>
                <small className="muted">{match.campTitle} · {fmtDate(match.campDate)} · {fmtTime12(match.startTime)} · {match.phone}</small>
              </div>
              <div className="lookup-row-actions">
                <Badge status={match.status} />
                {match.status === 'CONFIRMED' && (
                  <Button size="sm" icon="check" loading={checkingId === match.id} onClick={() => checkIn(match)}>Check in</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="muted workflow-foot">Live MySQL lookup · {campJoined ? 'camp room connected' : socket?.connected ? 'joining camp room…' : 'reconnecting to realtime updates'}</p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Service queue                                                              */
/* -------------------------------------------------------------------------- */

export function ServiceQueueCard({ campId }) {
  const { toast, socket } = useApp();
  const campJoined = useCampRoom(campId);
  const queue = useFetch(() => api.serviceQueue(campId), [campId], { skip: !campId });
  const [serviceTarget, setServiceTarget] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [serviceName, setServiceName] = useState('');
  const [outcome, setOutcome] = useState('');
  const [complete, setComplete] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!socket || !campJoined) return undefined;
    const refresh = () => queue.reload();
    socket.on('service:queue:updated', refresh);
    socket.on('service:recorded', refresh);
    socket.on('note:added', refresh);
    socket.on('checkin:new', refresh);
    return () => {
      socket.off('service:queue:updated', refresh);
      socket.off('service:recorded', refresh);
      socket.off('note:added', refresh);
      socket.off('checkin:new', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, campJoined]);

  function openService(patient) {
    setServiceName(patient.services.find((s) => !s.completed)?.name || patient.services[0]?.name || 'Consultation');
    setOutcome('');
    setComplete(true);
    setServiceTarget(patient);
  }

  async function saveService(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.recordService(serviceTarget.id, { serviceName, outcome, complete });
      toast(res.message || `${serviceName} recorded.`, 'ok', 'Saved as a real service record with an audit entry.');
      setServiceTarget(null);
      await queue.reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addNote(noteTarget.id, note);
      toast('Quick note saved to this visit.', 'ok', 'Visible to assigned staff only.');
      setNote('');
      setNoteTarget(null);
      await queue.reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (!campId) {
    return <Card className="workflow-card"><CardHead icon="stetho" title="Service queue" /><EmptyState icon="stetho" title="Select a duty camp">Choose a camp from your duty roster to see its live service queue.</EmptyState></Card>;
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="stetho" title="Service queue"
        sub={queue.data ? `${queue.data.waiting} waiting · avg ${queue.data.avgServiceTimeMinutes} min per patient · ${queue.data.services.join(', ') || 'no services configured'}` : 'Live queue with derived ETAs'}
        actions={<Button size="sm" variant="ghost" icon="refresh" onClick={queue.reload}>Refresh</Button>} />
      {queue.loading ? <div className="stack"><Skeleton h={64} /><Skeleton h={64} /></div>
        : queue.error ? <ErrorNote onRetry={queue.reload}>{queue.error}</ErrorNote>
          : queue.data.patients.length === 0 ? (
            <EmptyState icon="users" title="Nobody has checked in yet">
              Check in a patient from the QR scanner or manual lookup. Their queue position and ETA appear here immediately.
            </EmptyState>
          ) : (
            <div className="service-queue" role="list">
              {queue.data.patients.map((patient) => (
                <div key={patient.id} role="listitem" className="service-row">
                  <div className="service-pos">
                    {patient.queueNumber ? <strong>#{patient.queueNumber}</strong> : <span>—</span>}
                    <small>{patient.status === 'DONE' ? 'done' : patient.status === 'NO_SHOW' ? 'absent' : 'ETA'}</small>
                  </div>
                  <div className="service-main">
                    <strong>{patient.patientName}</strong>
                    <small className="muted">Token {patient.tokenNumber} · {patient.slot} · {patient.source}</small>
                    {patient.accountHolder && <small className="muted">Family of {patient.accountHolder}</small>}
                    <div className="service-progress">
                      {(patient.services.length ? patient.services : [{ name: 'Consultation', completed: false }]).map((service) => (
                        <Badge key={service.name} tone={service.completed ? 'ok' : 'muted'}>{service.completed ? '✓ ' : ''}{service.name}</Badge>
                      ))}
                    </div>
                    {patient.notes?.length > 0 && <p className="service-note">Note: {patient.notes.join(' · ')}</p>}
                  </div>
                  <div className="service-actions">
                    <Badge status={patient.status} tone={patient.status === 'WAITING' ? 'warn' : undefined} />
                    <strong className="service-eta">{patient.status === 'WAITING' ? `~${patient.estimatedWaitMinutes} min` : '—'}</strong>
                    {patient.status === 'WAITING' && <Button size="sm" icon="check" onClick={() => openService(patient)}>Record service</Button>}
                    <Button size="sm" variant="ghost" icon="note" onClick={() => { setNote(''); setNoteTarget(patient); }}>Note</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      <p className="muted workflow-foot">Provenance: {queue.data?.provenance || 'live-mysql'} · ETA = queue position × average service time.</p>

      <Modal open={serviceTarget !== null} onClose={() => setServiceTarget(null)} title={`Record service — ${serviceTarget?.patientName || ''}`}>
        {serviceTarget && (
          <form className="stack" onSubmit={saveService}>
            <p className="muted">Token {serviceTarget.tokenNumber} · {serviceTarget.slot} · {serviceTarget.status}</p>
            <Field label="Service">
              <Select value={serviceName} onChange={(e) => setServiceName(e.target.value)} required>
                {(serviceTarget.services.length ? serviceTarget.services.map((s) => s.name) : ['Consultation']).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Outcome" hint="Clinical observation or referral — kept with this visit only.">
              <textarea className="input" rows={3} maxLength={2000} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. BP within range, advised follow-up" />
            </Field>
            <label className="pledge"><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} /><span>Mark the visit complete</span></label>
            <div className="modal-foot">
              <Button type="button" variant="ghost" onClick={() => setServiceTarget(null)}>Cancel</Button>
              <Button type="submit" icon="check" loading={busy}>Save service</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={noteTarget !== null} onClose={() => setNoteTarget(null)} title={`Quick note — ${noteTarget?.patientName || ''}`}>
        {noteTarget && (
          <form className="stack" onSubmit={saveNote}>
            <Field label="Note">
              <textarea className="input" rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short handover note for the next staff member" required />
            </Field>
            <div className="modal-foot">
              <Button type="button" variant="ghost" onClick={() => setNoteTarget(null)}>Cancel</Button>
              <Button type="submit" icon="note" loading={busy}>Save note</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Walk-in registration                                                       */
/* -------------------------------------------------------------------------- */

const EMPTY_WALKIN = { name: '', phone: '', email: '', age: '', slotId: '', joinWaitlist: false };

export function WalkinCard({ campId, onRegistered }) {
  const { toast } = useApp();
  const slots = useFetch(() => api.campSlots(campId), [campId], { skip: !campId });
  const [form, setForm] = useState(EMPTY_WALKIN);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { setForm(EMPTY_WALKIN); setResult(null); }, [campId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.walkin({
        name: form.name.trim(),
        phone: form.phone.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.age !== '' ? { age: Number(form.age) } : {}),
        slotId: Number(form.slotId),
        joinWaitlist: form.joinWaitlist,
      });
      setResult(res);
      setForm(EMPTY_WALKIN);
      toast(
        res.message
          || (res.status === 'WAITLISTED' ? 'Patient added to the FIFO waitlist.' : 'Walk-in registered.'),
        'ok',
        res.temporaryPassword ? 'A temporary password was generated for the new account.' : 'Existing patient account linked.');
      onRegistered?.();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (!campId) return null;

  const available = (slots.data?.slots || []).filter((s) => Number(s.remaining) > 0);

  return (
    <Card className="workflow-card">
      <CardHead icon="user" title="Walk-in registration" sub="Register a patient at the desk — confirmed into a free slot or held in FIFO." />
      <form className="walkin-form" onSubmit={submit}>
        <div className="walkin-grid">
          <Field label="Patient name"><Input value={form.name} minLength={2} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Phone"><Input inputMode="numeric" maxLength={10} pattern="[0-9]{10}" value={form.phone} required onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="9876543210" /></Field>
          <Field label="Email (optional)"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="patient@example.com" /></Field>
          <Field label="Age (optional)"><Input type="number" min={0} max={120} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="42" /></Field>
        </div>
        <Field label="Slot" hint={slots.loading ? 'Loading real slots…' : `${available.length} slot(s) with free seats`}>
          <Select value={form.slotId} onChange={(e) => setForm({ ...form, slotId: e.target.value })} required disabled={slots.loading}>
            <option value="">Select a slot</option>
            {(slots.data?.slots || []).map((slot) => (
              <option key={slot.id} value={slot.id} disabled={Number(slot.remaining) <= 0 && !form.joinWaitlist}>
                {fmtTime12(slot.startTime)}–{fmtTime12(slot.endTime)} · {Number(slot.remaining) > 0 ? `${slot.remaining} free` : 'full'}
              </option>
            ))}
          </Select>
        </Field>
        {slots.error && <ErrorNote onRetry={slots.reload}>{slots.error}</ErrorNote>}
        <label className="pledge"><input type="checkbox" checked={form.joinWaitlist} onChange={(e) => setForm({ ...form, joinWaitlist: e.target.checked })} /><span>Join the FIFO waitlist if the chosen slot is full</span></label>
        <Button type="submit" icon="plus" loading={busy} disabled={!form.slotId}>Register walk-in</Button>
      </form>
      {result && (
        <div className="walkin-result" role="status">
          <Badge tone={result.status === 'WAITLISTED' ? 'warn' : 'ok'}>{result.status === 'WAITLISTED' ? 'Waitlisted' : 'Confirmed'}</Badge>
          <div>
            <strong>{result.status === 'WAITLISTED' ? `FIFO position #${result.waitlistPosition ?? '—'}` : `Token ${result.booking?.tokenNumber || '—'}`}</strong>
            {result.temporaryPassword && <p className="muted">Share this one-time password with the patient: <strong className="mono">{result.temporaryPassword}</strong></p>}
          </div>
        </div>
      )}
      <p className="muted workflow-foot">The walk-in is written to MySQL with a full audit trail and a distinct account when the phone is new.</p>
    </Card>
  );
}
