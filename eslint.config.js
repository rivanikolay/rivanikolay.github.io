'use strict';

// ESLint checks the code for mistakes and sloppy spots: run "npm run lint".
// In VS Code, the ESLint extension underlines problems while you type.

const js = require('@eslint/js');
const globals = require('globals');

// Rules on top of ESLint's recommended set.
const rules = {
  eqeqeq: ['error', 'always'],          // === instead of ==, so "1" == 1 surprises can't happen
  'no-var': 'error',                    // let/const only
  'prefer-const': 'error',              // const when a value never changes
  'no-implicit-globals': 'error',       // nothing leaks into the global scope by accident
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-prototype-builtins': 'error',
};

module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'assets/uploads/', 'assets/map/'] },
  js.configs.recommended,

  // Site scripts: run in the browser, and in Node for the tests (hence "module").
  {
    files: ['assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'writable' },
    },
    rules,
  },

  // Server, tests and tooling: Node.
  {
    files: ['server.js', 'eslint.config.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules,
  },

  // Tests feed the code attack examples like "javascript:alert(1)" on purpose.
  {
    files: ['tests/**/*.js'],
    rules: { 'no-script-url': 'off' },
  },
];
