// CineFallback.jsx — the CSS stand-in for the WebGL stage.
//
// Used when the scene chunk fails to load, when WebGL is unavailable, or as
// the Suspense placeholder while three.js is being fetched. It is a real
// composition (sun + ridge), never a blank rectangle.
import React from 'react';

export default function CineFallback({ className = '' }) {
  return (
    <div className={`cine-stage cine-fallback ${className}`} aria-hidden="true">
      <div className="cine-fallback-sun" />
      <div className="cine-fallback-ridge" />
    </div>
  );
}
