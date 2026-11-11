// Fails when what every page loads (lumen.js, the chunks it loads at startup, lumen.css), or one of the chunks loaded
// when they're needed (the player, the trailer preview, the restart banner, the catalog title page, the profile pages),
// exceeds its gzipped budget.
import { readdirSync, readFileSync } from 'node:fs';
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
// views/catalog/lazyTitle.tsx, views/profile/lazyProfile.tsx.
const playerChunk = oneChunk('PlayerView');
const trailerChunk = oneChunk('TrailerPreview');
const restartChunk = oneChunk('RestartBanner');
const titleChunk = oneChunk('TitleView');
const profileChunk = oneChunk('ProfilePages');
// Startup is lumen.js and the core it imports, which the server preloads with it. Another chunk would be a download
// the core waits for (vite.config.ts keeps it to one).
const others = chunks.filter(
  (f) => ![coreChunk, playerChunk, trailerChunk, restartChunk, titleChunk, profileChunk].includes(f),
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
// 1 KB, which freed ~2.8 KB at startup).
const PLAYER_BUDGET = 13 * 1024;
const player = gz(`dist/${playerChunk}`);
console.log(`lumen player: ${kb(player)} gzipped (budget ${PLAYER_BUDGET / 1024} KB)`);
// Loads as a title with a trailer preview shows (views/home/lazyTrailer.tsx).
const TRAILER_BUDGET = 8 * 1024;
const trailer = gz(`dist/${trailerChunk}`);
console.log(`lumen trailer preview: ${kb(trailer)} gzipped (budget ${TRAILER_BUDGET / 1024} KB)`);
// Loads on an admin page when Jellyfin has a restart pending (takeover/restartWatch.ts); the check itself is in the core.
const RESTART_BUDGET = 4 * 1024;
const restart = gz(`dist/${restartChunk}`);
console.log(`lumen restart banner: ${kb(restart)} gzipped (budget ${RESTART_BUDGET / 1024} KB)`);
// Loads on a catalog title's page, or once catalog cards show (only with Seerr): views/catalog/lazyTitle.tsx.
const TITLE_BUDGET = 6 * 1024;
const title = gz(`dist/${titleChunk}`);
console.log(`lumen catalog title: ${kb(title)} gzipped (budget ${TITLE_BUDGET / 1024} KB)`);
// Loads on the profile page or a stock settings page (views/profile/lazyProfile.tsx).
const PROFILE_BUDGET = 5 * 1024;
const profile = gz(`dist/${profileChunk}`);
console.log(`lumen profile: ${kb(profile)} gzipped (budget ${PROFILE_BUDGET / 1024} KB)`);
// The guard and the web plugin's definer are inlined into every index.html, so they share a small budget.
const GUARD_BUDGET = 4 * 1024;
const guard = gz('dist/lumen-guard.js') + gz('dist/lumen-web-plugin.js');
console.log(`lumen guard + web plugin: ${kb(guard)} gzipped (budget ${GUARD_BUDGET / 1024} KB)`);
// The admin pages' stylesheet loads alongside lumen.css only where the Dashboard skin is on.
const DASHBOARD_BUDGET = 8 * 1024;
const dashboard = gzipSync(readFileSync('dist/lumen-dashboard.css')).length;
console.log(
  `lumen dashboard: ${(dashboard / 1024).toFixed(1)} KB gzipped (budget ${DASHBOARD_BUDGET / 1024} KB)`,
);
if (
  total > BUDGET ||
  player > PLAYER_BUDGET ||
  trailer > TRAILER_BUDGET ||
  restart > RESTART_BUDGET ||
  title > TITLE_BUDGET ||
  profile > PROFILE_BUDGET ||
  guard > GUARD_BUDGET ||
  dashboard > DASHBOARD_BUDGET
) {
  process.exit(1);
}
