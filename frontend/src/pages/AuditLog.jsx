// AuditLog.jsx — real administrative audit trail served by Express/MySQL.
import React, { useState } from 'react';
import { useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Skeleton } from '../components/ui.jsx';
import { relTime } from '../lib/format.js';

function jsonCell(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  const text = JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function actionTone(action = '') {
  const name = String(action).toUpperCase();
  if (/CREATE|PUBLISH|CONFIRM|CHECKIN|COMPLETE|ASSIGN/.test(name)) return 'ok';
  if (/CANCEL|RELEASE|REMOVE|DELETE|PURGE|NO_SHOW/.test(name)) return 'bad';
  if (/WAITLIST|PROMOTE|HOLD|EXPIRE|ROLE|STATUS/.test(name)) return 'warn';
  return 'info';
}

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const log = useFetch(() => api.auditLog({ page, pageSize }), [page, pageSize]);
  const rows = log.data?.audit || [];
  const pagination = log.data?.pagination || {};

  return (
    <div className="stack-lg">
      <Card>
        <CardHead
          icon="clipboard"
          title="Audit Log"
          sub="Every administrative and booking-state change recorded by the backend"
          actions={<Badge tone="ok">LIVE · MySQL</Badge>}
        />
        <p className="muted">
          Rows are read from <span className="mono">audit_log</span>. Before/after values show the exact fields the API recorded.
        </p>
        {log.loading && <div className="stack-md"><Skeleton h={56} /><Skeleton h={56} /><Skeleton h={56} /></div>}
        {log.error && <ErrorNote onRetry={log.reload}>{log.error}</ErrorNote>}
        {!log.loading && !log.error && rows.length === 0 && (
          <EmptyState icon="clipboard" title="No audit events yet">
            Changes made through the API will appear here as soon as they are recorded.
          </EmptyState>
        )}
        {!log.loading && !log.error && rows.length > 0 && (
          <div className="user-table" role="table" aria-label="Audit log entries">
            <div className="user-table-head" role="row">
              <span role="columnheader">When</span>
              <span role="columnheader">Actor</span>
              <span role="columnheader">Action</span>
              <span role="columnheader">Target</span>
              <span role="columnheader">Change</span>
            </div>
            {rows.map((row) => (
              <div key={row.id} className="user-row" role="row">
                <div role="cell" className="muted small" title={row.createdAt}>{relTime(row.createdAt)}</div>
                <div role="cell"><strong>{row.actorName || `User ${row.actorId || '—'}`}</strong></div>
                <div role="cell"><Badge tone={actionTone(row.action)}>{String(row.action).replaceAll('_', ' ')}</Badge></div>
                <div role="cell" className="muted small">
                  {row.targetType || '—'}{row.targetId ? ` #${row.targetId}` : ''}
                </div>
                <div role="cell" className="muted small audit-change">
                  <span><strong>before</strong> {jsonCell(row.before)}</span>
                  <span><strong>after</strong> {jsonCell(row.after)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!log.loading && !log.error && rows.length > 0 && (
          <div className="modal-foot audit-pagination">
            <Button size="sm" variant="ghost" disabled={page <= 1 || log.loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span className="muted small">Page {pagination.page || page} of {pagination.totalPages || page}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={log.loading || !pagination.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
