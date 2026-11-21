// store.jsx — global app state: auth, mode, theme, language, science overlay,
// toasts, gateway interceptor feed, socket connection, routing.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, detectMode, setModeListener, setToken, setUser } from './lib/api.js';
import { translate } from './lib/i18n.js';

// Same-origin by default (backend-served build or Vite proxy). When the UI is
// on a static host, VITE_API_BASE points at the API and the socket follows it.
const SOCKET_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/api\/?$/, '');

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// These are realtime events emitted by the Express server in Mode A — not
// demo-engine events. They only bump the unread badge; notification content
// arrives through `notification:new` / `gateway:message`.
const LIVE_SOCKET_EVENTS = ['booking:confirmed', 'waitlist:joined', 'waitlist:promoted', 'checkin:new', 'queue:updated'];

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
  const [socketOnline, setSocketOnline] = useState(false);
  const localNotifId = useRef(1);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('chsc_theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('chsc_lang', lang); }, [lang]);
  useEffect(() => { document.body.classList.toggle('screenshot', screenshotMode); }, [screenshotMode]);

  useEffect(() => {
    setModeListener(setMode);
    detectMode().then((m) => {
      if (m === 'live') {
        try {
          const socket = io(SOCKET_BASE || undefined, {
            transports: ['websocket', 'polling'],
            auth: { token: localStorage.getItem('chsc_token') || null },
          });
          socketRef.current = socket;
          socket.on('connect', () => { setSocketOnline(true); });
          socket.on('disconnect', () => setSocketOnline(false));
          socket.on('connect_error', (error) => {
            setSocketOnline(false);
            // An anonymous visitor may still browse the app; private realtime
            // rooms simply stay disconnected until they sign in.
            if (error?.message && error.message !== 'Authentication error') {
              console.warn('[CHSC] realtime connection:', error.message);
            }
          });
          socket.on('gateway:message', (n) => pushGateway({ ...n, simulated: false }));
          socket.on('notification:new', (n) => pushGateway({ ...n, simulated: false }));
          LIVE_SOCKET_EVENTS.forEach((ev) => {
            const onUnread = () => setUnread((u) => u + 1);
            socket.on(ev, onUnread);
          });
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

  const navigate = useCallback((p) => {
    setPage(p);
    location.hash = `#/${p}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const signIn = useCallback(async (fn) => {
    const result = await fn(); // calls api.login/demoLogin; returns {user, token, simulated}
    setToken(result.token);
    setUser(result.user);
    setLocalUser(result.user);
    localStorage.setItem('chsc_user', JSON.stringify(result.user));
    if (socketRef.current) {
      socketRef.current.auth = { ...(socketRef.current.auth || {}), token: result.token };
      socketRef.current.connect();
    }
    if (result.simulated) pushGateway({ channel: 'SYSTEM', type: 'DEMO_SESSION', recipient: result.user.email, message: `Local demo session started for ${result.user.name} (${result.user.role}). Simulated — not a real server session.`, status: 'SIMULATED', provider: 'Local Engine' });
    // A successful sign-in is a navigation, not just a state change. Without
    // this, the shell falls back to Overview while the URL still says #/login.
    navigate('overview');
    return result.user;
  }, [pushGateway, navigate]);

  const signOut = useCallback(() => {
    setToken(null); setUser(null);
    setLocalUser(null);
    localStorage.removeItem('chsc_user');
    if (socketRef.current) {
      socketRef.current.auth = { ...(socketRef.current.auth || {}), token: null };
      // Force a fresh handshake on the next sign-in; changing auth alone does
      // not re-handshake a socket that is still connected.
      socketRef.current.disconnect();
    }
    navigate('welcome');
  }, [navigate]);

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
    socketOnline,
    isStaff: user && ['DOCTOR', 'VOLUNTEER'].includes(user.role),
    isOrganizer: user && ['ORGANIZER', 'ADMIN'].includes(user.role),
    isAdmin: user && user.role === 'ADMIN',
    socket: socketRef.current,
  }), [mode, user, theme, lang, science, page, toasts, gateway, drawerOpen, unread, screenshotMode, toast, pushGateway, t, signIn, signOut, navigate, socketOnline]);

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
      return data;
    } catch (err) {
      setState({ loading: false, data: null, error: err.message });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { if (!skip) reload(); }, [reload, skip]);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}
