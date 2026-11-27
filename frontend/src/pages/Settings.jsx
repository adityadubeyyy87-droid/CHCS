// Settings.jsx — Biophilic Future settings with motion primitives:
// InView for sections, Magnetic on buttons, Spotlight on purge card.
import React, { useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import {
  browserSubscription, enableDeviceAlerts, unsubscribeBrowserPush, pushSupported,
} from '../lib/push.js';
import {
  Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Icon, Input,
  Modal, Sci, Select, Skeleton,
} from '../components/ui.jsx';
import { Magnetic, InView, Spotlight } from '../components/motion';
import { ApprovalsCard, OrgSettingsCard, UserAdminCard } from '../components/AdminWorkflows.jsx';

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
            <Sci k="privacy" as="div" className="sci-block">
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
        <InView once delay={0.15}>
          <DeviceAlerts />
        </InView>
        {['ADMIN', 'ORGANIZER'].includes(user?.role) && (
          <InView once>
            <ApprovalsCard />
          </InView>
        )}
        {isAdmin ? (
          <>
            <InView once>
              <OrgSettingsCard />
            </InView>
            <InView once>
              <UserAdminCard />
            </InView>
          </>
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
          This deletes your account and bookings immediately through the live backend. It cannot be undone.
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

/**
 * Free browser alerts. The backend owns VAPID and MySQL storage; this card only
 * asks the browser for permission and a real PushManager subscription.
 */
function DeviceAlerts() {
  const { toast } = useApp();
  const config = useFetch(() => api.pushConfig(), []);
  const devices = useFetch(() => api.pushDevices(), []);
  const [busy, setBusy] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const supported = pushSupported();
  const enabled = Boolean(config.data?.enabled);
  const deviceCount = devices.data?.devices?.length || 0;

  async function enable() {
    setBusy('enable');
    try {
      await enableDeviceAlerts(api);
      toast('Free browser alerts enabled on this device.', 'ok', 'MySQL');
      setTestResult(null);
      await Promise.all([config.reload(), devices.reload()]);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy('disable');
    try {
      const subscription = await browserSubscription();
      if (!subscription) {
        throw new Error('This browser has no local alert subscription. Re-enable it first, then disable it here.');
      }
      await api.unsubscribePush(subscription.toJSON().endpoint);
      await unsubscribeBrowserPush();
      toast('Browser alert removed from this device.', 'ok', 'MySQL');
      setTestResult(null);
      await Promise.all([config.reload(), devices.reload()]);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setTestResult(null);
    try {
      const result = await api.testPush();
      setTestResult(result);
      toast(result.message || 'Browser push service accepted the test alert.', 'ok', 'Web Push');
    } catch (err) {
      setTestResult({ error: err.message });
      toast(err.message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHead
        icon="bell"
        title="Free browser alerts"
        sub="Web Push to your registered devices — no SMS wallet, no phone number sent to a paid gateway"
        actions={<Badge tone={enabled ? 'ok' : 'muted'}>{enabled ? 'READY' : 'NOT CONFIGURED'}</Badge>}
      />
      <p className="muted small">
        Each device grants its own permission. The browser vendor delivers the encrypted alert for free;
        CHSC stores only the subscription endpoint and its encryption keys. No clinical data is included.
      </p>
      <div className="detail-facts">
        <div><small>Backend VAPID</small><strong>{config.loading ? 'Checking…' : enabled ? 'Configured' : 'Not configured'}</strong></div>
        <div><small>This browser</small><strong>{supported ? 'Supported' : 'Unsupported'}</strong></div>
        <div><small>Devices on account</small><strong>{devices.loading ? '…' : deviceCount}</strong></div>
      </div>

      {config.error && <ErrorNote onRetry={config.reload}>{config.error}</ErrorNote>}
      {devices.error && <ErrorNote onRetry={devices.reload}>{devices.error}</ErrorNote>}
      {!supported && (
        <p className="muted small">
          Use a current Chrome, Edge, Firefox or Safari browser over HTTPS to receive device alerts.
        </p>
      )}
      {supported && !enabled && !config.loading && !config.error && (
        <p className="muted small">
          The backend has no VAPID key pair yet, so no device can be registered. Nothing is simulated here.
        </p>
      )}

      <div className="row-actions">
        <Button
          size="sm"
          variant="primary"
          icon="bell"
          loading={busy === 'enable'}
          disabled={!supported || !enabled || Boolean(busy)}
          onClick={enable}
        >
          Enable this device
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="x"
          loading={busy === 'disable'}
          disabled={!deviceCount || Boolean(busy)}
          onClick={disable}
        >
          Disable this device
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="send"
          loading={busy === 'test'}
          disabled={!deviceCount || Boolean(busy)}
          onClick={test}
        >
          Send test alert
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          disabled={Boolean(busy)}
          onClick={() => { config.reload(); devices.reload(); }}
        >
          Refresh
        </Button>
      </div>

      {deviceCount > 0 && (
        <div className="push-devices" aria-label="Registered browser devices">
          {devices.data.devices.map((device) => (
            <div className="push-device" key={device.id}>
              <span><Icon name="check" size={12} /> <strong>{device.endpointHost}</strong></span>
              <small className="muted">{new Date(device.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <p className={`small ${testResult.error ? 'text-danger' : ''}`} role="status" aria-live="polite">
          {testResult.error || `${testResult.provider} · ${testResult.accepted} device(s) · ${testResult.reference || 'accepted'}`}
        </p>
      )}
    </Card>
  );
}
