# Bin Pareto (single wafer) — Product Requirements

| Field            | Value                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Document ID**  | `YWPS-PAR-PRD`                                                                                                                                                                                                     |
| **Version**      | 2.0                                                                                                                                                                                                                |
| **Status**       | Approved for build — describes the implemented lightweight app                                                                                                                                                     |
| **Feature slug** | `bin-pareto`                                                                                                                                                                                                       |
| **Feature code** | `PAR`                                                                                                                                                                                                              |
| **Module**       | yieldWerx Playground — Reporting & Analysis                                                                                                                                                                        |
| **Depends on**   | `wafer-upload` (a wafer must have landed before it can be reported on)                                                                                                                                             |
| **Supersedes**   | v1.0, which described the full production report (selection cascade, multi-wafer grouping, Post-CD result passes, exports, yield summary, staleness). Requirements were renumbered; v1.0 IDs do not carry forward. |

---

## 1. Why this exists

For most people in the company, a report _is_ yieldWerx. It is the surface they see
and the number they trust. A wrong number in a yield report is not a cosmetic defect —
it is a reputation-level one.

This feature answers one question about one wafer: **what is it losing yield to, and
what should be fixed first?** A Pareto is not a bar chart of bins. It is bins
**ranked biggest-first** with a **running cumulative percentage** across them, so an
engineer can see that two bins account for most of the loss and go and fix those two.

The whole report is derived from the die rows on every request. There is no cache, no
saved report and no snapshot, so what is on screen is always what is in the database.

## 2. Who uses it

| User                  | What they need                                                                        |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Yield engineer**    | Find the dominant failure bin on a wafer and confirm it against the raw die counts.   |
| **Test engineer**     | Compare the hard-bin and soft-bin views of the same wafer.                            |
| **QA / data steward** | Check that the reported counts and percentages reconcile with the wafer's part count. |

## 3. Scope

### In scope

- A report over **one wafer**, addressed by its wafer sequence.
- Four report options: **Bin Type**, **Specify Bins**, **Sort By**, and a custom bin list.
- A header carrying the wafer's identity, total dies, pass count and yield.
- A ranked bin table with **die count**, **bin %** and **cumulative %**, and a bar per row.

### Out of scope

Present in the production product, deliberately absent here, and **not a defect if
absent**:

- The **Selection Criteria** cascade (Facility → Work Center → Device → Lot → Wafer).
  The report takes a wafer sequence directly.
- Multi-wafer, multi-lot and multi-device selections, and the **Group By** option that
  reshapes them. One report covers exactly one wafer.
- **Result passes**: reporting on a cluster-detection result rather than the original
  dies. Cluster detection persists nothing (`CLD-15`), so there is no second pass to
  report on and the selector does not exist.
- **Export** to CSV, XLSX or PDF, and the export-integrity and file-naming rules.
- The **Yield Summary** screen: yield per lot over a date range.
- **Staleness**: a report is never marked stale, because it is re-derived on every run.
- The `Cumulative %` on/off toggle and the `X-Axis Label` option — the cumulative
  line and column are always present, and bins are always labelled by number on the
  chart and by number and name in the table.
- A **Reset** control for the report options.
- Parametric reports of any kind (histogram, trend, scatter, box plot), wafer and heat
  maps (wafer maps belong to `wafer-upload` and `cluster-detection`), stacked and
  composite maps, zonal analysis, drill-through, saved favourites, scheduling, report
  policies, email delivery, genealogy and side-by-side comparison.

## 4. Selecting the data

| ID         | Requirement                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAR-01** | A report covers exactly one wafer, named by its **wafer sequence** — a whole number of `1` or greater. There is no cascade and no multi-value selection.                                                      |
| **PAR-02** | A wafer sequence that does not exist is refused with `404` `WAFER_NOT_FOUND` `Wafer was not found.` A non-integer sequence is refused with `400` `FST_ERR_VALIDATION` `params/waferSequence must be integer`. |
| **PAR-03** | Running a report requires only the `viewer` role. A caller with no valid token receives `401` `UNAUTHORIZED` `Authentication is required.`                                                                    |
| **PAR-04** | The report reads the wafer's dies at the moment it runs. A later upload cannot change an existing wafer (`UPL-27`), so the same wafer and the same options always produce the same report.                    |

## 5. Report options

| ID         | Option           | Values                                                                     | Default            |
| ---------- | ---------------- | -------------------------------------------------------------------------- | ------------------ |
| **PAR-05** | **Bin Type**     | `Hard Bin`, `Soft Bin`                                                     | `Hard Bin`         |
| **PAR-06** | **Specify Bins** | `All Bins`, `Failed Bins Only`, `Custom`                                   | `Failed Bins Only` |
| **PAR-07** | **Sort By**      | `Bin Occurrence`, `Bin Number`                                             | `Bin Occurrence`   |
| **PAR-08** | **Custom bins**  | a comma-separated list of non-negative whole numbers, up to 255 characters | empty              |

| ID         | Requirement                                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAR-09** | The custom bin list is only offered — and only read — when Specify Bins is `Custom`.                                                                                                                                                                                                            |
| **PAR-10** | A `Custom` report whose list yields no usable non-negative whole number is refused with `400` `INVALID_REPORT_OPTIONS` `Enter one or more bin numbers, separated by commas.` Non-numeric and negative entries are discarded before that check, so `abc` is refused exactly as an empty list is. |
| **PAR-11** | A value outside an option's enumeration is refused with `400` `FST_ERR_VALIDATION` and a message naming the parameter, for example `querystring/binType must be equal to one of the allowed values`.                                                                                            |
| **PAR-12** | Every response echoes the four options that produced it, so a reader can always see which filter was in force.                                                                                                                                                                                  |
| **PAR-13** | The screen's option controls keep their values after a run. Changing one has no effect until `Run report` is pressed again — a report on screen always reflects the options it was run with, never the controls' current state.                                                                 |

## 6. What the report shows

### 6.1 The header

**PAR-14** — A report carries a header naming the wafer and its totals:

| Field                   | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `waferSequence`         | The wafer reported on.                                        |
| `lot`, `waferNumber`    | Its lot code and wafer number.                                |
| `device`, `testProgram` | Its device and test program codes.                            |
| `totalDies`             | Every die on the wafer.                                       |
| `passCount`             | Dies whose **selected** bin is `0` or `1`.                    |
| `yield`                 | `passCount ÷ totalDies × 100`, rounded to two decimal places. |

**PAR-15** — `totalDies` is the wafer's whole die population and does **not** shrink
with the bin filter. It always equals the wafer's part count (`UPL-24`).

**PAR-16** — `passCount` and `yield` follow the **selected bin type**. A `Soft Bin`
report therefore counts soft bins `0` and `1` as passing, which can disagree with the
wafer's stored pass count and yield — those are derived from the hard bin. The
disagreement is a consequence of the option, not an error; see Q-PAR-01.

### 6.2 Which bins appear

| ID         | Requirement                                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAR-17** | Dies are grouped by the selected bin type: `Hard Bin` groups on `HB#`, `Soft Bin` on `SB#`.                                                                                                                                                                 |
| **PAR-18** | Inclusion follows Specify Bins. `All Bins` — every bin present on the wafer. `Failed Bins Only` — every bin except `0` and `1`. `Custom` — only bins named in the list.                                                                                     |
| **PAR-19** | Only bins that carry at least one die appear. A bin named in a `Custom` list that no die carries is absent, and a list matching nothing produces an empty bin set, not a row of zeros.                                                                      |
| **PAR-20** | Each bin carries a name: the bin name recorded with the first die seen for that bin, or `Bin <n>` when the upload supplied none. An upload records bin names only when the CSV carried `HB name` / `SB name` columns.                                       |
| **PAR-21** | Order follows Sort By. Under `Bin Occurrence` bins are ordered by **descending die count**, and **ties are broken by ascending bin number** so the order is always the same for the same data. Under `Bin Number` bins are ordered by ascending bin number. |

### 6.3 The numbers

| ID         | Calculation                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAR-22** | **Bin %** for a bin is that bin's die count ÷ `totalDies` × 100, rounded to two decimal places.                                                                                                                                                                 |
| **PAR-23** | **Cumulative %** at a bin is the summed die counts of that bin and every bin before it in the current order, ÷ `totalDies` × 100, rounded to two decimal places. It is computed from **integer die counts**, never by adding rounded Bin % values.              |
| **PAR-24** | Both percentages are taken against `totalDies`, not against the filtered subset. Under `All Bins` the final Cumulative % is therefore `100.00`; under any filter it is the filtered bins' share of the whole wafer and is below 100 whenever bins are excluded. |
| **PAR-25** | **The invariant.** Under `All Bins`, the die counts in the table sum exactly to `totalDies`, and `totalDies` equals the wafer's part count. This must hold for every wafer, under either bin type.                                                              |
| **PAR-26** | `passCount` equals the summed counts of bins `0` and `1` under `All Bins`; `totalDies` minus `passCount` equals the summed counts of every other bin, which is exactly what `Failed Bins Only` reports.                                                         |
| **PAR-27** | Rounding is for presentation only. Every derived value is calculated from unrounded counts, and the API returns the rounded percentages it displayed.                                                                                                           |

**Worked example — the sample wafer** (`probe-lab-app/database/sample-wafer.csv`,
25 dies: 20 on hard bin 1, 4 on bin 2, 1 on bin 3):

| Options                                          | Bins reported                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `Hard Bin`, `Failed Bins Only`, `Bin Occurrence` | bin 2 — 4 dies, 16.00 %, cumulative 16.00 %; bin 3 — 1 die, 4.00 %, cumulative 20.00 %           |
| `Hard Bin`, `All Bins`, `Bin Number`             | bin 1 — 20 dies, 80.00 %, cumulative 80.00 %; bin 2 — 16.00 %, 96.00 %; bin 3 — 4.00 %, 100.00 % |

Header for both: `totalDies` 25, `passCount` 20, `yield` 80.

### 6.4 The screen

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAR-28** | The Bin pareto screen carries `Wafer sequence` (number, default `1`), `Bin type`, `Specify bins`, `Sort by`, the `Custom bins (comma-separated)` field when Specify bins is `Custom`, and a `Run report` button. Nothing is requested until the button is pressed, and before the first run the screen states that no report has run yet. Arriving from a wafer detail's `Bin pareto` action pre-fills that wafer's sequence.                                                                                        |
| **PAR-29** | The header is rendered as a metric row: `Wafer` (`<lot> · W<n>`), `Total dies`, `Pass`, `Yield` (two decimal places).                                                                                                                                                                                                                                                                                                                                                                                                |
| **PAR-30** | The bin table carries the columns `Bin`, `Name`, `Dies`, `Bin %`, `Cumulative %`, one row per reported bin in the order of PAR-21. It is the report's table view: every value the chart draws is readable here.                                                                                                                                                                                                                                                                                                      |
| **PAR-31** | Above the table the report draws a **pareto chart** on a canvas: one bar per bin carrying its Bin %, and a line across them carrying the running Cumulative %, in the order of PAR-21. Bars and line share **one 0–100% axis** — both series are percentages of the same total, so the chart never carries a second scale. A legend names `Bin %` and `Cumulative %`; the leading bar and the final cumulative value are labelled directly, and hovering a bar reveals that bin's die count, bin % and cumulative %. |
| **PAR-32** | Every number on screen equals the value the API returned, formatted to two decimal places for the percentages and thousands-separated for the counts.                                                                                                                                                                                                                                                                                                                                                                |
| **PAR-33** | A report with no bins shows `No bins match these options.` with the header metrics still present.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **PAR-34** | A refused report — an unknown wafer, an invalid custom list, an expired session — is shown in an alert carrying the API's message, and the table from a previously reported wafer or option set is not left on screen beside it.                                                                                                                                                                                                                                                                                     |

## 7. Interfaces

### 7.1 API

| Method | Path                                                                                       | Purpose                              | Min role |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------ | -------- |
| `GET`  | `/api/reports/wafers/{waferSequence}/bin-pareto?binType=&specifyBins=&sortBy=&customBins=` | Derive the bin pareto for one wafer. | viewer   |

The response is:

```json
{
  "header": {
    "waferSequence": 5,
    "lot": "LOT-DEMO-01",
    "waferNumber": 5,
    "device": "PROBE-DEV-1",
    "testProgram": "PROBE-PGM-1",
    "totalDies": 25,
    "passCount": 20,
    "yield": 80
  },
  "bins": [
    {
      "binNumber": 2,
      "binName": "Bin 2",
      "dieCount": 4,
      "binPercentage": 16,
      "cumulativePercentage": 16
    }
  ],
  "options": {
    "binType": "Hard Bin",
    "specifyBins": "Failed Bins Only",
    "customBins": [],
    "sortBy": "Bin Occurrence"
  }
}
```

**PAR-35** — There is no `POST` under `/api/reports`, and no export endpoint. The
feature has no writable surface and produces no files.

**PAR-36** — Every error response is `{ statusCode, code, message }`, as in `UPL-44`.

**PAR-37** — The endpoint is described by the OpenAPI 3.1 document at `/openapi.json`,
and that document matches the implementation: the path, every status code, every
required field, and every option enumeration in section 5.

### 7.2 Screens

| Screen                | Route                 | Contains           |
| --------------------- | --------------------- | ------------------ |
| **Bin pareto report** | `/reports/bin-pareto` | The screen in 6.4. |

**PAR-38** — The screen needs a signed-in session; without one the app redirects to
`/login`.

## 8. Non-functional requirements

| ID         | Requirement                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| **PAR-39** | A report over a single wafer returns within 500 ms at the 95th percentile.                           |
| **PAR-40** | The report is derived per request with no caching, so it cannot serve values from a superseded read. |
| **PAR-41** | Deriving a report neither writes nor locks, so it may run while an upload or a detection runs.       |

## 9. The failure mode to design against

Most "this report is wrong" reports are not chart bugs. They are **a filter left set**:
a stuck Bin Type or Specify Bins silently changes every number on the page while the
report still looks correct.

**PAR-42** — Every report carries the options that produced it (`PAR-12`), and the
screen's controls still show the values that were run (`PAR-13`), so a reader can
always see what filter was in force.

## 10. Open questions

| ID           | Question                                                                                                                                                                                                                                               | Affects        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| **Q-PAR-01** | `passCount` and `yield` follow the selected bin type, so a `Soft Bin` report can show a yield that disagrees with the wafer's own yield on the Wafers screen. Should the header always report the hard-bin yield, or is a per-bin-type yield intended? | PAR-14, PAR-16 |
| **Q-PAR-02** | Percentages are taken against all dies on the wafer, so a `Failed Bins Only` report's cumulative line ends at the total failing share (20.00 % for the sample wafer) rather than at 100 %. Should a filtered report normalise to the bins it shows?    | PAR-23, PAR-24 |
| **Q-PAR-03** | Bin names come only from optional CSV columns, so almost every report shows the placeholder `Bin <n>`. Where should bin names come from?                                                                                                               | PAR-20         |
| **Q-PAR-04** | The report covers one wafer, so a lot-level Pareto — the question an engineer usually asks — cannot be produced. Is single-wafer scope sufficient for this app?                                                                                        | PAR-01         |
| **Q-PAR-05** | Nothing can be exported, so a number cannot leave the screen except by re-reading the API. Is that acceptable, or is CSV the minimum?                                                                                                                  | PAR-35         |
| **Q-PAR-06** | Is the passing-bin set (`0` and `1`) fixed, or configurable per device? `passCount`, `yield` and `Failed Bins Only` all depend on it.                                                                                                                  | PAR-14, PAR-18 |

## 11. Developer-owned verification

Internal to the implementation, not reachable through the UI or the API, and
belonging in the development team's own tests:

- The bin aggregation, proven directly against the die table for the invariant in
  PAR-25.
- Rounding and half-way behaviour in the percentage calculations of PAR-22 to PAR-27,
  including a bin count that produces a repeating decimal.
- Cumulative accumulation over the sort order, proven not to be a sum of rounded
  values.
- Behaviour on a wafer whose dies all carry one bin, and on a wafer with no dies
  (`totalDies` zero must not divide by zero).
- The custom-bin parser: whitespace, empty segments, repeated bins, and values that
  are numeric but not integers.

## 12. Glossary

| Term              | Meaning                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Pareto**        | Categories ranked biggest-first with a running cumulative percentage, so the largest contributor is tackled first. |
| **Bin %**         | One bin's share of all dies on the wafer.                                                                          |
| **Cumulative %**  | The running total of Bin % across the report's sort order.                                                         |
| **Total dies**    | Every die on the wafer, regardless of the bin filter.                                                              |
| **Report option** | One of the four settings that reshape the report without changing the wafer.                                       |
| **Selected bin**  | The hard bin or the soft bin, according to Bin Type.                                                               |
