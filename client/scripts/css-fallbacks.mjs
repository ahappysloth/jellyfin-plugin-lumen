// Chromium 68 (LG webOS 5) has no min(), max() or clamp() (Chromium 79) and no env() (Chromium 69): it drops any
// declaration that uses them. Each needs a plain declaration of the same property earlier in the same rule (Lightning
// CSS keeps it, though not always right before), or has to sit in an @supports block. A custom property can't have one (Lightning CSS keeps only the last), so it needs an
// `@supports not (…)` block that sets it again. Used on the source (styles/safe-area.test.ts) and on the built CSS
// (check-compat.mjs).
const NEWER = /(^|[^\w-])(min|max|clamp|env)\(/i;

/** The declarations that Chromium 68 would drop with nothing in their place. */
export function missingFallbacks(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];
  const blocks = [{ prelude: '', plain: new Set() }];
  const customProperties = []; // custom properties set with a newer function, outside @supports
  const supportsOverrides = new Set(); // custom properties set again inside @supports
  let buf = '';
  let depth = 0;
  let quote = null;

  const declaration = () => {
    const text = buf.trim();
    buf = '';
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    const block = blocks[blocks.length - 1];
    const inSupports = blocks.some((b) => b.prelude.startsWith('@supports'));
    if (property.startsWith('--')) {
      if (inSupports) supportsOverrides.add(property);
      else if (NEWER.test(value)) customProperties.push(property);
    } else if (NEWER.test(value) && !inSupports) {
      if (!block.plain.has(property)) problems.push(`${block.prelude} { ${property}: ${value} }`);
    }
    if (!NEWER.test(value)) block.plain.add(property);
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
      blocks.push({ prelude: buf.trim().replace(/\s+/g, ' '), plain: new Set() });
      buf = '';
    } else if (depth === 0 && (ch === ';' || ch === '}')) {
      declaration();
      if (ch === '}') blocks.pop();
    } else {
      buf += ch;
    }
  }
  for (const property of customProperties) {
    if (!supportsOverrides.has(property)) problems.push(`${property}: not set again in an @supports block`);
  }
  return problems;
}
