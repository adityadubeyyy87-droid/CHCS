// ControlRoom.jsx — Camp Day Control Room: real-time board for organizers.
// Slot fill, check-in queue, staff status, no-show countdown. Updates live via Socket.io.
import React, { useCallback, useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Card, CardHead, EmptyState, ErrorNote, Icon, Skeleton } from '../components/ui.jsx';
import { fmtTime12 } from '../lib/format.js';

export default function ControlRoom() {
  const { user, toast, socket, pushGateway } = useApp();
  const [campId, setCampId] = useState(1);
  const data = useFetch(() => api.controlRoom(campId), [campId]);
  const [checkIns, setCheckIns] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (data.data) {
      setCheckIns(data.data.checkedIn);
      setStats(data.data.stats);
    }
  }, [data.data]);

  // Live Socket.io updates
  useEffect(() => {
    if (!socket) return;
    socket.emit('camp:join', campId);
    const onCheckIn = (payload) => {
      if (payload.queue && payload.queue.campId === campId) {
        api.controlRoom(campId).then((r) => {
          if (r.data) { setCheckIns(r.data.checkedIn); setStats(r.data.stats); }
        });
        pushGateway({ channel: 'SYSTEM', type: 'CHECK_IN', recipient: 'control room', message: payload.queue.current?.patientName || 'Patient checked in', status: 'SENT', provider: 'Socket.io' });
        toast('Patient checked in: ' + (payload.queue.current?.patientName || 'unknown'), 'ok');
      }
    };
    const onAttendance = (payload) => {
      if (payload.campId === campId) {
        api.controlRoom(campId).then((r) => {
          if (r.data) { setCheckIns(r.data.checkedIn); setStats(r.data.stats); }
        });
      }
    };
    socket.on('checkin:new', onCheckIn);
    socket.on('attendance:updated', onAttendance);
    socket.on('queue:updated', (payload) => {
      if (payload.campId === campId) {
        api.controlRoom(campId).then((r) => {
          if (r.data) { setCheckIns(r.data.checkedIn); setStats(r.data.stats); }
        });
      }
    });
    return () => {
      socket.off('checkin:new', onCheckIn);
      socket.off('attendance:updated', onAttendance);
      socket.off('queue:updated');
      socket.emit('camp:leave', campId);
    };
  }, [socket, campId, api, pushGateway, toast]);

  if (!data.data) {
    return (
      <Card>
        <CardHead icon="radio" title="Camp Day Control Room" sub="Real-time camp operations board" />
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={92} />)}</div>
      </Card>
    );
  }

  const d = data.data;
  const staff = d.staff || [];
  const slots = d.slots || [];
  const totalFill = slots.length ? Math.round((slots.reduce((a, s) => a + s.booked, 0) / slots.reduce((a, s) => a + s.capacity, 0)) * 100) : 0;

  return (
    <div className="stack-lg">
      <Card className="control-room-header">
        <CardHead icon="radio" title="Camp Day Control Room" sub={d.camp.title + ' · ' + d.camp.venue + ' · ' + d.camp.campDate} />
        <div className="control-kpis">
          <div className="kpi">
            <div className="value">{d.stats.total}</div>
            <div className="label">Total bookings</div>
          </div>
          <div className="kpi">
            <div className="value ok">{d.stats.checkedIn}</div>
            <div className="label">Checked in</div>
          </div>
          <div className="kpi">
            <div className="value warn">{d.stats.noShow}</div>
            <div className="label">No-shows</div>
          </div>
          <div className="kpi">
            <div className="value">{totalFill}%</div>
            <div className="label">Slot fill</div>
          </div>
          <div className="kpi">
            <div className="value">{d.minutesToStart > 0 ? d.minutesToStart : 0} min</div>
            <div className="label">To camp start</div>
          </div>
        </div>
      </Card>

      <div className="control-grid">
        <Card className="control-panel-wide">
          <CardHead icon="layers" title="Slot fill board" sub={slots.length + ' slots · ' + totalFill + '% filled overall'} />
          <div className="slot-board">
            {slots.map((s) => (
              <div key={s.id} className="slot-row">
                <div className="slot-time">{fmtTime12(s.startTime)} – {fmtTime12(s.endTime)}</div>
                <div className="slot-bar-wrap">
                  <div className={`slot-bar ${s.fillPct > 85 ? 'bar-full' : s.fillPct > 65 ? 'bar-warn' : 'bar-ok'}`} style={{ width: s.fillPct + '%' }}></div>
                </div>
                <div className="slot-count">{s.booked} / {s.capacity} ({s.fillPct}%)</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="control-panel-narrow">
          <CardHead icon="user" title="Check-in queue" sub={d.stats.checkedIn + ' patients checked in'} />
          <div className="checkin-list">
            {d.checkedIn.length === 0 ? <EmptyState icon="user" title="No check-ins yet" /> : d.checkedIn.map((c) => (
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
        <CardHead icon="stetho" title="Staff status" sub={staff.length + ' assigned · ' + staff.filter((s) => s.loadWarning).length + ' over threshold'} />
        <div className="staff-board">
          {staff.length === 0 ? <EmptyState icon="stetho" title="No staff assigned" /> : staff.map((s) => (
            <div key={s.id} className="staff-row">
              <div className="staff-info">
                <div className="staff-name">{s.name}</div>
                <div className="staff-role">{s.roleAtCamp} · {s.shiftStart}–{s.shiftEnd}</div>
              </div>
              <div className="staff-load">
                <div className="staff-load-label">{s.expectedLoadPerHour} / {s.maxPatientsPerHour} per hr</div>
                <div className="staff-load-bar-wrap">
                  <div className={`staff-load-bar ${s.loadWarning ? 'bar-warn' : 'bar-ok'}`} style={{ width: Math.min(100, (s.expectedLoadPerHour / s.maxPatientsPerHour) * 100) + '%' }}></div>
                </div>
              </div>
              {s.loadWarning && <Badge tone="bad">OVER LOAD</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
