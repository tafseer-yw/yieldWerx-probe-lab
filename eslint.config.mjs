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
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/**/*.ts',
      'steps/**/*.ts',
      'scripts/**/*.ts',
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
