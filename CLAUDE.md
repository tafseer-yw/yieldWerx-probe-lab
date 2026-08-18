# yieldWerx Playground — Working Agreements

This repo bundles a **lightweight wafer-analysis app** (`probe-lab-app/`),
the **BDD framework** that tests it (`src/`, `steps/`, `features/`), and the
**PROBE plugin** (`yw@yieldwerx`) that governs QA delivery. Everything runs
offline; `npm test` starts the app and runs the BDD suite.

## The three pillars

- **App — `probe-lab-app/`**: yieldWerx Playground (Fastify API + SQLite
  `practice-probe-db` + React/Vite). Four workflows: wafer upload → wafer map,
  cluster detection, bin pareto, wafer triage. Self-contained; `npm start` (inside
  `probe-lab-app/`) seeds and runs it. See `probe-lab-app/README.md`.
- **Framework — `src/core/`, `steps/`, `features/`, `playwright.config.ts`**:
  Playwright + `playwright-bdd`. `src/core/fixtures.ts` is the DI backbone
  (`config` + `scenarioState`); steps drive the app through `page` +
  getByRole/getByTestId. The starter suite
  (`features/probe-lab/workflow.feature`) is the seed QA extends.
- **PROBE — `vendor/probe` + `.claude/settings.json` + `probe.config.yaml`**:
  the `yw@yieldwerx` plugin from `tafseer-yw/yieldwerx-probe`. PROBE owns _how_
  QA work is designed, reviewed, and gated; this repo owns its code, tests,
  rules, ledgers, and evidence.

## PROBE is the authority, not this repo

Skills and agents come from the **PROBE plugin**, not from this repository.
`yw@yieldwerx` (`https://github.com/tafseer-yw/yieldwerx-probe`) supplies 34
`yw:*` skills and specialist agents across a development track and a QA track.
This repository owns its code, tests, rules, configuration, ledgers, and
evidence. `.claude/settings.json` and `.claude/rules/` are the only
repository-owned Claude assets.

The integration contract is `probe.config.yaml` — paths, commands, policies,
and gate mode. The process authority is
`vendor/probe/plugins/yieldwerx-probe/references/process/PROBE-PROCESS.md`.
Never copy a plugin document into `docs/`; reference it instead.

**Read first, in order:** `docs/README.md` (docs index) →
`probe-lab-app/README.md` (the app) → the relevant `/yw:` skill for the
requested PROBE stage. Work on a feature starts by reading its ledger:
`docs/qa/<feature>/LEDGER.md`.

## Commands

| Command              | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `npm test`           | bddgen + Playwright (chromium); the webServer auto-starts probe-lab-app              |
| `npm run test:smoke` | the `@smoke` tag slice                                                               |
| `npm run typecheck`  | `tsc --noEmit` (strict)                                                              |
| `npm run lint`       | `eslint .` (no `any`, no raw CSS/XPath locators in steps, downward import direction) |
| `npm run app:dev`    | seed + run probe-lab-app (API :5000 + web :3000)                                     |
| `npm run app:build`  | production-build probe-lab-app                                                       |

## Architecture

- `src/core/` is the bottom layer (config, paths, logger, fixtures, types); it
  imports nothing above it.
- `steps/` import `test`/`expect`/`Given`/`When`/`Then` from `steps/fixtures.ts`
  (bound to `src/core/fixtures.ts`). Steps are the only layer that asserts; they
  drive the app through Playwright `page` + getByRole/getByTestId (no raw CSS/XPath
  locators — see `.claude/rules/locator-policy.md`).
- `features/` hold Gherkin; `bddgen` compiles them with `steps/` into
  `.features-gen/` (gitignored).
- `playwright.config.ts` runs a single `chromium` project; its `webServer` runs
  `cd probe-lab-app && npm start` and reuses an existing server when not in CI.
  Its `globalTeardown` (`src/core/global-teardown.ts`) deletes the `LOT-E2E-*`
  wafers the suite uploads, over HTTP as `admin`, so a developer database does
  not fill up run after run. It never fails a run.
- `probe-lab-app/` is self-contained (its own `package.json`, `node_modules`,
  SQLite DB) — the framework targets it only through the browser at
  `http://localhost:3000`.

## PROBE delivery tracks

PROBE runs development-first, then QA. The stages and their `/yw:` skills are
defined in the plugin (`vendor/probe/docs/SKILL-USAGE.md`); the bars are
predicates, not signatures.

- **Development track** — discern → draft → build → critique → certify.
- **QA track** — specify → codify → automate → attest → promote. The Cribrum
  bar (closes QA) opens when every criterion traces to a passing scenario or is
  deferred with a reason, and the suite is green three consecutive times.

Working artifacts: `.probe/artifacts/<feature>/<stage>/` (gitignored). Permanent
trail: `docs/qa/<feature>/` (committed).

## Rules

- **Wrong business data is always `blocker`.** A calculation that produces
  plausible-but-incorrect output is the worst defect class.
- **A test that cannot fail is worse than no test.** Assert calculated results
  against a value derived independently of the code under test.
- **Locator policy** (`locator-policy.md`): steps use getByTestId/getByRole; raw
  `.locator('css')`/XPath is forbidden. The app exposes `data-testid` where no
  semantic role exists (e.g. the file input).
- `@manual` is permanent provenance; `@automated` is added alongside, never
  instead.
- Severity ladder: `blocker | high | medium | low | info`. `blocker` halts
  immediately; `high` halts after the current step.

## Maintenance

- Any structural framework change updates this file in the same PR.
- `probe.config.yaml` paths/commands must point at scripts that exist in
  `package.json`.
- The PROBE plugin is vendored at `vendor/probe` (ignored by `tsconfig`/`eslint`/
  `bddgen`); update it with `git -C vendor/probe pull`.
