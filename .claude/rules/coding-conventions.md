---
paths:
  - 'src/**/*.ts'
  - 'steps/**/*.ts'
---

# Coding conventions (TypeScript / test code)

- TypeScript strict; `any` is an ESLint error — use `unknown` + narrowing.
- No hard waits (`waitForTimeout`) and no `networkidle` — both are flake
  sources. Wait on state: `expect(locator).toBeVisible()`, `waitForURL`, or
  `expect(...).toBeAttached()`.
- No unawaited promises — `await` every action/assertion, or `void` it
  deliberately. An unawaited action is a silent flake.
- No assertions outside steps; steps assert (`expect` from `steps/fixtures.ts`).
- Browser `page.evaluate` callbacks are serialized: they must be self-contained
  (no references to Node-side helpers).
- Dependency direction is strictly downward (see `CLAUDE.md`). `src/core/`
  imports nothing above it; `steps/` import only from `steps/fixtures.ts` and
  `@core/*`. Enforced by `import-x/no-restricted-paths` + `no-cycle` in
  `eslint.config.mjs`.
- `src/core/fixtures.ts` is the only DI mechanism (`config`, `scenarioState`) —
  no globals, no shared mutable state between scenarios.
- Config precedence: `config/environments/<env>.json` → `.env` → `E2E_*` env
  vars (highest), zod-validated at startup. Secrets never in committed JSON or
  code.
- The app under test (`probe-lab-app/`) is driven only through the browser at
  `http://localhost:3000`. Never import app code into the framework.
