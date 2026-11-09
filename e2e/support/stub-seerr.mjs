// A stand-in for Seerr (and TMDB's image CDN) for the end-to-end tests: just the endpoints Lumen calls, with fixture
// data, so CI needs no real Seerr or internet. Started by Playwright's `webServer` (see playwright.config.ts).
//
//   GET  /api/v1/status                         → { version }
//   GET  /api/v1/user/jellyfin/:jellyfinUserId  → the mapped user, 404 if unmapped, 403 without the right key
//   GET  /api/v1/settings/jellyfin              → the Jellyfin server this "Seerr" is linked to
//   GET  /api/v1/search?query=&page=            → "matrix" (any case): movies 603, 604, show 1399 and a person; else empty
//   GET  /api/v1/discover/trending?page=        → movie 603, show 1399 and a person
//   GET  /api/v1/discover/movies?page=          → movies 603, 604
//   GET  /api/v1/discover/tv?page=              → show 1399
//   GET  /api/v1/discover/movies/upcoming?page= → movie 605 "Lumen Future" (released a year from now)
//   GET  /api/v1/discover/tv/upcoming?page=     → empty
//   GET  /api/v1/user/:id/requests?take=&skip=&sort=
//        → { pageInfo, results: [{ id, status, createdAt, type, media: { tmdbId, mediaType, status, jellyfinMediaId } }] }:
//          the requests this user filed via POST /request, newest first (media.status 2, or 5 if made available below);
//          403 unless X-Api-User is that user
//   GET  /api/v1/movie/:id   (603, 604, 605)    → movie details (credits, YouTube trailer, mediaInfo)
//   GET  /api/v1/tv/:id      (1399)             → show details (seasons 0–3, season availability, a request for S2)
//   GET  /api/v1/{movie|tv}/:id/recommendations → two movies
//   POST /api/v1/request  { mediaType, mediaId, seasons?, is4k }
//        → 201 { id, status: 2 if the user has ADMIN/AUTO_APPROVE else 1, media: { status: 2 } };
//          409 { message } if this user already requested the same mediaId + seasons; recorded for /__stub/requests
//   (Catalog and request routes act as a user: they need the key and an X-Api-User header, 400 without it.)
//   GET  /t/p/:size/:file                       → a tiny PNG (TMDB image stand-in)
//   POST /__stub/users  { [jellyfinUserId]: { id, permissions } }   → replaces the user map (test control)
//   POST /__stub/jellyfin  { name, serverId }                       → sets the linked Jellyfin server (test control)
//   POST /__stub/library  { tmdbId, jellyfinMediaId }                → makes that title available (mediaInfo status 5,
//                                                                       jellyfinMediaId) everywhere it appears (test control)
//   GET  /__stub/requests                                           → [{ user, body }] of requests filed (test control)
//   POST /__stub/reset                                              → clears the recorded requests and /__stub/library (test control)
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
let requests = [];
let nextRequestId = 1;
// tmdbId → jellyfinMediaId, for titles a test has made "available" (POST /__stub/library).
let library = {};

// Seerr permission bits (server/lib/permissions.ts).
const ADMIN = 2;
const AUTO_APPROVE = 1024;

const cast = [
  { id: 6384, name: 'Stub Actor One', character: 'Lead', profilePath: '/stubcast1.jpg' },
  { id: 2975, name: 'Stub Actor Two', character: 'Mentor', profilePath: null },
];
const trailer = [
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', key: 'dQw4w9WgXcQ', name: 'Official Trailer', type: 'Trailer', site: 'YouTube' },
];
const art = (id) => ({ posterPath: `/stubposter${id}.jpg`, backdropPath: `/stubbackdrop${id}.jpg` });
const movie = (id, title, releaseDate, mediaInfo) => ({
  mediaType: 'movie', id, title, releaseDate, overview: `${title}: a stub overview.`, voteAverage: 8.2,
  genreIds: [28, 878], ...art(id), ...(mediaInfo ? { mediaInfo } : {}),
});
const MATRIX = movie(603, 'The Matrix', '1999-03-30');
const RELOADED = movie(604, 'The Matrix Reloaded', '2003-05-15', { status: 2 });
const SAGA = {
  mediaType: 'tv', id: 1399, name: 'Lumen Saga', firstAirDate: '2011-04-17', overview: 'Lumen Saga: a stub overview.',
  voteAverage: 8.4, genreIds: [10765, 18], ...art(1399),
  mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }] },
};
const PERSON = { mediaType: 'person', id: 6384, name: 'Stub Matrix Person', profilePath: '/stubcast1.jpg' };
const inAYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const FUTURE = movie(605, 'Lumen Future', inAYear);
const details = {
  'movie/603': { ...MATRIX, runtime: 136, genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }], credits: { cast }, relatedVideos: trailer },
  'movie/604': { ...RELOADED, runtime: 138, genres: [{ id: 28, name: 'Action' }], credits: { cast }, relatedVideos: trailer },
  'movie/605': { ...FUTURE, runtime: 120, genres: [{ id: 878, name: 'Science Fiction' }], credits: { cast }, relatedVideos: trailer },
  'tv/1399': {
    ...SAGA,
    genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 18, name: 'Drama' }],
    credits: { cast },
    relatedVideos: trailer,
    seasons: [
      { seasonNumber: 0, name: 'Specials', episodeCount: 2 },
      { seasonNumber: 1, name: 'Season 1', episodeCount: 10 },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 10 },
      { seasonNumber: 3, name: 'Season 3', episodeCount: 8 },
    ],
    mediaInfo: { ...SAGA.mediaInfo, requests: [{ status: 2, seasons: [{ seasonNumber: 2, status: 2 }] }] },
  },
};
const page = (results, pageNumber = 1) => ({
  page: pageNumber, totalPages: results.length ? 1 : 0, totalResults: results.length, results,
});
const recommendations = page([movie(607, 'Stub Recommendation One', '2010-01-01'), movie(608, 'Stub Recommendation Two', '2012-06-01')]);
const discover = {
  '/api/v1/discover/trending': [MATRIX, SAGA, PERSON],
  '/api/v1/discover/movies': [MATRIX, RELOADED],
  '/api/v1/discover/tv': [SAGA],
  '/api/v1/discover/movies/upcoming': [FUTURE],
  '/api/v1/discover/tv/upcoming': [],
};
// A title as it currently stands: available (status 5 + jellyfinMediaId) if a test put it in the library.
const withLibrary = (media) =>
  media.mediaType !== 'person' && library[media.id]
    ? { ...media, mediaInfo: { ...(media.mediaInfo ?? {}), status: 5, jellyfinMediaId: library[media.id] } }
    : media;
// What makes two requests "the same": mediaId plus the requested seasons ("all" or a sorted list).
const requestKey = (user, body) =>
  JSON.stringify([user, body.mediaType, body.mediaId, Array.isArray(body.seasons) ? [...body.seasons].sort((a, b) => a - b) : body.seasons ?? null]);

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  const path = url.pathname;
  if (path === '/__stub/health') return json(res, 200, { ok: true });
  if (path === '/__stub/requests' && req.method === 'GET') return json(res, 200, requests);
  if (path === '/__stub/reset' && req.method === 'POST') {
    requests = [];
    library = {};
    return json(res, 200, { ok: true });
  }
  if ((path === '/__stub/users' || path === '/__stub/jellyfin' || path === '/__stub/library') && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (path === '/__stub/users') users = JSON.parse(body || '{}');
      else if (path === '/__stub/library') {
        const { tmdbId, jellyfinMediaId } = JSON.parse(body || '{}');
        library[Number(tmdbId)] = String(jellyfinMediaId);
      } else jellyfin = JSON.parse(body || '{}');
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
  // Everything below acts as a user. Lumen must always say which one (X-Api-User), never browse as the admin.
  const actingUser = req.headers['x-api-user'];
  const isCatalog =
    path === '/api/v1/search' ||
    path === '/api/v1/request' ||
    /^\/api\/v1\/(movie|tv|discover)\//.test(path) ||
    /^\/api\/v1\/user\/\d+\/requests$/.test(path);
  if (isCatalog && !/^\d+$/.test(actingUser ?? '')) return json(res, 400, { message: 'stub: X-Api-User is required' });
  if (path === '/api/v1/search' && req.method === 'GET') {
    const query = url.searchParams.get('query') ?? '';
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    return json(res, 200, page((/matrix/i.test(query) ? [MATRIX, SAGA, RELOADED, PERSON] : []).map(withLibrary), pageNumber));
  }
  if (path in discover && req.method === 'GET') {
    return json(res, 200, page(discover[path].map(withLibrary), Number(url.searchParams.get('page') ?? 1)));
  }
  const userRequests = path.match(/^\/api\/v1\/user\/(\d+)\/requests$/);
  if (userRequests && req.method === 'GET') {
    // Like Seerr: only that user (or a request manager, which Lumen never relies on) may list them.
    if (userRequests[1] !== actingUser) return json(res, 403, { message: 'You do not have permission to view these requests.' });
    const take = Number(url.searchParams.get('take') ?? 10);
    const skip = Number(url.searchParams.get('skip') ?? 0);
    const mine = requests.filter((r) => r.user === actingUser).reverse();
    const results = mine.slice(skip, skip + take).map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      type: r.body.mediaType,
      media: {
        tmdbId: r.body.mediaId,
        mediaType: r.body.mediaType,
        status: library[r.body.mediaId] ? 5 : 2,
        jellyfinMediaId: library[r.body.mediaId] ?? null,
      },
    }));
    return json(res, 200, { pageInfo: { pages: Math.ceil(mine.length / take), pageSize: take, results: mine.length, page: 1 + skip / take }, results });
  }
  const title = path.match(/^\/api\/v1\/(movie|tv)\/(\d+)(\/recommendations)?$/);
  if (title && req.method === 'GET') {
    const found = details[`${title[1]}/${title[2]}`];
    if (!found) return json(res, 404, { message: 'Unable to retrieve media.' });
    return json(res, 200, title[3] ? recommendations : withLibrary(found));
  }
  if (path === '/api/v1/request' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { message: 'stub: invalid JSON' });
      }
      const key = requestKey(actingUser, body);
      if (requests.some((r) => requestKey(r.user, r.body) === key)) {
        return json(res, 409, { message: 'Request for this media already exists.' });
      }
      const seerrUser = Object.values(users).find((u) => String(u.id) === actingUser);
      const autoApprove = ((seerrUser?.permissions ?? 0) & (ADMIN | AUTO_APPROVE)) !== 0;
      const filed = { user: actingUser, body, id: nextRequestId++, status: autoApprove ? 2 : 1, createdAt: new Date().toISOString() };
      requests.push(filed);
      return json(res, 201, { id: filed.id, status: filed.status, media: { status: 2 } });
    });
    return;
  }
  return json(res, 404, { message: `stub: no route for ${req.method} ${path}` });
}).listen(PORT, () => console.log(`stub Seerr on :${PORT}`));
