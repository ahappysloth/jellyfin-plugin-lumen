import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
);
