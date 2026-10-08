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
);
