// Chromium 68 (LG webOS 5) has no min(), max() or clamp() (Chromium 79) and no env() (Chromium 69): it drops any
// declaration that uses them. So each one needs, in the same rule, a plain declaration of the same property BEFORE it
// (Lightning CSS keeps that, though not always right before; after it, it would override every browser). Or it sits
// in an @supports block that tests for one of those functions, which Chromium 68 skips whole.
//
// A custom property can't have a plain one before it (Lightning CSS keeps only the last), so the same selector has
// to set it again inside `@supports not (…)` testing for one of those functions.
//
// Used on the source (styles/safe-area.test.ts) and on the built CSS (check-compat.mjs).
const NEWER = /(^|[^\w-])(min|max|clamp|env)\(/i;

// An @supports block that tests for a newer function: Chromium 68 skips `@supports (width: max(…))` and applies
// `@supports not (width: max(…))`.
const skippedByChromium68 = (prelude) => /^@supports\s*\(/i.test(prelude) && NEWER.test(prelude);
const onlyForChromium68 = (prelude) => /^@supports\s+not\b/i.test(prelude) && NEWER.test(prelude);

/** The declarations that would leave Chromium 68 with nothing, or that would override newer browsers. */
export function missingFallbacks(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];
  const blocks = [{ prelude: '', plain: new Set(), modern: new Set() }];
  const customProperties = []; // `selector\n--name` set with a newer function
  const overrides = new Set(); // `selector\n--name` set again for Chromium 68 only
  let buf = '';
  let depth = 0;
  let quote = null;

  const declaration = () => {
    const text = buf.trim();
    buf = '';
    const colon = text.indexOf(':');
    if (colon < 0 || text.startsWith('@')) return;
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    const block = blocks[blocks.length - 1];
    if (blocks.some((b) => skippedByChromium68(b.prelude))) return;
    const newer = NEWER.test(value);
    if (property.startsWith('--')) {
      const key = `${block.prelude}\n${property}`;
      if (blocks.some((b) => onlyForChromium68(b.prelude))) {
        if (!newer) overrides.add(key);
      } else if (newer) {
        customProperties.push(key);
      }
    } else if (newer) {
      if (!block.plain.has(property))
        problems.push(`${block.prelude} { ${property}: ${value} }: no fallback before it`);
      block.modern.add(property);
    } else if (block.modern.has(property)) {
      problems.push(
        `${block.prelude} { ${property}: ${value} }: a fallback after the newer value overrides it`,
      );
    }
    if (!newer) block.plain.add(property);
  };

  for (const ch of css) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      buf += ch;
      quote = ch;
    } else if (ch === '(' || ch === ')') {
      depth += ch === '(' ? 1 : -1;
      buf += ch;
    } else if (depth === 0 && ch === '{') {
      blocks.push({ prelude: buf.trim().replace(/\s+/g, ' '), plain: new Set(), modern: new Set() });
      buf = '';
    } else if (depth === 0 && (ch === ';' || ch === '}')) {
      declaration();
      if (ch === '}') blocks.pop();
    } else {
      buf += ch;
    }
  }
  for (const key of customProperties) {
    if (!overrides.has(key)) {
      const [selector, property] = key.split('\n');
      problems.push(
        `${selector} { ${property} }: not set again for ${selector} in an @supports not (…) block`,
      );
    }
  }
  return problems;
}
