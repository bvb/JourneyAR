import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'book/**',
      'unity-data-project/**',
      'android-ar-viewer.1.0/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs}', '**/*.config.ts', '**/tests/**/*.ts', 'journey-ar/dev/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['journey-ar/src/**/*.ts', 'journey-virtual-book-camera/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
);
