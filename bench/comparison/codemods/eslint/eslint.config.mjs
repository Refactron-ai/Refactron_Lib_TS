// ESLint v9+ flat config. Stock prefer-const + no-var.
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts'],
    ignores: ['**/node_modules/**', '**/tests/**', '**/*.expected.json'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: false }],
    },
  },
];
