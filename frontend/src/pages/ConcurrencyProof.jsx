// ConcurrencyProof.jsx — live zero-overbooking proof. The backend fires 50
// simultaneous transactions at one capacity-10 slot and reads the InnoDB counters
// before removing its temporary verification rows. No client-side simulation.
import React, { useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Select } from '../components/ui.jsx';
import { Magnetic } from '../components/motion';

const TOTAL = 50;

export default function ConcurrencyProof() {
  const { user, toast, isOrganizer } = useApp();
  const camps = useFetch(() => api.camps(), []);
  const [campId, setCampId] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    const published = (camps.data?.camps || []).filter((c) => c.status === 'PUBLISHED');
    if (published.length && !campId) setCampId(published[0].id);
  }, [camps.data, campId]);

  useEffect(() => { setResult(null); setNodes([]); setError(null); }, [campId]);

  async function runRace() {
    if (running || !campId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setNodes(Array.from({ length: TOTAL }, (_, i) => ({ id: i + 1, status: 'pending', position: null })));
    try {
      const data = await api.concurrencyProof(campId);
      const confirmed = Math.max(0, Math.min(Number(data.confirmed) || 0, TOTAL));
      const positions = Array.isArray(data.positions) ? data.positions : [];
      setNodes((current) => current.map((node, index) => {
        if (index < confirmed) return { ...node, status: 'confirmed' };
        const waitIndex = index - confirmed;
        if (waitIndex < positions.length) {
          return { ...node, status: 'waitlisted', position: positions[waitIndex] };
        }
        return { ...node, status: 'failed' };
      }));
      setResult(data);
      toast(
        data.zeroOverbooked
          ? `Proof passed: ${data.confirmed} confirmed, ${data.waitlisted} waitlisted, 0 overbooked.`
          : `Proof FAILED: ${data.errors} errors.`,
        data.zeroOverbooked ? 'ok' : 'bad',
        `Slot ${data.slotId}: booked_count ${data.db?.booked_count ?? '—'}/${data.db?.capacity ?? '—'}`,
      );
    } catch (err) {
      setError(err.message);
      setNodes([]);
    } finally {
      setRunning(false);
    }
  }

  if (!isOrganizer && user.role !== 'ADMIN') {
    return (
      <Card>
        <CardHead icon="shield" title="Organizer / Admin only" />
        <EmptyState icon="compass" title="This proof is for camp organizers and administrators." />
      </Card>
    );
  }

  return (
    <div className="stack-lg">
      <Card>
        <CardHead
          icon="zap"
          title="Zero-Overbooking Proof"
          sub="50 concurrent transactions · one capacity-10 slot · real InnoDB row locks"
          actions={<Badge tone="ok">LIVE · MySQL</Badge>}
        />

        <div className="proof-controls">
          <Field label="Published camp">
            <Select value={campId || ''} onChange={(e) => setCampId(Number(e.target.value))} aria-label="Published camp for concurrency proof">
              <option value="">Select a published camp…</option>
              {(camps.data?.camps || [])
                .filter((c) => c.status === 'PUBLISHED')
                .map((c) => <option key={c.id} value={c.id}>{c.title} · {c.campDate}</option>)}
            </Select>
          </Field>
          <Magnetic intensity={0.4}>
            <Button icon="zap" loading={running} disabled={running || !campId} onClick={runRace}>
              {running ? 'Racing…' : 'Run 50-way race'}
            </Button>
          </Magnetic>
        </div>

        {camps.loading && <p className="muted">Loading real camps…</p>}
        {camps.error && <ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote>}
        {!camps.loading && !camps.error && !(camps.data?.camps || []).some((c) => c.status === 'PUBLISHED') && (
          <EmptyState icon="calendar" title="No published camp available">
            Publish a camp from Camp Management before running the proof. The backend requires a real PUBLISHED camp.
          </EmptyState>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}

        {!result && !error && campId && (
          <EmptyState icon="zap" title="Ready to verify zero overbooking">
            The backend creates 50 temporary patients and races them against one capacity-10 slot using{' '}
            <span className="mono">SELECT ... FOR UPDATE</span>. Temporary rows are removed before the response is returned;
            only the MySQL counters are reported here.
          </EmptyState>
        )}
      </Card>

      {result && (
        <>
          <Card className="concurrency-result">
            <CardHead
              icon="check"
              title="Result"
              sub={!result.zeroOverbooked ? 'Verification failed' : 'Verified against live MySQL'}
            />
            <div className="concurrency-stats">
              <div className="stat"><div className="value ok">{result.confirmed}</div><div className="label">Confirmed</div></div>
              <div className="stat"><div className="value warn">{result.waitlisted}</div><div className="label">Waitlisted (FIFO)</div></div>
              <div className="stat"><div className="value muted">{result.errors}</div><div className="label">Errors / 500s</div></div>
              <div className="stat"><div className="value">{result.db?.booked_count ?? '—'}</div><div className="label">DB booked_count</div></div>
            </div>
            <div className="concurrency-badge">
              <Badge tone={result.zeroOverbooked ? 'ok' : 'bad'}>
                {result.zeroOverbooked ? 'ZERO OVERBOOKING — PASS' : 'OVERBOOKING DETECTED — FAIL'}
              </Badge>
              <span className="muted small">
                {result.source || 'Live MySQL transactions'} · positions{' '}
                {(result.positions && result.positions[0]) || '—'}–{(result.positions && result.positions[result.positions.length - 1]) || '—'}
              </span>
            </div>
          </Card>

          <Card>
            <CardHead icon="layers" title="Request nodes" sub="10 confirmed (green) · 40 waitlisted (amber, FIFO order)" />
            <div className="concurrency-grid" role="grid" aria-label="50 concurrent booking requests">
              {nodes.map((node) => (
                <div
                  key={node.id}
                  className={'node node-' + node.status}
                  role="gridcell"
                  aria-label={`Request ${node.id}: ${node.status}${node.position ? `, position ${node.position}` : ''}`}
                >
                  <div className="node-ring" />
                  <span className="node-id">{node.id}</span>
                  {node.status === 'waitlisted' && <span className="node-pos-badge">Pos {node.position}</span>}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead icon="database" title="Database state" sub="Real InnoDB rows read after the transaction commit" />
            <div className="concurrency-db">
              <div className="row"><span>Slot capacity</span><span className="mono">{result.db?.capacity ?? '—'}</span></div>
              <div className="row"><span>booked_count</span><span className="mono ok">{result.db?.booked_count ?? '—'}</span></div>
              <div className="row"><span>CONFIRMED bookings</span><span className="mono ok">{result.db?.confirmedBookings ?? '—'}</span></div>
              <div className="row"><span>WAITING waitlist rows</span><span className="mono warn">{result.db?.waitingBookings ?? '—'}</span></div>
              <div className="row"><span>booked_count &lt;= capacity</span><span className={'mono ' + (result.zeroOverbooked ? 'ok' : 'bad')}>{String(result.zeroOverbooked)}</span></div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
