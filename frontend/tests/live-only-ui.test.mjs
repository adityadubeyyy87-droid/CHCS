import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path) => readFileSync(join(here, '..', 'src', path), 'utf8');

test('the retired science X-ray overlay is gone from the interface', () => {
  for (const path of ['App.jsx', 'store.jsx', 'components/Shell.jsx', 'components/ui.jsx', 'pages/Settings.jsx']) {
    const text = source(path);
    assert.doesNotMatch(text, /science-on/, `${path} still toggles the science body class`);
    assert.doesNotMatch(text, /\bSci\b/, `${path} still references the Sci component`);
  }
});

test('the retired concurrency-proof page and API call are gone', () => {
  assert.doesNotMatch(source('App.jsx'), /ConcurrencyProof|concurrencyProof/);
  assert.doesNotMatch(source('components/Shell.jsx'), /concurrencyProof/);
  assert.doesNotMatch(source('components/CommandPalette.jsx'), /concurrencyProof/);
  assert.doesNotMatch(source('lib/api.js'), /concurrency-proof|concurrencyProof/);
  assert.doesNotMatch(source('lib/i18n.js'), /concurrencyProof/);
});

test('SMS is not presented as a configurable delivery channel', () => {
  const readiness = source('pages/Readiness.jsx');
  assert.doesNotMatch(readiness, /SMS delivery|channel="SMS"|provider\.sms/);
  const admin = source('components/AdminWorkflows.jsx');
  assert.doesNotMatch(admin, /SMS delivery mode|smsProviderMode/);
});

test('camera scanning falls back to a lazy jsQR decoder', () => {
  const staff = source('pages/StaffDay.jsx');
  assert.match(staff, /import\('jsqr'\)/);
  assert.match(staff, /BarcodeDetector/);
  assert.match(staff, /getImageData/);
});
