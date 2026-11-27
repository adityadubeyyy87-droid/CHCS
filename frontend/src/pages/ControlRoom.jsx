// ControlRoom.jsx — Camp Day Control Room: the organizer's real-time board.
// The camp is selected explicitly, API payloads are read directly, and socket
// refreshes are coalesced so a burst of check-ins cannot stampede the API.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Field, Select, Skeleton } from '../components/ui.jsx';
import { fmtTime12 } from '../lib/format.js';

export default function ControlRoom() {
  const { socket, socketOnline, pushGateway, toast } = useApp();
  const camps = useFetch(() => api.camps(), []);
  const [campId, setCampId] = useState(null);
  const board = useFetch(() => api.controlRoom(campId), [campId], { skip: !campId });
  const [checkIns, setCheckIns] = useState([]);
  const [stats, setStats] = useState(null);
  const refreshTimer = useRef(null);

  useEffect(() => {
    const list = camps.data?.camps || [];
    if (list.length && !campId) setCampId(list[0].id);
  }, [camps.data, campId]);

  const applyBoard = useCallback((payload) => {
    if (!payload || payload.error) return;
    setCheckIns(payload.checkedIn || []);
    setStats(payload.stats || null);
  }, []);

  useEffect(() => { if (board.data) applyBoard(board.data); }, [board.data, applyBoard]);

  const refresh = useCallback(() => {
    if (!campId) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      api.controlRoom(campId).then(applyBoard).catch((error) => toast(error.message, 'bad'));
    }, 180);
  }, [campId, applyBoard, toast]);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  useEffect(() => {
    if (!socket || !campId) return undefined;
    socket.emit('camp:join', campId);
    const onCheckIn = (payload) => {
      if (payload?.queue?.campId !== Number(campId)) return;
      pushGateway({
        channel: 'SYSTEM', type: 'CHECK_IN', localActivity: true,
        message: payload.queue.current?.patientName || 'Patient checked in',
      });
      toast(`Patient checked in: ${payload.queue.current?.patientName || 'unknown'}`, 'ok');
      refresh();
    };
    const onAttendance = (payload) => {
      if (payload?.campId === Number(campId)) refresh();
    };
    const onQueue = (payload) => {
      if (payload?.campId === Number(campId)) refresh();
    };
    socket.on('checkin:new', onCheckIn);
    socket.on('attendance:updated', onAttendance);
    socket.on('queue:updated', onQueue);
    return () => {
      socket.off('checkin:new', onCheckIn);
      socket.off('attendance:updated', onAttendance);
      socket.off('queue:updated', onQueue);
      socket.emit('camp:leave', campId);
    };
  }, [socket, campId, refresh, pushGateway, toast]);

  if (camps.loading) {
    return (
      <Card>
        <CardHead icon="radio" title="Camp Day Control Room" sub="Loading camps…" />
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={92} />)}</div>
      </Card>
    );
  }
  if (camps.error) {
    return <Card><CardHead icon="radio" title="Camp Day Control Room" /><ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote></Card>;
  }
  if (!camps.data?.camps?.length) {
    return (
      <Card>
        <CardHead icon="radio" title="Camp Day Control Room" sub="No camps are published yet." />
        <EmptyState icon="calendar" title="Nothing to run today" action={<Button size="sm" icon="plus" onClick={() => (location.hash = '#/manage')}>Create a camp</Button>} />
      </Card>
    );
  }

  const d = board.data;
  const staff = d?.staff || [];
  const slots = d?.slots || [];
  const checked = checkIns;
  const viewStats = stats || d?.stats || { total: 0, checkedIn: 0, noShow: 0 };
  const totalFill = slots.length
    ? Math.round((slots.reduce((a, s) => a + (s.booked || 0), 0) / Math.max(1, slots.reduce((a, s) => a + (s.capacity || 0), 0))) * 100)
    : 0;

  return (
    <div className="stack-lg">
      <Card className="control-room-header">
        <CardHead
          icon="radio"
          title="Camp Day Control Room"
          sub={d?.camp ? `${d.camp.title} · ${d.camp.venue} · ${d.camp.campDate}` : 'Real-time camp operations board'}
          actions={
            <Field label="Camp" className="control-camp-field">
              <Select value={campId || ''} onChange={(e) => setCampId(Number(e.target.value))} aria-label="Select camp">
                {camps.data.camps.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select>
            </Field>
          }
        />
        {!socketOnline && (
          <p className="muted small">
            Waiting for the real-time connection. The board shows the last successful API read; check-ins will refresh it when the socket reconnects.
          </p>
        )}
        {board.loading && <div className="stack-md"><Skeleton h={48} /><Skeleton h={48} /></div>}
        {board.error && <ErrorNote onRetry={board.reload}>{board.error}</ErrorNote>}
        {d && (
          <div className="control-kpis">
            <div className="kpi"><div className="value">{viewStats.total}</div><div className="label">Total bookings</div></div>
            <div className="kpi"><div className="value ok">{viewStats.checkedIn}</div><div className="label">Checked in</div></div>
            <div className="kpi"><div className="value warn">{viewStats.noShow}</div><div className="label">No-shows</div></div>
            <div className="kpi"><div className="value">{totalFill}%</div><div className="label">Slot fill</div></div>
            <div className="kpi"><div className="value">{Math.max(0, d.minutesToStart || 0)} min</div><div className="label">To camp start</div></div>
          </div>
        )}
      </Card>

      {d && (
        <>
          <div className="control-grid">
            <Card className="control-panel-wide">
              <CardHead icon="layers" title="Slot fill board" sub={`${slots.length} slots · ${totalFill}% filled overall`} />
              {slots.length === 0 ? <EmptyState icon="clock" title="No slots generated for this camp" /> : (
                <div className="slot-board">
                  {slots.map((s) => (
                    <div key={s.id} className="slot-row">
                      <div className="slot-time">{fmtTime12(s.startTime)} – {fmtTime12(s.endTime)}</div>
                      <div className="slot-bar-wrap">
                        <div className={`slot-bar ${s.fillPct > 85 ? 'bar-full' : s.fillPct > 65 ? 'bar-warn' : 'bar-ok'}`} style={{ width: `${s.fillPct}%` }} />
                      </div>
                      <div className="slot-count">{s.booked} / {s.capacity} ({s.fillPct}%)</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="control-panel-narrow">
              <CardHead icon="user" title="Check-in queue" sub={`${viewStats.checkedIn} patients checked in`} />
              <div className="checkin-list">
                {checked.length === 0 ? <EmptyState icon="user" title="No check-ins yet" /> : checked.map((c) => (
                  <div key={c.id} className="checkin-row">
                    <div className="checkin-token">{c.tokenNumber}</div>
                    <div className="checkin-patient">{c.patientName}</div>
                    <div className="checkin-slot">{c.slot}</div>
                    <Badge tone="ok">Checked in</Badge>
                    {c.noShowRisk && (
                      <Badge tone={c.noShowRisk.level === 'High' ? 'bad' : c.noShowRisk.level === 'Medium' ? 'warn' : 'ok'}>
                        No-show {c.noShowRisk.level}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="control-panel-wide">
            <CardHead icon="stetho" title="Staff status" sub={`${staff.length} assigned · ${staff.filter((s) => s.loadWarning).length} over threshold`} />
            {staff.length === 0 ? <EmptyState icon="stetho" title="No staff assigned" /> : (
              <div className="staff-board">
                {staff.map((s) => (
                  <div key={s.id} className="staff-row">
                    <div className="staff-info">
                      <div className="staff-name">{s.name}</div>
                      <div className="staff-role">{s.roleAtCamp} · {s.shiftStart}–{s.shiftEnd}</div>
                    </div>
                    <div className="staff-load">
                      <div className="staff-load-label">{s.expectedLoadPerHour} / {s.maxPatientsPerHour} per hr</div>
                      <div className="staff-load-bar-wrap">
                        <div className={`staff-load-bar ${s.loadWarning ? 'bar-warn' : 'bar-ok'}`} style={{ width: `${Math.min(100, (s.expectedLoadPerHour / Math.max(1, s.maxPatientsPerHour)) * 100)}%` }} />
                      </div>
                    </div>
                    {s.loadWarning && <Badge tone="bad">OVER LOAD</Badge>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
