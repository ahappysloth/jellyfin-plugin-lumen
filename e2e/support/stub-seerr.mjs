// A stand-in for Seerr (and TMDB's image CDN) for the end-to-end tests: just the endpoints Lumen calls, with fixture
// data, so CI needs no real Seerr or internet. Started by Playwright's `webServer` (see playwright.config.ts).
//
//   GET  /api/v1/status                         → { version }
//   GET  /api/v1/user/jellyfin/:jellyfinUserId  → the mapped user, 404 if unmapped, 403 without the right key
//   GET  /api/v1/settings/jellyfin              → the Jellyfin server this "Seerr" is linked to
//   GET  /t/p/:size/:file                       → a tiny PNG (TMDB image stand-in)
//   POST /__stub/users  { [jellyfinUserId]: { id, permissions } }   → replaces the user map (test control)
//   POST /__stub/jellyfin  { name, serverId }                       → sets the linked Jellyfin server (test control)
//   GET  /__stub/health
import { createServer } from 'node:http';

export const STUB_API_KEY = 'stub-key';
const PORT = Number(process.env.LUMEN_STUB_SEERR_PORT ?? 5055);
// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
let users = {};
let jellyfin = { name: 'Stub Jellyfin', serverId: '' };

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  const path = url.pathname;
  if (path === '/__stub/health') return json(res, 200, { ok: true });
  if ((path === '/__stub/users' || path === '/__stub/jellyfin') && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (path === '/__stub/users') users = JSON.parse(body || '{}');
      else jellyfin = JSON.parse(body || '{}');
      json(res, 200, { ok: true });
    });
    return;
  }
  if (path.startsWith('/t/p/')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(PNG);
  }
  if (path === '/api/v1/status') return json(res, 200, { version: '3.5.1-stub', commitTag: 'stub' });
  if (req.headers['x-api-key'] !== STUB_API_KEY) return json(res, 403, { message: 'You do not have permission' });
  // Real Seerr also returns its Jellyfin API key here; Lumen must only read name and serverId.
  if (path === '/api/v1/settings/jellyfin') return json(res, 200, { ...jellyfin, ip: 'jellyfin', apiKey: 'must-not-leak' });
  const user = path.match(/^\/api\/v1\/user\/jellyfin\/([0-9a-f]{32})$/);
  if (user) {
    const found = users[user[1]];
    // Seerr's admin view of a user also carries tokens; Lumen must never pass these on.
    return found
      ? json(res, 200, { ...found, jellyfinAuthToken: 'must-not-leak', plexToken: 'must-not-leak' })
      : json(res, 404, { message: 'User not found' });
  }
  return json(res, 404, { message: `stub: no route for ${req.method} ${path}` });
}).listen(PORT, () => console.log(`stub Seerr on :${PORT}`));
