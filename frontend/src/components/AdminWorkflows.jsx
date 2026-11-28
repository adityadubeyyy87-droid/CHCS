// AdminWorkflows.jsx — approval queue, organisation settings and full account
// administration. Every row is a real MySQL record; every write is audited.
import React, { useCallback, useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Icon, Input, Modal, Select, Skeleton } from './ui.jsx';
import { fmtDate, fmtTime12 } from '../lib/format.js';

const ROLES = ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'];
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'kn', label: 'Kannada' },
  { code: 'hi', label: 'Hindi' },
];

/* -------------------------------------------------------------------------- */
/* Camp approvals                                                              */
/* -------------------------------------------------------------------------- */

export function ApprovalsCard() {
  const { user, toast, socket } = useApp();
  const approvals = useFetch(() => api.approvals(), []);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!socket) return undefined;
    const reload = () => approvals.reload();
    socket.on('camp:approved', reload);
    socket.on('camp:rejected', reload);
    socket.on('camp:updated', reload);
    return () => {
      socket.off('camp:approved', reload);
      socket.off('camp:rejected', reload);
      socket.off('camp:updated', reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  async function approve(camp) {
    setBusyId(camp.id);
    try {
      const res = await api.approveCamp(camp.id);
      toast(`${camp.title} approved and published.`, 'ok', 'Audit entry records the approving admin.');
      await approvals.reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(e) {
    e.preventDefault();
    setBusyId(rejecting.id);
    try {
      await api.rejectCamp(rejecting.id, reason);
      toast(`${rejecting.title} returned to the organizer.`, 'warn', 'Reason stored in the audit log.');
      setRejecting(null);
      setReason('');
      await approvals.reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="shield" title="Camp approvals"
        sub={isAdmin ? 'Camps waiting for admin approval before publication.' : 'Your camps waiting for approval.'}
        actions={(approvals.data?.camps?.length || 0) > 0 ? <Badge tone="warn">{approvals.data.camps.length} pending</Badge> : null} />
      {approvals.loading ? <div className="stack"><Skeleton h={64} /><Skeleton h={64} /></div>
        : approvals.error ? <ErrorNote onRetry={approvals.reload}>{approvals.error}</ErrorNote>
          : (approvals.data?.camps?.length || 0) === 0 ? (
            <EmptyState icon="shield" title="Nothing awaiting approval">
              New camps appear here automatically when approval is required. No placeholder rows are shown.
            </EmptyState>
          ) : (
            <div className="approval-rows" role="list">
              {approvals.data.camps.map((camp) => (
                <div key={camp.id} role="listitem" className="approval-row">
                  <div>
                    <strong>{camp.title}</strong>
                    <small className="muted">{fmtDate(camp.campDate)} · {fmtTime12(camp.startTime)} · {camp.venue}</small>
                    {camp.rejectionReason && <p className="muted approval-reason">Reason: {camp.rejectionReason}</p>}
                    <div className="approval-meta"><Badge status={camp.status} /><Badge status={camp.approvalStatus}>{camp.approvalStatus}</Badge></div>
                  </div>
                  {isAdmin ? (
                    <div className="row-actions">
                      <Button size="sm" icon="check" loading={busyId === camp.id} onClick={() => approve(camp)}>Approve</Button>
                      <Button size="sm" variant="ghost" icon="x" onClick={() => { setRejecting(camp); setReason(''); }}>Reject</Button>
                    </div>
                  ) : <Badge tone="info">Awaiting admin</Badge>}
                </div>
              ))}
            </div>
          )}
      <Modal open={rejecting !== null} onClose={() => setRejecting(null)} title="Return camp for changes">
        {rejecting && (
          <form className="stack" onSubmit={reject}>
            <p><strong>{rejecting.title}</strong> will stay a draft until the organizer resubmits it.</p>
            <Field label="Reason" hint="Shown to the organizer and stored in the audit log.">
              <textarea className="input" rows={3} minLength={3} maxLength={1000} required value={reason}
                onChange={(e) => setReason(e.target.value)} placeholder="What needs to change?" />
            </Field>
            <div className="modal-foot">
              <Button type="button" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button type="submit" variant="danger" loading={busyId === rejecting.id}>Reject camp</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Organisation settings                                                       */
/* -------------------------------------------------------------------------- */

export function OrgSettingsCard() {
  const { toast } = useApp();
  const settings = useFetch(() => api.orgSettings(), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) setForm({
      organizationName: settings.data.organizationName || '',
      logoUrl: settings.data.logoUrl || '',
      contactEmail: settings.data.contactEmail || '',
      defaultSlotDuration: Number(settings.data.defaultSlotDuration || 30),
      bookingHoldMinutes: Number(settings.data.bookingHoldMinutes || 10),
      requireCampApproval: Boolean(settings.data.requireCampApproval),
      supportedLanguages: settings.data.supportedLanguages?.length ? settings.data.supportedLanguages : ['en'],
      emailProviderMode: settings.data.emailProviderMode || 'SANDBOX',
    });
  }, [settings.data]);

  function toggleLanguage(code) {
    setForm((current) => ({
      ...current,
      supportedLanguages: current.supportedLanguages.includes(code)
        ? current.supportedLanguages.filter((language) => language !== code)
        : [...current.supportedLanguages, code],
    }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateOrgSettings(form);
      toast('Organisation settings saved.', 'ok', 'Audit entry records the previous values.');
      await settings.reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="gear" title="Organisation settings"
        sub="Branding, booking hold, approval policy and honest provider modes."
        actions={<Badge tone="ok">live-mysql</Badge>} />
      {settings.loading ? <Skeleton h={280} /> : settings.error ? <ErrorNote onRetry={settings.reload}>{settings.error}</ErrorNote>
        : !form ? <EmptyState icon="gear" title="Settings unavailable" /> : (
          <form className="stack" onSubmit={save}>
            <Field label="Organisation name"><Input value={form.organizationName} minLength={2} maxLength={120} required onChange={(e) => setForm({ ...form, organizationName: e.target.value })} /></Field>
            <div className="walkin-grid">
              <Field label="Contact email"><Input type="email" value={form.contactEmail} required onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
              <Field label="Logo URL (optional)"><Input value={form.logoUrl} maxLength={500} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…" /></Field>
              <Field label="Default slot minutes"><Input type="number" min={5} max={720} value={form.defaultSlotDuration} required onChange={(e) => setForm({ ...form, defaultSlotDuration: Number(e.target.value) })} /></Field>
              <Field label="Booking hold minutes"><Input type="number" min={1} max={120} value={form.bookingHoldMinutes} required onChange={(e) => setForm({ ...form, bookingHoldMinutes: Number(e.target.value) })} /></Field>
            </div>
            <fieldset className="prescreen-fieldset">
              <legend>Supported languages</legend>
              <div className="condition-grid">
                {LANGUAGES.map(({ code, label }) => (
                  <label key={code} className="condition-option">
                    <input type="checkbox" checked={form.supportedLanguages.includes(code)} onChange={() => toggleLanguage(code)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="pledge"><input type="checkbox" checked={form.requireCampApproval} onChange={(e) => setForm({ ...form, requireCampApproval: e.target.checked })} /><span>Require admin approval before a camp can be published</span></label>
            <div className="walkin-grid">
              <Field label="Email delivery mode" hint={settings.data?.emailApiKeyConfigured ? 'SMTP credentials are configured on the server.' : 'No SMTP credentials — Sandbox is honest.'}>
                <Select value={form.emailProviderMode} onChange={(e) => setForm({ ...form, emailProviderMode: e.target.value })}>
                  <option value="SANDBOX">Sandbox</option>
                  <option value="LIVE">Live SMTP (requires credentials)</option>
                </Select>
              </Field>
            </div>
            <Button type="submit" icon="check" loading={busy}>Save settings</Button>
          </form>
        )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Full user administration                                                    */
/* -------------------------------------------------------------------------- */

const EMPTY_NEW_USER = { name: '', email: '', phone: '', role: 'PATIENT' };

export function UserAdminCard() {
  const { user, toast, socket } = useApp();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [resetResult, setResetResult] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.users({ q: query, page, pageSize: 20 });
      setRows(res.users || []);
      setPagination(res.pagination || null);
    } catch (err) {
      setError(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('admin:users-changed', load);
    return () => socket.off('admin:users-changed', load);
  }, [socket, load]);

  async function changeRole(target, role) {
    setBusyId(target.id);
    try {
      await api.setRole(target.id, role);
      toast(`${target.name} is now ${role}.`, 'ok', 'Live role reload from MySQL on the next request.');
      await load();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusyId(null); }
  }

  async function toggleStatus(target) {
    setBusyId(target.id);
    try {
      await api.setUserStatus(target.id, !target.isActive);
      toast(`${target.name} ${target.isActive ? 'deactivated' : 'reactivated'}.`, target.isActive ? 'warn' : 'ok');
      await load();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusyId(null); }
  }

  async function create(e) {
    e.preventDefault();
    setBusyId('create');
    try {
      const res = await api.createUser(newUser);
      toast(`${res.user?.name || 'Account'} created.`, 'ok', res.temporaryPassword ? 'Share the one-time password securely.' : 'Account is ready.');
      setResetResult({ name: res.user?.name, temporaryPassword: res.temporaryPassword });
      setCreating(false);
      setNewUser(EMPTY_NEW_USER);
      await load();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusyId(null); }
  }

  async function resetPassword(target) {
    setBusyId(target.id);
    try {
      const res = await api.resetUserPassword(target.id);
      setResetResult({ name: target.name, temporaryPassword: res.temporaryPassword });
      toast(`New one-time password generated for ${target.name}.`, 'ok', 'Previous password no longer works.');
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusyId(null); }
  }

  async function remove() {
    setBusyId(deleteTarget.id);
    try {
      await api.deleteUser(deleteTarget.id);
      toast(`${deleteTarget.name} deleted.`, 'ok', 'Removal recorded in the audit log.');
      setDeleteTarget(null);
      await load();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusyId(null); }
  }

  return (
    <Card className="workflow-card">
      <CardHead icon="users" title="User & role management"
        sub={`${pagination?.total ?? 0} accounts · ADMIN only`}
        actions={<div className="row-actions">
          <label className="inline-field"><span>Search accounts</span><Input type="search" placeholder="Search name, email, phone" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <Button size="sm" icon="plus" onClick={() => setCreating(true)}>Create user</Button>
        </div>} />
      {resetResult && (
        <div className="credential-result" role="status">
          <Badge tone="warn">One-time password</Badge>
          <span><strong>{resetResult.name}</strong> · <strong className="mono">{resetResult.temporaryPassword || 'Existing password unchanged'}</strong></span>
          <Button size="sm" variant="ghost" onClick={() => setResetResult(null)} aria-label="Dismiss credential"><Icon name="x" size={14} /></Button>
        </div>
      )}
      {loading ? <div className="stack"><Skeleton h={48} /><Skeleton h={48} /></div>
        : error ? <ErrorNote onRetry={load}>{error}</ErrorNote>
          : rows.length === 0 ? <EmptyState icon="users" title="No accounts match">Try a different search term or create the first matching account.</EmptyState>
            : (
              <div className="user-table" role="table" aria-label="All accounts">
                <div className="user-table-head" role="row">
                  <span role="columnheader">Person</span><span role="columnheader">Contact</span>
                  <span role="columnheader">Role</span><span role="columnheader">Last login</span>
                  <span role="columnheader">Actions</span>
                </div>
                {rows.map((target) => (
                  <div key={target.id} className={`user-row ${!target.isActive ? 'row-inactive' : ''}`} role="row">
                    <div role="cell" className="user-cell-person">
                      <span className="avatar sm">{target.name?.[0]}</span>
                      <div><strong>{target.name}{target.id === user?.id && <span className="muted"> (you)</span>}</strong><small className="muted">ID {target.id}</small></div>
                    </div>
                    <div role="cell" className="user-cell-contact"><small>{target.email}</small><small className="muted">{target.phone}</small></div>
                    <div role="cell">
                      <Select className="select-sm" value={target.role} disabled={busyId === target.id || target.id === user?.id}
                        onChange={(e) => changeRole(target, e.target.value)} aria-label={`Role for ${target.name}`}>
                        {ROLES.map((role) => <option key={role}>{role}</option>)}
                      </Select>
                      <Badge tone={target.isActive ? 'ok' : 'muted'}>{target.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                    </div>
                    <div role="cell"><small className="muted">{target.lastLoginAt ? fmtDate(target.lastLoginAt) : 'Never'}</small></div>
                    <div role="cell" className="row-actions">
                      <button className="icon-btn" disabled={busyId === target.id} onClick={() => toggleStatus(target)} aria-label={`${target.isActive ? 'Deactivate' : 'Reactivate'} ${target.name}`} title={`${target.isActive ? 'Deactivate' : 'Reactivate'}`}>
                        <Icon name={target.isActive ? 'x' : 'check'} size={14} />
                      </button>
                      <Button size="sm" variant="ghost" disabled={busyId === target.id} onClick={() => resetPassword(target)}>Reset</Button>
                      <Button size="sm" variant="danger" disabled={busyId === target.id || target.id === user?.id} onClick={() => setDeleteTarget(target)}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
      {pagination && (
        <div className="pagination-controls" role="navigation" aria-label="Account pages">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="muted">Page {pagination.page || page} of {pagination.totalPages || 1}</span>
          <Button size="sm" variant="ghost" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Create an account">
        <form className="stack" onSubmit={create}>
          <Field label="Full name"><Input value={newUser.name} minLength={2} required onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></Field>
          <div className="walkin-grid">
            <Field label="Email"><Input type="email" value={newUser.email} required onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></Field>
            <Field label="Phone"><Input inputMode="numeric" maxLength={10} pattern="[0-9]{10}" value={newUser.phone} required onChange={(e) => setNewUser({ ...newUser, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></Field>
          </div>
          <Field label="Role"><Select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>{ROLES.map((role) => <option key={role}>{role}</option>)}</Select></Field>
          <div className="modal-foot">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" loading={busyId === 'create'}>Create account</Button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete account">
        {deleteTarget && (
          <>
            <p>Delete <strong>{deleteTarget.name}</strong>? This is permanent and rejected by the backend if the account has booking, staff or clinical history.</p>
            <div className="modal-foot">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Keep account</Button>
              <Button variant="danger" icon="trash" loading={busyId === deleteTarget.id} onClick={remove}>Delete account</Button>
            </div>
          </>
        )}
      </Modal>
    </Card>
  );
}
