// Fails when lumen.js + lumen.css exceed the gzipped budget from the spec.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 60 * 1024;
const files = ['dist/lumen.js', 'dist/lumen.css'];
const total = files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
console.log(`lumen bundle: ${(total / 1024).toFixed(1)} KB gzipped (budget ${BUDGET / 1024} KB)`);
// The guard is inlined into every index.html, so it gets its own small budget.
const GUARD_BUDGET = 4 * 1024;
const guard = gzipSync(readFileSync('dist/lumen-guard.js')).length;
console.log(`lumen guard: ${(guard / 1024).toFixed(1)} KB gzipped (budget ${GUARD_BUDGET / 1024} KB)`);
if (total > BUDGET || guard > GUARD_BUDGET) {
  process.exit(1);
}
