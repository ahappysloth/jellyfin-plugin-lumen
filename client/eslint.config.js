import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const HINT = 'use a loop, concat or index arithmetic.';
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
  // Lumen runs in Chromium 68 (LG webOS 5) and Safari 13 (vite.target.ts). The build compiles newer syntax down but
  // can't add missing functions. jellyfin-web's core-js has most of these by the time lumen.js runs, but not when the
  // inline guard does, and the guard shares code with the rest; so none of them, anywhere.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['globalThis', 'queueMicrotask', 'structuredClone'].map((name) => ({
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
        ].map(([object, property]) => ({
          object,
          property,
          message: `Not in Chromium 68 / Safari 13: ${HINT}`,
        })),
      ],
      // Calls only: `at` is also a field name.
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression > MemberExpression.callee[property.name=/^(${NEWER_METHODS.join('|')})$/]`,
          message: `Not in Chromium 68 / Safari 13: ${HINT}`,
        },
      ],
    },
  },
);
