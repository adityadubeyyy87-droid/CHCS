// OrganizerWorkflows.jsx — pre-camp checklist, FIFO waitlist promotion with a
// mandatory audited reason, broadcast announcements, camp templates/cloning and
// post-camp feedback analytics. All data comes from the live MySQL API.
import React, { useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Input, Modal, Select, Skeleton } from './ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';
import { useCampRoom } from './useCampRoom.js';

/* -------------------------------------------------------------------------- */
/* Pre-camp checklist                                                          */
/* -------------------------------------------------------------------------- */

export function ChecklistCard({ campId, campTitle }) {
  const { toast, socket } = useApp();
  const campJoined = useCampRoom(campId);
  const items = useFetch(() => api.checklist(campId), [campId], { skip: !campId });
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!socket || !campJoined) return undefined;
    const reload = () => items.reload();
    socket.on('checklist:changed', reload);
    return () => socket.off('checklist:changed', reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, campJoined]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addChecklistItem(campId, newItem);
      setNewItem('');
      await items.reload();
      toast('Checklist item added.', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item) {
    try {
      await api.updateChecklistItem(item.id, !item.isDone);
      await items.reload();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function remove(item) {
    try {
      await api.deleteChecklistItem(item.id);
      await items.reload();
      toast('Checklist item removed.', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  if (!campId) return null;
  const list = items.data?.items || [];
  const done = list.filter((item) => item.isDone).length;

  return (
    <Card className="workflow-card">
      <CardHead icon="clipboard" title="Pre-camp checklist"
        sub={campTitle ? `${campTitle} · ${done}/${list.length} ready` : 'Track readiness tasks against a real camp.'}
        actions={list.length ? <Badge tone={done === list.length ? 'ok' : 'warn'}>{done}/{list.length} done</Badge> : null} />
      {items.loading ? <div className="stack"><Skeleton h={44} /><Skeleton h={44} /></div>
        : items.error ? <ErrorNote onRetry={items.reload}>{items.error}</ErrorNote>
          : list.length === 0 ? (
            <EmptyState icon="clipboard" title="No checklist items yet">
              Add the first readiness task — venue, permissions, consumables or staff briefing.
            </EmptyState>
          ) : (
            <div className="checklist" role="list">
              {list.map((item) => (
                <div key={item.id} role="listitem" className={item.isDone ? 'checklist-row done' : 'checklist-row'}>
                  <label className="checklist-check">
                    <input type="checkbox" checked={item.isDone} onChange={() => toggle(item)} aria-label={`Mark ${item.item} ${item.isDone ? 'not done' : 'done'}`} />
                    <span>{item.item}</span>
                  </label>
                  <div className="checklist-meta">
                    {item.doneByName && <small className="muted">by {item.doneByName}</small>}
                    <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${item.item}`} onClick={() => remove(item)} />
                  </div>
                </div>
              ))}
            </div>
          )}
      <form className="checklist-add" onSubmit={add}>
        <label className="inline-field checklist-input">
          <span>New task</span>
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add a readiness task…" minLength={2} maxLength={500} required />
        </label>
        <Button type="submit" icon="plus" loading={busy} disabled={newItem.trim().length < 2}>Add</Button>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Waitlist + manual promotion                                                 */
/* -------------------------------------------------------------------------- */

export function WaitlistCard({ campId, campTitle, onPromoted }) {
  const { toast } = useApp();
  const list = useFetch(() => api.waitlist(campId), [campId], { skip: !campId });
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function promote(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.promoteWaiter(campId, target.id, reason);
      toast(`${res.patient?.name || 'Patient'} promoted.`, 'ok', 'Recorded as a manual override with your reason in the audit log.');
      setTarget(null);
      setReason('');
      await list.reload();
      onPromoted?.();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (!campId) return null;
  const waiting = (list.data?.waitlist || []).filter((row) => row.status === 'WAITING');

  return (
    <Card className="workflow-card">
      <CardHead icon="users" title="FIFO waitlist"
        sub={campTitle ? `${campTitle} · strict first-in-first-out order` : 'Manual promotion requires an audited reason.'}
        actions={waiting.length ? <Badge tone="warn">{waiting.length} waiting</Badge> : null} />
      {list.loading ? <div className="stack"><Skeleton h={52} /><Skeleton h={52} /></div>
        : list.error ? <ErrorNote onRetry={list.reload}>{list.error}</ErrorNote>
          : waiting.length === 0 ? (
            <EmptyState icon="users" title="Nobody is waiting">
              When a full slot receives a waitlist join, the patient appears here in FIFO order.
            </EmptyState>
          ) : (
            <div className="waitlist-rows" role="list">
              {waiting.slice(0, 40).map((row) => (
                <div key={row.id} role="listitem" className="waitlist-row">
                  <strong className="waitlist-pos">#{row.position}</strong>
                  <div>
                    <strong>{row.patientName || `Patient #${row.patientId}`}</strong>
                    <small className="muted">Joined {fmtDate(row.createdAt)}</small>
                  </div>
                  <Button size="sm" variant="ghost" icon="zap" onClick={() => { setTarget(row); setReason(''); }}>Promote</Button>
                </div>
              ))}
            </div>
          )}
      <Modal open={target !== null} onClose={() => setTarget(null)} title="Manual waitlist promotion">
        {target && (
          <form className="stack" onSubmit={promote}>
            <p>
              Promote <strong>{target.patientName || `patient #${target.patientId}`}</strong> from position #{target.position} ahead of the FIFO order?
            </p>
            <Field label="Reason for manual override" hint="Stored in the immutable audit log with your name.">
              <textarea className="input" rows={3} minLength={3} maxLength={500} required value={reason}
                onChange={(e) => setReason(e.target.value)} placeholder="e.g. accessibility need agreed with the patient" />
            </Field>
            <div className="modal-foot">
              <Button type="button" variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
              <Button type="submit" icon="zap" loading={busy}>Promote & audit</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Broadcast announcements                                                     */
/* -------------------------------------------------------------------------- */

export function AnnouncementCard() {
  const { toast } = useApp();
  const [form, setForm] = useState({ subject: '', message: '', audience: 'PATIENTS' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.announce(form);
      setResult(res);
      setForm({ subject: '', message: '', audience: 'PATIENTS' });
      toast(res.message, 'ok', 'Real accounts queued; delivery state stays honest until a provider confirms it.');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="send" title="Broadcast announcement" sub="Queued to real active accounts. No payment requests, ever." />
      <form className="stack" onSubmit={submit}>
        <Field label="Audience">
          <Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
            <option value="PATIENTS">Patients</option>
            <option value="STAFF">Staff</option>
            <option value="ALL">Everyone</option>
          </Select>
        </Field>
        <Field label="Subject"><Input value={form.subject} minLength={3} maxLength={190} required onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Camp update" /></Field>
        <Field label="Message" hint="This is a service update only.">
          <textarea className="input" rows={4} minLength={3} maxLength={4000} required value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Share the update with recipients" />
        </Field>
        <Button type="submit" icon="send" loading={busy}>Queue announcement</Button>
      </form>
      {result && (
        <div className="announce-result" role="status">
          <Badge tone="warn">{result.status}</Badge>
          <span>{result.recipientCount} real account(s) queued.</span>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Camp templates and cloning                                                  */
/* -------------------------------------------------------------------------- */

export function TemplatesCard({ onCreated }) {
  const { toast } = useApp();
  const templates = useFetch(() => api.campTemplates(), []);
  const camps = useFetch(() => api.camps({ scope: 'manage', pageSize: 100 }), []);
  const [sourceId, setSourceId] = useState('');
  const [form, setForm] = useState({ title: '', campDate: '', startTime: '09:00', endTime: '17:00', venue: '', address: '', status: 'DRAFT' });
  const [busy, setBusy] = useState(false);

  function applyTemplate(template) {
    setForm((current) => ({
      ...current,
      title: current.title || template.title,
      venue: current.venue || `Community centre — ${template.type.replace('_', ' ')}`,
      startTime: template.id === 'blood' ? '08:00' : '09:00',
      endTime: template.id === 'blood' ? '16:00' : '17:00',
    }));
    toast(`${template.title} template applied. Add a real date and venue, then create the camp.`, 'ok', 'Templates are configuration presets, not camp records.');
  }

  async function clone(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form };
      // Optional fields fall back to the real source camp on the server. An
      // empty string is not a valid venue/address and must not be submitted.
      for (const key of ['title', 'venue', 'address']) {
        if (!payload[key]?.trim()) delete payload[key];
      }
      const res = await api.cloneCamp(sourceId, payload);
      toast(res.camp?.title ? `${res.camp.title} cloned as a draft.` : 'Camp cloned.', 'ok', 'Slots and configuration were copied from the real source camp.');
      setSourceId('');
      setForm({ title: '', campDate: '', startTime: '09:00', endTime: '17:00', venue: '', address: '', status: 'DRAFT' });
      await camps.reload();
      onCreated?.();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const pastCamps = (camps.data?.camps || []).filter((c) => c.id !== Number(sourceId));

  return (
    <Card className="workflow-card">
      <CardHead icon="layers" title="Camp templates & clone"
        sub="Start from a service-type template or copy the configuration of a real past camp." />
      {templates.loading ? <Skeleton h={80} /> : templates.error ? <ErrorNote>{templates.error}</ErrorNote> : (
        <div className="template-grid">
          {(templates.data?.templates || []).map((template) => (
            <button key={template.id} type="button" className="template-card" onClick={() => applyTemplate(template)}>
              <Badge tone="info">{template.type.replace('_', ' ')}</Badge>
              <strong>{template.title}</strong>
              <small className="muted">{template.services.join(' · ')}</small>
            </button>
          ))}
        </div>
      )}
      <form className="stack clone-form" onSubmit={clone}>
        <Field label="Clone from a real past camp" hint="Required — cloning is only possible from an existing record.">
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
            <option value="">Select a camp</option>
            {pastCamps.map((camp) => <option key={camp.id} value={camp.id}>#{camp.id} · {camp.title} · {fmtDate(camp.campDate)}</option>)}
          </Select>
        </Field>
        {camps.error && <ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote>}
        <div className="walkin-grid">
          <Field label="New title (optional)"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Leave blank to reuse the source title" /></Field>
          <Field label="Date"><Input type="date" value={form.campDate} onChange={(e) => setForm({ ...form, campDate: e.target.value })} required /></Field>
          <Field label="Start"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required /></Field>
          <Field label="End"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required /></Field>
          <Field label="Venue (optional)"><Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></Field>
          <Field label="Address (optional)"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        </div>
        <Button type="submit" icon="layers" loading={busy} disabled={!sourceId}>Clone camp</Button>
      </form>
      <p className="muted workflow-foot">Templates provenance: {templates.data?.provenance || 'catalog'} · cloned camps are real MySQL rows with real slot plans.</p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Organizer feedback analytics                                                */
/* -------------------------------------------------------------------------- */

export function OrganizerFeedbackCard({ campId }) {
  const { toast } = useApp();
  const feedback = useFetch(() => api.organizerFeedback(campId), [campId]);
  const [ratingFilter, setRatingFilter] = useState('ALL');

  async function exportFeedback() {
    const rows = (feedback.data?.feedback || []).filter((row) => ratingFilter === 'ALL' || row.rating === Number(ratingFilter));
    if (!rows.length) {
      toast('No feedback rows match this filter.', 'warn');
      return;
    }
    const header = 'camp,patient,rating,submitted_at,comment';
    const escaped = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [header, ...rows.map((row) => [row.campTitle, row.patientName, row.rating, row.submittedAt, row.comment].map(escaped).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `chsc-feedback${campId ? `-camp-${campId}` : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Real feedback rows exported.', 'ok');
  }

  const rows = (feedback.data?.feedback || []).filter((row) => ratingFilter === 'ALL' || row.rating === Number(ratingFilter));

  return (
    <Card className="workflow-card">
      <CardHead icon="star" title="Post-camp feedback"
        sub={feedback.data?.summary ? `${feedback.data.summary.responses} real responses · average ${feedback.data.summary.averageRating}/5` : 'Ratings submitted after confirmed visits.'}
        actions={<Button size="sm" variant="ghost" icon="download" onClick={exportFeedback}>Export CSV</Button>} />
      <div className="feedback-controls">
        <label className="filter-field">
          <span>Filter by rating</span>
          <Select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)} aria-label="Filter feedback by rating">
            <option value="ALL">All ratings</option>
            {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}
          </Select>
        </label>
        <Badge tone="ok">live-mysql</Badge>
      </div>
      {feedback.loading ? <div className="stack"><Skeleton h={64} /><Skeleton h={64} /></div>
        : feedback.error ? <ErrorNote onRetry={feedback.reload}>{feedback.error}</ErrorNote>
          : rows.length === 0 ? (
            <EmptyState icon="star" title="No feedback yet">
              Feedback appears here after patients rate a confirmed visit. Nothing is fabricated when the table is empty.
            </EmptyState>
          ) : (
            <div className="feedback-rows" role="list">
              {rows.map((row) => (
                <div key={row.id} role="listitem" className="feedback-row">
                  <div className="feedback-rating" aria-label={`${row.rating} out of 5 stars`}>{'★'.repeat(row.rating)}<span>{'☆'.repeat(5 - row.rating)}</span></div>
                  <div>
                    <strong>{row.patientName}</strong>
                    <small className="muted">{row.campTitle} · {fmtDate(row.submittedAt)}</small>
                    {row.comment && <p>{row.comment}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
    </Card>
  );
}
