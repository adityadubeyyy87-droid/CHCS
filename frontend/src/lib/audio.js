// audio.js — Web Audio API sound design system.
// Subtle, non-intrusive sonic feedback for confirmations, errors and
// celebrations. Honours prefers-reduced-motion and only creates an AudioContext
// after a user gesture, so browsers never autoplay audio.
let ctx = null;
let started = false;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Lazily create the context; never at module import time. */
function getContext() {
  if (prefersReducedMotion() || typeof window === 'undefined') return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const tone = (freq, type = 'sine', duration = 0.12, when = 0, volume = 0.08) => {
  const ACTX = getContext();
  if (!ACTX) return;
  const osc = ACTX.createOscillator();
  const gain = ACTX.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ACTX.currentTime + when);
  gain.gain.setValueAtTime(volume, ACTX.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.001, ACTX.currentTime + when + duration);
  osc.connect(gain);
  gain.connect(ACTX.destination);
  osc.start(ACTX.currentTime + when);
  osc.stop(ACTX.currentTime + when + duration);
};

const chord = (freqs, when = 0, duration = 0.5, volume = 0.05) => {
  freqs.forEach((f, i) => tone(f, 'sine', duration, when + i * 0.03, volume));
};

const start = async () => {
  const ACTX = getContext();
  if (started || !ACTX) return;
  if (ACTX.state === 'suspended') await ACTX.resume();
  started = true;
};

// Confirmation — ascending major triad, warm
const confirm = () => {
  start();
  chord([523.25, 659.25, 783.99], 0, 0.35, 0.06);
};
// Error — descending minor cluster, muted
const error = () => {
  start();
  chord([220, 185, 155], 0, 0.4, 0.05);
};
// UI click — short, soft tick
const click = () => {
  start();
  tone(900, 'sine', 0.05, 0, 0.02);
};
// Success celebration — arpeggiated major chord
const success = () => {
  start();
  tone(523.25, 'sine', 0.2, 0, 0.07);
  tone(659.25, 'sine', 0.2, 0.1, 0.07);
  tone(783.99, 'sine', 0.3, 0.2, 0.07);
  tone(1046.5, 'sine', 0.4, 0.3, 0.06);
};
// Notification ding — clean single tone
const notify = () => {
  start();
  tone(880, 'sine', 0.15, 0, 0.05);
};

export const startAudio = start;
export const useSound = () => ({ click, success, error, notify, confirm });
export default { click, success, error, notify, confirm, start };
