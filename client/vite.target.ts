/**
 * The oldest browsers the build must run in: Chromium 68 (LG webOS 5 and the like) and Safari 13. Anything newer
 * that one of them can't parse, `?.` and `??` above all, is compiled down; a single parse error and Lumen never
 * loads there. `npm run compat` checks the output (scripts/check-compat.mjs).
 *
 * Only syntax is compiled down. Functions they lack must not be used (eslint.config.js). Lightning CSS lowers some
 * CSS to these targets (clamp() to max(min()), except in a value with var()), but Chromium 68 has no min(), max(),
 * clamp() or env() at all: each needs a plain fallback (styles/lumen.css).
 */
export const target = ['chrome68', 'safari13'];
