import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const HINT = 'use a loop, concat or index arithmetic.';
// Globals newer than Chromium 68 / Safari 13, bare or as window.x / self.x.
const NEWER_GLOBALS = ['globalThis', 'queueMicrotask', 'structuredClone'];
// Array and string methods newer than Chromium 68 / Safari 13.
const NEWER_METHODS = [
  'flat',
  'flatMap',
  'at',
  'findLast',
  'findLastIndex',
  'replaceAll',
  'matchAll',
  'toSorted',
  'toReversed',
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Later tasks use `!` together with noUncheckedIndexedAccess (controller ruling).
  { rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // ES5 (inlined as is; see the file): a catch needs its binding, used or not.
  {
    files: ['src/compat/webPluginDefiner.js'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  // Lumen's service worker: ES5 as well, copied to dist as it is, and running in a worker, not a page.
  {
    files: ['src/views/push/pushWorker.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  // Lumen runs in Chromium 68 (LG webOS 5) and Safari 13 (vite.target.ts). The build compiles newer syntax down but
  // can't add missing functions. jellyfin-web's core-js has most of these by the time lumen.js runs, but not when the
  // inline guard does, and the guard shares code with the rest; so none of them, anywhere.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...NEWER_GLOBALS.map((name) => ({
          name,
          message: 'Not in Chromium 68 / Safari 13: use window, or a plain alternative.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...[
          ['Object', 'fromEntries'],
          ['Object', 'hasOwn'],
          ['Promise', 'allSettled'],
          ['Promise', 'any'],
          ...['window', 'self'].flatMap((object) => NEWER_GLOBALS.map((name) => [object, name])),
        ].map(([object, property]) => ({
          object,
          property,
          message: `Not in Chromium 68 / Safari 13: ${HINT}`,
        })),
      ],
      // Calls only (`at` is also a field name), as `.at(…)`, `['at'](…)` or `[`at`](…)`.
      'no-restricted-syntax': [
        'error',
        ...[
          `[computed=false][property.name=/^(${NEWER_METHODS.join('|')})$/]`,
          `[computed=true][property.value=/^(${NEWER_METHODS.join('|')})$/]`,
          `[computed=true][property.type='TemplateLiteral'][property.expressions.length=0][property.quasis.0.value.cooked=/^(${NEWER_METHODS.join('|')})$/]`,
        ].map((property) => ({
          selector: `CallExpression > MemberExpression.callee${property}`,
          message: `Not in Chromium 68 / Safari 13: ${HINT}`,
        })),
      ],
    },
  },
);
