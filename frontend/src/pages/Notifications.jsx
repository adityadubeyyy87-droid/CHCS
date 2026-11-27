// Notifications.jsx — Biophilic Future Notification Center with motion primitives:
// InView for notification rows, Magnetic on buttons, Spotlight on sweep button.
import React, { useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Icon, Sci, Skeleton } from '../components/ui.jsx';
import { relTime } from '../lib/format.js';
import { Magnetic, InView, Spotlight } from '../components/motion';

export default function Notifications() {
  const { user, gateway, toast, pushGateway, isOrganizer } = useApp();
  const [running, setRunning] = useState(false);
  const [retryingId, setRetryingId] = useState(null);
  const canSeeLog = isOrganizer;

  const log = useFetch(
    () => (canSeeLog ? api.notifications(80) : Promise.resolve({ notifications: [] })),
    [canSeeLog],
  );

  const rows = [
    ...(log.data?.notifications || []),
    ...gateway.map((g) => ({ ...g, sentAt: g.at, local: true })),
  ].slice(0, 120);

  async function runSweep() {
    setRunning(true);
    try {
      const res = await api.runReminders();
      const count = res.sent ?? res.remindersSent ?? res.count ?? 0;
      toast(`Reminder sweep finished — ${count} new reminder(s).`, 'ok', res.note || 'De-duplicated per booking and type.');
      pushGateway({
        channel: 'SYSTEM', type: 'REMINDER_SWEEP', localActivity: true,
        message: `Manual reminder sweep finished with ${count} new reminder(s).`,
      });
      if (canSeeLog) await log.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { setRunning(false); }
  }

  async function retry(n) {
    if (!n?.id) return;
    setRetryingId(n.id);
    try {
      const res = await api.retryNotification(n.id);
      toast(res.message || 'Delivery retried.', res.notification?.status === 'SENT' ? 'ok' : 'warn');
      if (canSeeLog) await log.reload();
    } catch (err) {
      toast(err.message, 'bad', 'A real retry needs configured SMTP/SMS credentials.');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="split gap-6">
      <div className="split-left stack-lg">
        <Card>
          <CardHead icon="bell" title="Gateway Interceptor — audit log"
            sub="Every email, SMS and browser alert passes through this interceptor before it reaches a provider"
            actions={canSeeLog && (
              <Spotlight color="rgba(16, 185, 129, 0.1)" size={300}>
                <Magnetic intensity={0.4}>
                  <Button size="sm" variant="ghost" icon="refresh" loading={running} onClick={runSweep}>
                    Run reminder sweep
                  </Button>
                </Magnetic>
              </Spotlight>
            )} />
          <Sci k="privacy" as="div" className="sci-block">
            <p className="muted">
              Message bodies contain logistics only — token, venue, time. No health information is ever sent or stored.
            </p>
          </Sci>

          {log.loading && <div className="stack-md"><Skeleton h={64} /><Skeleton h={64} /><Skeleton h={64} /></div>}
          {log.error && <ErrorNote onRetry={log.reload}>{log.error}</ErrorNote>}
          {!log.loading && rows.length === 0 && (
            <EmptyState icon="send" title="No notifications yet">
              Book a slot, cancel one, or run the reminder sweep — every resulting message will appear here.
            </EmptyState>
          )}
          <div className="stack-md">
            {rows.map((n, i) => (
              <InView key={n._id || `${n.id}-${i}`} once>
                <article className={`gw-row ${n.local ? 'gw-local' : ''}`}>
                  <div className="gw-top">
                    <Badge status={n.channel} tone={n.channel === 'SMS' || n.channel === 'PUSH' ? 'info' : n.channel === 'SYSTEM' ? 'muted' : 'warn'}>{n.channel}</Badge>
                    <Badge
                      status={n.status || 'PENDING'}
                      tone={String(n.status || '').toUpperCase() === 'SENT' ? 'ok' : String(n.status || '').toUpperCase() === 'FAILED' ? 'bad' : String(n.status || '').toUpperCase() === 'SIMULATED' ? 'sim' : n.localActivity ? 'muted' : 'info'}
                    >
                      {n.localActivity ? 'LOCAL ACTIVITY' : String(n.status || 'PENDING').toUpperCase()}
                    </Badge>
                    {n.type && <Badge tone="muted">{String(n.type).replaceAll('_', ' ')}</Badge>}
                    <time className="muted">{relTime(n.sentAt || n.at)}</time>
                    {canSeeLog && !n.local && String(n.status).toUpperCase() === 'FAILED' && (
                      <Button size="sm" variant="ghost" icon="refresh" loading={retryingId === n.id} onClick={() => retry(n)}>
                        Retry
                      </Button>
                    )}
                  </div>
                  <p className="gw-msg">
                    {n.subject && <strong>{n.subject} — </strong>}{n.message}
                  </p>
                  <p className="gw-meta muted">
                    {n.localActivity ? 'No outbound delivery claimed · captured in this session'
                      : <>→ {n.recipient} · {n.provider || 'Gateway Interceptor'}</>}
                    {n.bookingId ? ` · booking reference ${n.bookingId}` : ''}
                    {n.attempts ? ` · ${n.attempts} attempt${n.attempts === 1 ? '' : 's'}` : ''}
                    {n.lastError ? ` · ${n.lastError}` : ''}
                    {n.local && !n.localActivity && ' · captured live in this session'}
                  </p>
                </article>
              </InView>
            ))}
          </div>
        </Card>
      </div>

      <div className="split-right stack-lg">
        <Card className="tips-card">
          <CardHead icon="clock" title="Automated reminder schedule" sub="node-cron sweep · de-duplicated per booking" />
          <ul className="math-steps">
            <li><strong>24 hours before</strong> the slot — email + SMS summary, plus a free browser alert where enabled.</li>
            <li><strong>2 hours before</strong> — final SMS with the slot time and the on-time pledge, mirrored to browser devices.</li>
            <li><strong>On promotion</strong> from the waitlist — instant notice with the new token, including free device alerts.</li>
            <li>Each reminder type is stored in <span className="mono">notifications_log</span>, so a booking never receives the same reminder twice.</li>
          </ul>
        </Card>

        <Card className="tips-card">
          <CardHead icon="shield" title="Honest delivery" sub="What SIMULATED means in this project" />
          <p className="muted">
            The backend logs delivery metadata through the interceptor. Where SMTP/SMS credentials are not configured,
            the provider runs in sandbox mode (Fast2SMS / Nodemailer test transport) and the real log row is marked{' '}
            <Badge status="SIMULATED" tone="sim">SIMULATED</Badge>. It is never presented as a completed provider delivery.
            Free browser alerts are sent through Web Push only to devices that opted in; a row becomes SENT only when the
            browser push service accepts it.
          </p>
          {!canSeeLog && (
            <p className="muted small">
              Signed in as <strong>{user?.role}</strong> — the platform-wide log is limited to organizers and admins.
              Your session feed above is still complete for your own actions.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
