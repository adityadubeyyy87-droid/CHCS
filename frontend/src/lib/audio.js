// audio.js — Web Audio API sound design system.
// Subtle, non-intrusive sonic feedback for confirmations, errors and
// celebrations. Always respects prefers-reduced-motion and is gated behind
// a user gesture (first click), so browsers never autoplay audio.
const ACTX = typeof AudioContext !== 'undefined' ? new (window.AudioContext || window.webkitAudioContext)() : null;

let started = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tone = (freq, type = 'sine', duration = 0.12, when = 0, volume = 0.08) => {
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
export const useSound = () => ({ click, success, error: error, notify, confirm });
export default { click, success, error, notify, confirm, start };
