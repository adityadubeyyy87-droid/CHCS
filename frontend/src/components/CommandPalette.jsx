// CommandPalette.jsx — Cmd+K / Ctrl+K quick navigation overlay.
// Power-user feature: jump to any page or run a demo scenario from the keyboard.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { startAudio, useSound } from '../lib/audio.js';
import { Icon } from './ui.jsx';

const COMMANDS = [
  { key: 'overview', label: 'Overview', icon: 'home', desc: 'Camp dashboard & pulse', action: 'overview' },
  { key: 'discover', label: 'Find Health Camps', icon: 'compass', desc: 'Browse & book screening camps', action: 'discover' },
  { key: 'myBookings', label: 'My Appointments', icon: 'ticket', desc: 'Your bookings & QR pass', action: 'myBookings' },
  { key: 'staffDay', label: 'Camp Day', icon: 'stetho', desc: 'Staff duty & QR check-in', action: 'staffDay' },
  { key: 'liveQueue', label: 'Live Queue TV', icon: 'radio', desc: 'Waiting room display', action: 'liveQueue' },
  { key: 'manage', label: 'Camp Management', icon: 'clipboard', desc: 'Create & staff camps', action: 'manage' },
  { key: 'analytics', label: 'Executive Analytics', icon: 'chart', desc: 'KPIs & capacity advisor', action: 'analytics' },
  { key: 'notifications', label: 'Notification Center', icon: 'bell', desc: 'Gateway interceptor log', action: 'notifications' },
  { key: 'settings', label: 'Settings & Privacy', icon: 'gear', desc: 'Theme, language, data purge', action: 'settings' },
  { key: 'demo', label: 'Demo Story Controller', icon: 'zap', desc: 'Run presentation scenarios', action: 'demo' },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CommandPalette() {
  const { setPage, user } = useApp();
  const { click, success, error } = useSound();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

  const filtered = useMemo(() => COMMANDS.filter((c) =>
    !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase())
  ), [query]);

  const isAllowed = useCallback((cmd) => {
    if (!cmd) return false;
    if (cmd.action === 'demo' || cmd.action === 'settings' || cmd.action === 'notifications') return true;
    if (cmd.action === 'analytics') return user?.role === 'ORGANIZER' || user?.role === 'ADMIN';
    if (['staffDay', 'liveQueue', 'manage'].includes(cmd.action)) {
      return ['DOCTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'].includes(user?.role);
    }
    return true;
  }, [user]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelected(0);
  }, []);

  const run = useCallback((cmd) => {
    if (!cmd) return;
    if (!isAllowed(cmd)) { error(); return; }
    close();
    if (cmd.action === 'demo') {
      window.dispatchEvent(new CustomEvent('chsc:toggle-demo'));
    } else {
      setPage(cmd.action);
    }
    success();
  }, [close, error, isAllowed, setPage, success]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!open) {
          restoreRef.current = document.activeElement;
          startAudio();
        }
        setOpen((value) => !value);
        if (!open) requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());

    const focusable = () => Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])
      .filter((el) => el.offsetParent !== null);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        click();
        return;
      }
      if (e.key === 'ArrowDown' && filtered.length) {
        e.preventDefault();
        setSelected((s) => (Math.min(s, filtered.length - 1) + 1) % filtered.length);
        click();
        return;
      }
      if (e.key === 'ArrowUp' && filtered.length) {
        e.preventDefault();
        setSelected((s) => (Math.min(s, filtered.length - 1) - 1 + filtered.length) % filtered.length);
        click();
        return;
      }
      if (e.key === 'Enter' && filtered.length) {
        e.preventDefault();
        run(filtered[Math.min(selected, filtered.length - 1)]);
        return;
      }
      if (e.key === 'Tab') {
        const nodes = focusable();
        if (!nodes.length) { e.preventDefault(); dialogRef.current?.focus(); return; }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [open, filtered, selected, close, click, run]);

  if (!open) return null;

  const activeIndex = filtered.length ? Math.min(selected, filtered.length - 1) : -1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" role="presentation">
      <button type="button" className="fixed inset-0 bg-black/50 cursor-default" aria-label="Close command palette" onClick={close} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-[201] w-full max-w-lg mx-4 rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
      >
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-300">
              <Icon name="zap" size={16} />
            </div>
            <h2 id="command-palette-title" className="text-lg font-semibold tracking-tight">Command Palette</h2>
          </div>
          <p className="text-sm text-slate-300 mt-1">⌘K to open · type to search · arrow keys to navigate</p>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              className="w-full pl-10 pr-4 py-3 bg-slate-900/70 border border-slate-600 rounded-xl text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition"
              placeholder="Search camps, pages, actions…"
              aria-label="Search commands"
              aria-controls="command-results"
              aria-activedescendant={activeIndex >= 0 ? `command-${filtered[activeIndex].key}` : undefined}
              value={query}
              onChange={(e) => { setQuery(e.target.value); click(); }}
            />
          </div>
          <div id="command-results" role="listbox" aria-label="Available commands" className="max-h-[300px] overflow-y-auto pr-2">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-slate-300">
                <Icon name="search" size={24} className="mx-auto mb-3 opacity-50" />
                <p>No matches found</p>
              </div>
            ) : (
              filtered.map((cmd, i) => {
                const allowed = isAllowed(cmd);
                return (
                  <button
                    type="button"
                    id={`command-${cmd.key}`}
                    key={cmd.key}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => run(cmd)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg transition ${
                      i === activeIndex ? 'bg-emerald-500/20 text-emerald-50 border border-emerald-400/40' : 'text-slate-200 hover:bg-white/5 hover:border-white/10'
                    } ${!allowed ? 'opacity-60' : ''}`}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300">
                      <Icon name={cmd.icon} size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{cmd.label}</div>
                      <div className="text-xs text-slate-300 truncate">{cmd.desc}</div>
                    </div>
                    {!allowed && <span className="text-xs text-slate-400">locked</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="p-3 border-t border-white/5 bg-slate-900/50 text-center">
          <p className="text-xs text-slate-300">↑↓ navigate · Enter select · Esc close</p>
        </div>
      </div>
    </div>
  );
}
