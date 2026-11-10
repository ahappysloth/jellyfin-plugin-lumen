// Fails when what every page loads (lumen.js, the chunks it loads at startup, lumen.css) or the player's own chunk
// exceeds its gzipped budget.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const gz = (f) => gzipSync(readFileSync(f)).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const chunks = readdirSync('dist').filter((f) => f.startsWith('lumen-chunk-') && f.endsWith('.js'));
const playerChunks = chunks.filter((f) => f.startsWith('lumen-chunk-PlayerView-'));
if (playerChunks.length !== 1) {
  console.error(`expected one player chunk, found ${playerChunks.length}: ${chunks.join(', ')}`);
  process.exit(1);
}

// Raised from 60 KB in 0.3.1 (episode page, library tabs, Watch together, volume pill), and from 64 KB in 0.3.4
// (player: Watch together, Cast, Ends at, settings with Repeat and Playback info, loading screen). The player has
// loaded on its own since 0.3.7.
const BUDGET = 68 * 1024;
const startup = ['lumen.js', 'lumen.css', ...chunks.filter((f) => !playerChunks.includes(f))];
const total = startup.reduce((sum, f) => sum + gz(`dist/${f}`), 0);
console.log(`lumen bundle: ${kb(total)} gzipped (budget ${BUDGET / 1024} KB): ${startup.join(', ')}`);
const PLAYER_BUDGET = 12 * 1024;
const player = gz(`dist/${playerChunks[0]}`);
console.log(`lumen player: ${kb(player)} gzipped (budget ${PLAYER_BUDGET / 1024} KB)`);
// The guard is inlined into every index.html, so it gets its own small budget.
const GUARD_BUDGET = 4 * 1024;
const guard = gzipSync(readFileSync('dist/lumen-guard.js')).length;
console.log(`lumen guard: ${kb(guard)} gzipped (budget ${GUARD_BUDGET / 1024} KB)`);
// The admin pages' stylesheet loads alongside lumen.css only where the Dashboard skin is on.
const DASHBOARD_BUDGET = 8 * 1024;
const dashboard = gzipSync(readFileSync('dist/lumen-dashboard.css')).length;
console.log(
  `lumen dashboard: ${(dashboard / 1024).toFixed(1)} KB gzipped (budget ${DASHBOARD_BUDGET / 1024} KB)`,
);
if (total > BUDGET || player > PLAYER_BUDGET || guard > GUARD_BUDGET || dashboard > DASHBOARD_BUDGET) {
  process.exit(1);
}
