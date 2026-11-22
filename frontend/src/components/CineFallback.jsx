// CineFallback.jsx — CSS stand-in for the WebGL stage.
// Used when the scene chunk fails to load, when WebGL is unavailable, or as
// the Suspense placeholder while three.js is being fetched. It keeps the same
// clinical beacon + ridge composition, never a blank rectangle.
import React from 'react';

export default function CineFallback({ className = '' }) {
  return (
    <div className={`cine-stage cine-fallback ${className}`} aria-hidden="true">
      <div className="cine-fallback-beacon">
        <span className="cine-fallback-core" />
        <span className="cine-fallback-ring" />
        <span className="cine-fallback-ring cine-fallback-ring--mid" />
        <span className="cine-fallback-ring cine-fallback-ring--outer" />
      </div>
      <div className="cine-fallback-ridge" />
    </div>
  );
}
