// qr.jsx — inline SVG QR generation (qrcode lib renders a self-contained
// <svg> string we inline directly; no image URLs, works fully offline).
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { cls } from './format.js';

export default function Qr({ text, size = 132, dark = '#0B1220', light = '#FFFFFF', className, label }) {
  const [svg, setSvg] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toString(text || ' ', {
      type: 'svg', margin: 1, width: size,
      color: { dark, light }, errorCorrectionLevel: 'M',
    })
      .then((out) => { if (alive) { setSvg(out); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [text, size, dark, light]);
  if (failed) {
    return <span className={cls('qr qr-fallback', className)} style={{ width: size, height: size }} aria-label={label || 'QR placeholder'}>{label || text}</span>;
  }
  return (
    <span
      className={cls('qr', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label || `QR code for ${text}`}
      dangerouslySetInnerHTML={{ __html: svg || '' }}
    />
  );
}
