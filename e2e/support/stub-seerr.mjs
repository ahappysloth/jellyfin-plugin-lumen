// A stand-in for Seerr (and TMDB's image CDN) for the end-to-end tests: just the endpoints Lumen calls, with fixture
// data, so CI needs no real Seerr or internet. Started by Playwright's `webServer` (see playwright.config.ts).
//
//   GET  /api/v1/status                         → { version }
//   GET  /api/v1/user/jellyfin/:jellyfinUserId  → the mapped user, 404 if unmapped, 403 without the right key
//   GET  /api/v1/settings/jellyfin              → the Jellyfin server this "Seerr" is linked to
//   GET  /api/v1/settings/{radarr|sonarr}        → its Radarr / Sonarr servers (one each, unless /__stub/services says)
//   GET  /api/v1/settings/notifications/webhook → its webhook agent, as Seerr answers it (off, unless /__stub/webhook says)
//   GET  /api/v1/search?query=&page=            → "matrix" (any case): movies 603, 604, show 1399 and a person; else empty
//   GET  /api/v1/discover/trending?page=        → movie 603, show 1399 and a person
//   GET  /api/v1/discover/movies?page=          → movies 603, 604
//   GET  /api/v1/discover/tv?page=              → show 1399
//   GET  /api/v1/discover/movies/upcoming?page= → movie 605 "Lumen Future" (released a year from now)
//   GET  /api/v1/discover/tv/upcoming?page=     → empty
//   GET  /api/v1/user/:id/requests?take=&skip=
//        → { pageInfo, results: [{ id, status, createdAt, type, media: { tmdbId, mediaType, status, status4k,
//          jellyfinMediaId } }] }: the requests this user filed via POST /request, newest first (media status: see
//          mediaStatus below); 403 unless X-Api-User is that user
//   GET  /api/v1/movie/:id   (603, 604, 605)    → movie details (credits, YouTube trailer, mediaInfo; 603 has an IMDb id)
//   GET  /api/v1/tv/:id      (1399)             → show details (seasons 0–3, season availability, a request for S2,
//                                                  its IMDb id in externalIds)
//   Titles everywhere (details, search, discover) carry their media status as Seerr would have it: 5 if made
//   available below, else the progress scenario's mediaStatus, else 3 (PROCESSING) once a request filed for it is
//   approved or 2 (PENDING) while one waits, else the fixture's. status4k is the scenario's mediaStatus4k, else 1.
//   GET  /api/v1/{movie|tv}/:id/recommendations → two movies
//   POST /api/v1/request  { mediaType, mediaId, seasons?, is4k }
//        → 201 { id, status: 2 if the user has ADMIN/AUTO_APPROVE else 1, media: { status: 2 } };
//          409 { message } if this user already requested the same mediaId + seasons; recorded for /__stub/requests.
//          A test may call it itself, for a request filed in Seerr's own interface, which Lumen hasn't seen.
//   (Catalog and request routes act as a user: they need the key and an X-Api-User header, 400 without it.)
//   Like Seerr, which checks every /api/v1 call against its OpenAPI spec: a query parameter that seerr-api.yml doesn't
//   define for the route (SEERR_QUERY below), or a number parameter that isn't one, is a 400 { message, errors } in the
//   words of Seerr's validator; so is a POST /request body without a field the spec requires, or with one it doesn't
//   list (Seerr would ignore that one: the stub is stricter, so a misspelt field fails too).
//   GET  /t/p/:size/:file                       → a tiny PNG (TMDB image stand-in)
//   GET  /embed/:videoId?autoplay=&mute=&start=&origin=…  → a stand-in for YouTube's embedded player (the server's
//        LUMEN_YOUTUBE_EMBED_BASE points the browser here: CI can't reach YouTube). It speaks the player's postMessage
//        protocol to the page named by `origin`, as checked against the real embed (client/src/views/home/
//        youTubePlayer.ts): after `listening` it sends initialDelivery and onReady, then infoDelivery every 250 ms
//        while it plays and on every change of state; it obeys playVideo, pauseVideo, seekTo, mute and unMute, and
//        sends onStateChange once asked to (addEventListener). A 30 s "video" by default, by id: stubShort10 runs 10 s,
//        stubErr0150 can't be embedded (onError 150), stubErr0100 was removed (onError 100). The page shows its state
//        (and has it on <body data-state data-time data-muted>) for the tests to read.
//   IMDb (the server's LUMEN_IMDB_API_BASE points at /imdb/graphql, and LUMEN_IMDB_VIDEO_BASE tells it the videos'
//   address, which is the browser's, so localhost): as IMDb's GraphQL API answers its site, only to a browser's
//   User-Agent with `x-imdb-client-name: imdb-web-next` and `origin: https://www.imdb.com` (else 403, as IMDb does).
//   POST /imdb/graphql { query, variables: { id } } → the title's primaryVideos, as IMDb gives them: for tt9000010,
//        tt9000001, tt0133093 (The Matrix, movie 603), tt9001399 (Lumen Saga, tv 1399) and tt4154796 (the Health
//        check's), a Clip, a 30 s Trailer with
//        720p, and a 126 s Trailer in 1080p, 720p, 480p and AUTO (HLS), its 720p at /imdb/video/<id>_720p.mp4 signed for
//        24 h; tt9000020 has only clips; any other title is a null title. Each lookup is recorded for /__stub/imdb.
//   GET  /imdb/video/:name.mp4                  → a 20 s MP4 with range requests, as IMDb's CDN serves them: H.264 to
//        WebKit, VP9 to Chromium (which has no H.264) and Firefox. From LUMEN_STUB_IMDB_MEDIA, else
//        e2e/fixtures/media/imdb (scripts/gen-test-media.sh makes both files). Each request is recorded for /__stub/imdb.
//   GET  /__stub/imdb                           → { lookups: [ids], videos: [{ name, range }] } (test control)
//   Trakt (LUMEN_TRAKT_API_BASE points here, under /trakt): every call needs `trakt-api-version: 2` and
//   `trakt-api-key: stub-trakt-key`, else 403 (as Trakt answers an invalid key). Lists take ?page=&limit= and answer
//   with Trakt's X-Pagination-* headers.
//   The fixture media has no ids: the Top 10 and Trakt specs give the library items theirs.
//   GET  /trakt/{movies|shows}/watched/{weekly|monthly|yearly|all} → most watched (Top 10 rows, Top charts):
//        weekly movies: Lumen Beta (tmdb 900002), The Matrix (603), a title Seerr doesn't know (999999), Lumen Alpha (imdb
//        tt9000001), The Matrix Reloaded (604). Weekly shows: Lumen Saga (1399), Lumen Show (tmdb 900010).
//        monthly movies: Reloaded, Alpha, Matrix, Beta. yearly movies: Matrix, Beta. all-time movies: 30 titles, The
//        Matrix, Stub Request 760–784, Alpha (27th), the unknown title, Beta (29th), Reloaded. Other shows' charts:
//        Lumen Show, Lumen Saga.
//   GET  /trakt/movies/boxoffice                → The Matrix, Lumen Beta, Stub Request 790, the unknown title
//   GET  /trakt/{movies|shows}/anticipated      → movies Lumen Future (605), Stub Request 791, 792; shows Lumen Saga
//   GET  /trakt/{movies|shows}/trending         → movies Lumen Alpha, The Matrix Reloaded; shows Lumen Show, Lumen Saga
//   GET  /trakt/users/lumen-tester/lists/lumen-picks[/items/movie,show] → "Lumen Picks": Lumen Saga (show), Lumen Beta,
//        Stub Request 793; /trakt/lists/4242 is the same list by id. users/lumen-tester/lists/secret is private (401),
//        any other list 404.
//   A push service (LUMEN_PUSH_TEST_ENDPOINT points Lumen's allowed push addresses here, under /push/):
//   POST /push/:id                              → 201, recorded for /__stub/push as { id, authorization, ttl, urgency,
//        encoding, body } (body: the encrypted message, base64). An id starting with "gone" answers 410 (the browser
//        unsubscribed), one starting with "refused" 403, one starting with "down" 503; those are recorded too.
//   GET  /__stub/push                                               → the push messages received (test control)
//   POST /__stub/users  { [jellyfinUserId]: { id, permissions } }   → replaces the user map (test control)
//   POST /__stub/jellyfin  { name, serverId }                       → sets the linked Jellyfin server (test control)
//   POST /__stub/library  { tmdbId, jellyfinMediaId }                → makes that title available (mediaInfo status 5,
//                                                                       jellyfinMediaId) everywhere it appears (test control)
//   POST /__stub/progress { [tmdbId]: { requestStatus?, mediaStatus?, mediaStatus4k?, downloads?: [{ size, sizeLeft, status?,
//                          etaSeconds?, downloadId?, season?, episode? }], step? } | null }
//        → how that title's requests stand in GET /user/:id/requests: the request's status, its media's status and
//          download queue (media.downloadStatus, as Seerr gets it from Radarr/Sonarr). `step` advances every download
//          by that many bytes on each such call (a download moving between polls); one that reaches 0 is "completed".
//          null clears it (test control)
//   Movies 701–799 have details too ("Stub Request 7xx", or the names in REQUEST_TITLES), for requests in each state.
//   POST /__stub/fail     { ['movie/603']: 503, requests: 400 }     → those title lookups answer that status, and with
//                                                                       `requests` GET /user/:id/requests does, as a Seerr
//                                                                       that won't list them; {} clears them (test control)
//   GET  /__stub/requests                                           → [{ user, body }] of requests filed (test control)
//   POST /__stub/services { radarr, sonarr }                        → how many Radarr and Sonarr servers it has (test control)
//   POST /__stub/webhook { enabled, types, webhookUrl, authHeader }  → its webhook agent's settings (test control)
//   POST /__stub/reset                                              → clears the recorded requests, the IMDb lookups and
//                                                                       videos, /__stub/library and
//                                                                       the push messages and the failing lookups, sets
//                                                                       one Radarr and one Sonarr server again and turns
//                                                                       the webhook off (test control)
//   GET  /__stub/health
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUB_API_KEY = 'stub-key';
export const STUB_TRAKT_KEY = 'stub-trakt-key';
const PORT = Number(process.env.LUMEN_STUB_SEERR_PORT ?? 5055);
// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
// YouTube's embedded player, as far as Lumen's trailer preview talks to it (see the header).
const embedPage = (videoId) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Stub YouTube player</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#1d5c8a;color:#fff;font:600 28px sans-serif}</style></head>
<body data-state="-1" data-time="0"><div id="label"></div><script>
const videoId = ${JSON.stringify(videoId)};
const params = new URLSearchParams(location.search);
const pageOrigin = params.get('origin') || '*';
const error = { stubErr0150: 150, stubErr0100: 100 }[videoId];
const duration = videoId === 'stubShort10' ? 10 : 30;
let state = -1, time = Number(params.get('start') || 0), muted = params.get('mute') === '1';
let channel = null, stateListener = false, last = performance.now();
const post = (event, info) => {
  if (channel) parent.postMessage(JSON.stringify({ event, info, id: channel, channel: 'widget' }), pageOrigin);
};
const show = () => {
  document.body.dataset.state = String(state);
  document.body.dataset.time = time.toFixed(2);
  document.body.dataset.muted = String(muted);
  document.getElementById('label').textContent = 'Stub YouTube ' + videoId + ' · state ' + state + ' · ' + time.toFixed(1) + ' s';
};
const setState = (next) => {
  if (state === next) return;
  state = next;
  last = performance.now();
  show();
  post('infoDelivery', { playerState: state, currentTime: time, duration });
  if (stateListener) post('onStateChange', state);
};
// Like the real one: buffering first, playing a moment later.
const play = () => {
  if (error || state === 1 || state === 0) return;
  setState(3);
  setTimeout(() => state === 3 && setState(1), 100);
};
setInterval(() => {
  if (state !== 1) return;
  const now = performance.now();
  time = Math.min(duration, time + (now - last) / 1000);
  last = now;
  show();
  if (time >= duration) return setState(0);
  post('infoDelivery', { currentTime: time });
}, 250);
addEventListener('message', (e) => {
  if (e.source !== parent || (pageOrigin !== '*' && e.origin !== pageOrigin)) return;
  let data;
  try { data = JSON.parse(e.data); } catch { return; }
  if (data.event === 'listening') {
    const first = !channel;
    channel = data.id;
    if (!first) return post('alreadyInitialized', null);
    post('initialDelivery', { playerState: state, currentTime: time, duration: error ? 0 : duration - 0.5, muted, volume: 100 });
    post('onReady', null);
    if (error) post('onError', error);
    return;
  }
  if (data.event !== 'command') return;
  const args = data.args || [];
  if (data.func === 'addEventListener' && args[0] === 'onStateChange') stateListener = true;
  else if (data.func === 'playVideo') play();
  else if (data.func === 'pauseVideo') { if (state === 1 || state === 3) setState(2); }
  else if (data.func === 'seekTo') { time = Math.max(0, Math.min(duration, Number(args[0]) || 0)); show(); if (state === 1) { setState(3); setTimeout(() => state === 3 && setState(1), 100); } }
  else if (data.func === 'mute' || data.func === 'unMute') { muted = data.func === 'mute'; show(); post('infoDelivery', { muted, volume: 100 }); }
});
show();
if (params.get('autoplay') === '1') play();
</script></body></html>`;
let users = {};
// How many Radarr and Sonarr servers this "Seerr" has (Settings → Services).
let services = { radarr: 1, sonarr: 1 };
// Its webhook agent (Settings → Notifications → Webhook).
const WEBHOOK_OFF = { enabled: false, types: 0, webhookUrl: '', authHeader: '' };
let webhook = WEBHOOK_OFF;
let jellyfin = { name: 'Stub Jellyfin', serverId: '' };
let requests = [];
// Request ids differ between runs too: Lumen remembers which it saw in flight (its ready pop-ups) across restarts.
let nextRequestId = (Math.floor(Date.now() / 1000) % 1_000_000) * 100 + 1;
// "movie/603" → the status its lookups answer instead (POST /__stub/fail): Seerr failing on some titles.
let failing = {};
// tmdbId → jellyfinMediaId, for titles a test has made "available" (POST /__stub/library).
let library = {};
// tmdbId → the progress scenario of its requests (POST /__stub/progress).
let progress = {};
// What Lumen sent to the stand-in push service (POST /push/:id).
let pushes = [];
// IMDb lookups (title ids) and video requests the stub has had (GET /__stub/imdb).
let imdbLookups = [];
let imdbVideos = [];

const IMDB_MEDIA = process.env.LUMEN_STUB_IMDB_MEDIA ?? join(dirname(fileURLToPath(import.meta.url)), '../fixtures/media/imdb');
// tt4154796 is the title Lumen's Health check looks up (ImdbTrailersCheck).
const IMDB_TITLES = ['tt9000010', 'tt9000001', 'tt0133093', 'tt9001399', 'tt4154796'];
/** IMDb's answer for a title id: its first videos, as IMDb lists them (a clip may come first). */
const imdbTitle = (id) => {
  if (id === 'tt9000020') return { primaryVideos: { edges: [{ node: imdbVideo('Clip', 200, id, ['720p']) }] } };
  if (!IMDB_TITLES.includes(id)) return null;
  return {
    primaryVideos: {
      edges: [
        { node: imdbVideo('Clip', 91, `${id}clip`, ['720p']) },
        { node: imdbVideo('Trailer', 30, `${id}teaser`, ['720p']) },
        { node: imdbVideo('Trailer', 126, id, ['1080p', 'SD', 'AUTO', '720p', '480p']) },
      ],
    },
  };
};
const imdbVideo = (type, seconds, name, qualities) => ({
  id: `vi${name}`,
  runtime: { value: seconds },
  contentType: { displayName: { value: type } },
  playbackURLs: qualities.map((q) => ({
    url:
      q === 'AUTO'
        ? `http://localhost:${PORT}/imdb/video/${name}/hls-master.m3u8`
        : `http://localhost:${PORT}/imdb/video/${name}_${q}.mp4?Expires=${Math.floor(Date.now() / 1000) + 86400}&Signature=stub~sig__&Key-Pair-Id=STUB`,
    displayName: { value: q },
  })),
});
/** One of the fixture MP4s, with range requests: H.264 to WebKit, VP9 to the others (Playwright's Chromium has no H.264). */
const serveImdbVideo = (req, res, name) => {
  const ua = req.headers['user-agent'] ?? '';
  const webkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Firefox/.test(ua);
  const file = join(IMDB_MEDIA, webkit ? 'trailer-h264.mp4' : 'trailer-vp9.mp4');
  imdbVideos.push({ name, range: req.headers.range ?? null });
  if (!existsSync(file)) return json(res, 404, { message: `stub: no ${file} (run scripts/gen-test-media.sh)` });
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    return createReadStream(file).pipe(res);
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  return createReadStream(file, { start, end }).pipe(res);
};

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
const REQUEST_TITLES = {
  701: 'Stub Queued',
  702: 'Stub Declined',
  703: 'Stub Failed',
  704: 'Stub Processing',
  705: 'Stub Awaiting Approval',
  706: 'Stub Ready',
};
const requestTitle = (id) => movie(id, REQUEST_TITLES[id] ?? `Stub Request ${id}`, '2020-01-01');
const details = {
  'movie/603': { ...MATRIX, imdbId: 'tt0133093', externalIds: { imdbId: 'tt0133093' }, runtime: 136, genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }], credits: { cast }, relatedVideos: trailer },
  'movie/604': { ...RELOADED, runtime: 138, genres: [{ id: 28, name: 'Action' }], credits: { cast }, relatedVideos: trailer },
  'movie/605': { ...FUTURE, runtime: 120, genres: [{ id: 878, name: 'Science Fiction' }], credits: { cast }, relatedVideos: trailer },
  'tv/1399': {
    ...SAGA,
    // A show's IMDb id is only in externalIds, as Seerr has it.
    externalIds: { imdbId: 'tt9001399', tvdbId: 1399 },
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
const traktTitle = (title, year, ids) => ({
  title, year, ids: { trakt: ids.tmdb ?? 1, slug: title.toLowerCase().replace(/\W+/g, '-'), imdb: null, tmdb: null, ...ids },
});
// Trakt's titles, as [title, year, ids].
const T = {
  beta: ['Lumen Beta', 2002, { tmdb: 900002 }],
  matrix: ['The Matrix', 1999, { tmdb: 603, imdb: 'tt0133093' }],
  unknown: ['Stub Unknown To Seerr', 2026, { tmdb: 999999 }],
  alpha: ['Lumen Alpha', 2001, { tmdb: 900001, imdb: 'tt9000001' }],
  reloaded: ['The Matrix Reloaded', 2003, { tmdb: 604, imdb: 'tt0234215' }],
  future: ['Lumen Future', Number(inAYear.slice(0, 4)), { tmdb: 605 }],
  saga: ['Lumen Saga', 2011, { tmdb: 1399 }],
  show: ['Lumen Show', 2010, { tmdb: 900010, imdb: 'tt9000010' }],
};
const stubRequest = (id) => [REQUEST_TITLES[id] ?? `Stub Request ${id}`, 2020, { tmdb: id }];
/** A list's entries: each title under `movie` or `show`, with what that list adds (watchers, revenue…). */
const entries = (kind, titles, extra = () => ({})) =>
  titles.map(([title, year, ids], i) => ({ ...extra(i), [kind]: traktTitle(title, year, ids) }));
const watchedMovies = {
  weekly: [T.beta, T.matrix, T.unknown, T.alpha, T.reloaded],
  monthly: [T.reloaded, T.alpha, T.matrix, T.beta],
  yearly: [T.matrix, T.beta],
  all: [T.matrix, ...Array.from({ length: 25 }, (_, i) => stubRequest(760 + i)), T.alpha, T.unknown, T.beta, T.reloaded],
};
const traktLists = {
  'movies/watched/weekly': entries('movie', watchedMovies.weekly, (i) => ({ watcher_count: 5000 - i * 1000 })),
  'movies/watched/monthly': entries('movie', watchedMovies.monthly, (i) => ({ watcher_count: 9000 - i * 1000 })),
  'movies/watched/yearly': entries('movie', watchedMovies.yearly, (i) => ({ watcher_count: 90000 - i * 1000 })),
  'movies/watched/all': entries('movie', watchedMovies.all, (i) => ({ watcher_count: 900000 - i * 1000 })),
  'shows/watched/weekly': entries('show', [T.saga, T.show], (i) => ({ watcher_count: 3000 - i * 1000 })),
  'shows/watched/monthly': entries('show', [T.show, T.saga]),
  'shows/watched/yearly': entries('show', [T.show, T.saga]),
  'shows/watched/all': entries('show', [T.show, T.saga]),
  'movies/boxoffice': entries('movie', [T.matrix, T.beta, stubRequest(790), T.unknown], (i) => ({ revenue: 90000000 - i * 1000000 })),
  'movies/anticipated': entries('movie', [T.future, stubRequest(791), stubRequest(792)], (i) => ({ list_count: 900 - i })),
  'shows/anticipated': entries('show', [T.saga], () => ({ list_count: 800 })),
  'movies/trending': entries('movie', [T.alpha, T.reloaded], () => ({ watchers: 42 })),
  'shows/trending': entries('show', [T.show, T.saga], () => ({ watchers: 42 })),
};
// A user's list: entries of either type, in the list's order.
const PICKS = [
  { rank: 1, type: 'show', show: entries('show', [T.saga])[0].show },
  { rank: 2, type: 'movie', movie: entries('movie', [T.beta])[0].movie },
  { rank: 3, type: 'movie', movie: entries('movie', [stubRequest(793)])[0].movie },
];
const PICKS_INFO = { name: 'Lumen Picks', privacy: 'public', ids: { trakt: 4242, slug: 'lumen-picks' } };
// A title's MediaStatus as Seerr has it (see the header). `base` is the fixture's; a show that's partly available stays
// so, as in Seerr.
const mediaStatus = (tmdbId, base) => {
  if (library[tmdbId]) return 5;
  const scenario = progress[tmdbId];
  if (scenario?.mediaStatus) return scenario.mediaStatus;
  if (base >= 4) return base;
  const filed = requests.filter((r) => r.body.mediaId === tmdbId && !r.body.is4k).map((r) => scenario?.requestStatus ?? r.status);
  if (filed.includes(2)) return 3;
  if (filed.includes(1)) return 2;
  return base;
};
const mediaStatus4k = (tmdbId, base) => progress[tmdbId]?.mediaStatus4k ?? base ?? 1;
// A request's media as Seerr lists it: its status, linked item and download queue (progress scenario, if any).
const requestMedia = (body) => {
  const scenario = progress[body.mediaId];
  const media = {
    tmdbId: body.mediaId,
    mediaType: body.mediaType,
    status: mediaStatus(body.mediaId, details[`${body.mediaType}/${body.mediaId}`]?.mediaInfo?.status ?? 1),
    status4k: mediaStatus4k(body.mediaId),
    jellyfinMediaId: library[body.mediaId] ?? null,
    downloadStatus: [],
    downloadStatus4k: [],
  };
  if (!scenario?.downloads || library[body.mediaId]) return media;
  media.downloadStatus = scenario.downloads.map((d, i) => ({
    mediaType: body.mediaType,
    externalId: body.mediaId,
    size: d.size,
    sizeLeft: d.sizeLeft,
    status: d.sizeLeft <= 0 ? 'completed' : (d.status ?? 'downloading'),
    timeLeft: '00:10:00',
    estimatedCompletionTime: new Date(Date.now() + (d.etaSeconds ?? 600) * 1000).toISOString(),
    title: `stub download ${i}`,
    downloadId: d.downloadId ?? `stub-${body.mediaId}-${i}`,
    ...(d.season ? { episode: { seasonNumber: d.season, episodeNumber: d.episode, absoluteEpisodeNumber: d.episode, id: i } } : {}),
  }));
  return media;
};
// One Seerr download sync: every scenario with a `step` moves on.
const advanceDownloads = () => {
  for (const scenario of Object.values(progress)) {
    if (!scenario.step) continue;
    for (const d of scenario.downloads ?? []) d.sizeLeft = Math.max(0, d.sizeLeft - scenario.step);
  }
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
// A title as it currently stands: its media status from the library, the progress scenario and the requests filed
// (mediaStatus), and its Jellyfin item if a test put it in the library. A title Seerr knows nothing of has no mediaInfo.
const withLibrary = (media) => {
  if (media.mediaType === 'person') return media;
  const status = mediaStatus(media.id, media.mediaInfo?.status ?? 1);
  if (!media.mediaInfo && status === 1) return media;
  return {
    ...media,
    mediaInfo: {
      ...(media.mediaInfo ?? {}),
      status,
      status4k: mediaStatus4k(media.id, media.mediaInfo?.status4k),
      ...(library[media.id] ? { jellyfinMediaId: library[media.id] } : {}),
    },
  };
};
// What makes two requests "the same": mediaId plus the requested seasons ("all" or a sorted list).
const requestKey = (user, body) =>
  JSON.stringify([user, body.mediaType, body.mediaId, Array.isArray(body.seasons) ? [...body.seasons].sort((a, b) => a - b) : body.seasons ?? null]);

// The query parameters seerr-api.yml (seerr-team/seerr) defines for each route the stub serves, and which of them are
// numbers. Seerr's express-openapi-validator rejects any other parameter with a 400 ("Unknown query parameter"), so a
// parameter Lumen sends must be in this list *and* in the spec: copy from the spec, never from Lumen.
const SEERR_LANGUAGE = { language: 'string' };
const SEERR_PAGE = { page: 'number', ...SEERR_LANGUAGE };
const SEERR_DISCOVER = {
  ...SEERR_PAGE, genre: 'string', keywords: 'string', excludeKeywords: 'string', sortBy: 'string',
  withRuntimeGte: 'number', withRuntimeLte: 'number', voteAverageGte: 'number', voteAverageLte: 'number',
  voteCountGte: 'number', voteCountLte: 'number', watchRegion: 'string', watchProviders: 'string',
  certification: 'string', certificationGte: 'string', certificationLte: 'string', certificationCountry: 'string',
  certificationMode: 'string',
};
const SEERR_QUERY = [
  [/^\/api\/v1\/status$/, { checkUpdateAvailable: 'boolean' }],
  [/^\/api\/v1\/settings\/(jellyfin|radarr|sonarr|notifications\/webhook)$/, {}],
  [/^\/api\/v1\/user\/jellyfin\/[^/]+$/, {}],
  [/^\/api\/v1\/user\/\d+\/requests$/, { take: 'number', skip: 'number' }],
  [/^\/api\/v1\/search$/, { query: 'string', ...SEERR_PAGE }],
  [/^\/api\/v1\/discover\/trending$/, { ...SEERR_PAGE, mediaType: 'string', timeWindow: 'string' }],
  [/^\/api\/v1\/discover\/movies$/, { ...SEERR_DISCOVER, studio: 'number', primaryReleaseDateGte: 'string', primaryReleaseDateLte: 'string' }],
  [/^\/api\/v1\/discover\/tv$/, { ...SEERR_DISCOVER, network: 'number', firstAirDateGte: 'string', firstAirDateLte: 'string', status: 'string' }],
  [/^\/api\/v1\/discover\/(movies|tv)\/upcoming$/, SEERR_PAGE],
  [/^\/api\/v1\/(movie|tv)\/\d+$/, SEERR_LANGUAGE],
  [/^\/api\/v1\/(movie|tv)\/\d+\/recommendations$/, SEERR_PAGE],
  // POST /request takes no query parameters (GET /request, which Lumen doesn't call, has sort, filter…).
  [/^\/api\/v1\/request$/, {}],
];
// POST /request's body properties in seerr-api.yml, and the required ones.
const SEERR_REQUEST_BODY = ['mediaType', 'mediaId', 'tvdbId', 'seasons', 'is4k', 'serverId', 'profileId', 'rootFolder', 'languageProfileId', 'userId', 'ignoreQuota'];
const SEERR_REQUEST_REQUIRED = ['mediaType', 'mediaId'];
/** Seerr's validator's 400 for the first query parameter its spec rejects on this route, or null if it takes them all. */
const seerrQueryError = (path, searchParams) => {
  const allowed = SEERR_QUERY.find(([route]) => route.test(path))?.[1];
  if (!allowed) return null;
  for (const [name, value] of searchParams) {
    if (!(name in allowed)) return `Unknown query parameter '${name}'`;
    if (allowed[name] === 'number' && (value === '' || !Number.isFinite(Number(value)))) return `request/query/${name} must be number`;
  }
  return null;
};
const seerrBodyError = (body) => {
  const unknown = Object.keys(body).find((k) => !SEERR_REQUEST_BODY.includes(k));
  if (unknown) return `request/body must NOT have additional properties: '${unknown}'`;
  const missing = SEERR_REQUEST_REQUIRED.find((k) => !(k in body));
  return missing ? `request/body must have required property '${missing}'` : null;
};

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
/** One page of a Trakt list, with Trakt's pagination headers (?page= from 1, ?limit= 10 by default). */
const paged = (res, url, all) => {
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 10));
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  return json(res, 200, all.slice((page - 1) * limit, page * limit), {
    'X-Pagination-Page': String(page),
    'X-Pagination-Limit': String(limit),
    'X-Pagination-Page-Count': String(Math.max(1, Math.ceil(all.length / limit))),
    'X-Pagination-Item-Count': String(all.length),
  });
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  const path = url.pathname;
  if (path === '/__stub/health') return json(res, 200, { ok: true });
  if (path === '/__stub/requests' && req.method === 'GET') return json(res, 200, requests);
  if (path === '/__stub/reset' && req.method === 'POST') {
    requests = [];
    library = {};
    progress = {};
    pushes = [];
    imdbLookups = [];
    imdbVideos = [];
    services = { radarr: 1, sonarr: 1 };
    webhook = WEBHOOK_OFF;
    failing = {};
    return json(res, 200, { ok: true });
  }
  if (path === '/__stub/push' && req.method === 'GET') return json(res, 200, pushes);
  if (path === '/__stub/imdb' && req.method === 'GET') return json(res, 200, { lookups: imdbLookups, videos: imdbVideos });
  if (path === '/imdb/graphql' && req.method === 'POST') {
    // As IMDb: anything that doesn't ask as its own site is refused.
    if (
      req.headers['x-imdb-client-name'] !== 'imdb-web-next' ||
      req.headers.origin !== 'https://www.imdb.com' ||
      !/^Mozilla\/5\.0 /.test(req.headers['user-agent'] ?? '')
    ) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end('<html><head><title>403 Forbidden</title></head></html>');
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { errors: [{ message: 'stub: invalid JSON' }] });
      }
      const id = body.variables?.id;
      if (typeof id !== 'string' || !/primaryVideos/.test(body.query ?? '')) {
        return json(res, 200, { errors: [{ message: 'stub: expected the trailer query with an id variable' }] });
      }
      imdbLookups.push(id);
      json(res, 200, { data: { title: imdbTitle(id) }, extensions: { disclaimer: 'stub' } });
    });
    return;
  }
  const imdbVideoPath = path.match(/^\/imdb\/video\/([\w~-]+)\.mp4$/);
  if (imdbVideoPath && req.method === 'GET') return serveImdbVideo(req, res, imdbVideoPath[1]);
  const pushed = path.match(/^\/push\/([\w-]+)$/);
  if (pushed && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      pushes.push({
        id: pushed[1],
        authorization: req.headers.authorization ?? null,
        ttl: req.headers.ttl ?? null,
        urgency: req.headers.urgency ?? null,
        encoding: req.headers['content-encoding'] ?? null,
        body: Buffer.concat(chunks).toString('base64'),
      });
      // As a push service answers: 201 Created, or why not.
      const status = pushed[1].startsWith('gone') ? 410 : pushed[1].startsWith('refused') ? 403 : pushed[1].startsWith('down') ? 503 : 201;
      res.writeHead(status);
      res.end();
    });
    return;
  }
  const controls = ['/__stub/users', '/__stub/jellyfin', '/__stub/library', '/__stub/progress', '/__stub/services', '/__stub/webhook', '/__stub/fail'];
  if (controls.includes(path) && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (path === '/__stub/users') users = JSON.parse(body || '{}');
      else if (path === '/__stub/fail') failing = JSON.parse(body || '{}');
      else if (path === '/__stub/progress') {
        for (const [id, scenario] of Object.entries(JSON.parse(body || '{}'))) {
          if (scenario) progress[Number(id)] = structuredClone(scenario);
          else delete progress[Number(id)];
        }
      }
      else if (path === '/__stub/services') services = { radarr: 0, sonarr: 0, ...JSON.parse(body || '{}') };
      else if (path === '/__stub/webhook') webhook = { ...WEBHOOK_OFF, ...JSON.parse(body || '{}') };
      else if (path === '/__stub/library') {
        const { tmdbId, jellyfinMediaId } = JSON.parse(body || '{}');
        library[Number(tmdbId)] = String(jellyfinMediaId);
      } else jellyfin = JSON.parse(body || '{}');
      json(res, 200, { ok: true });
    });
    return;
  }
  const embed = path.match(/^\/embed\/([A-Za-z0-9_-]{11})$/);
  if (embed && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(embedPage(embed[1]));
  }
  if (path.startsWith('/t/p/')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(PNG);
  }
  if (path.startsWith('/trakt/') && req.method === 'GET') {
    if (req.headers['trakt-api-key'] !== STUB_TRAKT_KEY || req.headers['trakt-api-version'] !== '2') {
      // As Trakt: 403 is an invalid API key (401 is "OAuth must be provided", as for a private list below).
      return json(res, 403, { error: 'invalid_api_key' });
    }
    const resource = path.slice('/trakt/'.length);
    const list = resource.match(/^(?:users\/([^/]+)\/lists\/([^/]+)|lists\/([^/]+))(\/items\/movie,show)?$/);
    if (list) {
      const picks = (list[1] === 'lumen-tester' && list[2] === 'lumen-picks') || list[3] === '4242';
      if (list[1] === 'lumen-tester' && list[2] === 'secret') return json(res, 401, { error: 'private list' });
      if (!picks) return json(res, 404, { error: 'not found' });
      return list[4] ? paged(res, url, PICKS) : json(res, 200, PICKS_INFO);
    }
    if (traktLists[resource]) return paged(res, url, traktLists[resource]);
    return json(res, 404, { error: 'not found' });
  }
  if (path.startsWith('/api/v1/')) {
    // Before authentication, as in Seerr, where the validator runs ahead of every route.
    const invalid = seerrQueryError(path, url.searchParams);
    if (invalid) return json(res, 400, { message: invalid, errors: [{ path: '.query', message: invalid }] });
  }
  if (path === '/api/v1/status') return json(res, 200, { version: '3.5.1-stub', commitTag: 'stub' });
  if (req.headers['x-api-key'] !== STUB_API_KEY) return json(res, 403, { message: 'You do not have permission' });
  // Real Seerr also returns its Jellyfin API key here; Lumen must only read name and serverId.
  if (path === '/api/v1/settings/jellyfin') return json(res, 200, { ...jellyfin, ip: 'jellyfin', apiKey: 'must-not-leak' });
  // Each server's settings carry its API key, as in Seerr: Lumen only counts them.
  const arr = path.match(/^\/api\/v1\/settings\/(radarr|sonarr)$/);
  if (arr)
    return json(
      res,
      200,
      Array.from({ length: services[arr[1]] }, (_, id) => ({ id, name: `${arr[1]} ${id}`, apiKey: 'must-not-leak' })),
    );
  // As Seerr answers it: the payload decoded, and the Authorization Header Lumen compares with its secret.
  if (path === '/api/v1/settings/notifications/webhook')
    return json(res, 200, {
      enabled: webhook.enabled,
      embedPoster: true,
      types: webhook.types,
      options: { webhookUrl: webhook.webhookUrl, authHeader: webhook.authHeader, jsonPayload: {}, customHeaders: [], supportVariables: false },
    });
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
    if (failing.requests) return json(res, failing.requests, { message: 'stub: failing' });
    const take = Number(url.searchParams.get('take') ?? 10);
    const skip = Number(url.searchParams.get('skip') ?? 0);
    advanceDownloads();
    const mine = requests.filter((r) => r.user === actingUser).reverse();
    const results = mine.slice(skip, skip + take).map((r) => ({
      id: r.id,
      status: library[r.body.mediaId] ? 5 : (progress[r.body.mediaId]?.requestStatus ?? r.status),
      createdAt: r.createdAt,
      type: r.body.mediaType,
      is4k: false,
      seasons: (Array.isArray(r.body.seasons) ? r.body.seasons : []).map((n) => ({ seasonNumber: n, status: 2 })),
      media: requestMedia(r.body),
    }));
    return json(res, 200, { pageInfo: { pages: Math.ceil(mine.length / take), pageSize: take, results: mine.length, page: 1 + skip / take }, results });
  }
  const title = path.match(/^\/api\/v1\/(movie|tv)\/(\d+)(\/recommendations)?$/);
  if (title && req.method === 'GET') {
    const id = Number(title[2]);
    const fail = failing[`${title[1]}/${title[2]}`];
    if (fail) return json(res, fail, { message: 'stub: failing' });
    const found = details[`${title[1]}/${title[2]}`] ?? (title[1] === 'movie' && id >= 701 && id <= 799 ? requestTitle(id) : undefined);
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
      const invalid = seerrBodyError(body);
      if (invalid) return json(res, 400, { message: invalid, errors: [{ path: '.body', message: invalid }] });
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
