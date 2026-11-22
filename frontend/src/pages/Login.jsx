// Login.jsx — Biophilic Clinical Precision authentication with motion primitives.
// Sign-in and registration go straight to the Express/MySQL API.
import React, { Suspense, lazy, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Icon, Input, Select, Sci, Skeleton } from '../components/ui.jsx';

const Hero3D = lazy(() => import('../components/Hero3D.jsx'));
import { TextShimmer, Magnetic, InView } from '../components/motion';

export default function Login() {
  const { signIn, toast, mode, connectionError, refreshConnection, setTheme, setPage } = useApp();
  const [tab, setTab] = useState('signin');
  const [busy, setBusy] = useState(null);
  const [checking, setChecking] = useState(false);
  const [form, setForm] = useState({ identifier: '', password: '', name: '', email: '', phone: '', ageGroup: '30-45' });
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  const validPhone = (value) => /^\d{10}$/.test(String(value || '').trim());

  async function retryConnection() {
    setChecking(true);
    try { await refreshConnection(); }
    finally { setChecking(false); }
  }

  async function doSignIn(e) {
    e?.preventDefault();
    setError(null);
    const identifier = form.identifier.trim();
    const password = form.password;
    const identifierOk = validEmail(identifier) || validPhone(identifier);
    if (!identifierOk) { setError('Enter a valid email address or 10-digit phone number.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy('in');
    try {
      const user = await signIn(() => api.login(identifier, password));
      toast(`Welcome back, ${user.name.split(' ')[0]}.`, 'ok');
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function doRegister(e) {
    e.preventDefault();
    setError(null);
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const phone = form.phone.trim();
    if (name.length < 2) { setError('Enter your full name.'); return; }
    if (!validEmail(email)) { setError('Enter a valid email address.'); return; }
    if (!validPhone(phone)) { setError('Enter a 10-digit phone number.'); return; }
    if (form.password.length < 8) { setError('Use a password of at least 8 characters.'); return; }
    setBusy('reg');
    try {
      const user = await signIn(() => api.register({
        name, email, phone,
        password: form.password, ageGroup: form.ageGroup, preferredLanguage: 'en',
      }));
      toast(`Account created. Welcome, ${user.name.split(' ')[0]}.`, 'ok');
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  const connectionLabel = mode === 'live'
    ? 'LIVE · MySQL'
    : mode === 'connecting' ? 'Connecting…' : 'Connection error';
  const connectionTone = mode === 'live' ? 'ok' : mode === 'connecting' ? 'muted' : 'bad';

  return (
    <div className="auth h-screen flex items-center justify-center" data-theme="dark">
      <aside className="auth-brand h-full w-full lg:w-1/2 flex flex-col">
        <div className="relative w-full h-full flex-1 flex items-center justify-center px-8 py-12 lg:px-12">
          <div className="z-10 w-full max-w-lg flex flex-col items-center text-center space-y-6">
            <div className="relative">
              <Suspense fallback={<Skeleton h={280} w={320} />}>
                <Hero3D width={320} height={280} />
              </Suspense>
            </div>
            <div className="space-y-4">
              <TextShimmer
                children="BIOPHILIC FUTURE · INTELLIGENT HEALTHCARE"
                duration={3}
                className="text-xs font-semibold tracking-widest text-emerald-400"
              />
              <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight">
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

      <main className="auth-panel h-full w-full lg:w-1/2 flex items-center justify-center px-8 py-12 lg:px-0 bg-surface/30 backdrop-blur-sm border-r border-line/50">
        <div className="auth-card w-full max-w-md">
          <button type="button" className="linkish auth-back" onClick={() => setPage('welcome')}>
            ← Back to the cinematic site
          </button>

          <div className="auth-connection" role="status">
            <Badge tone={connectionTone}>{connectionLabel}</Badge>
            {mode === 'error' && (
              <button type="button" className="linkish" onClick={retryConnection} disabled={checking}>
                {checking ? 'Retrying…' : 'Retry connection'}
              </button>
            )}
          </div>
          {mode === 'error' && connectionError && <p className="muted small auth-connection-error">{connectionError}</p>}
          {mode === 'error' && (
            <p className="muted small auth-connection-error">
              Sign-in needs a reachable backend. No local account or substitute session is available.
            </p>
          )}

          <div className="auth-tabs" role="group" aria-label="Account access">
            <button type="button" aria-pressed={tab === 'signin'} className={tab === 'signin' ? 'on' : undefined} onClick={() => setTab('signin')}>Sign in</button>
            <button type="button" aria-pressed={tab === 'register'} className={tab === 'register' ? 'on' : undefined} onClick={() => setTab('register')}>Register</button>
          </div>

          <InView once>
            {error && <div className="error-note compact" role="alert"><Icon name="alert" size={15} /><p>{error}</p></div>}
          </InView>

          {tab === 'signin' ? (
            <InView once>
              <form onSubmit={doSignIn}>
                <Field label="Email or phone">
                  <Input value={form.identifier} onChange={set('identifier')} placeholder="you@example.com" autoComplete="username" />
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

          <div className="auth-footnote">
            <small className="muted">Accounts are created and verified by the live backend.</small>
            <button
              type="button"
              className="linkish"
              onClick={() => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')}
            >
              Switch theme
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
