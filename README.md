# yieldWerx PROBE Lab

UI changes follow the app-specific [`STYLEGUIDE.md`](STYLEGUIDE.md).

A lightweight, fully offline repo bundling **a small wafer-analysis app**, **the BDD test framework that tests it**, and **the PROBE plugin**. It exists so Dev and QA teams can practice PROBE skills (specify → codify → automate → attest → promote) against a small, self-contained full-stack app.

## What's here

- **`probe-lab-app/`** — the app under test: **yieldWerx PROBE Lab** (Fastify API + SQLite + React/Vite). Four end-to-end workflows:
  1. **Wafer upload → wafer map** — login → upload a wafer CSV or ATDF file → view the die map + yield.
  2. **Cluster detection** — contiguous fail-die clusters (4-/8-way adjacency, minimum size).
  3. **Bin pareto report** — bin % + cumulative %.
  4. **Wafer triage** — combine fixed pattern matching, spatial loss, clusters, and failed-bin priorities.

  Run it: `cd probe-lab-app && npm start` (seeds the DB → API :5000 + web :3000). See [`probe-lab-app/README.md`](probe-lab-app/README.md).

- **BDD framework** (`src/`, `steps/`, `features/`, `playwright.config.ts`) — Playwright + `playwright-bdd`. A starter suite ([`features/probe-lab/workflow.feature`](features/probe-lab/workflow.feature)) drives the four workflows through the UI. `npm test` regenerates the specs (`bddgen`) and runs them, auto-starting the app via `webServer`.
- **PROBE plugin** (`vendor/probe` + [`.claude/settings.json`](.claude/settings.json) + [`probe.config.yaml`](probe.config.yaml)) — `yw@yieldwerx`, from `tafseer-yw/yieldwerx-probe`. Open Claude Code here and the `/yw:*` skills load; `probe.config.yaml` is the consumer contract (paths + commands).

## Install and run

Five steps from an empty folder to a running app. Everything is local and offline — no
credentials, no network services, no shared database.

### Before you start

| Need               | Why                                                                  |
| ------------------ | -------------------------------------------------------------------- |
| **Node.js 22.18+** | An older Node fails during install rather than at runtime. `node -v` |
| **npm**            | Ships with Node.                                                     |
| **Git**            | To clone this repository.                                            |
| **Git LFS**        | Only if you also clone the Knowledgebase, whose documents use LFS.   |

### 1. Get the repository

```bash
git clone https://github.com/tafseer-yw/yieldWerx-probe-lab.git
cd yieldWerx-probe-lab
```

### 2. Install dependencies

```bash
npm install
```

One command covers both packages. This repository holds two: the test framework at the root,
and the app under `probe-lab-app/` with its own `package.json` and `node_modules`. The root
install finishes by installing the app's as well.

### 3. Install the browser Playwright drives

```bash
npx playwright install chromium
```

Separate from `npm install` on purpose — this downloads a browser binary, not an npm package.
Skip it and the suite fails on its first scenario.

### 4. Start the lab

```bash
npm run app:dev
```

Seeds the SQLite database, then runs the API (`:5000`) and the web app (`:3000`) together.
Leave it running and use a second terminal for everything else.

Open <http://127.0.0.1:3000> and sign in with `dev / dev` or `qa / qa`; use `admin / admin` to
manage sample wafers. The interactive **PROBE guide** is beside **API docs** in the app header.

### 5. Confirm the install is complete

```bash
node scripts/ensure-deps.mjs --check
```

Prints nothing and exits `0` when every declared package is present; names whatever is missing
otherwise. It installs nothing, so it is safe to run any time, including in CI.

Then run the verification suite from a second terminal:

```bash
npm test
```

`npm test` starts the app automatically when it is not already running. It executes the app
unit/API tests and seven browser scenarios covering upload, wafer maps, triage, cluster
detection, bin pareto, the interactive guide, and audited controls and permissions.

### A missing dependency will not stop you

Every front-door script in both packages checks its dependencies first and installs them if they
are absent, so a fresh clone, a skipped `npm install`, or a `git pull` that added a package all
repair themselves on the next command you run:

```text
probe-lab: probe-lab-app: tsx is declared but not installed — installing now, this runs once.
added 208 packages in 3s
probe-lab: probe-lab-app: ready.
```

The check is whether every declared package is present on disk — the question that decides
whether the command can run — so it also catches an install that ran with `--omit=dev` or
`NODE_ENV=production` and quietly skipped development dependencies. It is silent and takes about
40 ms when nothing is wrong.

The one exception is `npm run <script> --ignore-scripts`, which skips this check along with every
other hook.

### If something goes wrong

| Symptom                               | What it means and what to do                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsx: command not found`              | The app's dependencies were never installed — usually an install that ran as `--omit=dev` or with `NODE_ENV=production`, and tsx is a devDependency. Run the command again; it now installs them for you. |
| `EADDRINUSE` on 3000 or 5000          | An earlier run still holds the port. Find it with `netstat -ano \| findstr :5000` on Windows, or `lsof -i :5000` on macOS and Linux, then stop that process.                                              |
| The app starts but has no wafers      | The database seeded empty. Delete `probe-lab-app/data/practice-probe-db.sqlite*` and run `npm run app:dev` again to recreate and reseed it.                                                               |
| Playwright cannot find a browser      | Step 3 was skipped, or ran against a different Node installation. Rerun `npx playwright install chromium`.                                                                                                |
| `/yw:` skills do not appear in Claude | The plugin is not installed. See [PROBE and Knowledgebase plugins](#probe-and-knowledgebase-plugins).                                                                                                     |

## Practice tracks

- **Dev track:** review the OpenAPI contract, challenge parsing and RBAC boundaries, implement a scoped change, then run lint, typecheck, unit/API, smoke, and browser gates.
- **QA track:** specialize the Dev loop around expected outcomes, valid and invalid wafer data, UI/API evidence, and automated scenarios.

Both tracks use the same PROBE loop: **specify → codify → automate → attest → promote**.

## PROBE and Knowledgebase plugins

The plugins deliberately have separate responsibilities:

- [yieldWerx PROBE](https://github.com/tafseer-yw/yieldwerx-probe) owns Dev and QA workflows, evidence, specialist agents, reviews, and gates.
- [yieldWerx Knowledgebase](https://github.com/tafseer-yw/yieldwerx-knowledgebase) supplies source-traceable product and domain context. It cannot replace the approved requirement or fill requirement gaps.

Clone them locally as sibling repositories when you want to inspect or contribute to their source. The Knowledgebase includes Git LFS documents:

```bash
git clone https://github.com/tafseer-yw/yieldwerx-probe.git
git lfs install
git clone https://github.com/tafseer-yw/yieldwerx-knowledgebase.git
```

Cloning does not install them into Claude.

### Claude Desktop and Cowork

In the latest Claude Desktop:

> Claude plugins require a paid plan. Team or Enterprise organizations must allow Cowork and Skills, and administrators may control plugin availability.

1. Open **Cowork → Customize → Plugins**.
2. Under Personal plugins, select **+ → Add marketplace → Add from a repository**.
3. Add both GitHub repositories above.
4. Install **yieldWerx PROBE** and **yieldWerx Knowledgebase**.
5. Start a Cowork task, grant it access to this repository folder, type `/` or use the `+` menu, and choose a `/yw:*` skill.

Plugins and their skills work in Claude chat and Cowork; plugin sub-agents run in Cowork. See Anthropic's [plugin instructions](https://support.claude.com/en/articles/13837440-use-plugins-in-claude) and [Cowork guide](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork).

Claude Code users can install the same marketplaces with:

```text
/plugin marketplace add https://github.com/tafseer-yw/yieldwerx-probe.git
/plugin marketplace add https://github.com/tafseer-yw/yieldwerx-knowledgebase.git
/plugin install yieldwerx-knowledgebase@yieldwerx-company
/plugin install yw@yieldwerx
/reload-plugins
```

### Dev track skills and agents

Typical flow:

```text
/yw:build-feature <feature-slug> --requirement <path>
/yw:seed-testability <feature-slug> --surface all
/yw:review-code <feature-slug> --staged --depth thorough
/yw:ship-change <feature-slug> describe
```

Use `/yw:scaffold-app` for a new application, `/yw:revise-feature` for an intentional behavior change, and `/yw:fix-defect` for a reproducible defect. The skills delegate to `requirement-clarifier`, `testability-scout`, `build-verifier`, and `code-reviewer`. These agent names are internal delegation targets—not slash commands. Dev work is gate-independent and treats QA artifacts as optional enrichment.

### QA track skills and agents

Typical design-to-operations flow:

```text
/yw:ask-yieldwerx <product question>
/yw:probe-spec <feature-slug> <approved-spec>
/yw:probe-implementation <feature-slug> local
/yw:forge-cases <feature-slug> --scenario-type all
/yw:audit-cases <feature-slug>
/yw:gate-design <feature-slug>
/yw:ui-recon <feature-slug> local --with-api-recon --spec http://127.0.0.1:5000/openapi.json
/yw:execute-cases <feature-slug> local
/yw:forge-scripts <feature-slug> --scenario-type all
/yw:audit-scripts <feature-slug>
/yw:green-run <feature-slug>
/yw:gate-merge <feature-slug>
/yw:testops-promote <feature-slug>
/yw:gate-ops <feature-slug>
```

The QA skills delegate to specialists including `source-digester`, `implementation-prober`, `test-case-designer`, `test-case-auditor`, `ui-recon-agent`, `e2e-scripter`, `script-auditor`, and `testops-engineer`. QA owns its cases, evidence, and gates; it observes the application but does not edit application code. Human reviewers remain responsible for gate approval and scoped bypass decisions.

## Repo layout

```
probe-lab-app/         # the app (Fastify API + SQLite + React/Vite) + its own README
src/core/              # framework: config, fixtures (DI), logger, paths, types
steps/                 # BDD step definitions (fixtures.ts + probe-lab.steps.ts)
features/              # Gherkin (probe-lab/workflow.feature)
playwright.config.ts   # webServer -> probe-lab-app, chromium project, bddgen wiring
eslint.config.mjs      # framework policy (no-any, locator policy, import boundaries)
probe.config.yaml      # PROBE consumer contract (paths + commands)
.claude/               # settings.json (yw@yieldwerx marketplace) + rules/
vendor/probe/          # the PROBE plugin (cloned; ignored by tsc/eslint/bddgen)
docs/                  # PRDs (the 3 workflows' requirements) + index
```

## PROBE

Open Claude Code **from this repo** — `.claude/settings.json` registers the `yieldwerx` marketplace and enables `yw@yieldwerx`, so the 42 `/yw:*` skills (probe-spec, forge-prd, forge-cases, gate-design, ask-yieldwerx, …) load. `probe.config.yaml` tells PROBE where `features`/`ledgers`/`test-data` live and which npm scripts to call (`bddgen`, `lint`, `typecheck`, `test`, `app:build`). Clone it to `vendor/probe` for offline reference — that path is gitignored, so it is local state you create, and its own docs then live in `vendor/probe/docs/`.

## Scripts

| Command                                | Purpose                                               |
| -------------------------------------- | ----------------------------------------------------- |
| `npm test`                             | app unit/API tests + bddgen + Playwright (chromium)   |
| `npm run test:app`                     | app unit and API contract tests                       |
| `npm run test:smoke`                   | the `@smoke` slice                                    |
| `npm run typecheck`                    | `tsc --noEmit` (strict)                               |
| `npm run lint`                         | `eslint .`                                            |
| `npm run app:dev`                      | seed + run probe-lab-app (API :5000 + web :3000)      |
| `npm run app:build`                    | production-build probe-lab-app                        |
| `npm run check:connections`            | verify the AIO Tests and Jira credentials (read-only) |
| `node scripts/ensure-deps.mjs --check` | report missing dependencies without installing        |

See [`CLAUDE.md`](CLAUDE.md) for working agreements and [`probe-lab-app/README.md`](probe-lab-app/README.md) for the app.
