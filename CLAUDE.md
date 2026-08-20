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
`yw@yieldwerx` (`https://github.com/tafseer-yw/yieldwerx-probe`) supplies 42
`yw:*` skills and 17 specialist agents across a development track, a QA track,
and skills shared by both.
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

| Command                                | Purpose                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm test`                             | bddgen + Playwright (chromium); the webServer auto-starts probe-lab-app              |
| `npm run test:smoke`                   | the `@smoke` tag slice                                                               |
| `npm run typecheck`                    | `tsc --noEmit` (strict)                                                              |
| `npm run lint`                         | `eslint .` (no `any`, no raw CSS/XPath locators in steps, downward import direction) |
| `npm run app:dev`                      | seed + run probe-lab-app (API :5000 + web :3000)                                     |
| `npm run check:connections`            | verify the AIO Tests and Jira credentials reach their configured project (read-only) |
| `node scripts/ensure-deps.mjs --check` | report missing/stale dependencies without installing (CI)                            |
| `npm run app:build`                    | production-build probe-lab-app                                                       |

## Architecture

- `src/core/` is the bottom layer (config, paths, logger, fixtures, types); it
  imports nothing above it.
- `src/pages/` and `src/components/` hold the **page-object model** — page
  objects (one per screen) and component objects (reusable widgets scoped to a
  root). They carry locators and actions only, never assertions, and sit below
  steps and above core; the direction is enforced by eslint. Constructed once
  in `src/core/fixtures.ts` and injected into steps by name. `BasePage` /
  `BaseComponent` are the thin bases. `steps/visual.steps.ts` is the reference.
- `steps/` import `test`/`expect`/`Given`/`When`/`Then` from `steps/fixtures.ts`
  (bound to `src/core/fixtures.ts`). Steps are the only layer that asserts; they
  drive the app through the page objects (preferred) or, for one-offs the POM
  does not model, `page` + getByRole/getByTestId — never raw CSS/XPath (see
  `.claude/rules/locator-policy.md`).
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
defined in the plugin (`vendor/probe/docs/SKILL-USAGE.md`).

- **Development track** — PRD → spec analysis → tech design → build → unit
  tests → review → ship.
- **QA track** — spec analysis → cases → Design Gate → recon → scripts →
  green run → Merge Gate → promote → Ops Gate.
- Both tracks start from the **same** `spec-analysis.md`; `/yw:probe-spec` is
  shared, and whoever runs it second reads the existing analysis rather than
  producing a second opinion.

**A gate is a record of a human decision — nothing else.** There are exactly
three (Design, Merge, Ops). Each assembles an evidence digest of facts, presents
it, records a named human's approval with a timestamp, and unlocks the next
stage. It computes no verdict and blocks on nothing, so there is nothing to
waive, bypass, or override — all of those mechanisms were removed in PROBE 3.0.
Approving with gaps visible is a legitimate decision and is recorded as exactly
that; removing a gap from a digest to make the decision look cleaner is
falsified evidence. Authority:
`vendor/probe/plugins/yieldwerx-probe/references/governance/human-gates.md`.

Working artifacts: `.probe/artifacts/<feature>/<stage>/` (gitignored). Permanent
trail: `docs/qa/<feature>/` (committed).

## Test types

Functional e2e is the everyday `chromium` project. Three specialised layers run
on their own:

- **Visual regression** (`npm run test:visual`) — pixel-pins the canvas charts
  with odiff, **inside the pinned Playwright container only** (host GPU/font
  stacks differ). Baselines live committed under `tests/visual/baselines/`;
  regenerate with `npm run test:visual:baseline` after reviewing the diff.
  Tolerances are pinned in `src/core/visual.ts` and guarded by the
  `framework-selftest` project. Tag a scenario `@visual`.
- **Performance** (`npm run perf:smoke`, then `perf:load` / `perf:stress` / ...)
  — k6 in Docker against the host app; profiles are data behind a fail-closed
  `assertSafeTarget` gate (load and external/production targets need explicit
  unlocks). Summaries land under `reports/k6/`.
- **Security** — `npm run security:tests` is the executable regression suite
  (`probe-lab-app/tests/security.test.ts`) for the boundaries no scanner can
  judge, tagged by OWASP 2025 category; `security:deps` / `security:sast` /
  `security:baseline` drive osv-scanner, semgrep, and ZAP in Docker, the
  baseline fail-closed without an explicit local target and authorization.

## Reports and local CI

- **Allure** — `allure-playwright` writes `reports/allure-results` on every run;
  `npm run allure:generate` builds the report, `allure:open` / `allure:serve`
  view it, `allure:report` does both. `environmentInfo` makes each report
  self-describing and `src/reporting/allureCategories.ts` classifies a red run
  into legible buckets (wrong-data blocker, visual drift, testId break, timeout,
  untriaged defect, infra).
- **Local Jenkins** (`ci/local/`) — a self-contained controller in Docker,
  configured entirely by JCasC (`casc.yaml`), with one job `probe-lab-e2e` that
  runs the whole pipeline (install → lint → typecheck → bddgen → test) and
  publishes Allure. `npm run jenkins:up` builds and starts it, `jenkins:run`
  triggers a build and streams its console, `jenkins:logs` / `jenkins:down`
  manage it. The job builds the mounted working tree (uncommitted changes
  included), so a green Jenkins build is the same evidence as a green local run.

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

## Dependencies install themselves

Every front-door npm script in both packages has a `pre<name>` hook running
`scripts/ensure-deps.mjs`, which installs a missing or stale dependency tree
and then lets the command proceed. Nobody has to be told to run `npm install`
first, and `sh: tsx: command not found` should not recur.

The guard imports **`node:` builtins only**, and is `.mjs` run by `node` rather
than `.ts` run by `tsx`, because tsx is exactly what goes missing. Any import of
a package here would reintroduce the failure it exists to remove.

It is silent when the tree is healthy (~40ms). The check is whether every
package the project declares is present on disk — the question that actually
decides whether the next command runs — so a `git pull` that adds a dependency,
and an `--omit=dev` install that skipped tsx, both heal on the next command.
It is deliberately not a lockfile hash: `npm install` rewrites the lockfile on
some platforms, so a hash would never settle and would dirty git on every run.
`postinstall` passes `--include=dev` so a nested install cannot inherit
`--omit=dev` or `NODE_ENV=production` and silently skip devDependencies.

The **app** install also passes `--ignore-scripts`, and that flag is load-bearing
as well. better-sqlite3 ships a prebuilt binary per platform and sets
`gypfile: false` so npm leaves it alone, but npm never writes `gypfile` into
`package-lock.json`. Every lockfile-resolved install — every one after the first,
and every `npm ci` — therefore sees only `binding.gyp`, injects a default
`node-gyp rebuild`, and fails with `Could not find any Python installation to
use` on any machine without Python and a C++ toolchain. Nothing in the app tree
needs an install script (esbuild's is a CLI optimisation vite does not use;
fsevents is macOS-only and optional). The framework tree keeps its scripts,
because unrs-resolver places the native resolver eslint imports.

## Maintenance

- Any structural framework change updates this file in the same PR.
- `probe.config.yaml` paths/commands must point at scripts that exist in
  `package.json`.
- The PROBE plugin is vendored at `vendor/probe` (ignored by `tsconfig`/`eslint`/
  `bddgen`); update it with `git -C vendor/probe pull`.
