// format.js — shared formatting helpers (client side)
export function fmtTime12(t) {
  if (!t) return '—';
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(String(d).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function dayTone(d) {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  if (s === local) return 'today';
  return s > local ? 'future' : 'past';
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function slotTone(remaining, capacity) {
  if (remaining <= 0) return 'full';
  if (capacity > 0 && remaining / capacity <= 0.25) return 'almost';
  return 'open';
}

export function cls(...args) {
  return args.filter(Boolean).join(' ');
}
