# yieldWerx PROBE Lab

UI changes follow the repository [`STYLEGUIDE.md`](../STYLEGUIDE.md).

A trimmed-down wafer-analysis app with its own API, database, and frontend. It
exists so Dev and QA teams can practice **PROBE** skills (specify →
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

1. **Sign in** (local JWT auth, roles: `viewer` / `dev` / `qa` / `admin`)
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
npm install --ignore-scripts     # one-time; better-sqlite3 ships prebuilt, nothing to compile
cp .env.example .env             # optional; use YW_* names to override local defaults
npm start                        # seeds the DB, then runs API (:5000) + web (:3000)
```

Open <http://localhost:3000> and sign in as:

| Username | Password | Role   | Can upload? |
| -------- | -------- | ------ | ----------- |
| `viewer` | `viewer` | viewer | no          |
| `dev`    | `dev`    | dev    | yes         |
| `qa`     | `qa`     | qa     | yes         |
| `admin`  | `admin`  | admin  | yes         |

To try a workflow: sign in as `dev` or `qa`, go to **Upload data**, choose a device and
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
script is idempotent (uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`),
and the four practice accounts keep **fixed** user ids, so a re-seed does not
invalidate a token a browser is still holding.

A database created before ATDF support carries the old wafer and coordinate
limits, and SQLite cannot alter a `CHECK` constraint in place. The store refuses
to open such a file and says so, rather than rejecting valid wafer data later —
delete it and re-seed.

## API surface

| Method | Path                                                                                      | Min role | Purpose                                                                           |
| ------ | ----------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| GET    | `/health`                                                                                 | –        | process health                                                                    |
| GET    | `/ready`                                                                                  | –        | DB readiness                                                                      |
| GET    | `/docs`, `/openapi.json`                                                                  | –        | Swagger UI / OpenAPI 3.1                                                          |
| POST   | `/api/auth/login`                                                                         | –        | username/password → JWT                                                           |
| GET    | `/api/reference/devices`                                                                  | viewer   | list devices                                                                      |
| GET    | `/api/reference/test-programs?device=`                                                    | viewer   | list programs                                                                     |
| POST   | `/api/uploads?device=&program=`                                                           | dev, qa  | upload CSV or ATDF (multipart, or text/csv paste), parsed synchronously           |
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
| Wafer   | integer 1–9999, same wafer across all rows          |
| X, Y    | integers −32768–32767, unique per upload            |
| HB#     | integer ≥ 0 (0 and 1 ⇒ **Pass**, others ⇒ Fail)     |
| SB#     | integer ≥ 0                                         |
| PF_Flag | `P` or `F`, must match the pass/fail implied by HB# |

Validation error codes (same as the real app): `MISSING_VALUE`,
`NOT_AN_INTEGER`, `OUT_OF_RANGE`, `BAD_FLAG`, `DUPLICATE_DIE`,
`FLAG_BIN_MISMATCH`. An upload ends `Succeeded`, `Completed with errors`
(some rows rejected), or `Rejected` (no valid rows).

The wafer and coordinate spans are the STDF spans, so a CSV and an ATDF describing
the same wafer land identically. Real wafer numbers run past 25 and real die
coordinates are measured from the wafer centre, so both are accepted as recorded.

## ATDF format

ATDF is the ASCII rendering of STDF: one record per line as `TYPE:field|field|...`,
where a line beginning with a space continues the record above it. Upload an
`.atdf` file through **Upload data → File**; pasting stays CSV-only, because ATDF
arrives as a tester file rather than typed rows.

Only the records a wafer map, cluster view, and bin pareto consume are read:

| Record | Read for                                                            |
| ------ | ------------------------------------------------------------------- |
| `FAR`  | confirming the file really is ATDF                                  |
| `MIR`  | the lot code (field 1)                                              |
| `WIR`  | the wafer id (field 4), cross-checked against `WRR` when both exist |
| `HBR`  | each hard bin's name and its pass/fail disposition                  |
| `SBR`  | each soft bin's name and its pass/fail disposition                  |
| `PRR`  | one die: pass/fail flag, hard bin, soft bin, X and Y                |
| `PTR`  | **ignored** — nothing here stores a per-test measurement            |

Because `HBR`/`SBR` carry bin names, an ATDF upload produces a bin pareto with
real bin labels where a CSV without the optional name columns shows `Bin <n>`.

Pass/fail comes from the `PRR` flag the tester recorded. The bin's `HBR`
disposition can contradict it but never replaces it: a disagreement is a
`FLAG_BIN_MISMATCH` row error, exactly as a CSV whose `PF_Flag` fights its `HB#`
would be. A file is rejected outright when it has no `FAR`, no `MIR` lot, no
wafer record, no `PRR` parts, or more than one `WIR` — one wafer per file.

`database/sample-wafer.atdf` is a six-die fixture that exercises negative
coordinates and a wafer number above 25.

### Die pitch

An ATDF's `X_COORD`/`Y_COORD` are stepper positions, so neighbouring dies are a
whole **die pitch** apart — 5 in the sample file, where a CSV written in die
indices steps by 1. Coordinates are stored exactly as recorded; anything that
reasons about dies touching derives the pitch instead (`shared/die-lattice.ts`,
the greatest common divisor of the gaps between distinct coordinates, per axis).
Cluster adjacency and the wafer map grid both work in those lattice indices, so
the same physical wafer written at either pitch gives the same clusters and the
same `28 x 18`-style grid — rather than a sparse `136 x 86` one that finds no
clusters at all.

## What was deliberately cut (vs. the real app)

- No async worker / job queue — upload parsing is synchronous.
- No STDF (binary), object storage, production root-cause triage, lot intelligence, or
  experience center. **ATDF wafer results are read**, but only the records a wafer map needs —
  the parametric `PTR` measurements are counted and discarded.
- Cluster detection, bin-pareto reporting, and Wafer triage are deliberately compact practice implementations.
- No observation-election complexity on the wafer detail — dies keep
  `x, y, hardBin, softBin, passFailFlag`. The one piece of coordinate-frame
  metadata that is read is the axis direction: ATDF's `WCR` `POS_X`/`POS_Y`
  lands on the wafer as `positiveX`/`positiveY`, because a file declaring
  positive X to the left is mirrored by a map that ignores it. Map bounds,
  flip flags and die-ID mapping stay out of scope.
- SQLite (file) instead of SQL Server — the store layer is isolated so a future
  swap to `mssql` would touch only `store.ts`.
- Wafer map is a **round wafer drawn on a `<canvas>`** (disc + notch + die
  lattice). Because a canvas has no per-die DOM, the component also renders a
  visually-hidden mirror — `data-testid="wafer-map-data"`, one element per die
  carrying `data-x`/`data-y`/`data-hardbin`/`data-softbin`/`data-passfail`
  (+`data-cluster` when a detection highlights it) and the `data-col`/`data-row`
  it was drawn at. The chart container states the frame those positions used —
  `data-positive-x`, `data-positive-y`, `data-frame`. Assert the **data model**
  there, never pixels. The bin pareto chart is canvas too, with the data table
  beside it as its readable view.

## Layout

```
probe-lab-app/
  shared/contracts.ts        # DTOs shared by api + web
  database/schema.sql        # SQLite DDL + indexes
  database/sample-wafer.csv  # ready-to-upload CSV fixture
  database/sample-wafer.atdf # ready-to-upload ATDF fixture (negative coords, wafer 42)
  scripts/setup.ts           # npm run setup — create db + seed
  api/src/                   # Fastify API (app, server, store, routes, auth)
  api/src/wafer-upload.ts    #   the parse contract both readers return
  api/src/wafer-csv.ts       #   CSV reader
  api/src/wafer-atdf.ts      #   ATDF reader
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

## Assessments

The header's **Assessments** page carries a self-paced skill ladder: 15
assessments per track (Dev and QA), ordered from first skills to a capstone,
each classified by effort — Starter (10 pts), Core (20), Advanced (35),
Expert (60). The dev-track build targets are real gaps in this app (lot
summary report, audit trail, duplicate-die upload guard, wafer compare), so
the work products are genuinely useful. The QA track covers the full ladder
through API test automation, performance test design, and security cases.

Results are **self-recorded per signed-in account**, on the honor system —
the same philosophy as a PROBE gate: the record is the person's word. The
submission method is a **pull request**: do the work on a branch, open the
PR, and record its link with the result so every pass points at reviewable
evidence. Passing adds the assessment's points; a standing fail subtracts
half of them until cleared or passed; the total never goes below zero. Six
fab-themed levels run from Cleanroom Visitor to Fab Master, and the page
shows team standings for everyone who has recorded anything.

Progress belongs to the account that recorded it. The lab seeds four shared
accounts (`viewer`, `dev`, `qa`, `admin`); for personal tracking, give each
team member their own row in `scripts/setup.ts`'s `seedUsers`.
