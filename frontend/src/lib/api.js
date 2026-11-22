// api.js — single gateway between the UI and (Mode A) the Express API or
// (Mode B) the local demo engine. Never presents a simulated result as a
// real database result: every Mode B result carries `simulated: true` and
// the store displays the operating mode at all times.
const BASE = import.meta.env.VITE_API_BASE || '';
// When a real backend origin is explicitly injected into a production build,
// never substitute the local engine if that backend is unavailable. The app
// must surface the real error instead of presenting simulated data as live.
const STRICT_LIVE = Boolean(BASE) && Boolean(import.meta.env.PROD);
export const isStrictLive = () => STRICT_LIVE;
let token = localStorage.getItem('chsc_token') || null;
let mode = 'connecting'; // 'connecting' | 'live' | 'demo'
let onModeChange = () => {};
let currentUser = null;

export function setModeListener(fn) { onModeChange = fn; }
export function getMode() { return mode; }
export function setToken(t) { token = t; if (t) localStorage.setItem('chsc_token', t); else localStorage.removeItem('chsc_token'); }
export function setUser(u) { currentUser = u; }
export function getUser() { return currentUser; }

/**
 * The demo engine is sizeable and is only needed when the backend is absent
 * (or a connection fails). Keep it out of the initial Mode A bundle by loading
 * it on the first fallback path; the promise is cached so later calls are free.
 */
let enginePromise;
function loadEngine() {
  if (!enginePromise) enginePromise = import('./engine.js').then((m) => m.default);
  return enginePromise;
}

async function call(path, { method = 'GET', body, qs } = {}) {
  let url = path;
  if (qs && typeof qs === 'object') {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) search.append(k, String(v));
    }
    const qsStr = search.toString();
    if (qsStr) url += (path.includes('?') ? '&' : '?') + qsStr;
  }
  const res = await fetch(`${BASE}${url}`, {
    method,
    // API responses are stateful and ETag revalidation can surface a bodyless
    // 304 to fetch(), which would break JSON parsing. Always read fresh data.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.code = data?.code;
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

/** Detect backend availability once at startup. Memoised so React's
 * development double-effect cannot issue two probes where the second one is
 * served a bodyless 304 and incorrectly flips the app back to DEMO. */
let modePromise;
export function detectMode() {
  if (modePromise) return modePromise;
  modePromise = (async () => {
    // A production build with no API base is a static-only deployment
    // (GitHub Pages / Netlify / Vercel). Probing `/api/health` there would
    // always 404 and paint a red console error even though DEMO is the
    // expected mode. Skip the probe and declare DEMO immediately. localhost
    // still probes, so the full build served by Express stays in LIVE mode.
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (!BASE && import.meta.env.PROD && !localHost) {
      mode = 'demo';
      onModeChange(mode);
      return mode;
    }
    try {
      const res = await fetch(`${BASE}/api/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      mode = data?.database === 'connected' || STRICT_LIVE ? 'live' : 'demo';
    } catch {
      // In strict-live deployments a failed probe must not activate the demo
      // engine. Keep the intended live mode and let individual API calls show
      // the real network error to the user.
      mode = STRICT_LIVE ? 'live' : 'demo';
    }
    onModeChange(mode);
    return mode;
  })();
  return modePromise;
}

/**
 * Run `live` against the real API; on network/DB failure transparently fall
 * back to the demo engine and switch the global mode indicator to DEMO.
 * `engineFn` receives the lazily loaded engine so Mode A never downloads it.
 */
async function withFallback(liveFn, engineFn) {
  // A page can issue its first request before the startup health probe has
  // resolved. Wait for the memoised detection so Mode A never serves or
  // commits simulated data while the chip still says "Connecting…".
  if (mode === 'connecting') await detectMode();
  if (mode === 'live') {
    try {
      const out = await liveFn();
      return { ...out, __mode: 'live' };
    } catch (err) {
      // Only fall back to the demo engine on a connection failure (no HTTP
      // status = server unreachable). Surface real API errors (4xx/5xx) so
      // they are never silently masked as a demo result.
      if (STRICT_LIVE || err.status !== undefined) throw err;
      mode = 'demo';
      onModeChange(mode);
    }
  }
  const engine = await loadEngine();
  const out = await engineFn(engine);
  return { ...out, __mode: 'demo' };
}

export const api = {
  health: () => call('/api/health'),
  register: (payload) => withFallback(() => call('/api/auth/register', { method: 'POST', body: payload }), async () => { throw new Error('Registration needs the backend (Mode A). Use a demo role in Mode B.'); }),
  login: (identifier, password) => withFallback(() => call('/api/auth/login', { method: 'POST', body: { identifier, password } }), (engine) => engine.login(identifier, password)),
  demoLogin: (role) => withFallback(() => call('/api/auth/demo-login', { method: 'POST', body: { role } }), (engine) => engine.demoLogin(role)),
  me: () => withFallback(() => call('/api/auth/me'), (engine) => engine.me(currentUser)),
  camps: () => withFallback(() => call('/api/camps'), (engine) => engine.camps()),
  camp: (id) => withFallback(() => call(`/api/camps/${id}`), (engine) => engine.camp(id)),
  book: (slotId, opts) => withFallback(() => call(`/api/slots/${slotId}/book`, { method: 'POST', body: opts }), (engine) => engine.book(slotId, opts, currentUser)),
  confirmBooking: (id) => withFallback(() => call(`/api/bookings/${id}/confirm`, { method: 'POST' }), (engine) => engine.confirmBooking(id, currentUser)),
  myBookings: () => withFallback(() => call('/api/bookings/me'), (engine) => engine.myBookings(currentUser)),
  cancelBooking: (id) => withFallback(() => call(`/api/bookings/${id}/cancel`, { method: 'PATCH' }), (engine) => engine.cancelBooking(id, currentUser)),
  rescheduleBooking: (id, slotId) => withFallback(
    () => call(`/api/bookings/${id}/reschedule`, { method: 'PATCH', body: { slotId } }),
    (engine) => engine.rescheduleBooking(id, slotId, currentUser),
  ),
  checkin: (qrToken) => withFallback(() => call('/api/checkin', { method: 'POST', body: { qrToken } }), (engine) => engine.checkin(qrToken, currentUser)),
  queue: (campId) => withFallback(() => call(`/api/queue/${campId}`), (engine) => engine.queue(campId)),
  staffMe: () => withFallback(() => call('/api/staff/me'), (engine) => engine.staffMe(currentUser)),
  createCamp: (payload) => withFallback(() => call('/api/camps', { method: 'POST', body: payload }), (engine) => engine.createCamp(payload, currentUser)),
  generateSlots: (campId, payload) => withFallback(() => call(`/api/camps/${campId}/generate-slots`, { method: 'POST', body: payload }), (engine) => engine.generateSlots(campId, payload, currentUser)),
  setCampStatus: (campId, status) => withFallback(() => call(`/api/camps/${campId}/status`, { method: 'PATCH', body: { status } }), (engine) => engine.setCampStatus(campId, status)),
  staffFor: (campId) => withFallback(() => call(`/api/camps/${campId}/staff`), async (engine) => ({ staff: (await engine.camp(campId)).camp.staff })),
  controlRoom: (campId) => withFallback(() => call(`/api/camps/${campId}/control-room`), (engine) => engine.controlRoom(campId)),
  assignStaff: (campId, payload) => withFallback(() => call(`/api/camps/${campId}/staff`, { method: 'POST', body: payload }), (engine) => engine.assignStaff(campId, payload, currentUser)),
  removeStaff: (id) => withFallback(() => call(`/api/staff/${id}`, { method: 'DELETE' }), (engine) => engine.removeStaff(id)),
  analytics: () => withFallback(() => call('/api/admin/analytics'), (engine) => engine.analytics()),
  advisor: (physical) => withFallback(() => call(`/api/admin/capacity-advisor?physicalCapacity=${physical}`), (engine) => engine.advisor(physical)),
  // Backend pagination uses page/pageSize; keep the legacy limit argument as
  // a caller-facing convenience without sending an ignored query parameter.
  notifications: (limit = 50) => withFallback(() => call(`/api/admin/notifications?page=1&pageSize=${limit}`), (engine) => engine.notifications(limit)),
  users: () => withFallback(() => call('/api/admin/users'), (engine) => engine.users()),
  setRole: (id, role) => withFallback(() => call(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role } }), (engine) => engine.setRole(id, role)),
  setUserStatus: (id, isActive) => withFallback(() => call(`/api/admin/users/${id}/status`, { method: 'PATCH', body: { isActive } }), (engine) => engine.setUserStatus(id, isActive)),
  runReminders: () => withFallback(() => call('/api/admin/reminders/run', { method: 'POST' }), (engine) => engine.runReminders()),
  rush: (campId) => withFallback(() => call('/api/demo/rush', { method: 'POST', body: { campId } }), (engine) => engine.rush(campId)),
  concurrency: (campId) => withFallback(() => call('/api/demo/concurrency', { method: 'POST', body: { campId } }), (engine) => engine.concurrency(campId)),
  scenario: (name) => withFallback(() => call(`/api/demo/scenario/${name}`, { method: 'POST' }), (engine) => engine.scenario(name)),
  auditLog: (params = {}) => withFallback(() => call('/api/admin/audit-log', { method: 'GET', qs: params }), async () => ({ audit: [], pagination: { page: 1, pageSize: 20, total: 0 } })),
  purgeMe: () => withFallback(() => call('/api/users/me/purge', { method: 'DELETE' }), (engine) => engine.purgeMe(currentUser)),
  /** Live-mode notice only; never triggers a local engine reset. */
  demoResetNotice: () => call('/api/demo/reset-notice', { method: 'POST' }),
  /** Mode-B only: reset the cached local engine to its deterministic seed. */
  demoReset: async () => {
    const engine = await loadEngine();
    engine.reset();
    return { simulated: true, __mode: 'demo', message: 'Local demo data reset to the deterministic seed.' };
  },
  exportCsvUrl: () => `${BASE}/api/admin/reports/export.csv`,
  /**
   * Authenticated CSV download. A plain <a href> cannot attach the Bearer token,
   * so a live export used to 401. Fetch the bytes with the header instead of
   * putting the JWT in a URL (which would leak into history and server logs).
   */
  exportCsv: async () => {
    const res = await fetch(`${BASE}/api/admin/reports/export.csv`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Export failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* non-JSON */ }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.blob();
  },
};
