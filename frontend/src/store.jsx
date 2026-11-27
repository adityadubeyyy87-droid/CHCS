// store.jsx — global app state: auth, live connection status, theme, language,
// science overlay, toasts, real gateway feed, Socket.io and routing.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, probeHealth, setToken, setUser } from './lib/api.js';
import { translate } from './lib/i18n.js';

// Same-origin by default (backend-served build or Vite proxy). When the UI is
// on a static host, VITE_API_BASE points at the API and the socket follows it.
const SOCKET_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/api\/?$/, '').replace(/\/+$/, '');

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [mode, setMode] = useState('connecting'); // 'connecting' | 'live' | 'error'
  const [connectionError, setConnectionError] = useState(null);
  const [user, setLocalUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chsc_user') || 'null'); } catch { return null; }
  });
  const [theme, setTheme] = useState(() => localStorage.getItem('chsc_theme') || 'dark');
  const [lang, setLang] = useState(() => localStorage.getItem('chsc_lang') || 'en');
  const [science, setScience] = useState(false);
  const [page, setPage] = useState(() => {
    const hash = location.hash.replace('#/', '');
    if (hash) return hash;
    try { return localStorage.getItem('chsc_user') ? 'overview' : 'welcome'; } catch { return 'welcome'; }
  });
  const [toasts, setToasts] = useState([]);
  const [gateway, setGateway] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [inbox, setInbox] = useState([]);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const socketRef = useRef(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const localNotifId = useRef(1);
  const seenNotificationIds = useRef(new Set());
  const bootedRef = useRef(false);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('chsc_theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('chsc_lang', lang); }, [lang]);
  useEffect(() => { document.body.classList.toggle('screenshot', screenshotMode); }, [screenshotMode]);
  useEffect(() => { if (user) setUser(user); }, [user]);

  const toast = useCallback((message, tone = 'ok', detail = null) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { id, message, tone, detail }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4600);
  }, []);

  /** Bell inbox: the MySQL-backed notification row list, never a local fake. */
  const refreshInbox = useCallback(async () => {
    if (!localStorage.getItem('chsc_token')) {
      setInbox([]);
      setInboxUnread(0);
      return;
    }
    try {
      const data = await api.inbox({ page: 1, pageSize: 20 });
      setInbox(data?.notifications || []);
      setInboxUnread(Number(data?.unread || 0));
    } catch {
      setInbox([]);
      setInboxUnread(0);
    }
  }, []);

  useEffect(() => { refreshInbox(); }, [user, refreshInbox]);

  /** Live activity feed: real notification rows plus explicitly local activity. */
  const pushGateway = useCallback((event) => {
    const notificationId = event?.id === undefined || event?.id === null ? null : String(event.id);
    if (notificationId) {
      if (seenNotificationIds.current.has(notificationId)) return;
      seenNotificationIds.current.add(notificationId);
    }
    const isLocalActivity = Boolean(event?.localActivity);
    const row = {
      ...event,
      _id: localNotifId.current++,
      at: event?.at || new Date().toISOString(),
      status: isLocalActivity ? 'LOCAL' : (event?.status || 'PENDING'),
      localActivity: isLocalActivity,
    };
    if (isLocalActivity) {
      delete row.recipient;
      delete row.provider;
    }
    setGateway((current) => [row, ...current].slice(0, 80));
    setUnread((count) => count + 1);
  }, []);

  const connectSocket = useCallback(() => {
    if (socketRef.current) return;
    const authToken = localStorage.getItem('chsc_token');
    if (!authToken) return;
    try {
      const socket = io(SOCKET_BASE || undefined, {
        transports: ['websocket', 'polling'],
        auth: { token: authToken },
      });
      socketRef.current = socket;
      socket.on('connect', () => setSocketOnline(true));
      socket.on('disconnect', () => setSocketOnline(false));
      socket.on('connect_error', (error) => {
        setSocketOnline(false);
        if (error?.message && error.message !== 'Authentication error') {
          console.warn('[CHSC] realtime connection:', error.message);
        }
      });
      // Both events carry the same redacted notification id; pushGateway
      // de-duplicates by id so one notification cannot be counted twice.
      socket.on('gateway:message', (event) => pushGateway(event));
      socket.on('notification:new', (event) => pushGateway(event));
      socket.on('inapp:changed', () => refreshInbox());
    } catch (error) {
      console.warn('[CHSC] realtime connection:', error.message);
    }
  }, [pushGateway, refreshInbox]);

  const refreshConnection = useCallback(async () => {
    setMode('connecting');
    setConnectionError(null);
    try {
      await probeHealth();
      setMode('live');
      connectSocket();
      return true;
    } catch (error) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketOnline(false);
      }
      setMode('error');
      setConnectionError(error.message);
      return false;
    }
  }, [connectSocket]);

  useEffect(() => {
    if (bootedRef.current) return undefined;
    bootedRef.current = true;
    refreshConnection();
    return () => socketRef.current?.disconnect();
  }, [refreshConnection]);

  const t = useCallback((key) => translate(lang, key), [lang]);

  const navigate = useCallback((nextPage) => {
    setPage(nextPage);
    location.hash = `#/${nextPage}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const signIn = useCallback(async (requestSession) => {
    const result = await requestSession();
    if (!result?.token || !result?.user) {
      throw new Error('The sign-in response did not include a session.');
    }
    setToken(result.token);
    setUser(result.user);
    setLocalUser(result.user);
    localStorage.setItem('chsc_user', JSON.stringify(result.user));
    await refreshInbox();
    // A successful auth call is not a substitute for the health probe.
    const connected = await refreshConnection();
    // A successful sign-in is a navigation, not just a state change.
    navigate('overview');
    if (!connected) toast('Signed in, but the backend health check did not pass.', 'warn');
    return result.user;
  }, [navigate, refreshConnection, refreshInbox, toast]);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    setLocalUser(null);
    setInbox([]);
    setInboxUnread(0);
    localStorage.removeItem('chsc_user');
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocketOnline(false);
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
    mode, connectionError, user, theme, lang, science, page, toasts, gateway,
    drawerOpen, unread, screenshotMode, inbox, inboxUnread,
    setTheme, setLang, setScience, setPage: navigate, setDrawerOpen, setUnread, setScreenshotMode,
    toast, pushGateway, t, signIn, signOut, refreshConnection, refreshInbox,
    socketOnline,
    isStaff: Boolean(user && ['DOCTOR', 'VOLUNTEER'].includes(user.role)),
    isOrganizer: Boolean(user && ['ORGANIZER', 'ADMIN'].includes(user.role)),
    isAdmin: Boolean(user && user.role === 'ADMIN'),
    socket: socketRef.current,
  }), [mode, connectionError, user, theme, lang, science, page, toasts, gateway, drawerOpen, unread,
    screenshotMode, inbox, inboxUnread, toast, pushGateway, t, signIn, signOut, refreshConnection,
    refreshInbox, navigate, socketOnline]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Reusable data-fetch hook with loading/error/empty states. */
export function useFetch(fn, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ loading: !skip, data: null, error: null });
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      setState({ loading: false, data: null, error: error.message });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { if (!skip) reload(); }, [reload, skip]);
  return {
    ...state,
    reload,
    setData: (next) => setState((current) => ({
      ...current,
      data: typeof next === 'function' ? next(current.data) : next,
    })),
  };
}
