// @ts-check
import { createRequire } from 'node:module';
import eslintConfigPrettier from 'eslint-config-prettier';

// typescript-eslint is installed in ./lint with TypeScript 6 (it does not support TypeScript 7 yet).
const tseslint = createRequire(new URL('./lint/', import.meta.url))('typescript-eslint');

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'electron/dist/',
      'electron/build/',
      'node_modules/',
      'lint/',
      'build/',
      '.build/',
      'playground/',
      'android/',
      'ios/',
      'electron/*.cjs',
      'README.md',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended, eslintConfigPrettier],
    rules: {
      'no-fallthrough': 'off',
      'no-constant-condition': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': [
        'warn',
        { allowArgumentsExplicitlyTypedAsAny: true },
      ],
      'max-lines': [
        'warn',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
);
