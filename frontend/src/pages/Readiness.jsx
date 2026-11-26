// Readiness.jsx — Ops Readiness Console.
//
// Two questions an operations engineer asks before a camp: "will the message
// actually leave the building?" and "is this camp safe to run?". Both answers
// come from the live backend: provider variable presence (never values) and
// rule-based checks over real MySQL rows.
import React, { useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import {
  Badge, Button, Card, CardHead, ErrorNote, Icon, Sci, Skeleton,
} from '../components/ui.jsx';

const BAND_TONE = { READY: 'ok', ATTENTION: 'warn', BLOCKED: 'bad' };
const CHECK_TONE = { ok: 'ok', warn: 'warn', bad: 'bad' };
const CHECK_ICON = { ok: 'check', warn: 'clock', bad: 'alert' };

function codeList(provider) {
  return Object.entries(provider.present || {}).map(([key, present]) => (
    <span key={key} className={present ? 'env-chip on' : 'env-chip off'}>
      {present ? <Icon name="check" size={11} /> : <Icon name="x" size={11} />}
      <span className="mono">{key}</span>
    </span>
  ));
}

function ProviderCard({ channel, provider, canTest, testing, onTest }) {
  const isEmail = channel === 'EMAIL';
  return (
    <Card className="readiness-provider">
      <CardHead
        icon={isEmail ? 'send' : 'radio'}
        title={isEmail ? 'Email delivery' : 'SMS delivery'}
        sub={provider.note}
        actions={<Badge tone={provider.live ? 'ok' : 'sim'}>{provider.status}</Badge>}
      />
      <div className="readiness-provider-meta">
        <div>
          <small className="muted">Provider</small>
          <strong>{provider.provider}</strong>
        </div>
        {isEmail ? (
          <div>
            <small className="muted">From address</small>
            <strong className="mono readiness-from">{provider.from}</strong>
          </div>
        ) : (
          <div>
            <small className="muted">Route</small>
            <strong className="mono">
              {provider.route}
              {provider.route === 't' ? ' · transactional' : ' · quick'}
            </strong>
          </div>
        )}
      </div>

      {!isEmail && (
        <div className="readiness-dlt">
          <Badge tone={provider.dlt?.sender ? 'ok' : 'muted'}>DLT sender {provider.dlt?.sender ? 'set' : 'missing'}</Badge>
          <Badge tone={provider.dlt?.template ? 'ok' : 'muted'}>DLT template {provider.dlt?.template ? 'set' : 'missing'}</Badge>
        </div>
      )}

      <div className="readiness-env">{codeList(provider)}</div>

      {provider.missing?.length > 0 && (
        <p className="muted small">
          Still required for live delivery: <span className="mono">{provider.missing.join(', ')}</span>
        </p>
      )}

      <div className="row-actions">
        <Button
          size="sm"
          variant="ghost"
          icon="send"
          onClick={() => onTest(channel)}
          loading={testing === channel}
          disabled={!canTest || Boolean(testing)}
        >
          {canTest ? `Send test ${isEmail ? 'email' : 'SMS'}` : 'Admin-only self-test'}
        </Button>
      </div>
    </Card>
  );
}

export default function Readiness() {
  const { toast, isAdmin, user } = useApp();
  const data = useFetch(() => api.readiness(), []);
  const [testing, setTesting] = useState(null);
  const [result, setResult] = useState(null);

  async function runTest(channel) {
    setTesting(channel);
    setResult(null);
    try {
      const res = await api.testDelivery(channel);
      setResult(res);
      toast(
        res.simulated
          ? `${channel} sandbox attempt recorded — nothing left the server.`
          : `${res.provider} accepted the ${channel.toLowerCase()} test.`,
        res.simulated ? 'warn' : 'ok',
      );
    } catch (error) {
      setResult({ error: error.message, channel });
      toast(error.message, 'bad');
    } finally {
      setTesting(null);
    }
  }

  if (data.loading) {
    return (
      <div className="stack-lg">
        <Card><CardHead icon="flask" title="Ops Readiness Console" sub="Reading live configuration and camp state…" /></Card>
        <div className="bento">
          <Card className="bento-2"><Skeleton h={210} /></Card>
          <Card className="bento-2"><Skeleton h={210} /></Card>
        </div>
        <Card><Skeleton h={180} /></Card>
      </div>
    );
  }

  if (data.error) {
    return (
      <Card>
        <CardHead icon="flask" title="Ops Readiness Console" sub="The backend did not return a readiness report." />
        <ErrorNote onRetry={data.reload}>{data.error}</ErrorNote>
      </Card>
    );
  }

  const report = data.data;
  const integrity = report.integrity || {};
  const camps = report.camps || [];
  const published = camps.filter((camp) => String(camp.status).toUpperCase() === 'PUBLISHED');
  const needingAttention = camps.filter((camp) => camp.band !== 'READY');
  const provider = report.providers || {};

  return (
    <div className="stack-lg">
      <Card>
        <CardHead
          icon="flask"
          title="Ops Readiness Console"
          sub="Delivery configuration and camp run-readiness, computed from live MySQL rows."
          actions={(
            <div className="row-actions">
              <Badge tone={provider.ready ? 'ok' : report.providers?.sandboxOnly ? 'sim' : 'warn'}>
                {provider.ready ? 'Email + SMS live' : report.providers?.sandboxOnly ? 'Sandbox only' : 'Partially configured'}
              </Badge>
              <Button size="sm" variant="ghost" icon="refresh" onClick={data.reload}>Re-run checks</Button>
            </div>
          )}
        />
        <div className="readiness-summary">
          <div className="kpi"><div className="value">{published.length}</div><div className="label">Published camps</div></div>
          <div className="kpi"><div className="value ok">{camps.length - needingAttention.length}</div><div className="label">Ready camps</div></div>
          <div className="kpi"><div className="value warn">{integrity.campsWithoutDoctor}</div><div className="label">No doctor</div></div>
          <div className="kpi"><div className="value">{integrity.unnotifiedConfirmedBookings}</div><div className="label">Un-notified bookings</div></div>
          <div className="kpi"><div className="value">{integrity.failedNotifications}</div><div className="label">Failed messages</div></div>
        </div>
        <Sci k="ethical" as="p" className="muted small">
          Each score is 100 minus fixed penalties for named failures. This console is arithmetic over
          checkable conditions — not a model, and never a prediction about patients.
        </Sci>
      </Card>

      <div className="bento">
        <div className="bento-2">
          <ProviderCard
            channel="EMAIL"
            provider={provider.email || { present: {}, missing: [] }}
            canTest={isAdmin}
            testing={testing}
            onTest={runTest}
          />
        </div>
        <div className="bento-2">
          <ProviderCard
            channel="SMS"
            provider={provider.sms || { present: {}, missing: [] }}
            canTest={isAdmin}
            testing={testing}
            onTest={runTest}
          />
        </div>
      </div>

      {result && (
        <Card className={result.error ? 'readiness-result bad' : result.simulated ? 'readiness-result warn' : 'readiness-result ok'} role="status" aria-live="polite">
          <CardHead
            icon={result.error ? 'alert' : result.simulated ? 'clock' : 'check'}
            title={result.error ? 'Test failed' : result.simulated ? 'Sandbox attempt — nothing sent' : 'Provider accepted the test'}
            sub={result.error
              ? `${result.channel || 'Delivery'} · the provider rejected or could not be reached.`
              : `${result.channel} · ${result.provider} · ${result.testedAt}`}
          />
          <p>{result.error || result.message}</p>
          {!result.error && (
            <p className="muted small mono">
              recipient {result.recipient} · reference {result.reference || 'none'}
              {result.delivered ? ' · provider-accepted' : ' · recorded as sandbox'}
            </p>
          )}
          <p className="muted small">
            A sandbox result is an audit state, not a delivery claim. Configure the provider on the
            backend and run the test again.
          </p>
        </Card>
      )}

      <Card>
        <CardHead
          icon="shield"
          title="Data integrity"
          sub="Read directly from bookings, slots, staff assignments and the notification log."
          actions={<Badge tone={integrity.oversubscribedSlots || integrity.failedNotifications ? 'bad' : 'ok'}>
            {integrity.oversubscribedSlots || integrity.failedNotifications ? 'Needs attention' : 'Clean'}
          </Badge>}
        />
        <div className="readiness-integrity">
          <div className="kpi"><strong>{integrity.oversubscribedSlots}</strong><span>Oversubscribed slots</span></div>
          <div className="kpi"><strong>{integrity.stuckHolds}</strong><span>Expired holds awaiting sweep</span></div>
          <div className="kpi"><strong>{integrity.failedNotifications}</strong><span>Failed notifications</span></div>
          <div className="kpi"><strong>{integrity.simulatedNotifications}</strong><span>Sandbox records</span></div>
          <div className="kpi"><strong>{integrity.sentNotifications}</strong><span>Provider-accepted</span></div>
          <div className="kpi"><strong>{integrity.unnotifiedConfirmedBookings}</strong><span>Confirmed bookings without a confirmation</span></div>
          <div className="kpi"><strong>{integrity.campsWithoutVolunteer}</strong><span>Published camps without a volunteer</span></div>
          <div className="kpi"><strong>{integrity.campsWithoutSlots}</strong><span>Published camps without slots</span></div>
        </div>
      </Card>

      <Card>
        <CardHead
          icon="layers"
          title="Camp readiness"
          sub={`${camps.length} camp${camps.length === 1 ? '' : 's'} scored from live rows. Fix blockers before the gate opens.`}
          actions={camps.length > 0 && <Badge tone={needingAttention.length ? 'warn' : 'ok'}>{camps.length - needingAttention.length} ready / {camps.length}</Badge>}
        />
        {camps.length === 0 ? (
          <p className="muted">No camps exist yet. Create one in Camp Management, then re-run the checks.</p>
        ) : (
          <div className="readiness-camps">
            {camps.map((camp) => (
              <article key={camp.id} className="readiness-camp">
                <div className="readiness-camp-head">
                  <div>
                    <h3>{camp.title}</h3>
                    <p className="muted small">
                      {camp.status} · {camp.campDate} · {camp.venue || 'venue missing'} · {camp.city || 'city missing'}
                      {!camp.hasCoordinates && ' · address-based Maps link'}
                    </p>
                  </div>
                  <div className="readiness-camp-score">
                    <Badge tone={BAND_TONE[camp.band] || 'muted'}>{camp.band}</Badge>
                    <strong>{camp.score}</strong><span className="muted">/100</span>
                  </div>
                </div>

                <div className="meter" role="meter" aria-valuenow={camp.score} aria-valuemin={0} aria-valuemax={100} aria-label={`${camp.title} readiness ${camp.score} of 100`}>
                  <span style={{ width: `${camp.score}%` }} />
                </div>

                <div className="readiness-counters">
                  <span><strong>{camp.bookings.active}</strong> booked</span>
                  <span><strong>{camp.bookings.checkedIn}</strong> checked in</span>
                  <span><strong>{camp.bookings.waitlisted}</strong> waiting</span>
                  <span><strong>{camp.capacity}</strong> seats</span>
                  <span><strong>{camp.staff.doctors}</strong> doctors</span>
                  <span><strong>{camp.staff.volunteers}</strong> volunteers</span>
                  <span><strong>{camp.slots.future}</strong> future slots</span>
                  <a href={camp.mapsUrl} target="_blank" rel="noreferrer">Maps preview</a>
                </div>

                <ul className="readiness-checks">
                  {camp.checks.filter((check) => check.status !== 'ok').map((check) => (
                    <li key={check.id} className={`readiness-check ${check.status}`}>
                      <Icon name={CHECK_ICON[check.status]} size={13} />
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                      </div>
                      {check.penalty > 0 && <code>−{check.penalty}</code>}
                    </li>
                  ))}
                  {camp.checks.every((check) => check.status === 'ok') && (
                    <li className="readiness-check ok">
                      <Icon name="check" size={13} />
                      <div><strong>All checks pass</strong><span>{camp.headline}</span></div>
                    </li>
                  )}
                </ul>

                {camp.checks.some((check) => check.status !== 'ok') && (
                  <details className="readiness-details">
                    <summary>All {camp.checks.length} checks</summary>
                    <ul>
                      {camp.checks.map((check) => (
                        <li key={check.id} className={`readiness-check ${check.status}`}>
                          <Badge tone={CHECK_TONE[check.status]}>{check.status}</Badge>
                          <div><strong>{check.label}</strong><span>{check.detail}</span></div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </Card>

      <p className="muted small">
        Signed in as {user?.name} ({user?.role}). Provider secrets are never returned by this API —
        only whether each variable is present.
      </p>
    </div>
  );
}
