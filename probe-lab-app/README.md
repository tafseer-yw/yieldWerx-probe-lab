# yieldWerx PROBE Lab

UI changes follow the repository [`STYLEGUIDE.md`](../STYLEGUIDE.md).

A trimmed-down wafer-analysis app with its own API, database, and frontend. It
exists so QA and Engineering teams can practice **PROBE** skills (specify →
codify → automate → attest → promote) against a small, self-contained, fully
offline full-stack app. Four end-to-end workflows are included.

## Workflows

Signing in lands on the **Dashboard** — a summary of the practice lab (wafer
count, die-weighted average yield, upload outcomes, service health) with
quick-launch tiles into each workflow, cluster-detection analytics across the
latest wafers (clusters found, wafers with clusters, largest cluster), and the
most recent wafers and uploads. Clicking the logo in the side nav returns to it
from anywhere.

**1. Wafer upload → wafer map**

1. **Sign in** (local JWT auth, roles: `viewer` / `engineer` / `admin`)
2. **Pick a device + test program**
3. **Upload a wafer CSV** (file or paste) → the server **synchronously** parses,
   validates, and stores the wafer + dies
4. **See the upload** in history with status + row counts + validation errors
5. **Open the wafers list** → open a wafer → see the **die map** (pass/fail) and yield

**2. Cluster detection** — pick a wafer, choose 4-/8-way adjacency and a minimum
connected-die threshold, then **detect contiguous fail-die clusters**. Each cluster
reports its die count and coordinates; click a cluster to highlight it on the die map.

**3. Bin pareto report** — for a wafer, group dies by **Hard/Soft bin**, filter
(All / Failed-Bins-Only / Custom), sort by occurrence or bin number, and view
**bin %** + **cumulative %** as a table with a bar chart.

**4. Wafer triage** — in a dedicated analysis workspace, combine the wafer's yield,
normalized center/middle/edge loss, connected clusters, failed-bin Pareto, and the closest
healthy, scratch, or edge-ring example. The fixed weighted pattern-distance algorithm runs locally
with no training, external request, extra package, or database migration. Triage
reports evidence and returns **No close match** below the fixed threshold instead of forcing
a diagnosis.

## Quickstart

```bash
cd probe-lab-app
npm install                      # one-time
cp .env.example .env             # optional; use YW_* names to override local defaults
npm start                        # seeds the DB, then runs API (:5000) + web (:3000)
```

Open <http://localhost:3000> and sign in as:

| Username   | Password   | Role     | Can upload? |
| ---------- | ---------- | -------- | ----------- |
| `viewer`   | `viewer`   | viewer   | no          |
| `engineer` | `engineer` | engineer | yes         |
| `admin`    | `admin`    | admin    | yes         |

To try a workflow: sign in as `engineer`, go to **Upload data**, choose a device and
program, upload `database/sample-wafer.csv`, then open **Wafers** and click the new
wafer to see the die map. Select **Triage wafer** there, or open **Wafer triage** from
the Analysis navigation and find it by sequence, device, lot, wafer number, or program.
Open **Cluster detection** or **Bin pareto** to exercise those signals independently.

## Sample wafers

The database starts with **reference data and users only** — no wafers. Sign in as
`admin` and use **Sample wafers** in the main header to pick which demo wafers to
load — healthy, scratch, edge ring, and a partly bad file — or to remove any of
them again.
Removal is scoped to what the loader created, so your own uploads — and the
`LOT-E2E-*` wafers the BDD suite creates — are left alone.

## Reset the database

Delete `data/practice-probe-db.sqlite*` and run `npm run setup` again. The setup
script is idempotent (uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`).

## API surface

| Method | Path                                                                                      | Min role | Purpose                                                                           |
| ------ | ----------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| GET    | `/health`                                                                                 | –        | process health                                                                    |
| GET    | `/ready`                                                                                  | –        | DB readiness                                                                      |
| GET    | `/docs`, `/openapi.json`                                                                  | –        | Swagger UI / OpenAPI 3.1                                                          |
| POST   | `/api/auth/login`                                                                         | –        | username/password → JWT                                                           |
| GET    | `/api/reference/devices`                                                                  | viewer   | list devices                                                                      |
| GET    | `/api/reference/test-programs?device=`                                                    | viewer   | list programs                                                                     |
| POST   | `/api/uploads?device=&program=`                                                           | engineer | upload CSV (multipart or text/csv), parsed synchronously                          |
| GET    | `/api/uploads`                                                                            | viewer   | paged history (status/search/page/pageSize)                                       |
| GET    | `/api/uploads/:id`                                                                        | viewer   | upload summary                                                                    |
| GET    | `/api/uploads/:id/errors`                                                                 | viewer   | paged validation errors                                                           |
| DELETE | `/api/uploads/:id`                                                                        | admin    | delete an upload + its wafer, dies and validation rows                            |
| GET    | `/api/wafers?search=&lot=&device=&program=&page=&pageSize=`                               | viewer   | paged wafer list; `search` accepts `#sequence`, device, lot, `W##`, or program    |
| GET    | `/api/wafers/:waferSequence`                                                              | viewer   | wafer detail + dies                                                               |
| GET    | `/api/wafers/:waferSequence/signature-match`                                              | viewer   | explainable signature and spatial analytics used by Wafer triage                  |
| GET    | `/api/cd/wafers/:waferSequence/clusters?adjacency=&minimumConnectedDies=`                 | viewer   | detect contiguous fail-die clusters                                               |
| GET    | `/api/cd/summary?adjacency=&minimumConnectedDies=&waferCount=`                            | viewer   | aggregate of re-running detection over the latest wafers (runs are not persisted) |
| GET    | `/api/reports/wafers/:waferSequence/bin-pareto?binType=&specifyBins=&sortBy=&customBins=` | viewer   | bin pareto (bin % + cumulative %)                                                 |
| GET    | `/api/sample-data`                                                                        | viewer   | sample-wafer catalogue + which are loaded                                         |
| POST   | `/api/sample-data`                                                                        | admin    | load `{keys:[...]}` (or all) through the normal upload path                       |
| DELETE | `/api/sample-data?keys=`                                                                  | admin    | remove the named wafers (or all) — scoped, never touches other uploads            |

Errors use `{ statusCode, code, message }` (e.g. `INVALID_CREDENTIALS`,
`UNAUTHORIZED`, `FORBIDDEN`, `INVALID_REFERENCE`, `WAFER_EXISTS`,
`UPLOAD_NOT_FOUND`, `WAFER_NOT_FOUND`, `BAD_FILE_TYPE`, `FILE_TOO_LARGE`,
`SAMPLE_DATA_EXISTS`).

## CSV format

Header (aliases accepted): `Lot, Wafer, X, Y, HB#, SB#, PF_Flag`. An optional
`Notch: <0|90|180|270>` line may precede the header.

| Field   | Rule                                                |
| ------- | --------------------------------------------------- |
| Lot     | 1–32 chars, same lot across all rows                |
| Wafer   | integer 1–25, same wafer across all rows            |
| X, Y    | integers 0–99, unique per upload                    |
| HB#     | integer ≥ 0 (0 and 1 ⇒ **Pass**, others ⇒ Fail)     |
| SB#     | integer ≥ 0                                         |
| PF_Flag | `P` or `F`, must match the pass/fail implied by HB# |

Validation error codes (same as the real app): `MISSING_VALUE`,
`NOT_AN_INTEGER`, `OUT_OF_RANGE`, `BAD_FLAG`, `DUPLICATE_DIE`,
`FLAG_BIN_MISMATCH`. An upload ends `Succeeded`, `Completed with errors`
(some rows rejected), or `Rejected` (no valid rows).

## What was deliberately cut (vs. the real app)

- No async worker / job queue — upload parsing is synchronous.
- No ATDF/STDF, object storage, production root-cause triage, lot intelligence, or experience center.
- Cluster detection, bin-pareto reporting, and Wafer triage are deliberately compact practice implementations.
- No coordinate-frame / observation-election complexity on the wafer detail —
  dies keep `x, y, hardBin, softBin, passFailFlag`.
- SQLite (file) instead of SQL Server — the store layer is isolated so a future
  swap to `mssql` would touch only `store.ts`.
- Wafer map is a **round wafer drawn on a `<canvas>`** (disc + notch + die
  lattice). Because a canvas has no per-die DOM, the component also renders a
  visually-hidden mirror — `data-testid="wafer-map-data"`, one element per die
  carrying `data-x`/`data-y`/`data-hardbin`/`data-softbin`/`data-passfail`
  (+`data-cluster` when a detection highlights it). Assert the **data model**
  there, never pixels. The bin pareto chart is canvas too, with the data table
  beside it as its readable view.

## Layout

```
probe-lab-app/
  shared/contracts.ts        # DTOs shared by api + web
  database/schema.sql        # SQLite DDL + indexes
  database/sample-wafer.csv  # ready-to-upload fixture
  scripts/setup.ts           # npm run setup — create db + seed
  api/src/                   # Fastify API (app, server, store, routes, csv parser, auth)
  web/                       # Vite + React SPA
```

## Scripts

| Script              | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `npm start`         | **seed DB + run API (:5000) & web (:3000) — one command for the lab** |
| `npm run setup`     | create + migrate + seed the SQLite db                                 |
| `npm run dev`       | API (:5000) + web (:3000) concurrently (no seeding)                   |
| `npm run dev:api`   | API only (tsx watch)                                                  |
| `npm run dev:web`   | web only (vite)                                                       |
| `npm run build`     | typecheck + vite build                                                |
| `npm run typecheck` | `tsc --noEmit`                                                        |
| `npm test`          | unit and API contract tests                                           |

> `scripts/smoke-test.ps1` is an end-to-end API smoke test (login → upload CSV →
> view wafer → RBAC). Start the API (`npm run dev:api` or `npm run start`), then
> run `pwsh scripts/smoke-test.ps1` (it expects the API on `localhost:5000`).

## Notes for PROBE practice

- The API contract shapes and error codes mirror the real production app,
  so scenarios transfer.
- RBAC gives token-propagation / permission cases: `viewer` cannot POST uploads.
- The CSV parser is the richest validation surface — boundary and negative cases
  per error code.
- Pagination + filters on both uploads and wafers — parametrized table scenarios.
- The wafer map's hidden mirror exposes per-die data attributes for
  data-model-level assertions (per the repo's chart-testing rule) — the canvas
  itself is never asserted against.
- Wafer triage is deterministic and intentionally refuses to diagnose a root cause:
  exact references, too-few-failure behavior, and below-threshold results are stable QA surfaces.
- Light/dark theming, an empty state per screen, and a validation-report dialog
  give visual-state and accessibility cases.
