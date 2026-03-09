import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
