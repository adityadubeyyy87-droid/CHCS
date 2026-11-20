// Passport.jsx — Digital Health Passport: the appointment pass with QR,
// ICS calendar export and the Community Health Champion seal.
// Contains no medical data by design — identity + logistics only.
import React, { useMemo, useState } from 'react';
import Qr from '../lib/qr.jsx';
import { Badge, Button, Icon, Modal } from './ui.jsx';
import { fmtDate, fmtTime12, cls } from '../lib/format.js';
import { useApp } from '../store.jsx';

export function bookingToIcs(b) {
  const date = String(b.campDate || '').slice(0, 10);
  const [sh, sm] = String(b.startTime || '09:00').split(':');
  const [eh, em] = String(b.endTime || '09:30').split(':');
  const stamp = (h, m) => `${date.replace(/-/g, '')}T${h}${m}00`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CHSC//Health Camp//EN', 'BEGIN:VEVENT',
    `UID:${b.qrToken}@chsc.cmrit.edu`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART;TZID=Asia/Kolkata:${stamp(sh, sm)}`,
    `DTEND;TZID=Asia/Kolkata:${stamp(eh, em)}`,
    `SUMMARY:CHSC Screening — ${b.campTitle || 'Community Health Camp'} (${b.tokenNumber})`,
    `DESCRIPTION:Booking ${b.qrToken}. Arrive 10 minutes early with this pass. Free screening event.`,
    `LOCATION:${b.venue || ''}, ${b.address || ''}`,
    'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:CHSC camp reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadIcs(b) {
  const blob = new Blob([bookingToIcs(b)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chsc-${(b.qrToken || 'pass').replace(/[^A-Z0-9-]/gi, '')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

const CONFETTI_COLORS = ['#10b981', '#6ee7b7', '#f59e0b', '#60a5fa', '#fcd34d', '#ecfdf5'];
const CONFETTI = Array.from({ length: 30 }, (_, i) => ({
  left: ((i * 37 + 11) % 96) + 2,
  delay: (i % 9) * 90,
  duration: 1700 + (i % 7) * 190,
  drift: ((i * 53) % 160) - 80,
  spin: (i % 2 ? 1 : -1) * (300 + (i % 5) * 120),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
}));

export function Passport({ booking, onClose, embedded = false, celebrated = false }) {
  const { user, toast } = useApp();
  const [seal, setSeal] = useState(celebrated);
  if (!booking) return null;
  const name = booking.patientName || user?.name || 'Community Member';

  return (
    <div className={cls('passport', seal && 'passport-sealed')} role="region" aria-label="Digital Health Passport">
      {celebrated && (
        <div className="confetti" aria-hidden="true">
          {CONFETTI.map((p, i) => (
            <i
              key={i}
              style={{
                left: `${p.left}%`,
                background: p.color,
                animationDelay: `${p.delay}ms`,
                animationDuration: `${p.duration}ms`,
                '--drift': `${p.drift}px`,
                '--spin': `${p.spin}deg`,
              }}
            />
          ))}
        </div>
      )}
      <div className="passport-strip" aria-hidden="true" />
      <div className="passport-top">
        <div>
          <p className="passport-brand">Community Health Screening · Bengaluru</p>
          <h3>Digital Health Passport</h3>
        </div>
        <Badge status={booking.status} />
      </div>

      <div className="passport-grid">
        <div className="passport-fields">
          <div><small>Patient</small><strong>{name}</strong></div>
          <div><small>Camp</small><strong>{booking.campTitle}</strong></div>
          <div>
            <small>Date & slot</small>
            <strong>{fmtDate(booking.campDate)} · {fmtTime12(booking.startTime)}–{fmtTime12(booking.endTime)}</strong>
          </div>
          <div>
            <small>Venue</small>
            <strong>{booking.venue}<br /><span className="muted">{booking.address}</span></strong>
          </div>
          <div className="passport-refs">
            <div><small>Token</small><strong className="mono">{booking.tokenNumber}</strong></div>
            <div><small>Reference</small><strong className="mono">{booking.qrToken}</strong></div>
          </div>
        </div>

        <div className="passport-qr">
          <Qr text={booking.qrToken} size={148} dark="#04310f" className={cls('qr-pulse', seal && 'qr-pulse')} label={`QR pass ${booking.qrToken}`} />
          <p className="muted">Show at the gate · no printing needed</p>
        </div>
      </div>

      <div className="passport-foot">
        <ul className="passport-notes">
          <li>Arrive 10 minutes early; the gate opens 15 minutes before your slot.</li>
          <li>Carry any photo ID. Screening is free — no payment is ever requested.</li>
          <li>Plans changed? One-tap release in My Appointments lets a waiting neighbour take your seat.</li>
        </ul>
        <div className={cls('passport-seal', seal && 'seal-active')} aria-hidden="true">
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle cx="32" cy="32" r="29" fill="none" stroke="#059669" strokeWidth="2.4" strokeDasharray="3.4 3" />
            <path d="M20 33.5 28 41l16.5-18" fill="none" stroke="#059669" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <small>Community Health<br />Champion · Verified</small>
        </div>
      </div>

      {!embedded && (
        <div className="passport-actions">
          <Button variant="ghost" size="sm" icon="download" onClick={() => { downloadIcs(booking); toast('Calendar file downloaded (.ics)'); }}>Add to calendar</Button>
          <Button variant="ghost" size="sm" icon="qr" onClick={() => window.print()}>Print / save PDF</Button>
        </div>
      )}
    </div>
  );
}

export function PassportModal({ booking, onClose }) {
  return (
    <Modal open={Boolean(booking)} onClose={onClose} title="Digital Health Passport" wide>
      {booking && <Passport booking={booking} />}
    </Modal>
  );
}
