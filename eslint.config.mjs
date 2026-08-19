import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';

/**
 * ESLint — framework policy for the repointed, lightweight BDD framework.
 * Lints both the BDD harness and the PROBE Lab app.
 *  - no `any` (error)
 *  - downward dependency direction: src/ never imports steps/ or features/
 *  - no circular imports
 *  - locator policy: raw CSS / XPath locators are forbidden in steps — use
 *    getByTestId / getByRole (the lightweight app exposes data-testid where
 *    no semantic role exists, e.g. the file input).
 */

const importSettings = {
  'import-x/resolver': {
    typescript: {
      alwaysTryTypes: true,
      project: ['./tsconfig.json', './probe-lab-app/tsconfig.json'],
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '.features-gen/**',
      'test-results/**',
      'reports/**',
      '**/dist/**',
      'probe-lab-app/data/**',
      'vendor/**',
      'docs/**',
      '.husky/**',
      '.claude/**',
      // k6 scripts run under the k6 runtime (its own __ENV/__VU globals and
      // k6/* module resolver), not Node — linting them with the Node config
      // only produces false no-undef/no-unresolved noise. They are validated
      // instead by `npm run perf:validate` (k6 inspect).
      'performance/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/**/*.ts',
      'steps/**/*.ts',
      'scripts/**/*.ts',
      'tests/**/*.ts',
      'playwright.config.ts',
      'probe-lab-app/{api,scripts,shared,tests,web}/**/*.{ts,tsx}',
    ],
    settings: importSettings,
    plugins: { 'import-x': importX },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty-pattern': 'off',
      'import-x/no-cycle': 'error',
      'import-x/no-unresolved': 'off',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src',
              from: ['./steps', './features'],
              message:
                'Dependency direction is downward: src/ must not import from steps/ or features/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Stand-alone Node scripts run by `node` directly, never imported by the
    // suite. They may not import a package at all — scripts/ensure-deps.mjs
    // exists to repair a missing dependency tree — so the Node globals are
    // declared here rather than pulled in from the `globals` package, which
    // would be one more thing that has to already be installed.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['steps/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='locator'] Literal[value=/^(\\/\\/|xpath=)/]",
          message: 'XPath locators are forbidden. Use getByTestId/getByRole.',
        },
        {
          selector: "CallExpression[callee.property.name='locator'] > Literal:first-child",
          message: 'Raw CSS locators are forbidden in steps. Use getByTestId/getByRole.',
        },
      ],
    },
  },
  prettier,
);
