// Passport.jsx — Digital Health Passport: the appointment pass with QR,
// ICS calendar export and the Community Health Champion seal.
// Contains no medical data by design — identity + logistics only.
import React, { useState } from 'react';
import Qr from '../lib/qr.jsx';
import { Badge, Button, Icon, Modal } from './ui.jsx';
import { fmtDate, fmtTime12, cls } from '../lib/format.js';
import { useApp } from '../store.jsx';
import { downloadIcs } from '../lib/ics.js';
import { mapsUrlFor, qrPayloadFor } from '../lib/maps.js';

export { bookingToIcs, downloadIcs } from '../lib/ics.js';

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
  const mapsUrl = mapsUrlFor(booking);
  const qrPayload = qrPayloadFor(booking);

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
            <div><small>Booking ID</small><strong className="mono">#{booking.id}</strong></div>
            <div><small>Token</small><strong className="mono">{booking.tokenNumber}</strong></div>
            <div><small>Reference</small><strong className="mono">{booking.qrToken}</strong></div>
          </div>
          {mapsUrl && (
            <a className="passport-nav" href={mapsUrl} target="_blank" rel="noreferrer">
              <Icon name="pin" size={14} /> Open Google Maps directions
            </a>
          )}
        </div>

        <div className="passport-qr">
          <Qr text={qrPayload} size={148} dark="#04310f" className={cls('qr-pulse', seal && 'qr-pulse')} label={`QR pass ${booking.qrToken} with Google Maps navigation`} />
          <p className="muted">Scan at the gate · opens Google Maps directions</p>
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
          {mapsUrl && (
            <Button variant="ghost" size="sm" icon="pin" onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')}>
              Google Maps directions
            </Button>
          )}
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
