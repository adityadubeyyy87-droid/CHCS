import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCardSvg, escapeXml } from '../src/lib/appointmentCard.js';

test('escapeXml neutralises markup in live data', () => {
  assert.equal(escapeXml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeXml("O'Brien & Co"), 'O&apos;Brien &amp; Co');
});

test('appointment card requires a real QR pass', async () => {
  await assert.rejects(() => appointmentCardSvg({ id: 1 }), /QR token/);
});

test('appointment card embeds live booking details without an external image', async () => {
  const svg = await appointmentCardSvg({
    id: 42,
    tokenNumber: 'A-042',
    qrToken: 'real-token',
    qrPayload: 'https://maps.example/?ticket=real-token',
    campTitle: 'Eye <Camp>',
    patientName: 'Asha Rao',
    familyMemberName: null,
    status: 'CONFIRMED',
    campDate: '2026-12-02',
    startTime: '09:00:00',
    endTime: '09:30:00',
    venue: 'CMRIT',
    address: 'Bengaluru',
    city: 'Bengaluru',
  });
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /A-042/);
  assert.match(svg, /Eye &lt;Camp&gt;/);
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /https?:\/\/api\.qrserver/);
});
