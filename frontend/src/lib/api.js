// api.js — the single network boundary for CHSC.
//
// Every value returned here comes from the configured Express/MySQL API. A
// failed probe or request surfaces the real error; there is no fabricated
// result, seeded shortcut or silent fallback.
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

let token = localStorage.getItem('chsc_token') || null;
let currentUser = null;

export function setToken(nextToken) {
  token = nextToken || null;
  if (token) localStorage.setItem('chsc_token', token);
  else localStorage.removeItem('chsc_token');
}

export function setUser(user) {
  currentUser = user || null;
}

export function getUser() {
  return currentUser;
}

function buildUrl(path, qs) {
  let url = `${BASE}${path}`;
  if (qs && typeof qs === 'object') {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(qs)) {
      if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
    }
    const suffix = search.toString();
    if (suffix) url += `${path.includes('?') ? '&' : '?'}${suffix}`;
  }
  return url;
}

function makeHttpError(status, data) {
  const message = data?.error || data?.message || `Request failed (${status})`;
  const error = new Error(message);
  error.status = status;
  error.code = data?.code;
  error.details = data?.details;
  return error;
}

function makeNetworkError(cause) {
  const error = new Error('Cannot reach the CHSC API. Check the backend connection and try again.');
  error.code = 'NETWORK_ERROR';
  error.cause = cause;
  return error;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('The API returned a non-JSON response.');
    error.code = 'INVALID_RESPONSE';
    throw error;
  }
}

async function call(path, { method = 'GET', body, qs, signal, headers } = {}) {
  try {
    const response = await fetch(buildUrl(path, qs), {
      method,
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await readJson(response);
    if (!response.ok) throw makeHttpError(response.status, data);
    if (data && typeof data === 'object' && typeof data.error === 'string') {
      throw makeHttpError(response.status, data);
    }
    return data;
  } catch (error) {
    if (error?.status || error?.code === 'NETWORK_ERROR' || error?.name === 'AbortError') {
      if (error.name === 'AbortError') {
        const timeout = new Error('The CHSC API did not respond in time.');
        timeout.code = 'TIMEOUT';
        throw timeout;
      }
      throw error;
    }
    throw makeNetworkError(error);
  }
}

/** Startup probe. An unavailable API is an error — never a substitute result. */
export async function probeHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const data = await call('/api/health', { signal: controller.signal });
    if (!data || data.ok !== true || data.database !== 'connected') {
      throw new Error(data?.error || `Database unavailable (${data?.database || 'unknown'}).`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => call('/api/health'),

  register: (payload) => call('/api/auth/register', { method: 'POST', body: payload }),
  login: (identifier, password) =>
    call('/api/auth/login', { method: 'POST', body: { identifier, password } }),
  me: () => call('/api/auth/me'),

  camps: (params) => call('/api/camps', { qs: params }),
  camp: (id) => call(`/api/camps/${encodeURIComponent(id)}`),
  campSlots: (campId) => call(`/api/camps/${encodeURIComponent(campId)}/slots`),

  book: (slotId, payload) =>
    call(`/api/slots/${encodeURIComponent(slotId)}/book`, { method: 'POST', body: payload }),
  myBookings: () => call('/api/bookings/me'),
  booking: (id) => call(`/api/bookings/${encodeURIComponent(id)}`),
  confirmBooking: (id) =>
    call(`/api/bookings/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
  cancelBooking: (id) =>
    call(`/api/bookings/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' }),
  rescheduleBooking: (id, slotId) =>
    call(`/api/bookings/${encodeURIComponent(id)}/reschedule`, {
      method: 'PATCH',
      body: { slotId },
    }),
  attendance: (id, status) =>
    call(`/api/bookings/${encodeURIComponent(id)}/attendance`, {
      method: 'PATCH',
      body: { status },
    }),

  checkin: (qrToken) => call('/api/checkin', { method: 'POST', body: { qrToken } }),
  checkinLookup: (payload) => call('/api/checkin/lookup', { method: 'POST', body: payload }),
  walkin: (payload) => call('/api/walkins', { method: 'POST', body: payload }),
  queue: (campId) => call(`/api/queue/${encodeURIComponent(campId)}`),
  serviceQueue: (campId) => call(`/api/camps/${encodeURIComponent(campId)}/service-queue`),
  recordService: (bookingId, payload) =>
    call(`/api/bookings/${encodeURIComponent(bookingId)}/service-records`, {
      method: 'POST',
      body: payload,
    }),
  addNote: (bookingId, note) =>
    call(`/api/bookings/${encodeURIComponent(bookingId)}/notes`, {
      method: 'POST',
      body: { note },
    }),
  staffMe: () => call('/api/staff/me'),

  familyMembers: () => call('/api/family'),
  addFamilyMember: (payload) => call('/api/family', { method: 'POST', body: payload }),
  deleteFamilyMember: (id) => call(`/api/family/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  prescreening: (bookingId) => call(`/api/bookings/${encodeURIComponent(bookingId)}/prescreening`),
  savePrescreening: (bookingId, payload) =>
    call(`/api/bookings/${encodeURIComponent(bookingId)}/prescreening`, {
      method: 'POST',
      body: payload,
    }),
  submitFeedback: (bookingId, payload) =>
    call(`/api/bookings/${encodeURIComponent(bookingId)}/feedback`, {
      method: 'POST',
      body: payload,
    }),
  organizerFeedback: (campId) => call('/api/feedback/organizer', { qs: { campId } }),

  campTemplates: () => call('/api/camp-templates'),
  cloneCamp: (campId, payload) =>
    call(`/api/camps/${encodeURIComponent(campId)}/clone`, { method: 'POST', body: payload }),
  checklist: (campId) => call(`/api/camps/${encodeURIComponent(campId)}/checklist`),
  addChecklistItem: (campId, item) =>
    call(`/api/camps/${encodeURIComponent(campId)}/checklist`, {
      method: 'POST',
      body: { item },
    }),
  updateChecklistItem: (id, isDone) =>
    call(`/api/checklist/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { isDone },
    }),
  deleteChecklistItem: (id) =>
    call(`/api/checklist/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  waitlist: (campId) => call(`/api/camps/${encodeURIComponent(campId)}/waitlist`),
  promoteWaiter: (campId, waitlistId, reason) =>
    call(`/api/camps/${encodeURIComponent(campId)}/waitlist/${encodeURIComponent(waitlistId)}/promote`, {
      method: 'POST',
      body: { reason },
    }),
  announce: (payload) => call('/api/announcements', { method: 'POST', body: payload }),

  approvals: () => call('/api/admin/camps/approvals'),
  submitCampForApproval: (campId, note = '') =>
    call(`/api/camps/${encodeURIComponent(campId)}/submit-approval`, {
      method: 'POST',
      body: { note },
    }),
  approveCamp: (campId) =>
    call(`/api/admin/camps/${encodeURIComponent(campId)}/approve`, { method: 'POST' }),
  rejectCamp: (campId, reason) =>
    call(`/api/admin/camps/${encodeURIComponent(campId)}/reject`, {
      method: 'POST',
      body: { reason },
    }),
  createUser: (payload) => call('/api/admin/users', { method: 'POST', body: payload }),
  resetUserPassword: (id) =>
    call(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' }),
  deleteUser: (id) => call(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  orgSettings: () => call('/api/org/settings'),
  updateOrgSettings: (payload) =>
    call('/api/org/settings', { method: 'PUT', body: payload }),
  inbox: (params) => call('/api/notifications/inbox', { qs: params }),
  markNotificationRead: (id) =>
    call(`/api/notifications/inbox/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => call('/api/notifications/inbox/read-all', { method: 'POST' }),

  createCamp: (payload) => call('/api/camps', { method: 'POST', body: payload }),
  updateCamp: (campId, payload) =>
    call(`/api/camps/${encodeURIComponent(campId)}`, { method: 'PATCH', body: payload }),
  generateSlots: (campId, payload) =>
    call(`/api/camps/${encodeURIComponent(campId)}/generate-slots`, {
      method: 'POST',
      body: payload,
    }),
  setCampStatus: (campId, status) =>
    call(`/api/camps/${encodeURIComponent(campId)}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  closeOut: (campId, payload = {}) =>
    call(`/api/camps/${encodeURIComponent(campId)}/close-out`, {
      method: 'POST',
      ...(payload && Object.keys(payload).length ? { body: payload } : {}),
    }),

  staffFor: (campId) => call(`/api/camps/${encodeURIComponent(campId)}/staff`),
  assignStaff: (campId, payload) =>
    call(`/api/camps/${encodeURIComponent(campId)}/staff`, { method: 'POST', body: payload }),
  removeStaff: (id) => call(`/api/staff/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  controlRoom: (campId) =>
    call(`/api/camps/${encodeURIComponent(campId)}/control-room`),

  analytics: () => call('/api/admin/analytics'),
  readiness: () => call('/api/admin/ops/readiness'),
  testDelivery: (channel) =>
    call('/api/admin/ops/delivery-test', { method: 'POST', body: { channel } }),

  // Free browser device alerts (Web Push / VAPID).
  pushConfig: () => call('/api/push/config'),
  pushDevices: () => call('/api/push/devices'),
  subscribePush: (subscription) =>
    call('/api/push/subscriptions', { method: 'POST', body: subscription }),
  unsubscribePush: (endpoint) =>
    call('/api/push/subscriptions', { method: 'DELETE', body: { endpoint } }),
  testPush: () => call('/api/push/test', { method: 'POST' }),
  advisor: (physicalCapacity) =>
    call('/api/admin/capacity-advisor', { qs: { physicalCapacity } }),
  notifications: (limit = 50, page = 1) =>
    call('/api/admin/notifications', { qs: { page, pageSize: limit } }),
  retryNotification: (id) =>
    call(`/api/admin/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  users: (params) => call('/api/admin/users', { qs: params }),
  setRole: (id, role) =>
    call(`/api/admin/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      body: { role },
    }),
  setUserStatus: (id, isActive) =>
    call(`/api/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { isActive },
    }),
  runReminders: () => call('/api/admin/reminders/run', { method: 'POST' }),
  expireHolds: () => call('/api/admin/holds/expire', { method: 'POST' }),
  auditLog: (params = {}) => call('/api/admin/audit-log', { qs: params }),

  /**
   * The backend requires a published campId; callers select a real camp first.
   * With no camp selected this fails honestly instead of inventing a target.
   */
  concurrencyProof: (campId) => {
    const id = Number(campId);
    if (!Number.isInteger(id)) {
      const error = new Error('Select a published camp before running the proof.');
      error.code = 'VALIDATION';
      return Promise.reject(error);
    }
    return call('/api/admin/concurrency-proof', { method: 'POST', body: { campId: id } });
  },
  concurrency: (campId) => api.concurrencyProof(campId),

  purgeMe: () => call('/api/users/me/purge', { method: 'DELETE' }),

  /**
   * Authenticated CSV download. A plain link cannot attach the Bearer token, so
   * request the bytes here instead of putting the JWT into a URL.
   */
  exportCsv: async () => {
    try {
      const response = await fetch(buildUrl('/api/admin/reports/export.csv'), {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        let data = null;
        try {
          data = await response.json();
        } catch {
          /* non-JSON error body */
        }
        throw makeHttpError(response.status, data);
      }
      return await response.blob();
    } catch (error) {
      if (error?.status || error?.code === 'NETWORK_ERROR') throw error;
      throw makeNetworkError(error);
    }
  },
};
