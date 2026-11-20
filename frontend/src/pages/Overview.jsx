// Overview.jsx — Biophilic Clinical Precision dashboard with motion primitives:
// AnimatedNumber KPI counters, InView staggered cards, Spotlight hero.
import React, { useEffect, useState } from 'react';
import { useApp, useFetch } from '../store.jsx';
import { api } from '../lib/api.js';
import {
  Badge, Button, Card, CardHead, Counter, ErrorNote, Icon, Sci, Skeleton, EmptyState,
} from '../components/ui.jsx';
import { PassportModal } from '../components/Passport.jsx';
import HealthViz3D from '../components/HealthViz3D.jsx';
import {
  AnimatedNumber,
  InView,
  Spotlight,
} from '../components/motion';
import { fmtDate, fmtTime12, dayTone, slotTone } from '../lib/format.js';

const STATS = [
  { label: 'Camps', value: 3, icon: 'compass', tone: 'ok', desc: 'scheduled across Bengaluru' },
  { label: 'Slots', value: 160, icon: 'clock', tone: 'info', desc: 'screening windows open' },
  { label: 'Patients', value: 1248, icon: 'users', tone: 'ok', desc: 'registered on the platform' },
  { label: 'Promoted', value: 37, icon: 'radio', tone: 'warn', desc: 'waitlist auto-promotions' },
];

export default function Overview() {
  const { user, setPage, isOrganizer, isStaff } = useApp();
  const camps = useFetch(() => api.camps(), []);
  const mine = useFetch(() => (user.role === 'PATIENT' ? api.myBookings() : Promise.resolve({ bookings: [] })), [user.id]);
  const [pass, setPass] = useState(null);

  const upcoming = (camps.data?.camps || []).filter((c) => c.status === 'PUBLISHED' && dayTone(c.campDate) !== 'past');
  const myNext = (mine.data?.bookings || []).filter((b) => ['CONFIRMED', 'CHECKED_IN'].includes(b.status))
    .sort((a, b) => (a.campDate || '').localeCompare(b.campDate || ''))[0];

  return (
    <div className="bento overview-bento gap-6">
      {/* Hero banner */}
      <Card className="hero-card entrance" style={{ gridColumn: '1 / -1' }}>
        <div className="hero-wrap">
          <div className="hero-text max-w-[52ch]">
            <p className="hero-kicker">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="text-3xl lg:text-4xl font-extrabold leading-tight tracking-tight">
              {user.role === 'PATIENT' ? 'Your health, one booking away.' : user.role === 'ADMIN' ? 'Command center — system pulse.' : 'Operations desk — camps in flight.'}
            </h1>
            <p className="hero-sub text-muted max-w-[44ch]">
              {user.role === 'PATIENT'
                ? 'Reserve a free community screening slot, get your QR passport, and skip the queue.'
                : user.role === 'ADMIN'
                ? 'Monitor attendance, no-shows and capacity across every camp in real time.'
                : 'Run camps, assign staff, verify QR check-ins and broadcast the live queue.'}
            </p>
            <div className="hero-actions">
              {user.role === 'PATIENT' && <Button icon="compass" className="btn-primary" onClick={() => setPage('discover')}>Find a health camp</Button>}
              {(isOrganizer || isStaff) && <Button icon="radio" variant="ghost" onClick={() => setPage('liveQueue')}>Open Live Queue TV</Button>}
              {isOrganizer && <Button icon="clipboard" variant="ghost" onClick={() => setPage('manage')}>Manage camps</Button>}
              {isOrganizer && <Button icon="chart" variant="ghost" onClick={() => setPage('analytics')}>Analytics</Button>}
            </div>
          </div>
          <div className="hero-stats flex flex-wrap gap-3 mt-6 lg:mt-0">
            {STATS.map((s) => (
              <InView key={s.label} once>
                <div className="stat-card entrance">
                  <div className="stat-orb">
                    <Icon name={s.icon} size={20} className="icon" />
                  </div>
                  <div className="min-w-0">
                    <AnimatedNumber value={s.value} className="text-2xl font-bold text-text-hi" />
                    <small>{s.desc}</small>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </Card>

      {user.role === 'PATIENT' && (
        <Card className="next-appointment entrance card-tilt">
          <CardHead icon="ticket" title="Next appointment" sub={myNext ? 'Show this pass at the venue' : 'Nothing booked yet'} />
          {mine.loading ? <Skeleton h={140} /> : myNext ? (
            <button className="mini-pass" onClick={() => setPass(myNext)}>
              <div className="mini-pass-main">
                <strong className="mono">{myNext.tokenNumber}</strong>
                <span>{myNext.campTitle}</span>
                <small className="muted">{fmtDate(myNext.campDate)} · {fmtTime12(myNext.startTime)}</small>
              </div>
              <Badge status={myNext.status} />
            </button>
          ) : (
            <EmptyState icon="ticket" title="No appointments yet"
              action={<Button size="sm" icon="compass" className="btn-primary" onClick={() => setPage('discover')}>Browse camps</Button>}>
              Free screening camps run every week across Bengaluru.
            </EmptyState>
          )}
        </Card>
      )}

      <Card className="camps-teaser entrance card-tilt">
        <CardHead icon="compass" title="Upcoming camps" sub={`${upcoming.length} scheduled`} actions={<Button size="sm" variant="ghost" onClick={() => setPage(user.role === 'PATIENT' ? 'discover' : 'manage')}>All camps</Button>} />
        {camps.loading ? (
          <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={64} />)}</div>
        ) : camps.error ? <ErrorNote onRetry={camps.reload}>{camps.error}</ErrorNote> : upcoming.length === 0 ? (
          <EmptyState title="No upcoming camps" icon="compass">Organizers will publish the next dates shortly.</EmptyState>
        ) : (
          <div className="camp-rows">
            {upcoming.slice(0, 4).map((c) => {
              const remaining = c.slotCapacity - c.bookedTotal;
              const fill = c.slotCapacity ? Math.round((c.bookedTotal / c.slotCapacity) * 100) : 0;
              return (
                <button key={c.id} className="camp-row entrance card-tilt" onClick={() => setPage(user.role === 'PATIENT' ? 'discover' : 'manage')}>
                  <div className="camp-date"><strong>{fmtDate(c.campDate).split(',')[1] || c.campDate}</strong><small>{fmtDate(c.campDate).split(',')[0]}</small></div>
                  <div className="camp-row-main">
                    <strong>{c.title}</strong>
                    <small className="muted"><Icon name="pin" size={12} /> {c.venue} · {fmtTime12(c.startTime)}–{fmtTime12(c.endTime)}</small>
                    <div className="fill-bar"><span style={{ width: `${fill}%` }} data-tone={fill > 85 ? 'bad' : fill > 65 ? 'warn' : 'ok'} /></div>
                  </div>
                  <div className="camp-row-side">
                    <Badge tone={slotTone(remaining, c.slotCapacity) === 'full' ? 'bad' : slotTone(remaining, c.slotCapacity) === 'almost' ? 'warn' : 'ok'}>
                      {remaining > 0 ? `${remaining} seats` : 'Full'}
                    </Badge>
                    {c.waitingTotal > 0 && <small className="muted">{c.waitingTotal} waiting</small>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {(isOrganizer || user.role === 'ADMIN') && (
        <Card className={`${'entrance card-tilt'} pulse-card`}>
          <CardHead icon="chart" title="System pulse" sub="Live aggregates from bookings & camps" actions={<Button size="sm" variant="ghost" onClick={() => {}} />} />
          <HealthViz3D className="w-full h-[260px] my-4" />
          <div className="kpi-strip entrance gap-6">
            <div className="kpi"><strong><AnimatedNumber value={camps.data?.kpis?.totalRegistered || 0} className="text-2xl font-bold" /></strong><span>Registered patients</span></div>
            <div className="kpi"><strong><AnimatedNumber value={camps.data?.kpis?.attendanceRate || 0} decimals={1} className="text-2xl font-bold" />%</strong><span>Attendance rate</span></div>
            <div className="kpi"><strong><AnimatedNumber value={camps.data?.kpis?.waitlistPromotions || 0} className="text-2xl font-bold" /></strong><span>Waitlist promotions</span></div>
            <div className="kpi"><strong><AnimatedNumber value={camps.data?.kpis?.noShowRate || 0} decimals={1} className="text-2xl font-bold" />%</strong><span>No-show rate</span></div>
          </div>
          <p className="muted pulse-note text-sm"><Icon name="flask" size={13} /> Figures from live aggregates · demonstration seed data.</p>
        </Card>
      )}
      {isStaff && (
        <Spotlight color="rgba(16, 185, 129, 0.1)" size={500}>
          <Card className={`${'entrance card-tilt'} duty-card`}>
            <CardHead icon="stetho" title="My duty assignments" sub="Where and when you're on camp duty" />
            <div className="camp-rows">
              {[]}
            </div>
          </Card>
        </Spotlight>
      )}

      <PassportModal booking={pass} onClose={() => setPass(null)} />
    </div>
  );
}
