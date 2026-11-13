// Fails when a built file uses syntax the oldest browsers Lumen loads in can't parse: Chromium 68 (LG webOS 5) and
// Safari 13. One parse error there and Lumen silently never loads. Run after `npm run build`.
//
// Parses as ES2020, for dynamic import() (Chrome 63, Safari 11.1), and rejects the rest of ES2020's syntax: optional
// chaining and `??` (Chrome 80, Safari 13.1), BigInt literals and `export * as`. Anything newer (class fields,
// `??=`, top-level await, numeric separators…) fails the parse itself. Regex lookbehind is rejected too: Safari has
// it only from 16.4.
//
// The inline guard runs before jellyfin-web loads its polyfills (core-js), so it is also checked for functions those
// browsers lack. Lumen's own source is checked for them by eslint (eslint.config.js); this catches whatever else gets
// bundled into the guard.
//
// The built stylesheets are checked for min(), max(), clamp() and env() without a fallback (css-fallbacks.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { missingFallbacks } from './css-fallbacks.mjs';

const GUARD = 'lumen-guard.js';
const NEWER_GLOBALS = new Set(['globalThis', 'queueMicrotask', 'structuredClone']);
const NEWER_PROPERTIES = new Set([
  'fromEntries',
  'hasOwn',
  'allSettled',
  'any',
  'flat',
  'flatMap',
  'at',
  'findLast',
  'findLastIndex',
  'replaceAll',
  'matchAll',
  'toSorted',
  'toReversed',
]);

const failures = [];
// Every one of these must be there and checked: a missing file would otherwise pass unnoticed.
const REQUIRED = [
  'lumen.js',
  GUARD,
  'lumen-admin.js',
  'lumen.css',
  'lumen-stock.css',
  'lumen-dashboard.css',
  'lumen-secondary.css',
  'lumen-charts.css',
  'lumen-quickconnect.css',
];
for (const file of REQUIRED) {
  if (!existsSync(`dist/${file}`)) failures.push(`dist/${file} is missing: run \`npm run build\` first`);
}
// The content-named chunks: the core, the player and the trailer preview (vite.config.ts).
for (const chunk of [
  'main',
  'PlayerView',
  'TrailerPreview',
  'SecondaryViews',
  'ChartsView',
  'QuickConnect',
]) {
  if (!readdirSync('dist').some((f) => f.startsWith(`lumen-chunk-${chunk}-`) && f.endsWith('.js'))) {
    failures.push(`no lumen-chunk-${chunk}-*.js in dist: run \`npm run build\` first`);
  }
}
const files = readdirSync('dist').filter((f) => f.endsWith('.js'));
for (const file of files) {
  const code = readFileSync(`dist/${file}`, 'utf8');
  // lumen.js and its chunks are ES modules; the admin page and guard scripts are classic scripts.
  const sourceType = /^(export|import)\b/m.test(code) || /\bimport\(/.test(code) ? 'module' : 'script';
  const where = (node) => {
    const line = code.slice(0, node.start).split('\n').length;
    return `${file}:${line}: ${code.slice(node.start, Math.min(node.end, node.start + 60))}`;
  };
  let ast;
  try {
    ast = parse(code, { ecmaVersion: 2020, sourceType });
  } catch (e) {
    failures.push(`${file}: ${e.message}`);
    continue;
  }
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (file === GUARD) {
      const isProperty = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const isKey = parent?.type === 'Property' && parent.key === node && !parent.computed;
      if (node.type === 'Identifier' && NEWER_GLOBALS.has(node.name) && !isProperty && !isKey) {
        failures.push(`${node.name} (no polyfill before the guard): ${where(node)}`);
      }
      if (node.type === 'MemberExpression') {
        // x.at, x['at'], and window.queueMicrotask / self.structuredClone.
        const name = node.computed ? node.property.value : node.property.name;
        if (typeof name === 'string' && (NEWER_PROPERTIES.has(name) || NEWER_GLOBALS.has(name))) {
          failures.push(`.${name} (no polyfill before the guard): ${where(node)}`);
        }
      }
    }
    if (node.type === 'ChainExpression') failures.push(`optional chaining: ${where(node)}`);
    if (node.type === 'LogicalExpression' && node.operator === '??') failures.push(`??: ${where(node)}`);
    if (node.type === 'Literal' && node.bigint !== undefined) failures.push(`BigInt literal: ${where(node)}`);
    if (node.type === 'ExportAllDeclaration' && node.exported) failures.push(`export * as: ${where(node)}`);
    if (node.type === 'Literal' && node.regex && /\(\?<[=!]/.test(node.regex.pattern)) {
      failures.push(`regex lookbehind: ${where(node)}`);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((c) => visit(c, node));
      else if (child && typeof child === 'object') visit(child, node);
    }
  };
  visit(ast, null);
}

const styles = readdirSync('dist').filter((f) => f.endsWith('.css'));
for (const file of styles) {
  for (const problem of missingFallbacks(readFileSync(`dist/${file}`, 'utf8'))) {
    failures.push(`${file}: no fallback for Chromium 68: ${problem.slice(0, 160)}`);
  }
}

for (const f of failures.slice(0, 20)) console.error(f);
if (failures.length > 20) console.error(`…and ${failures.length - 20} more`);
if (failures.length) {
  console.error(`${failures.length} problem(s): the build must run in Chromium 68 and Safari 13`);
  process.exit(1);
}
const checked = [...files, ...styles];
console.log(`lumen compat: ${checked.length} files OK for Chromium 68 / Safari 13 (${checked.join(', ')})`);
