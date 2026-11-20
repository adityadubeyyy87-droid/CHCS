// Login.jsx — Biophilic Future authentication with motion primitives:
// TextShimmer hero text, GlowEffect behind 3D hero, Magnetic buttons,
// InView staggered form entries.
import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Icon, Input, Select, Sci } from '../components/ui.jsx';
import Hero3D from '../components/Hero3D.jsx';
import {
  TextShimmer,
  GlowEffect,
  Magnetic,
  InView,
  AnimatedNumber,
} from '../components/motion';

const DEMO_ROLES = [
  { role: 'PATIENT', name: 'Meera Sharma', desc: 'Book & manage appointments' },
  { role: 'ORGANIZER', name: 'Nandini Rao', desc: 'Run camps & staff' },
  { role: 'DOCTOR', name: 'Dr. Ananya Rao', desc: 'Camp day & check-in' },
  { role: 'VOLUNTEER', name: 'Arjun Kumar', desc: 'QR desk duty' },
  { role: 'ADMIN', name: 'Kavya Rao', desc: 'Analytics & governance' },
];

export default function Login() {
  const { signIn, toast, mode, setTheme, setPage } = useApp();
  const [tab, setTab] = useState('signin');
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ identifier: '', password: '', name: '', email: '', phone: '', ageGroup: '30-45' });
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function doSignIn(e) {
    e?.preventDefault();
    setError(null);
    if (!form.identifier || !form.password) { setError('Enter your email/phone and password.'); return; }
    setBusy('in');
    try {
      const user = await signIn(() => api.login(form.identifier, form.password));
      toast(`Welcome back, ${user.name.split(' ')[0]}.`, 'ok');
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function doDemo(role) {
    setError(null);
    setBusy(role);
    try {
      const user = await signIn(() => api.demoLogin(role));
      toast(`Demo session as ${user.name} (${user.role})`, 'ok', 'Simulated session — clearly labeled in the mode indicator.');
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function doRegister(e) {
    e.preventDefault();
    setError(null);
    setBusy('reg');
    try {
      const user = await signIn(() => api.register({
        name: form.name, email: form.email, phone: form.phone,
        password: form.password, ageGroup: form.ageGroup, preferredLanguage: 'en',
      }));
      toast(`Account created. Welcome, ${user.name.split(' ')[0]}.`, 'ok');
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="auth h-screen flex items-center justify-center" data-theme="dark">
      {/* Left: 3D Hero + Brand */}
      <aside className="auth-brand h-full w-full lg:w-1/2 flex flex-col">
        <div className="relative w-full h-full flex-1 flex items-center justify-center px-8 py-12 lg:px-12">
          <div className="absolute inset-0 -z-10 rounded-3xl bg-surface-2/50 blur-[20px]" />
          <GlowEffect
            colors={['rgba(16, 185, 129, 0.4)', 'rgba(37, 99, 235, 0.2)', 'rgba(245, 158, 11, 0.2)']}
            mode="rotate"
            blur="strong"
            scale={1.5}
            duration={6}
          />
          <div className="z-10 w-full max-w-lg flex flex-col items-center text-center space-y-6">
            <div className="relative">
              <Hero3D width={320} height={280} />
            </div>
            <div className="space-y-4">
              <TextShimmer
                children="BIOPHILIC FUTURE · INTELLIGENT HEALTHCARE"
                duration={3}
                className="text-xs font-semibold tracking-widest text-transparent bg-clip-text bg-[length:200%_auto] animate-[shimmer_3s_infinite]"
              />
              <h1 className="grad-text text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight">
                Care that reaches every<br />
                neighbour.
              </h1>
            </div>
          </div>
        </div>
        <div className="auth-foot mt-auto p-8 lg:p-12 border-t border-line">
          <p className="text-xs text-muted uppercase tracking-widest">
            CMR Institute of Technology, Bengaluru · Dept. of Information Science &amp; Engineering
          </p>
        </div>
      </aside>

      {/* Right: Sign-in card */}
      <main className="auth-panel h-full w-full lg:w-1/2 flex items-center justify-center px-8 py-12 lg:px-0 bg-surface/30 backdrop-blur-sm border-r border-line/50">
        <div className="auth-card w-full max-w-md">
          <button type="button" className="linkish auth-back" onClick={() => setPage('welcome')}>
            ← Back to the cinematic site
          </button>
          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'signin'} className={tab === 'signin' ? 'on' : undefined} onClick={() => setTab('signin')}>Sign in</button>
            <button role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'on' : undefined} onClick={() => setTab('register')}>Register</button>
          </div>

          <InView once>
            {error && <div className="error-note compact" role="alert"><Icon name="alert" size={15} /><p>{error}</p></div>}
          </InView>

          {tab === 'signin' ? (
            <InView once>
              <form onSubmit={doSignIn}>
                <Field label="Email or phone">
                  <Input value={form.identifier} onChange={set('identifier')} placeholder="patient@cmrit.edu" autoComplete="username" />
                </Field>
                <Field label="Password">
                  <Input type="password" value={form.password} onChange={set('password')} placeholder="••••••••" autoComplete="current-password" />
                </Field>
                <Magnetic intensity={0.4} range={80}>
                  <Button type="submit" loading={busy === 'in'} className="auth-cta w-full">Sign in</Button>
                </Magnetic>
              </form>
            </InView>
          ) : (
            <InView once>
              <form onSubmit={doRegister}>
                <Field label="Full name"><Input value={form.name} onChange={set('name')} placeholder="Your name" autoComplete="name" /></Field>
                <div className="field-row">
                  <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" /></Field>
                  <Field label="Phone (10 digits)"><Input value={form.phone} onChange={set('phone')} placeholder="9845000000" inputMode="numeric" autoComplete="tel" /></Field>
                </div>
                <div className="field-row">
                  <Field label="Age group">
                    <Select value={form.ageGroup} onChange={set('ageGroup')}>
                      <option>18-29</option><option>30-45</option><option>46-60</option><option>60+</option>
                    </Select>
                  </Field>
                  <Field label="Password" hint="Min 8 characters"><Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
                </div>
                <p className="muted consent-note"><Sci k="privacy"><Icon name="shield" size={13} /> We store only name, phone, email and age group — no medical history, ever.</Sci></p>
                <Magnetic intensity={0.4} range={80}>
                  <Button type="submit" loading={busy === 'reg'} className="auth-cta w-full">Create account</Button>
                </Magnetic>
              </form>
            </InView>
          )}

          <div className="auth-demo mt-8">
            <p className="field-label mb-4">
              {mode === 'live' ? 'One-click demo sessions (seeded MySQL accounts)' : 'One-click demo sessions (local engine)'}
            </p>
            <div className="demo-grid">
              {DEMO_ROLES.map((r) => (
                <Magnetic key={r.role} intensity={0.3} range={60}>
                  <button onClick={() => doDemo(r.role)} disabled={busy === r.role} className="demo-role">
                    <Badge tone="muted">{r.role}</Badge>
                    <strong>{r.name}</strong>
                    <small className="muted">{r.desc}</small>
                    {busy === r.role && <span className="btn-spinner" aria-hidden="true" />}
                  </button>
                </Magnetic>
              ))}
            </div>
            <small className="muted">Mode {mode === 'live' ? 'A' : 'B'} · {mode === 'live' ? 'real MySQL backend connected' : 'backend offline — the local demo engine is active'}.
              <button className="linkish" onClick={() => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')}>Theme</button>
            </small>
          </div>
        </div>
      </main>
    </div>
  );
}
