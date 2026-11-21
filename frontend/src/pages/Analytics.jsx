// Analytics.jsx — Biophilic Future executive analytics with motion primitives:
// AnimatedNumber KPI counters, InView for chart cards, Spotlight on advisor.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useApp, useFetch } from '../store.jsx';
import { api, getMode } from '../lib/api.js';
import {
  Badge, Button, Card, CardHead, Counter, ErrorNote, Icon, Sci, Skeleton, Slider,
} from '../components/ui.jsx';
import HealthViz3D from '../components/HealthViz3D.jsx';
import { AnimatedNumber, InView, Spotlight, GlowEffect } from '../components/motion';

const C = { ok: '#10b981', ok2: '#34d399', teal: '#14b8a6', amber: '#f59e0b', red: '#f87171', grid: 'rgba(148,163,184,0.15)' };

const tooltipStyle = {
  background: 'rgba(15,23,42,0.94)', border: '1px solid rgba(148,163,184,0.25)',
  borderRadius: 12, color: '#e2e8f0', fontSize: 13, padding: '10px 12px',
};

export default function Analytics() {
  const { toast } = useApp();
  const data = useFetch(() => api.analytics(), []);
  const [physical, setPhysical] = useState(100);
  const [advisor, setAdvisor] = useState(null);
  const [advisorBusy, setAdvisorBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setAdvisorBusy(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.advisor(physical);
        if (alive) setAdvisor(res);
      } catch { if (alive) setAdvisor(null); }
      finally { if (alive) setAdvisorBusy(false); }
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [physical]);

  const kpis = data.data?.kpis;
  const charts = data.data || {};

  const csvHref = useMemo(() => {
    const rows = (charts.bookingsVsCapacity || []);
    const lines = [
      'Camp,Date,Status,Capacity,Booked,Fill rate %',
      ...rows.map((r) => `"${r.camp}",${String(r.date).slice(0, 10)},${r.status},${r.capacity},${r.bookings},${r.capacity ? ((r.bookings / r.capacity) * 100).toFixed(1) : '0.0'}`),
    ];
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`# CHSC local demo export (simulated data — Mode B)\n${lines.join('\n')}`)}`;
  }, [charts.bookingsVsCapacity]);

  const [exportBusy, setExportBusy] = useState(false);

  async function downloadCsv() {
    if (getMode() !== 'live') {
      const a = document.createElement('a');
      a.href = csvHref;
      a.download = 'chsc-camp-report.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Demo CSV downloaded — labelled as simulated (Mode B).', 'info');
      return;
    }
    setExportBusy(true);
    try {
      const blob = await api.exportCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chsc-camp-report.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Camp report exported from MySQL.', 'ok');
    } catch (err) {
      toast(err.message || 'Export failed.', 'bad');
    } finally {
      setExportBusy(false);
    }
  }

  function printReport() { window.print(); toast('Print dialog opened — clean layout is print-ready.', 'ok'); }

  return (
    <div className="stack-lg analytics gap-6">
      <Sci k="privacy">
        <div className="banner-quiet">
          <Icon name="shield" size={16} />
          <p>Every number here is derived from booking logistics only — never from medical data, which the platform does not collect.</p>
        </div>
      </Sci>

      {data.loading && (
        <div className="bento">
          {[0, 1, 2, 3].map((i) => <Card key={i}><Skeleton h={84} /></Card>)}
          <Card className="bento-2"><Skeleton h={260} /></Card>
          <Card className="bento-2"><Skeleton h={260} /></Card>
        </div>
      )}
      {data.error && <ErrorNote onRetry={data.reload}>{data.error}</ErrorNote>}

      {kpis && (
        <>
          <div className="bento kpi-bento">
            <InView once>
              <Card className="kpi-card">
                <small className="kpi-label">Total registered</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.totalRegistered} /></strong>
                <span className="muted">community members on the platform</span>
              </Card>
            </InView>
            <InView once delay={80}>
              <Card className="kpi-card">
                <small className="kpi-label">Attendance rate</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.attendanceRate} decimals={1} format={(v) => v.toFixed(1)} /></strong>%
                <span className="muted">of completed screenings attended</span>
              </Card>
            </InView>
            <InView once delay={160}>
              <Card className="kpi-card">
                <small className="kpi-label">Waitlist auto-promotions</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.waitlistPromotions} /></strong>
                <span className="muted">seats rescued by FIFO fairness</span>
              </Card>
            </InView>
            <InView once delay={240}>
              <Card className="kpi-card">
                <small className="kpi-label">No-show rate</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.noShowRate} decimals={1} format={(v) => v.toFixed(1)} /></strong>%
                <span className="muted">across completed camps</span>
              </Card>
            </InView>
          </div>

          <Sci k="ethical">
            <Card>
              <CardHead icon="zap" title="Modelled no-show reduction"
                sub="Transparent label: modelled, not a measured causal inference"
                actions={<Badge status="SIMULATED" tone="sim">{kpis.noShowReductionPct}% modelled</Badge>} />
              <p className="muted">{kpis.noShowReductionBasis}</p>
            </Card>
          </Sci>

          <div className="bento chart-bento">
            <InView once>
              <Card className="bento-2">
                <CardHead icon="chart" title="Bookings vs physical capacity" sub="Every camp, past and upcoming" actions={<Badge tone="sim">Seeded demo data</Badge>} />
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={charts.bookingsVsCapacity || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="short" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                      <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                      <Bar dataKey="capacity" name="Slot capacity" fill="rgba(148,163,184,0.35)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="bookings" name="Bookings" fill={C.ok} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </InView>
            <InView once delay={100}>
              <Card className="bento-2">
                <CardHead icon="users" title="Attendance vs no-shows" sub="Completed camps only" actions={<Badge tone="sim">Seeded demo data</Badge>} />
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={charts.attendanceVsNoShow || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="camp" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                      <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                      <Bar dataKey="attended" name="Attended" stackId="a" fill={C.ok} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="noShow" name="No-shows" stackId="a" fill={C.amber} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </InView>
            <InView once delay={200}>
              <Card>
                <CardHead icon="clock" title="Hourly slot utilisation" sub="Where the day is quiet — evidence for slot re-timing" actions={<Badge tone="sim">Seeded demo data</Badge>} />
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={charts.hourlyUtilisation || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.ok2} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={C.ok2} stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                      <ReferenceLine y={90} stroke={C.amber} strokeDasharray="5 4" label={{ value: 'Target 90%', fill: C.amber, fontSize: 11, position: 'insideTopRight' }} />
                      <Area type="monotone" dataKey="utilisation" name="Utilisation" stroke={C.ok} strokeWidth={2.4} fill="url(#utilGrad)" />
                      <Line type="monotone" dataKey="utilisation" stroke="transparent" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </InView>
          </div>

          <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}>
            <CapacityAdvisor advisor={advisor} busy={advisorBusy} physical={physical} setPhysical={setPhysical} />
          </Spotlight>

          <Card>
            <CardHead icon="download" title="Reports"
              sub={getMode() === 'live'
                ? 'CSV served by the Express + MySQL backend.'
                : 'Local engine active — the export below is generated in-browser from simulated data.'}
              actions={(
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={downloadCsv}
                    disabled={exportBusy}
                    aria-busy={exportBusy || undefined}
                  >
                    <Icon name="download" size={14} /> {exportBusy ? 'Exporting…' : 'Export CSV'}
                  </button>
                  <Button size="sm" variant="ghost" icon="camera" onClick={printReport}>Print report</Button>
                </div>
              )} />
            <p className="muted">
              {charts.meta?.engine
                ? <>Source: <strong>{charts.meta.engine}</strong> · {charts.meta.isolation} · generated {new Date(charts.meta.generatedAt).toLocaleTimeString()}</>
                : 'Source: MySQL aggregate queries.'}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function CapacityAdvisor({ advisor, busy, physical, setPhysical }) {
  return (
    <Card className="advisor-card entrance card-tilt">
      <CardHead icon="flask" title="Smart Capacity Advisor"
        sub="Rule-Based Statistical Heuristic — NOT Black-Box AI/ML"
        actions={advisor && <Badge tone="sim">{advisor.sampleSize} historical bookings</Badge>} />
      <div className="advisor-grid">
        <div className="stack-md">
          <Slider label="Physical screening seats (C_phys)" min={20} max={400} step={5} value={physical}
            onChange={setPhysical} format={(v) => `${v} seats`} />
          <div className="formula mono">min( ceil(C_phys / (1 − p)), floor(C_phys × (1 + α_max)) )</div>
          <p className="muted">
            p = empirical no-show rate from completed bookings; α_max = 25% hard safety ceiling.
            {advisor && <> Current p = <strong>{advisor.noShowRate}%</strong> ({advisor.noShows} no-shows in {advisor.sampleSize} completed bookings).</>}
          </p>
          <Sci k="ethical">
            <p className="muted small">{advisor?.interpretation}</p>
          </Sci>
        </div>
        <div className="advisor-results">
          {busy && !advisor && <Skeleton h={150} />}
          {advisor && (
            <>
              <div className="advisor-row">
                <div><small className="muted">Raw statistical recommendation</small><strong className="mono">{advisor.rawRecommendation}</strong></div>
                <div><small className="muted">Safety ceiling (α_max = 25%)</small><strong className="mono">{advisor.safetyCeiling}</strong></div>
              </div>
              <div className="advisor-recommended">
                <small>Recommended booking capacity</small>
                <strong><AnimatedNumber value={advisor.recommended} /></strong>
                <span className="muted">+{advisor.buffer} buffer seats over physical</span>
              </div>
              <div className="advisor-row">
                <div><small className="muted">Expected attendance</small><strong>{advisor.expectedAttendance}</strong></div>
                <div>
                  <small className="muted">Expected seat utilisation</small>
                  <strong>{advisor.expectedDoctorUtilisation}%</strong>
                </div>
              </div>
              <div className="meter" role="meter" aria-valuenow={advisor.expectedDoctorUtilisation} aria-valuemin={0} aria-valuemax={100} aria-label="Expected seat utilisation">
                <span style={{ width: `${advisor.expectedDoctorUtilisation}%` }} />
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
