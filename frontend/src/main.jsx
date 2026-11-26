import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { registerPushWorker } from './lib/push.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Registering the worker is harmless without permission; the opt-in button in
// Settings requests permission and creates the actual PushManager subscription.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerPushWorker().catch(() => {
      // An unsupported or blocked worker must never break the app shell.
    });
  });
}
