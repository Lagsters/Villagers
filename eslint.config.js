import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'art/models/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // Testy e2e siegaja do window.__game z page.evaluate - tam `any` jest uzasadnione.
    files: ['tests/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Symulacja musi byc deterministyczna: zakaz Math.random, Date i floatowych funkcji Math.
    files: ['sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Uzyj PRNG z sim/rng.ts' },
        { object: 'Math', property: 'sin', message: 'Uzyj tablic z sim/fixed.ts' },
        { object: 'Math', property: 'cos', message: 'Uzyj tablic z sim/fixed.ts' },
        { object: 'Math', property: 'sqrt', message: 'Uzyj isqrt z sim/fixed.ts' },
        { object: 'Date', property: 'now', message: 'Symulacja nie zna czasu rzeczywistego' },
        { object: 'performance', property: 'now', message: 'Symulacja nie zna czasu rzeczywistego' },
      ],
      'no-restricted-globals': ['error', 'window', 'document'],
    },
  },
);
