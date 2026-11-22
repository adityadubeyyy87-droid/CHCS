// Manage.jsx — Biophilic Future organizer workspace with motion primitives:
// Tilt on camp cards, InView for staff matrix, Magnetic on assign button.
import React, { useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Icon, Input, Modal, Sci, Select, Skeleton } from '../components/ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { Tilt, InView, Magnetic, Spotlight } from '../components/motion';

const EMPTY_FORM = {
  title: '', descriptionEn: '', venue: '', address: '', campDate: '',
  startTime: '09:00', endTime: '13:00', slotDurationMins: 30, totalCapacity: 96, physicalCapacity: 80,
};

export default function Manage() {
  const { toast, pushGateway } = useApp();
  const camps = useFetch(() => api.camps({ scope: 'manage' }), []);
  const users = useFetch(() => api.users(), []);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [staffForm, setStaffForm] = useState({ userId: '', roleAtCamp: 'DOCTOR', shiftStart: '09:00', shiftEnd: '13:00', expectedLoadPerHour: 16, maxPatientsPerHour: 20, duties: '' });
  const [showSlotPlan, setShowSlotPlan] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeOutBusy, setCloseOutBusy] = useState(false);
  const [closeOutResult, setCloseOutResult] = useState(null);

  useEffect(() => {
    if (camps.data && !selected) setSelected(camps.data.camps[0] || null);
  }, [camps.data]);

  useEffect(() => { setCloseOutResult(null); }, [selected?.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function createCamp(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.createCamp(form);
      toast(`Camp created — ${res.slotPlan.length} slots generated automatically.`, 'ok', 'MySQL');
      setShowSlotPlan(res.slotPlan);
      setCreating(false);
      setForm(EMPTY_FORM);
      const fresh = await camps.reload();
      if (fresh?.camps) {
        setSelected(fresh.camps.find((c) => c.id === res.camp?.id) || fresh.camps[0]);
      }
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api.generateSlots(selected.id, {
        startTime: selected.startTime, endTime: selected.endTime,
        slotDurationMins: selected.slotDurationMins, totalCapacity: selected.totalCapacity,
        physicalCapacity: selected.physicalCapacity,
      });
      toast(`${res.slotPlan.length} slots regenerated from the interval partitioner.`);
      await camps.reload();
    } catch (err) { toast(err.message, 'bad', 'Camps with bookings cannot be regenerated.'); }
    finally { setBusy(false); }
  }

  async function setStatus(status) {
    try {
      await api.setCampStatus(selected.id, status);
      toast(`Camp marked ${status.toLowerCase()}.`);
      await camps.reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function closeOutCamp() {
    if (!camp) return;
    setCloseOutBusy(true);
    try {
      const res = await api.closeOut(camp.id);
      setCloseOutResult(res);
      setConfirmClose(false);
      toast(
        `Camp closed — ${res.noShowMarked} marked no-show, ${res.checkedIn} checked in.`,
        'ok',
        'Status moved to COMPLETED in MySQL.',
      );
      // Keep the closed camp selected so the result is not attributed to a different camp.
      setSelected((current) => (current ? { ...current, status: 'COMPLETED' } : null));
      await camps.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setCloseOutBusy(false); }
  }

  async function addStaff(e) {
    e.preventDefault();
    if (!staffForm.userId) { toast('Pick a person to assign.', 'warn'); return; }
    setBusy(true);
    try {
      const res = await api.assignStaff(selected.id, staffForm);
      if (res.warning) toast(res.warning.message, 'warn', 'Load Balancer');
      else toast(`${res.staff.name} assigned to ${selected.title}.`, 'ok', 'MySQL');
      pushGateway({
        channel: 'SYSTEM', type: 'STAFF', recipient: 'organizer desk',
        message: `${res.staff.name} → ${selected.title} (${res.staff.roleAtCamp})`,
        status: 'SENT', provider: 'Load Balancer',
      });
      setStaffForm({ ...staffForm, userId: '' });
      await camps.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusy(false); }
  }

  async function removeStaff(id) {
    try { await api.removeStaff(id); await camps.reload(); toast('Assignment removed.'); }
    catch (err) { toast(err.message, 'bad'); }
  }

  const camp = selected;
  const doctors = (users.data?.users || []).filter((u) => ['DOCTOR', 'VOLUNTEER', 'ORGANIZER'].includes(u.role));

  return (
    <div className="split gap-6">
      <div className="split-left stack-lg">
        <Card>
          <CardHead icon="clipboard" title="Camps" sub={`${camps.data?.camps.length || 0} total · select to configure`}
            actions={<Button size="sm" icon="plus" onClick={() => setCreating(true)}>New camp</Button>} />
          {camps.loading ? <Skeleton h={120} /> : camps.error ? <ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote> : (
            <div className="camp-rows">
              {camps.data.camps.map((c) => (
                <Tilt key={c.id} rotationFactor={6}>
                  <button className={`camp-row ${selected?.id === c.id && 'sel'}`} onClick={() => setSelected(c)}>
                    <div className="camp-date"><strong>{fmtDate(c.campDate).split(',')[1] || c.campDate}</strong><small>{fmtDate(c.campDate).split(',')[0]}</small></div>
                    <div className="camp-row-main">
                      <strong>{c.title}</strong>
                      <small className="muted">{c.venue} · {c.bookedTotal}/{c.slotCapacity} booked · {c.staffTotal} staff</small>
                    </div>
                    <Badge status={c.status} />
                  </button>
                </Tilt>
              ))}
            </div>
          )}
        </Card>

        {camp && (
          <>
            <Card>
              <CardHead icon="gear" title="Camp configuration" sub="Venue, window and slot parameters"
                actions={<Badge status={camp.status} />} />
              <div className="detail-facts">
                <div><small>Venue</small><strong>{camp.venue}</strong></div>
                <div><small>Date</small><strong>{fmtDate(camp.campDate)}</strong></div>
                <div><small>Window</small><strong>{fmtTime12(camp.startTime)}–{fmtTime12(camp.endTime)}</strong></div>
                <div><small>Slot Δt</small><strong>{camp.slotDurationMins} min</strong></div>
                <div><small>Screening seats</small><strong>{camp.physicalCapacity}</strong></div>
                <div><small>Booking capacity</small><strong>{camp.totalCapacity}</strong></div>
              </div>
              <div className="row-actions">
                <Button size="sm" variant="ghost" icon="refresh" loading={busy} onClick={regenerate}>Regenerate slots</Button>
                {camp.status === 'PUBLISHED' && (
                  <Button size="sm" variant="danger" icon="check" onClick={() => { setCloseOutResult(null); setConfirmClose(true); }}>
                    Close out camp day
                  </Button>
                )}
                {camp.status === 'DRAFT' && <Button size="sm" onClick={() => setStatus('PUBLISHED')}>Publish</Button>}
              </div>
              {closeOutResult && (
                <div className="close-out-result" role="status">
                  <Icon name="check" size={15} />
                  <span>
                    Last close-out: {closeOutResult.checkedIn} checked in · {closeOutResult.completed} completed ·{' '}
                    {closeOutResult.noShowMarked} newly marked no-show.
                  </span>
                </div>
              )}
              <Sci k="miller" as="div" className="sci-block">
                <p className="muted config-note">
                  <Icon name="flask" size={13} />
                  k = floor((T<sub>end</sub> − T<sub>start</sub>) / Δt) = <strong>{camp.slots.length}</strong> slots ·
                  base seat load {Math.floor(camp.totalCapacity / camp.slots.length)} + remainder spread earliest-first.
                  No overlaps, no partial windows.
                </p>
              </Sci>
            </Card>

            <Card>
              <CardHead icon="users" title="Staff assignment matrix" sub={`${camp.staff.length} assigned`}
                actions={camp.loadWarnings.length > 0 && <Badge status="CRITICAL">{camp.loadWarnings.length} overload</Badge>} />
              {camp.loadWarnings.length > 0 && (
                <div className="load-warnings" role="alert">
                  {camp.loadWarnings.map((w) => (
                    <div key={w.staffId} className="load-warning">
                      <Icon name="alert" />
                      <div>
                        <strong>{w.name} — {w.expected} patients/hr assigned.</strong>
                        <p className="muted">Exceeds the {w.threshold}/hr safe threshold. {w.roleAtCamp === 'DOCTOR' ? 'Add a second doctor or extend the window.' : 'Rebalance volunteer duties.'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="staff-matrix">
                {camp.staff.map((s) => (
                  <div key={s.id} className="staff-row">
                    <span className="avatar sm">{s.name[0]}</span>
                    <div>
                      <strong>{s.name}</strong>
                      <small className="muted">{s.roleAtCamp} · {s.shiftStart?.slice(0, 5)}–{s.shiftEnd?.slice(0, 5)}{s.duties ? ` · ${s.duties}` : ''}</small>
                    </div>
                    <Badge status={s.loadWarning ? 'CRITICAL' : 'PUBLISHED'} tone={s.loadWarning ? 'bad' : 'ok'}>
                      {s.expectedLoadPerHour}/{s.maxPatientsPerHour} per hr
                    </Badge>
                    <button className="icon-btn" onClick={() => removeStaff(s.id)} aria-label={`Remove ${s.name}`}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                {camp.staff.length === 0 && <EmptyState icon="users" title="No staff assigned yet" />}
              </div>
              {users.error && <ErrorNote onRetry={users.reload}>{users.error}</ErrorNote>}
              <form className="assign-form" onSubmit={addStaff}>
                <Select value={staffForm.userId} onChange={(e) => setStaffForm((f) => ({ ...f, userId: e.target.value }))} aria-label="Person">
                  <option value="">Assign a person…</option>
                  {doctors.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </Select>
                <Select value={staffForm.roleAtCamp} onChange={(e) => setStaffForm((f) => ({ ...f, roleAtCamp: e.target.value }))} aria-label="Role">
                  <option>DOCTOR</option><option>VOLUNTEER</option><option>NURSE</option><option>COORDINATOR</option>
                </Select>
                <Input type="time" value={staffForm.shiftStart} onChange={(e) => setStaffForm((f) => ({ ...f, shiftStart: e.target.value }))} aria-label="Shift start" />
                <Input type="time" value={staffForm.shiftEnd} onChange={(e) => setStaffForm((f) => ({ ...f, shiftEnd: e.target.value }))} aria-label="Shift end" />
                <Input type="number" min="0" max="80" value={staffForm.expectedLoadPerHour} onChange={(e) => setStaffForm((f) => ({ ...f, expectedLoadPerHour: e.target.value }))} aria-label="Expected patients per hour" title="Expected patients per hour" />
                <Magnetic intensity={0.4}>
                  <Button type="submit" size="sm" icon="plus" loading={busy}>Assign</Button>
                </Magnetic>
              </form>
            </Card>
          </>
        )}
      </div>

      <div className="split-right stack-lg">
        <Card className="tips-card">
          <CardHead icon="zap" title="How slot generation works" sub="Deterministic interval partitioning — no randomness" />
          <ol className="math-steps">
            <li>Window <span className="mono">[T<sub>start</sub>, T<sub>end</sub>)</span> is divided by Δt (slot minutes): <span className="mono">k = floor(ΔT / Δt)</span>.</li>
            <li>Seat base: <span className="mono">floor(C / k)</span> per slot; the remainder <span className="mono">C mod k</span> is added to the earliest slots.</li>
            <li>Each slot row carries <span className="mono">booked_count ≤ capacity</span> enforced by a CHECK constraint.</li>
            <li>Booking transactions lock the slot row — the counter can never exceed capacity.</li>
          </ol>
          {showSlotPlan && (
            <div className="slot-plan" role="table" aria-label="Generated slot plan">
              {showSlotPlan.slice(0, 8).map((s) => (
                <div key={s.slotIndex} role="row"><span>Slot {s.slotIndex}</span><span className="mono">{s.startTime}–{s.endTime}</span><span>{s.capacity} seats</span></div>
              ))}
              {showSlotPlan.length > 8 && <p className="muted">+{showSlotPlan.length - 8} more…</p>}
            </div>
          )}
        </Card>

        <Card className="tips-card">
          <CardHead icon="alert" title="Load Balancer thresholds" sub="Configurable per assignment" />
          <p className="muted">Warning at <strong>&gt;= 25 patients/shift</strong> · critical at <strong>&gt;= 30</strong> per doctor-shift.
            The banner appears the moment an assignment breaches its threshold — before camp day, not during the queue.</p>
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Create health camp" wide>
        <form onSubmit={createCamp} className="camp-form">
          <Field label="Camp name"><Input required value={form.title} onChange={set('title')} placeholder="Whitefield Community Health Camp" /></Field>
          <div className="field-row">
            <Field label="Venue"><Input required value={form.venue} onChange={set('venue')} placeholder="Community hall name" /></Field>
            <Field label="Date"><Input required type="date" value={form.campDate} onChange={set('campDate')} /></Field>
          </div>
          <Field label="Address"><Input required value={form.address} onChange={set('address')} placeholder="Street, area, Bengaluru — PIN" /></Field>
          <Field label="Description"><Input value={form.descriptionEn} onChange={set('descriptionEn')} placeholder="Free BP, sugar, BMI and vision screening" /></Field>
          <div className="field-row four">
            <Field label="Start"><Input required type="time" value={form.startTime} onChange={set('startTime')} /></Field>
            <Field label="End"><Input required type="time" value={form.endTime} onChange={set('endTime')} /></Field>
            <Field label="Slot minutes"><Input type="number" min="5" max="120" value={form.slotDurationMins} onChange={set('slotDurationMins')} /></Field>
            <Field label="Total booking capacity"><Input type="number" min="1" value={form.totalCapacity} onChange={set('totalCapacity')} /></Field>
          </div>
          <Field label="Physical screening seats" hint="True clinical capacity. Booking capacity may exceed it — the Capacity Advisor governs that gap.">
            <Input type="number" min="1" value={form.physicalCapacity} onChange={set('physicalCapacity')} />
          </Field>
          <div className="modal-foot">
            <Button variant="ghost" type="button" onClick={() => setCreating(false)}>Cancel</Button>
            <Magnetic intensity={0.4}>
              <Button type="submit" icon="plus" loading={busy}>Create & auto-generate slots</Button>
            </Magnetic>
          </div>
        </form>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title="Close out camp day">
        {camp && (
          <>
            <p>
              Close <strong>{camp.title}</strong>? Every confirmed booking that has not checked in will be marked{' '}
              <strong>NO_SHOW</strong> and the camp will move to <strong>COMPLETED</strong>. This is a real backend transaction.
            </p>
            <div className="modal-foot">
              <Button variant="ghost" onClick={() => setConfirmClose(false)}>Keep camp open</Button>
              <Magnetic intensity={0.4}>
                <Button variant="danger" icon="check" loading={closeOutBusy} onClick={closeOutCamp}>
                  Close out and mark no-shows
                </Button>
              </Magnetic>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
