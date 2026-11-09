// Fails when lumen.js + lumen.css exceed the gzipped budget from the spec.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Raised from 60 KB in 0.3.1 (episode page, library tabs, Watch together, volume pill).
const BUDGET = 64 * 1024;
const files = ['dist/lumen.js', 'dist/lumen.css'];
const total = files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
console.log(`lumen bundle: ${(total / 1024).toFixed(1)} KB gzipped (budget ${BUDGET / 1024} KB)`);
// The guard is inlined into every index.html, so it gets its own small budget.
const GUARD_BUDGET = 4 * 1024;
const guard = gzipSync(readFileSync('dist/lumen-guard.js')).length;
console.log(`lumen guard: ${(guard / 1024).toFixed(1)} KB gzipped (budget ${GUARD_BUDGET / 1024} KB)`);
// The admin pages' stylesheet loads alongside lumen.css only where the Dashboard skin is on.
const DASHBOARD_BUDGET = 8 * 1024;
const dashboard = gzipSync(readFileSync('dist/lumen-dashboard.css')).length;
console.log(
  `lumen dashboard: ${(dashboard / 1024).toFixed(1)} KB gzipped (budget ${DASHBOARD_BUDGET / 1024} KB)`,
);
if (total > BUDGET || guard > GUARD_BUDGET || dashboard > DASHBOARD_BUDGET) {
  process.exit(1);
}
