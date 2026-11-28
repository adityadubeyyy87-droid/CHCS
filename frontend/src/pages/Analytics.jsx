// Analytics.jsx — Biophilic Future executive analytics with motion primitives:
// AnimatedNumber KPI counters, InView for chart cards, Spotlight on advisor.
import React, { useEffect, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import {
  Badge, Button, Card, CardHead, Counter, EmptyState, ErrorNote, Icon, Skeleton, Slider,
} from '../components/ui.jsx';
import { AnimatedNumber, InView, Spotlight } from '../components/motion';

/* Charts read the active theme instead of assuming a dark canvas. */
const CHART = {
  dark: {
    ok: '#10b981', ok2: '#34d399', amber: '#fbbf24', red: '#f87171',
    grid: 'rgba(148,163,184,0.15)', tick: '#94a3b8', capacity: 'rgba(148,163,184,0.35)',
    cursor: 'rgba(148,163,184,0.08)', tooltipBg: 'rgba(15,23,42,0.96)',
    tooltipBorder: 'rgba(148,163,184,0.25)', tooltipText: '#e2e8f0',
  },
  light: {
    ok: '#047857', ok2: '#059669', amber: '#b45309', red: '#b91c1c',
    grid: 'rgba(15,23,42,0.12)', tick: '#475569', capacity: 'rgba(100,116,139,0.28)',
    cursor: 'rgba(15,23,42,0.06)', tooltipBg: '#ffffff',
    tooltipBorder: 'rgba(15,23,42,0.16)', tooltipText: '#0f172a',
  },
};

export default function Analytics() {
  const { toast, theme } = useApp();
  const chart = CHART[theme] || CHART.dark;
  const tooltipStyle = {
    background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`,
    borderRadius: 12, color: chart.tooltipText, fontSize: 13, padding: '10px 12px',
    boxShadow: 'var(--shadow-lg)',
  };
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
  const provenance = data.data?.meta?.provenance || 'live-mysql';

  const [exportBusy, setExportBusy] = useState(false);

  async function downloadCsv() {
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
      <div className="banner-quiet">
        <Icon name="shield" size={16} />
        <p>Every number here is derived from booking logistics only — never from medical data, which the platform does not collect.</p>
      </div>

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
          <div className="analytics-provenance" role="note">
            <Badge tone="ok">{provenance}</Badge>
            <span className="muted">Generated {data.data?.meta?.generatedAt ? new Date(data.data.meta.generatedAt).toLocaleString() : 'from live rows'} · {data.data?.meta?.engine || 'MySQL aggregate queries'}</span>
          </div>

          <div className="bento kpi-bento">
            <InView once className="kpi-slot">
              <Card className="kpi-card">
                <small className="kpi-label">Total registered</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.totalRegistered} /></strong>
                <span className="muted">community members on the platform</span>
                <small className="kpi-provenance"><Badge tone="ok">{provenance}</Badge></small>
              </Card>
            </InView>
            <InView once delay={80} className="kpi-slot">
              <Card className="kpi-card">
                <small className="kpi-label">Attendance rate</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.attendanceRate} decimals={1} format={(v) => v.toFixed(1)} /></strong>%
                <span className="muted">of completed screenings attended</span>
                <small className="kpi-provenance"><Badge tone="ok">{provenance}</Badge></small>
              </Card>
            </InView>
            <InView once delay={160} className="kpi-slot">
              <Card className="kpi-card">
                <small className="kpi-label">Waitlist auto-promotions</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.waitlistPromotions} /></strong>
                <span className="muted">seats rescued by FIFO fairness</span>
                <small className="kpi-provenance"><Badge tone="ok">{provenance}</Badge></small>
              </Card>
            </InView>
            <InView once delay={240} className="kpi-slot">
              <Card className="kpi-card">
                <small className="kpi-label">No-show rate</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.noShowRate} decimals={1} format={(v) => v.toFixed(1)} /></strong>%
                <span className="muted">across completed camps</span>
                <small className="kpi-provenance"><Badge tone="ok">{provenance}</Badge></small>
              </Card>
            </InView>
            <InView once delay={80} className="kpi-slot">
              <Card className="kpi-card">
                <small className="kpi-label">Feedback responses</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.feedbackResponses} /></strong>
                <span className="muted">average {Number(kpis.averageFeedbackRating || 0).toFixed(1)} / 5 post-camp</span>
                <small className="kpi-provenance"><Badge tone="ok">{provenance}</Badge></small>
              </Card>
            </InView>
            <InView once delay={160} className="kpi-slot">
              <Card className="kpi-card">
                <small className="kpi-label">Service records</small>
                <strong className="kpi-value"><AnimatedNumber value={kpis.serviceRecords} /></strong>
                <span className="muted">completed service entries from camp days</span>
                <small className="kpi-provenance"><Badge tone="ok">{provenance}</Badge></small>
              </Card>
            </InView>
          </div>

          <div className="bento chart-bento">
            <InView once className="bento-2 chart-slot">
              <Card className="bento-2">
                <CardHead icon="chart" title="Bookings vs physical capacity" sub="Every camp, past and upcoming" actions={<Badge tone="ok">Live MySQL</Badge>} />
                <div className="chart-box">
                  {(charts.bookingsVsCapacity || []).length === 0 ? (
                    <EmptyState icon="chart" title="No camps to chart yet">Create a real camp to see capacity evidence here.</EmptyState>
                  ) : <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={charts.bookingsVsCapacity} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="short" tick={{ fill: chart.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: chart.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: chart.cursor }} />
                      <Legend wrapperStyle={{ fontSize: 12, color: chart.tick }} />
                      <Bar dataKey="capacity" name="Slot capacity" fill={chart.capacity} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="bookings" name="Bookings" fill={chart.ok} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>}
                </div>
              </Card>
            </InView>
            <InView once delay={100} className="bento-2 chart-slot">
              <Card className="bento-2">
                <CardHead icon="users" title="Attendance vs no-shows" sub="Completed camps only" actions={<Badge tone="ok">Live MySQL</Badge>} />
                <div className="chart-box">
                  {(charts.attendanceVsNoShow || []).length === 0 ? (
                    <EmptyState icon="users" title="No completed camps yet">Attendance evidence appears after a camp closes.</EmptyState>
                  ) : <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={charts.attendanceVsNoShow} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="camp" tick={{ fill: chart.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: chart.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: chart.cursor }} />
                      <Legend wrapperStyle={{ fontSize: 12, color: chart.tick }} />
                      <Bar dataKey="attended" name="Attended" stackId="a" fill={chart.ok} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="noShow" name="No-shows" stackId="a" fill={chart.red} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>}
                </div>
              </Card>
            </InView>
            <InView once delay={200} className="chart-slot">
              <Card>
                <CardHead icon="clock" title="Hourly slot utilisation" sub="Where the day is quiet — evidence for slot re-timing" actions={<Badge tone="ok">Live MySQL</Badge>} />
                <div className="chart-box">
                  {(charts.hourlyUtilisation || []).length === 0 ? (
                    <EmptyState icon="clock" title="No slot activity yet">Utilisation is derived from real bookings once slots exist.</EmptyState>
                  ) : <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={charts.hourlyUtilisation} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chart.ok2} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={chart.ok2} stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: chart.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fill: chart.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: chart.cursor }} />
                      <ReferenceLine y={90} stroke={chart.amber} strokeDasharray="5 4" label={{ value: 'Target 90%', fill: chart.amber, fontSize: 11, position: 'insideTopRight' }} />
                      <Area type="monotone" dataKey="utilisation" name="Utilisation" stroke={chart.ok} strokeWidth={2.4} fill="url(#utilGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>}
                </div>
              </Card>
            </InView>
          </div>

          <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}>
            <CapacityAdvisor advisor={advisor} busy={advisorBusy} physical={physical} setPhysical={setPhysical} />
          </Spotlight>

          <Card>
            <CardHead icon="download" title="Reports"
              sub="CSV served by the Express + MySQL backend."
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
            <p className="muted">Source: MySQL aggregate queries.</p>
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
        actions={advisor && <Badge tone="ok">Sample: {advisor.sampleSize} bookings</Badge>} />
      <div className="advisor-grid">
        <div className="stack-md">
          <Slider label="Physical screening seats (C_phys)" min={20} max={400} step={5} value={physical}
            onChange={setPhysical} format={(v) => `${v} seats`} />
          <div className="formula mono">min( ceil(C_phys / (1 − p)), floor(C_phys × (1 + α_max)) )</div>
          <p className="muted">
            p = empirical no-show rate from completed bookings; α_max = 25% hard safety ceiling.
            {advisor && <> Current p = <strong>{advisor.noShowRate}%</strong> ({advisor.noShows} no-shows in {advisor.sampleSize} completed bookings).</>}
          </p>
          <p className="muted small">{advisor?.interpretation}</p>
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
