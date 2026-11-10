// Fails when a built file uses syntax the oldest browsers Lumen loads in can't parse: Chromium 68 (LG webOS 5) and
// Safari 13. One parse error there and Lumen silently never loads. Run after `npm run build`.
//
// Parses as ES2020, for dynamic import() (Chrome 63, Safari 11.1), and rejects the rest of ES2020's syntax: optional
// chaining and `??` (Chrome 80, Safari 13.1), BigInt literals and `export * as`. Anything newer (class fields,
// `??=`, top-level await, numeric separators…) fails the parse itself. Regex lookbehind is rejected too: Safari has
// it only from 16.4.
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'acorn';

const failures = [];
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
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ChainExpression') failures.push(`optional chaining: ${where(node)}`);
    if (node.type === 'LogicalExpression' && node.operator === '??') failures.push(`??: ${where(node)}`);
    if (node.type === 'Literal' && node.bigint !== undefined) failures.push(`BigInt literal: ${where(node)}`);
    if (node.type === 'ExportAllDeclaration' && node.exported) failures.push(`export * as: ${where(node)}`);
    if (node.type === 'Literal' && node.regex && /\(\?<[=!]/.test(node.regex.pattern)) {
      failures.push(`regex lookbehind: ${where(node)}`);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast);
}

if (files.length === 0) failures.push('no .js files in dist: run `npm run build` first');
for (const f of failures.slice(0, 20)) console.error(f);
if (failures.length > 20) console.error(`…and ${failures.length - 20} more`);
if (failures.length) {
  console.error(`${failures.length} problem(s): the build must parse in Chromium 68 and Safari 13`);
  process.exit(1);
}
console.log(`lumen compat: ${files.length} files parse as Chromium 68 / Safari 13 (${files.join(', ')})`);
