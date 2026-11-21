// CommandPalette.jsx — Cmd+K / Ctrl+K quick navigation overlay.
// Power-user feature: jump to any page or run a demo scenario from the keyboard.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { useSound } from '../lib/audio.js';
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

export default function CommandPalette() {
  const { setPage, user, science, setScience, screenshotMode, setScreenshotMode } = useApp();
  const { click, success, error } = useSound();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const next = !open;
        setOpen(next);
        if (next) {
          audioStart?.();
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
      if (open && e.key === 'Escape') { setOpen(false); click(); }
      if (open && filtered.length && e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => (s + 1) % filtered.length); click(); }
      if (open && filtered.length && e.key === 'ArrowUp') { e.preventDefault(); setSelected((s - 1 + filtered.length) % filtered.length); click(); }
      if (open && e.key === 'Enter' && filtered.length) { e.preventDefault(); run(filtered[selected]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, query, user]);

  const filtered = COMMANDS.filter((c) =>
    !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase())
  );

  let audioStart;
  useEffect(() => {
    const start = async () => { const m = await import('../lib/audio.js'); m.default.start(); };
    audioStart = start;
  }, []);

  const run = (cmd) => {
    if (!cmd) return;
    setOpen(false);
    setQuery('');
    setSelected(0);
    if (cmd.action === 'demo') {
      window.dispatchEvent(new CustomEvent('chsc:toggle-demo'));
    } else if (cmd.action === 'analytics' && !(user?.role === 'ORGANIZER' || user?.role === 'ADMIN')) { error(); return; }
    else if ((cmd.action === 'staffDay' || cmd.action === 'liveQueue' || cmd.action === 'manage') && !(user?.role === 'DOCTOR' || user?.role === 'VOLUNTEER' || user?.role === 'ORGANIZER' || user?.role === 'ADMIN')) { error(); return; }
    else setPage(cmd.action);
    success();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button type="button" className="fixed inset-0 bg-black/50 cursor-default" aria-label="Close command palette" onClick={() => setOpen(false)} />
      <div className="relative z-[201] w-full max-w-lg mx-4 rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Icon name="zap" size={16} />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Command Palette</h2>
          </div>
          <p className="text-sm text-slate-400 mt-1">⌘K to open · type to search · arrow keys to navigate</p>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              autoFocus
              className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition"
              placeholder="Search camps, pages, actions…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); click(); }}
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto pr-2">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-slate-500">
                <Icon name="search" size={24} className="mx-auto mb-3 opacity-30" />
                <p>No matches found</p>
              </div>
            ) : (
              filtered.map((cmd, i) => {
                const allowed = cmd.action === 'demo' || cmd.action === 'settings' || cmd.action === 'notifications'
                  || (cmd.action === 'analytics' && (user?.role === 'ORGANIZER' || user?.role === 'ADMIN'))
                  || (['staffDay', 'liveQueue', 'manage'].includes(cmd.action) && (user?.role === 'DOCTOR' || user?.role === 'VOLUNTEER' || user?.role === 'ORGANIZER' || user?.role === 'ADMIN'));
                return (
                  <button
                    key={cmd.key}
                    onClick={() => { if (allowed) run(cmd); else error(); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg transition ${
                      i === selected ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-500/30' : 'text-slate-300 hover:bg-white/5 hover:border-white/10'
                    } ${!allowed ? 'opacity-50' : ''}`}
                    disabled={!allowed}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500">
                      <Icon name={cmd.icon} size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{cmd.label}</div>
                      <div className="text-xs text-slate-500 truncate">{cmd.desc}</div>
                    </div>
                    {!allowed && <span className="text-xs text-slate-500">locked</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="p-3 border-t border-white/5 bg-slate-900/30 text-center">
          <p className="text-xs text-slate-500">↑↓ navigate · Enter select · Esc close</p>
        </div>
      </div>
    </div>
  );
}
