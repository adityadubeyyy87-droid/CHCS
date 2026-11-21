'use strict';

/**
 * Regression: the production build served by the backend itself (GET /) must be
 * reachable when the page origin is the backend origin (http://localhost:4000).
 *
 * The CORS origin callback rejects anything not on the allow-list. The allow-list
 * is sourced from BACKEND/.env (via dotenv), which must therefore include the
 * backend origin itself — otherwise every static-asset request from the "full
 * version" (http://localhost:4000) is rejected and the page 500s. That was the
 * "full version not opening" defect.
 */

const { app, request } = require('../helpers/api');

describe('full-version static serving (backend origin)', () => {
  it('serves the built frontend for the backend origin without CORS rejection', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:4000');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!doctype html');
  });

  it('serves the built frontend for the loopback frontend origin', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
  });

  it('rejects an unlisted browser origin', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(403);
  });
});
