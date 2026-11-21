// api.js — single gateway between the UI and (Mode A) the Express API or
// (Mode B) the local demo engine. Never presents a simulated result as a
// real database result: every Mode B result carries `simulated: true` and
// the store displays the operating mode at all times.
import engine from './engine.js';

const BASE = import.meta.env.VITE_API_BASE || '';
let token = localStorage.getItem('chsc_token') || null;
let mode = 'connecting'; // 'connecting' | 'live' | 'demo'
let onModeChange = () => {};
let currentUser = null;

export function setModeListener(fn) { onModeChange = fn; }
export function getMode() { return mode; }
export function setToken(t) { token = t; if (t) localStorage.setItem('chsc_token', t); else localStorage.removeItem('chsc_token'); }
export function setUser(u) { currentUser = u; }
export function getUser() { return currentUser; }

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

/** Detect backend availability once at startup (and via retry()). */
export async function detectMode() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined });
    const data = await res.json();
    mode = data?.database === 'connected' ? 'live' : 'demo';
  } catch {
    mode = 'demo';
  }
  onModeChange(mode);
  return mode;
}

/**
 * Run `live` against the real API; on network/DB failure transparently fall
 * back to the demo engine and switch the global mode indicator to DEMO.
 */
async function withFallback(liveFn, engineFn) {
  if (mode === 'live') {
    try {
      const out = await liveFn();
      return { ...out, __mode: 'live' };
    } catch (err) {
      // Only fall back to the demo engine on a connection failure (no HTTP
      // status = server unreachable). Surface real API errors (4xx/5xx) so
      // they are never silently masked as a demo result.
      if (err.status !== undefined) throw err;
      mode = 'demo';
      onModeChange(mode);
    }
  }
  const out = await engineFn();
  return { ...out, __mode: 'demo' };
}

export const api = {
  health: () => call('/api/health'),
  register: (payload) => withFallback(() => call('/api/auth/register', { method: 'POST', body: payload }), async () => { throw new Error('Registration needs the backend (Mode A). Use a demo role in Mode B.'); }),
  login: (identifier, password) => withFallback(() => call('/api/auth/login', { method: 'POST', body: { identifier, password } }), () => engine.login(identifier, password)),
  demoLogin: (role) => withFallback(() => call('/api/auth/demo-login', { method: 'POST', body: { role } }), () => engine.demoLogin(role)),
  me: () => withFallback(() => call('/api/auth/me'), () => engine.me(currentUser)),
  camps: () => withFallback(() => call('/api/camps'), () => engine.camps()),
  camp: (id) => withFallback(() => call(`/api/camps/${id}`), () => engine.camp(id)),
  book: (slotId, opts) => withFallback(() => call(`/api/slots/${slotId}/book`, { method: 'POST', body: opts }), () => engine.book(slotId, opts, currentUser)),
  myBookings: () => withFallback(() => call('/api/bookings/me'), () => engine.myBookings(currentUser)),
  cancelBooking: (id) => withFallback(() => call(`/api/bookings/${id}/cancel`, { method: 'PATCH' }), () => engine.cancelBooking(id, currentUser)),
  checkin: (qrToken) => withFallback(() => call('/api/checkin', { method: 'POST', body: { qrToken } }), () => engine.checkin(qrToken, currentUser)),
  queue: (campId) => withFallback(() => call(`/api/queue/${campId}`), () => engine.queue(campId)),
  staffMe: () => withFallback(() => call('/api/staff/me'), () => engine.staffMe(currentUser)),
  createCamp: (payload) => withFallback(() => call('/api/camps', { method: 'POST', body: payload }), () => engine.createCamp(payload, currentUser)),
  generateSlots: (campId, payload) => withFallback(() => call(`/api/camps/${campId}/generate-slots`, { method: 'POST', body: payload }), () => engine.generateSlots(campId, payload, currentUser)),
  setCampStatus: (campId, status) => withFallback(() => call(`/api/camps/${campId}/status`, { method: 'PATCH', body: { status } }), () => engine.setCampStatus(campId, status)),
  staffFor: (campId) => withFallback(() => call(`/api/camps/${campId}/staff`), async () => ({ staff: (await engine.camp(campId)).camp.staff })),
  controlRoom: (campId) => withFallback(() => call(`/api/camps/${campId}/control-room`), () => engine.controlRoom(campId)),
  assignStaff: (campId, payload) => withFallback(() => call(`/api/camps/${campId}/staff`, { method: 'POST', body: payload }), () => engine.assignStaff(campId, payload, currentUser)),
  removeStaff: (id) => withFallback(() => call(`/api/staff/${id}`, { method: 'DELETE' }), () => engine.removeStaff(id)),
  analytics: () => withFallback(() => call('/api/admin/analytics'), () => engine.analytics()),
  advisor: (physical) => withFallback(() => call(`/api/admin/capacity-advisor?physicalCapacity=${physical}`), () => engine.advisor(physical)),
  notifications: (limit = 50) => withFallback(() => call(`/api/admin/notifications?limit=${limit}`), () => engine.notifications(limit)),
  users: () => withFallback(() => call('/api/admin/users'), () => engine.users()),
  setRole: (id, role) => withFallback(() => call(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role } }), () => engine.setRole(id, role)),
  setUserStatus: (id, isActive) => withFallback(() => call(`/api/admin/users/${id}/status`, { method: 'PATCH', body: { isActive } }), () => engine.setUserStatus(id, isActive)),
  runReminders: () => withFallback(() => call('/api/admin/reminders/run', { method: 'POST' }), () => engine.runReminders()),
  rush: (campId) => withFallback(() => call('/api/demo/rush', { method: 'POST', body: { campId } }), () => engine.rush(campId)),
  concurrency: (campId) => withFallback(() => call('/api/demo/concurrency', { method: 'POST', body: { campId } }), () => engine.concurrency(campId)),
  scenario: (name) => withFallback(() => call(`/api/demo/scenario/${name}`, { method: 'POST' }), () => engine.scenario(name)),
  auditLog: (params = {}) => withFallback(() => call('/api/admin/audit-log', { method: 'GET', qs: params }), () => ({ audit: [], pagination: { page: 1, pageSize: 20, total: 0 } })),
  purgeMe: () => withFallback(() => call('/api/users/me/purge', { method: 'DELETE' }), () => engine.purgeMe(currentUser)),
  exportCsvUrl: () => `${BASE}/api/admin/reports/export.csv`,
  /**
   * Authenticated CSV download. A plain <a href> cannot attach the Bearer token,
   * so a live export used to 401. Fetch the bytes with the header instead of
   * putting the JWT in a URL (which would leak into history and server logs).
   */
  exportCsv: async () => {
    const res = await fetch(`${BASE}/api/admin/reports/export.csv`, {
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

export { engine };
