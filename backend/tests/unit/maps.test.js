'use strict';

const {
  buildMapsUrl,
  buildTicketQrPayload,
  extractTicketToken,
  addressDestination,
  validCoordinates,
  publicBaseUrl,
  buildShortNavigationUrl,
} = require('../../lib/maps');

describe('Google Maps ticket helpers', () => {
  it('builds a directions URL from exact coordinates when present', () => {
    const url = buildMapsUrl({ latitude: 12.9569, longitude: 77.7011 });
    expect(url).toContain('https://www.google.com/maps/dir/?api=1');
    expect(url).toContain('destination=12.9569%2C77.7011');
    expect(url).toContain('travelmode=driving');
  });

  it('falls back to the encoded venue and full address when coordinates are absent', () => {
    const url = buildMapsUrl({
      venue: 'CMRIT Auditorium',
      address: 'AECS Layout, Kundalahalli, Bengaluru - 560037',
      city: 'Bengaluru',
    });
    expect(url).toContain('destination=');
    const destination = decodeURIComponent(url.split('destination=')[1].split('&')[0]);
    expect(destination).toContain('CMRIT Auditorium');
    expect(destination).toContain('AECS Layout');
    expect(destination).toContain('560037');
  });

  it('ignores 0,0 and out-of-range coordinates', () => {
    expect(validCoordinates(0, 0)).toBeNull();
    expect(validCoordinates(120, 77)).toBeNull();
    expect(buildMapsUrl({ latitude: 0, longitude: 0, venue: 'Hall' })).toContain('destination=Hall');
  });

  it('returns null when there is nothing to navigate to', () => {
    expect(buildMapsUrl({})).toBeNull();
    expect(addressDestination({})).toBe('');
  });

  it('puts the ticket token in the fragment so Google never receives it', () => {
    const maps = 'https://www.google.com/maps/dir/?api=1&destination=12.9%2C77.6';
    const payload = buildTicketQrPayload(maps, 'CHSC-BLR-ABCDEFGH');
    expect(payload).toBe(`${maps}#chsc=CHSC-BLR-ABCDEFGH`);
    expect(payload.split('#')[0]).toBe(maps);
  });

  it('extracts the token from a scanned Maps QR, a query URL, or a raw pass', () => {
    const maps = 'https://www.google.com/maps/dir/?api=1&destination=12.9%2C77.6';
    const payload = buildTicketQrPayload(maps, 'CHSC-BLR-ABCDEFGH');
    expect(extractTicketToken(payload)).toBe('CHSC-BLR-ABCDEFGH');
    expect(extractTicketToken('https://example.test/pass?chsc=CHSC-BLR-123456')).toBe(
      'CHSC-BLR-123456',
    );
    expect(extractTicketToken('  CHSC-BLR-LEGACY1  ')).toBe('CHSC-BLR-LEGACY1');
    expect(extractTicketToken('A-123456')).toBe('A-123456');
    expect(extractTicketToken('')).toBe('');
  });

  it('derives a public base URL and a short navigation link', () => {
    expect(publicBaseUrl({ PUBLIC_BASE_URL: 'https://api.chsc.app/' })).toBe('https://api.chsc.app');
    expect(publicBaseUrl({ RAILWAY_PUBLIC_DOMAIN: 'chsc.up.railway.app' })).toBe(
      'https://chsc.up.railway.app',
    );
    expect(publicBaseUrl({ FRONTEND_ORIGIN: 'https://app.chsc.app,https://backup.chsc.app' })).toBe(
      'https://app.chsc.app',
    );
    expect(buildShortNavigationUrl('https://api.chsc.app/', 'CHSC-BLR-ABC')).toBe(
      'https://api.chsc.app/n/CHSC-BLR-ABC',
    );
  });
});
