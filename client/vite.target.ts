/**
 * The oldest browsers the build must run in: Chromium 68 (LG webOS 5 and the like) and Safari 13. Anything newer
 * that one of them can't parse, `?.` and `??` above all, is compiled down; a single parse error and Lumen never
 * loads there. CSS is lowered to match. `npm run compat` checks the output (scripts/check-compat.mjs).
 */
export const target = ['chrome68', 'safari13'];
