// Settings.jsx — Biophilic Future settings with motion primitives:
// InView for sections, Magnetic on buttons, Spotlight on purge card.
import React, { useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import {
  Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Icon, Input,
  Modal, Sci, Select, Skeleton,
} from '../components/ui.jsx';
import { Magnetic, InView, Spotlight } from '../components/motion';

const ROLES = ['PATIENT', 'ORGANIZER', 'DOCTOR', 'VOLUNTEER', 'ADMIN'];

export default function Settings() {
  const app = useApp();
  const { user, theme, setTheme, lang, setLang, science, setScience, screenshotMode, setScreenshotMode, toast, signOut, t } = app;
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  async function purge() {
    setPurging(true);
    try {
      await api.purgeMe();
      toast('All personal data purged. Only the signup fields ever existed — nothing medical.', 'ok');
      setConfirmPurge(false);
      signOut();
    } catch (err) { toast(err.message, 'bad'); setConfirmPurge(false); }
    finally { setPurging(false); }
  }

  return (
    <div className="split gap-6">
      <div className="split-left stack-lg">
        <InView once>
          <Card>
            <CardHead icon="gear" title="Appearance & language" sub="Theme, language, and viva study aids" />
            <div className="settings-rows">
              <div className="setting-row">
                <div>
                  <strong>Theme</strong>
                  <p className="muted">Dark clinical is the default; light theme for bright rooms and printing.</p>
                </div>
                <Select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Theme">
                  <option value="dark">Dark clinical</option>
                  <option value="light">Light clinical</option>
                </Select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Language</strong>
                  <p className="muted">Kannada covers navigation and primary actions; long-form clinical copy stays English (partial localization).</p>
                </div>
                <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
                  <option value="en">English</option>
                  <option value="kn">ಕನ್ನಡ (Kannada)</option>
                </Select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Biophilic Science X-Ray</strong>
                  <p className="muted">Overlay the behavioral-science annotation chips across the interface.</p>
                </div>
                <Magnetic intensity={0.3}>
                  <Button size="sm" variant={science ? 'primary' : 'ghost'} icon="flask" onClick={() => setScience(!science)} aria-pressed={science}>
                    {science ? 'Annotations ON' : 'Annotations OFF'}
                  </Button>
                </Magnetic>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Clean PPT screenshot mode</strong>
                  <p className="muted">Hides chrome and annotations for clean presentation captures.</p>
                </div>
                <Magnetic intensity={0.3}>
                  <Button size="sm" variant={screenshotMode ? 'primary' : 'ghost'} icon="camera" onClick={() => setScreenshotMode(!screenshotMode)} aria-pressed={screenshotMode}>
                    {screenshotMode ? 'Clean mode ON' : 'Clean mode OFF'}
                  </Button>
                </Magnetic>
              </div>
            </div>
          </Card>
        </InView>

        <InView once delay={0.1}>
          <Card>
            <CardHead icon="user" title="Account" sub="Contact fields only — the platform's entire data footprint" />
            <div className="detail-facts">
              <div><small>Name</small><strong>{user?.name || '—'}</strong></div>
              <div><small>Email</small><strong>{user?.email || '—'}</strong></div>
              <div><small>Phone</small><strong>{user?.phone || '—'}</strong></div>
              <div><small>Role</small> <Badge tone="ok">{user?.role || '—'}</Badge></div>
              <div><small>Age group</small><strong>{user?.ageGroup || 'Not collected'}</strong></div>
              <div><small>Language</small><strong>{(user?.preferredLanguage || lang).toUpperCase()}</strong></div>
            </div>
            <Sci k="privacy">
              <p className="muted config-note"><Icon name="flask" size={13} /> Name, phone, email, age group — that is the complete schema. No diagnosis, prescription or report field exists anywhere in the database.</p>
            </Sci>
          </Card>
        </InView>

        <Spotlight color="rgba(248, 113, 113, 0.1)" size={400}>
          <Card className="danger-card">
            <CardHead icon="trash" title="Delete my personal data" sub="DPDP-aligned right to erasure — immediate, one tap" />
            <p className="muted">
              Purges your account, bookings and notification rows immediately. Active seat bookings are
              released to waiting neighbours first. The database never held medical data, so this removes everything.
            </p>
            <Magnetic intensity={0.4}>
              <Button variant="danger" icon="trash" onClick={() => setConfirmPurge(true)}>Delete my data</Button>
            </Magnetic>
          </Card>
        </Spotlight>
      </div>

      <div className="split-right stack-lg">
        {isAdmin ? (
          <InView once>
            <AdminUsers />
          </InView>
        ) : (
          <Card className="tips-card">
            <CardHead icon="shield" title="Why so little data?" sub="Privacy by Design, not privacy by promise" />
            <ul className="math-steps">
              <li>Collection minimisation — fields that are never needed are never stored.</li>
              <li>QR passes carry a token and a name — no health context.</li>
              <li>Notification bodies are logistics-only; the interceptor enforces it.</li>
              <li>Erasure is a single endpoint: <span className="mono">DELETE /api/users/me/purge</span>.</li>
            </ul>
          </Card>
        )}
      </div>

      <Modal open={confirmPurge} onClose={() => setConfirmPurge(false)} title="Delete my personal data">
        <p>
          This deletes your account and bookings immediately
          {app.mode !== 'live' && ' (local demo engine — simulated purge, clearly not a real server action)'}. It cannot be undone.
        </p>
        <p className="muted">Active bookings are released to the waitlist first — neighbours get the seats.</p>
        <div className="modal-foot">
          <Button variant="ghost" onClick={() => setConfirmPurge(false)}>Keep my data</Button>
          <Magnetic intensity={0.4}>
            <Button variant="danger" icon="trash" loading={purging} onClick={purge}>Purge everything</Button>
          </Magnetic>
        </div>
      </Modal>
    </div>
  );
}

function AdminUsers() {
  const { toast, pushGateway, user } = useApp();
  const users = useFetch(() => api.users(), []);
  const [busyId, setBusyId] = useState(null);

  async function changeRole(id, role) {
    setBusyId(id);
    try {
      await api.setRole(id, role);
      toast(`Role updated to ${role}.`);
      pushGateway({ channel: 'SYSTEM', type: 'ADMIN', recipient: 'user table', message: `User #${id} role set to ${role}.`, status: 'SIMULATED', provider: 'Admin console' });
      await users.reload();
    } catch (err) { toast(err.message, 'bad'); await users.reload(); }
    finally { setBusyId(null); }
  }

  async function toggleStatus(u) {
    setBusyId(u.id);
    try {
      await api.setUserStatus(u.id, !u.isActive);
      toast(`${u.name} ${u.isActive ? 'deactivated' : 'reactivated'}.`, u.isActive ? 'warn' : 'ok');
      await users.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHead icon="users" title="User & role management" sub={`${users.data?.users?.length || 0} accounts · ADMIN only`}
        actions={<Badge tone="muted">live table view</Badge>} />
      {users.loading && <Skeleton h={180} />}
      {users.error && <ErrorNote onRetry={users.reload}>{users.error}</ErrorNote>}
      {users.data && users.data.users.length === 0 && <EmptyState icon="users" title="No users found" />}
      {users.data && (
        <div className="user-table" role="table" aria-label="All accounts">
          <div className="user-table-head" role="row">
            <span role="columnheader">Person</span><span role="columnheader">Contact</span>
            <span role="columnheader">Role</span><span role="columnheader">Status</span>
          </div>
          {users.data.users.map((u) => (
            <InView key={u.id} once>
              <div key={u.id} className={`user-row ${!u.isActive ? 'row-inactive' : ''}`} role="row">
                <div role="cell" className="user-cell-person">
                  <span className="avatar sm">{u.name?.[0]}</span>
                  <div><strong>{u.name}{u.id === user?.id && <span className="muted"> (you)</span>}</strong><small className="muted">#{u.id}</small></div>
                </div>
                <div role="cell" className="user-cell-contact">
                  <small>{u.email}</small>
                  <small className="muted">{u.phone}</small>
                </div>
                <div role="cell">
                  <Select className="select-sm" value={u.role} disabled={busyId === u.id || u.id === user?.id}
                    onChange={(e) => changeRole(u.id, e.target.value)} aria-label={`Role for ${u.name}`}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </div>
                <div role="cell" className="user-cell-status">
                  <Badge tone={u.isActive ? 'ok' : 'muted'}>{u.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                  <button className="icon-btn" disabled={busyId === u.id || u.id === user?.id} title={u.id === user?.id ? 'You cannot deactivate yourself' : undefined}
                    onClick={() => toggleStatus(u)} aria-label={`${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.name}`}>
                    <Icon name={u.isActive ? 'x' : 'check'} size={14} />
                  </button>
                </div>
              </div>
            </InView>
          ))}
        </div>
      )}
      <p className="muted small">
        Role/status changes take effect on the affected user's next request. You cannot demote or deactivate your own admin account — the backend rejects it explicitly.
      </p>
    </Card>
  );
}
