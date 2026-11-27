// PatientWorkflows.jsx — family dependents, pre-screening, feedback and
// downloadable appointment cards. Every value here comes from the live API.
import React, { useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Input, Modal, Select, Skeleton } from './ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { appointmentCardSvg, downloadSvg } from '../lib/appointmentCard.js';

export const AGE_GROUPS = ['18-29', '30-45', '46-60', '60+'];
export const CONDITIONS = ['diabetes', 'hypertension', 'heart disease', 'none'];
export const LANGUAGES = ['English', 'Kannada', 'Hindi'];
export const RELATIONSHIPS = ['Parent', 'Spouse', 'Child', 'Sibling', 'Grandparent', 'Other'];

export const EMPTY_PRESCREENING = {
  ageGroup: '18-29',
  conditions: ['none'],
  mobilityNeeds: false,
  preferredLanguage: 'English',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

const toRow = (row) => ({
  id: row?.id,
  name: row?.name || '',
  age: row?.age ?? '',
  relationship: row?.relationship || 'Other',
  createdAt: row?.createdAt,
});

/* -------------------------------------------------------------------------- */
/* Pre-screening fields — shared by the booking flow and the appointments page */
/* -------------------------------------------------------------------------- */

export function PreScreeningFields({ value, onChange, idPrefix = 'pre' }) {
  const p = value || EMPTY_PRESCREENING;
  const set = (patch) => onChange({ ...p, ...patch });
  const toggleCondition = (condition) => {
    if (condition === 'none') {
      set({ conditions: p.conditions.includes('none') ? [] : ['none'] });
      return;
    }
    const withoutNone = p.conditions.filter((c) => c !== 'none');
    set({
      conditions: withoutNone.includes(condition)
        ? withoutNone.filter((c) => c !== condition)
        : [...withoutNone, condition],
    });
  };

  return (
    <div className="prescreen-fields">
      <div className="prescreen-grid">
        <Field label="Age group">
          <Select id={`${idPrefix}-age`} value={p.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })}>
            {AGE_GROUPS.map((age) => <option key={age} value={age}>{age} years</option>)}
          </Select>
        </Field>
        <Field label="Preferred language">
          <Select id={`${idPrefix}-language`} value={p.preferredLanguage} onChange={(e) => set({ preferredLanguage: e.target.value })}>
            {LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
          </Select>
        </Field>
      </div>
      <fieldset className="prescreen-fieldset">
        <legend>Do you have any of these conditions?</legend>
        <div className="condition-grid">
          {CONDITIONS.map((condition) => (
            <label key={condition} className="condition-option">
              <input
                type="checkbox"
                checked={p.conditions.includes(condition)}
                onChange={() => toggleCondition(condition)}
              />
              <span>{condition === 'none' ? 'None' : condition.replace(/^\w/, (c) => c.toUpperCase())}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="pledge">
        <input type="checkbox" checked={p.mobilityNeeds} onChange={(e) => set({ mobilityNeeds: e.target.checked })} />
        <span>I need mobility assistance at the camp.</span>
      </label>
      <div className="prescreen-grid">
        <Field label="Emergency contact name">
          <Input id={`${idPrefix}-contact`} value={p.emergencyContactName} placeholder="Full name"
            onChange={(e) => set({ emergencyContactName: e.target.value })} />
        </Field>
        <Field label="Emergency contact phone" hint="10-digit Indian mobile number">
          <Input id={`${idPrefix}-phone`} inputMode="numeric" maxLength={10} value={p.emergencyContactPhone}
            placeholder="9876543210" onChange={(e) => set({ emergencyContactPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
        </Field>
      </div>
    </div>
  );
}

export function prescreeningComplete(p) {
  return Boolean(p && p.ageGroup && p.conditions.length && p.preferredLanguage
    && p.emergencyContactName.trim().length >= 2 && /^\d{10}$/.test(p.emergencyContactPhone));
}

/* -------------------------------------------------------------------------- */
/* Family members                                                              */
/* -------------------------------------------------------------------------- */

export function FamilyMembersCard({ compact = false, onSelect, selectedId }) {
  const { toast } = useApp();
  const members = useFetch(() => api.familyMembers(), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', age: '', relationship: 'Parent' });

  async function addMember(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addFamilyMember({
        name: form.name.trim(),
        age: Number(form.age),
        relationship: form.relationship,
      });
      setForm({ name: '', age: '', relationship: 'Parent' });
      setOpen(false);
      toast('Family member saved. You can now book a pass for them.', 'ok', 'Stored in MySQL under your account.');
      await members.reload();
    } catch (error) {
      toast(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member) {
    try {
      await api.deleteFamilyMember(member.id);
      toast(`${member.name} removed.`, 'ok');
      await members.reload();
    } catch (error) {
      toast(error.message, 'bad');
    }
  }

  const list = members.data?.members || [];

  return (
    <Card className={compact ? 'workflow-card compact' : 'workflow-card'}>
      <CardHead icon="users" title="Family & dependents"
        sub="Each dependent gets their own QR pass under your booking."
        actions={<Button size="sm" icon="plus" onClick={() => setOpen(true)}>Add member</Button>} />
      {members.loading ? <div className="stack"><Skeleton h={64} /><Skeleton h={64} /></div>
        : members.error ? <ErrorNote onRetry={members.reload}>{members.error}</ErrorNote>
          : list.length === 0 ? (
            <EmptyState icon="users" title="No family members yet">
              Add a parent, spouse, child or other dependent to book a screening pass on their behalf.
            </EmptyState>
          ) : (
            <div className="family-list" role="list">
              {list.map((member) => {
                const row = toRow(member);
                const selected = selectedId === row.id;
                return (
                  <div key={row.id} role="listitem" className={selected ? 'family-row selected' : 'family-row'}>
                    {onSelect ? (
                      <button type="button" className="family-select" onClick={() => onSelect(selected ? null : row.id)}
                        aria-pressed={selected}>
                        <strong>{row.name}</strong>
                        <small className="muted">{row.relationship} · {row.age} yrs</small>
                      </button>
                    ) : (
                      <div><strong>{row.name}</strong><small className="muted"> {row.relationship} · {row.age} yrs</small></div>
                    )}
                    <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${row.name}`} onClick={() => removeMember(row)}>Remove</Button>
                  </div>
                );
              })}
            </div>
          )}
      {!compact && <p className="muted workflow-foot">Provenance: {members.data?.provenance || 'live-mysql'} · stored against your account, never shared with other patients.</p>}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a family member">
        <form className="stack" onSubmit={addMember}>
          <Field label="Full name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Anita Rao" required minLength={2} maxLength={100} />
          </Field>
          <div className="prescreen-grid">
            <Field label="Age">
              <Input type="number" min={0} max={120} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="42" required />
            </Field>
            <Field label="Relationship">
              <Select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
                {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
              </Select>
            </Field>
          </div>
          <div className="modal-foot">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Save member</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Pre-screening for an existing booking                                       */
/* -------------------------------------------------------------------------- */

export function PreScreeningCard({ booking, onSaved }) {
  const { toast } = useApp();
  const state = useFetch(() => api.prescreening(booking.id), [booking.id]);
  const [form, setForm] = useState(EMPTY_PRESCREENING);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    const saved = state.data?.prescreening;
    if (saved) setForm({
      ageGroup: saved.ageGroup || '18-29',
      conditions: saved.conditions?.length ? saved.conditions : ['none'],
      mobilityNeeds: Boolean(saved.mobilityNeeds),
      preferredLanguage: saved.preferredLanguage || 'English',
      emergencyContactName: saved.emergencyContactName || '',
      emergencyContactPhone: saved.emergencyContactPhone || '',
    });
  }, [state.data]);

  async function save(e) {
    e.preventDefault();
    if (!prescreeningComplete(form)) {
      toast('Add an emergency contact name and a valid 10-digit phone number.', 'warn');
      return;
    }
    setBusy(true);
    try {
      await api.savePrescreening(booking.id, form);
      toast('Pre-screening saved for this visit.', 'ok', 'Written to MySQL with an audit entry.');
      await state.reload();
      onSaved?.();
    } catch (error) {
      toast(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="clipboard" title="Pre-screening"
        sub="Share the details the screening team needs before your visit."
        actions={state.data?.prescreening ? <Badge tone="ok">Submitted</Badge> : <Badge tone="warn">Pending</Badge>} />
      {state.loading ? <Skeleton h={220} /> : state.error ? <ErrorNote onRetry={state.reload}>{state.error}</ErrorNote> : (
        <form className="stack" onSubmit={save}>
          <PreScreeningFields value={form} onChange={setForm} idPrefix={`pre-${booking.id}`} />
          <div className="row-actions">
            <Button type="submit" loading={busy} icon="check">Save pre-screening</Button>
            <small className="muted">Your answers are visible only to the assigned camp team.</small>
          </div>
        </form>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Post-camp feedback                                                          */
/* -------------------------------------------------------------------------- */

export function FeedbackButton({ booking, onSubmitted }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (booking.feedback?.rating) {
    return <Badge tone="info">Feedback {booking.feedback.rating}/5</Badge>;
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.submitFeedback(booking.id, { rating, comment });
      toast('Thank you — your feedback helps the next camp.', 'ok', 'Recorded against this real visit.');
      setOpen(false);
      onSubmitted?.();
    } catch (error) {
      toast(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" icon="star" onClick={() => setOpen(true)}>Give feedback</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`How was ${booking.campTitle}?`}>
        <form className="stack" onSubmit={submit}>
          <p className="muted">{fmtDate(booking.campDate)} · {fmtTime12(booking.startTime)} · token {booking.tokenNumber}</p>
          <fieldset className="rating-fieldset">
            <legend>Your rating</legend>
            <div className="rating-row" role="group" aria-label="Rating from 1 to 5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" aria-pressed={rating === value}
                  className={value <= rating ? 'rating-star selected' : 'rating-star'}
                  onClick={() => setRating(value)} aria-label={`${value} star${value === 1 ? '' : 's'}`}>
                  ★
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="What worked well? (optional)">
            <textarea className="input" rows={4} maxLength={2000} value={comment}
              onChange={(e) => setComment(e.target.value)} placeholder="Tell the organisers about your experience" />
          </Field>
          <div className="modal-foot">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
            <Button type="submit" loading={busy}>Submit feedback</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Downloadable appointment card                                               */
/* -------------------------------------------------------------------------- */

export function AppointmentCardButton({ booking, size = 'sm' }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);

  async function download() {
    if (!booking.qrPayload || !booking.tokenNumber) {
      toast('A confirmed pass with a QR token is required.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const svg = await appointmentCardSvg(booking);
      downloadSvg(svg, `chsc-pass-${booking.tokenNumber || booking.id}.svg`);
      toast('Appointment card downloaded.', 'ok', 'Generated locally from your live booking — no external image service.');
    } catch (error) {
      toast(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return <Button size={size} variant="ghost" icon="download" loading={busy} onClick={download}>Pass card</Button>;
}
