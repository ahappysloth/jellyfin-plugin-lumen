// Fails when what every page loads (lumen.js, the chunks it loads at startup, lumen.css), or one of the chunks loaded
// when they're needed (the player, its Skip button and next-episode card, the trailer preview, the restart banner, the
// catalog title page and My requests, the profile pages, the item menu, the Trailer section of Media info, the secondary
// views, Top charts, Quick Connect), or one of
// the stylesheets linked where they're used, exceeds its gzipped budget,
// or Lumen's fonts exceed theirs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const gz = (f) => gzipSync(readFileSync(f)).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const chunks = readdirSync('dist').filter((f) => f.startsWith('lumen-chunk-') && f.endsWith('.js'));
/** The one chunk named `name`; fails if there isn't exactly one. */
const oneChunk = (name) => {
  const found = chunks.filter((f) => f.startsWith(`lumen-chunk-${name}-`));
  if (found.length !== 1) {
    console.error(`expected one ${name} chunk, found ${found.length}: ${chunks.join(', ')}`);
    process.exit(1);
  }
  return found[0];
};
const coreChunk = oneChunk('main');
// Loaded when they're needed: views/player/lazyPlayer.tsx, views/home/lazyTrailer.tsx, takeover/restartWatch.ts,
// views/catalog/lazyTitle.tsx, views/profile/lazyProfile.tsx, views/itemMenu/lazyItemMenu.ts,
// views/secondary/lazySecondary.tsx, views/charts/lazyCharts.tsx, views/quickconnect/lazyQuickConnect.tsx,
// views/push/lazyPush.tsx, views/player/lazySegments.tsx, views/trailerInfo/lazyTrailerInfo.ts.
const playerChunk = oneChunk('PlayerView');
const segmentsChunk = oneChunk('SegmentPrompts');
const trailerChunk = oneChunk('TrailerPreview');
const restartChunk = oneChunk('RestartBanner');
const titleChunk = oneChunk('TitleView');
const profileChunk = oneChunk('ProfilePages');
const itemMenuChunk = oneChunk('itemMenu');
const secondaryChunk = oneChunk('SecondaryViews');
const chartsChunk = oneChunk('ChartsView');
const quickConnectChunk = oneChunk('QuickConnect');
const pushChunk = oneChunk('PushSettings');
const trailerInfoChunk = oneChunk('TrailerInfo');
// Startup is lumen.js and the core it imports, which the server preloads with it. Another chunk would be a download
// the core waits for (vite.config.ts keeps it to one).
const others = chunks.filter(
  (f) =>
    ![
      coreChunk,
      playerChunk,
      segmentsChunk,
      trailerChunk,
      restartChunk,
      titleChunk,
      profileChunk,
      itemMenuChunk,
      secondaryChunk,
      chartsChunk,
      quickConnectChunk,
      pushChunk,
      trailerInfoChunk,
    ].includes(f),
);
if (others.length) {
  console.error(`unexpected chunks: ${others.join(', ')}`);
  process.exit(1);
}

// Raised from 60 KB in 0.3.1 (episode page, library tabs, Watch together, volume pill), and from 64 KB in 0.3.4
// (player: Watch together, Cast, Ends at, settings with Repeat and Playback info, loading screen). The player has
// loaded on its own since 0.3.7, and the trailer preview too, which freed about 2.5 KB; the catalog title page and the
// profile pages followed, about 3 KB more. Raised to 72 KB in 0.3.7 anyway, at the owner's call: headroom for upcoming
// features. Then dropping the build's comments and moving the strings and icons only lazy files use into those files
// freed about 2.7 KB (strings.ts, components/icons.tsx).
const BUDGET = 72 * 1024;
const startup = ['lumen.js', 'lumen.css', coreChunk];
const total = startup.reduce((sum, f) => sum + gz(`dist/${f}`), 0);
console.log(`lumen bundle: ${kb(total)} gzipped (budget ${BUDGET / 1024} KB): ${startup.join(', ')}`);
// Loads on Play, behind the "Starting…" screen. 13 KB since its own strings and icons moved here out of the core (about
// 1 KB, which freed ~2.8 KB at startup). 13.5 KB since request progress: the player's code didn't change, but
// the core chunk's new exports renamed the minified imports it uses, 28 bytes more gzipped, past 13 KB by 26.
const PLAYER_BUDGET = 13.5 * 1024;
const player = gz(`dist/${playerChunk}`);
console.log(`lumen player: ${kb(player)} gzipped (budget ${PLAYER_BUDGET / 1024} KB)`);
// The player's Skip Intro button, "Skipped intro" notice and next-episode card, with their stylesheet
// (views/player/lazySegments.tsx): fetched as the player opens, apart from it, so the player's budget stays where it was.
// 4 KB at first, with 16 bytes to spare. 4.2 KB since the re-check fixes, about 130 bytes (the owner approved up to
// 4.5 KB): jellyfin-web's unseen buttons out of the D-pad's reach, the TV focus kept on Watch credits and Undo, the
// queue read again as the card is due, the watched mark's time limit, the group flag read from the playback manager.
const SEGMENTS_BUDGET = 4.2 * 1024;
const segments = gz(`dist/${segmentsChunk}`) + gz('dist/lumen-segments.css');
console.log(`lumen player segments + styles: ${kb(segments)} gzipped (budget ${SEGMENTS_BUDGET / 1024} KB)`);
// Loads as a title with a trailer preview shows (views/home/lazyTrailer.tsx).
const TRAILER_BUDGET = 8 * 1024;
const trailer = gz(`dist/${trailerChunk}`);
console.log(`lumen trailer preview: ${kb(trailer)} gzipped (budget ${TRAILER_BUDGET / 1024} KB)`);
// Loads on an admin page when Jellyfin has a restart pending (takeover/restartWatch.ts); the check itself is in the core.
const RESTART_BUDGET = 4 * 1024;
const restart = gz(`dist/${restartChunk}`);
console.log(`lumen restart banner: ${kb(restart)} gzipped (budget ${RESTART_BUDGET / 1024} KB)`);
// Loads on a catalog title's page or My requests, or once catalog cards show (only with Seerr):
// views/catalog/lazyTitle.tsx; with My requests' stylesheet (lumen-requests.css), which that page links. 6 KB until
// My requests' search, filter chips and "Everyone's requests" for administrators came here, as the file that holds
// the page (the startup file has no room): about 2.1 KB of code and strings, and the 0.8 KB stylesheet counted here.
// 8.2 KB since My requests' new layout (0.6.3): its rows' styles moved here out of lumen.css (about 0.3 KB, which the
// startup file needed for the lone Back button's hover), plus the centred column, the status column and the loading rows.
const TITLE_BUDGET = 8.2 * 1024;
const title = gz(`dist/${titleChunk}`) + gz('dist/lumen-requests.css');
console.log(
  `lumen catalog title + my requests styles: ${kb(title)} gzipped (budget ${TITLE_BUDGET / 1024} KB)`,
);
// Loads on the profile page or a stock settings page (views/profile/lazyProfile.tsx).
const PROFILE_BUDGET = 5 * 1024;
const profile = gz(`dist/${profileChunk}`);
console.log(`lumen profile: ${kb(profile)} gzipped (budget ${PROFILE_BUDGET / 1024} KB)`);
// Loads as a details page shows, or a card's "More actions…" is picked (views/itemMenu/lazyItemMenu.ts). 5 KB since its
// own strings and icons moved here out of the core (views/itemMenu/itemMenuStrings.ts, itemMenuIcons.ts).
const ITEM_MENU_BUDGET = 5 * 1024;
const itemMenu = gz(`dist/${itemMenuChunk}`);
console.log(`lumen item menu: ${kb(itemMenu)} gzipped (budget ${ITEM_MENU_BUDGET / 1024} KB)`);
// The Trailer section of a title's Media info and the show's Trailer info dialog, with their stylesheet
// (views/trailerInfo/lazyTrailerInfo.ts): fetched as Media info or Trailer info opens, from the item menu. A file of its
// own, with its own budget, since 0.6.4: the startup file has no room, and the item menu and trailer preview are
// downloaded by everyone who opens a details page or sees a trailer, which this needn't weigh on.
const TRAILER_INFO_BUDGET = 4.25 * 1024;
const trailerInfo = gz(`dist/${trailerInfoChunk}`) + gz('dist/lumen-trailerinfo.css');
console.log(
  `lumen trailer info + styles: ${kb(trailerInfo)} gzipped (budget ${TRAILER_INFO_BUDGET / 1024} KB)`,
);
// Search, person and collection pages, a library's Suggestions and Upcoming tabs, History and the Watch together menu,
// with their stylesheet (views/secondary/lazySecondary.tsx): fetched once the first page is up. Moving them out of the
// core freed about 4.7 KB at startup, with their strings and styles.
const SECONDARY_BUDGET = 9 * 1024;
const secondary = gz(`dist/${secondaryChunk}`) + gz('dist/lumen-secondary.css');
console.log(
  `lumen secondary views + styles: ${kb(secondary)} gzipped (budget ${SECONDARY_BUDGET / 1024} KB)`,
);
// Top charts, with its stylesheet (views/charts/lazyCharts.tsx): only servers with a Trakt key have the page, so it's a
// file of its own rather than more of the secondary views' (added in the Trakt charts PR; not a raised budget).
const CHARTS_BUDGET = 5 * 1024;
const charts = gz(`dist/${chartsChunk}`) + gz('dist/lumen-charts.css');
console.log(`lumen top charts + styles: ${kb(charts)} gzipped (budget ${CHARTS_BUDGET / 1024} KB)`);
// Quick Connect's approve page and sign-in screen, with the QR encoder and its stylesheet
// (views/quickconnect/lazyQuickConnect.tsx): only someone using Quick Connect downloads it, the sign-in page included.
// A new budget line in 0.5.0, approved by the owner at 6 KB, raised to 6.1 KB by the review fixes (one screen per press,
// no secret in the console, the code field's retyping, the polling back-off, the accessibility fixes). 6.2 KB in 0.6.0:
// the core chunk's new exports (the online trailers) renamed the minified imports Quick Connect uses, 7 bytes past 6.1
// with no change to its own code.
const QUICK_CONNECT_BUDGET = 6.2 * 1024;
const quickConnect = gz(`dist/${quickConnectChunk}`) + gz('dist/lumen-quickconnect.css');
console.log(
  `lumen quick connect + styles: ${kb(quickConnect)} gzipped (budget ${QUICK_CONNECT_BUDGET / 1024} KB)`,
);
// The notifications toggle with its stylesheet (views/push/lazyPush.tsx): fetched on My requests and the profile page,
// and at idle on a device with notifications on; never on a server without Seerr. A file of its own, with its own
// budget, since the push notifications PR.
const PUSH_BUDGET = 4 * 1024;
const push = gz(`dist/${pushChunk}`) + gz('dist/lumen-push.css');
console.log(`lumen notifications + styles: ${kb(push)} gzipped (budget ${PUSH_BUDGET / 1024} KB)`);
// Lumen's service worker (views/push/pushWorker.js, served as /Lumen/Push/sw.js): no page waits for it; the browser
// fetches it when notifications are turned on, then to check for updates. Copied as written, comments and all.
const WORKER_BUDGET = 2 * 1024;
const worker = gz('dist/lumen-push-sw.js');
console.log(`lumen service worker: ${kb(worker)} gzipped (budget ${WORKER_BUDGET / 1024} KB)`);
// The guard and the web plugin's definer are inlined into every index.html, so they share a small budget.
const GUARD_BUDGET = 4 * 1024;
const guard = gz('dist/lumen-guard.js') + gz('dist/lumen-web-plugin.js');
console.log(`lumen guard + web plugin: ${kb(guard)} gzipped (budget ${GUARD_BUDGET / 1024} KB)`);
// With the stock pages restyled, the guard links these (veil/skinCss.ts): jellyfin-web's sign-in, settings and admin
// pages' controls and its dialogs and menus on every page, in the way of the first paint only on those pages; and the
// admin pages' own look, on those pages only. They were part of lumen.css and of the Dashboard's stylesheet, which the
// server linked on every page.
const STOCK_BUDGET = 7 * 1024;
const stock = gz('dist/lumen-stock.css');
console.log(`lumen stock pages: ${kb(stock)} gzipped (budget ${STOCK_BUDGET / 1024} KB)`);
const DASHBOARD_BUDGET = 8 * 1024;
const dashboard = gz('dist/lumen-dashboard.css');
console.log(`lumen dashboard: ${kb(dashboard)} gzipped (budget ${DASHBOARD_BUDGET / 1024} KB)`);
// Inter's three weights (styles/fonts.css), fetched only where the system font isn't Apple's, as Lumen's first text
// shows, then cached for good. Already compressed (woff2), so counted as they are. About 54 KB: Latin with
// Latin Extended-A (scripts/subset-inter.sh).
const FONTS_BUDGET = 80 * 1024;
const fontFiles = readdirSync('dist').filter((f) => f.startsWith('lumen-font-') && f.endsWith('.woff2'));
for (const weight of [400, 500, 600]) {
  if (fontFiles.filter((f) => f.startsWith(`lumen-font-inter-${weight}-`)).length !== 1) {
    console.error(`expected one Inter ${weight} font, found: ${fontFiles.join(', ') || 'none'}`);
    process.exit(1);
  }
}
if (fontFiles.length !== 3) {
  console.error(`unexpected fonts: ${fontFiles.join(', ')}`);
  process.exit(1);
}
const fonts = fontFiles.reduce((sum, f) => sum + statSync(`dist/${f}`).size, 0);
console.log(`lumen fonts: ${kb(fonts)} (budget ${FONTS_BUDGET / 1024} KB): ${fontFiles.join(', ')}`);
if (
  total > BUDGET ||
  player > PLAYER_BUDGET ||
  segments > SEGMENTS_BUDGET ||
  trailer > TRAILER_BUDGET ||
  restart > RESTART_BUDGET ||
  title > TITLE_BUDGET ||
  profile > PROFILE_BUDGET ||
  itemMenu > ITEM_MENU_BUDGET ||
  trailerInfo > TRAILER_INFO_BUDGET ||
  secondary > SECONDARY_BUDGET ||
  charts > CHARTS_BUDGET ||
  quickConnect > QUICK_CONNECT_BUDGET ||
  push > PUSH_BUDGET ||
  worker > WORKER_BUDGET ||
  guard > GUARD_BUDGET ||
  stock > STOCK_BUDGET ||
  dashboard > DASHBOARD_BUDGET ||
  fonts > FONTS_BUDGET
) {
  process.exit(1);
}
