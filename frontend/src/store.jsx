// store.jsx — global app state: auth, mode, theme, language, science overlay,
// toasts, gateway interceptor feed, socket connection, routing.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, detectMode, setModeListener, setToken, setUser, getMode } from './lib/api.js';
import { translate } from './lib/i18n.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const DEMO_SOCKET_EVENTS = ['booking:confirmed', 'waitlist:joined', 'waitlist:promoted', 'checkin:new', 'queue:updated'];

export function AppProvider({ children }) {
  const [mode, setMode] = useState('connecting');
  const [user, setLocalUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chsc_user') || 'null'); } catch { return null; }
  });
  const [theme, setTheme] = useState(() => localStorage.getItem('chsc_theme') || 'dark');
  const [lang, setLang] = useState(() => localStorage.getItem('chsc_lang') || 'en');
  const [science, setScience] = useState(false);
  const [page, setPage] = useState(() => {
    const hash = location.hash.replace('#/', '');
    if (hash) return hash;
    // First visit (no session): the cinematic front door. Returning signed-in
    // users still land on their dashboard.
    try { return localStorage.getItem('chsc_user') ? 'overview' : 'welcome'; } catch { return 'welcome'; }
  });
  const [toasts, setToasts] = useState([]);
  const [gateway, setGateway] = useState([]);       // Gateway Interceptor feed
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const socketRef = useRef(null);
  const localNotifId = useRef(1);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('chsc_theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('chsc_lang', lang); }, [lang]);
  useEffect(() => { document.body.classList.toggle('screenshot', screenshotMode); }, [screenshotMode]);

  useEffect(() => {
    setModeListener(setMode);
    detectMode().then((m) => {
      if (m === 'live' && window.io) {
        try {
          const socket = window.io({ transports: ['websocket', 'polling'] });
          socketRef.current = socket;
          socket.on('connect', () => setMode('live'));
          socket.on('disconnect', () => setMode('demo'));
          socket.on('gateway:message', (n) => pushGateway({ ...n, simulated: false }));
          ['notification:new', 'reminders:sweep'].forEach(() => {});
          socket.on('notification:new', (n) => pushGateway(n));
          DEMO_SOCKET_EVENTS.forEach((ev) =>
            socket.on(ev, () => setUnread((u) => u + 1)));
        } catch { /* socket optional */ }
      }
    });
    return () => socketRef.current?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toast = useCallback((message, tone = 'ok', detail = null) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone, detail }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
  }, []);

  // Rehydrate the api module's current-user (module state is lost on reload).
  useEffect(() => { if (user) setUser(user); }, [user]);

  /** Engine-side simulated gateway events (Mode B). */
  const pushGateway = useCallback((n) => {
    const row = { ...n, _id: localNotifId.current++, at: new Date().toISOString() };
    setGateway((g) => [row, ...g].slice(0, 80));
    setUnread((u) => u + 1);
  }, []);

  const t = useCallback((key) => translate(lang, key), [lang]);

  const signIn = useCallback(async (fn) => {
    const result = await fn(); // calls api.login/demoLogin; returns {user, token, simulated}
    setToken(result.token);
    setUser(result.user);
    setLocalUser(result.user);
    localStorage.setItem('chsc_user', JSON.stringify(result.user));
    if (result.simulated) pushGateway({ channel: 'SYSTEM', type: 'DEMO_SESSION', recipient: result.user.email, message: `Local demo session started for ${result.user.name} (${result.user.role}). Simulated — not a real server session.`, status: 'SIMULATED', provider: 'Local Engine' });
    return result.user;
  }, [pushGateway]);

  const signOut = useCallback(() => {
    setToken(null); setUser(null);
    setLocalUser(null);
    localStorage.removeItem('chsc_user');
    setPage('overview');
  }, []);

  const navigate = useCallback((p) => {
    setPage(p);
    location.hash = `#/${p}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHash = () => {
      const hash = location.hash.replace('#/', '');
      if (hash) { setPage(hash); return; }
      try { setPage(localStorage.getItem('chsc_user') ? 'overview' : 'welcome'); } catch { setPage('welcome'); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const value = useMemo(() => ({
    mode, user, theme, lang, science, page, toasts, gateway, drawerOpen, unread, screenshotMode,
    setTheme, setLang, setScience, setPage: navigate, setDrawerOpen, setUnread, setScreenshotMode,
    toast, pushGateway, t, signIn, signOut,
    isStaff: user && ['DOCTOR', 'VOLUNTEER'].includes(user.role),
    isOrganizer: user && ['ORGANIZER', 'ADMIN'].includes(user.role),
    isAdmin: user && user.role === 'ADMIN',
    socket: socketRef.current,
  }), [mode, user, theme, lang, science, page, toasts, gateway, drawerOpen, unread, screenshotMode, toast, pushGateway, t, signIn, signOut, navigate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Reusable data-fetch hook with loading/error/empty states. */
export function useFetch(fn, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ loading: !skip, data: null, error: null });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: err.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { if (!skip) reload(); }, [reload, skip]);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}
