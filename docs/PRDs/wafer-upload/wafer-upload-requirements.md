# Wafer Data Upload — Product Requirements

| Field            | Value                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document ID**  | `YWPS-UPL-PRD`                                                                                                                                                                                                                                                                                                    |
| **Version**      | 2.0                                                                                                                                                                                                                                                                                                               |
| **Status**       | Approved for build — describes the implemented lightweight app                                                                                                                                                                                                                                                    |
| **Feature slug** | `wafer-upload`                                                                                                                                                                                                                                                                                                    |
| **Feature code** | `UPL`                                                                                                                                                                                                                                                                                                             |
| **Module**       | yieldWerx Playground — Data Management                                                                                                                                                                                                                                                                            |
| **Depends on**   | nothing (this is the front door)                                                                                                                                                                                                                                                                                  |
| **Consumed by**  | `cluster-detection`, `bin-pareto`                                                                                                                                                                                                                                                                                 |
| **Supersedes**   | v1.0 `YWPS-ING-PRD` (feature slug `wafer-ingest`, code `ING`), which described the full production upload pipeline (async worker, queued/parsing lifecycle, upload deletion). The feature is now named **upload** throughout; requirements were renumbered `ING-nn` → `UPL-nn` and v1.0 IDs do not carry forward. |

---

## 1. Why this exists

Nothing else in the app works until wafer test results are in the database. This
feature gives an engineer a self-service upload with an honest answer: what landed,
what did not, and exactly why. That last part is the whole point. A silent partial
load is worse than a rejection, because every downstream number is then quietly
wrong.

**The rule that governs this feature:** every row in an uploaded file ends in a
recorded state — accepted, or rejected with a reason. Nothing is ever dropped
silently.

## 2. Who uses it

| User                  | What they need                                                        |
| --------------------- | --------------------------------------------------------------------- |
| **Yield engineer**    | Upload a wafer file and know immediately whether it worked.           |
| **Test operator**     | Understand why a file was refused, row by row, and fix it.            |
| **QA / data steward** | Look back over what was loaded, when, by whom, and what was rejected. |

## 3. Scope

### In scope

- Upload a wafer result file in **CSV** format, by file picker, drag-and-drop, or by
  pasting the rows.
- Parse and validate **synchronously**, inside the request.
- Land the accepted rows as a Lot, a Wafer, and its Dies.
- A **validation report** listing every rejected row with a reason.
- An **Upload history** screen showing every upload and its outcome.
- A **Wafers** list and a **wafer detail** screen with the die map and bin distribution.

### Out of scope

Present in the production product, deliberately absent here, and **not a defect if
absent**:

- Asynchronous upload processing — no job queue, no worker, no `Queued`/`Parsing` dwell time.
- STDF and ATDF binary formats; folder listener, watched directories, scheduled uploads.
- Loader type selection, data scaling, limits files, die-ID mapping.
- A delete action in the user interface. Deletion exists as an API call only
  (`UPL-59`), for an administrator or an automated suite clearing up after itself.
- Parametric measurement values — this app carries **bin data only**.
- Wafer coordinate-frame metadata (positive-X, flip, map bounds) and WCR settings.
- Persisting or displaying wafer notch orientation (the notch line is parsed and
  validated, then discarded — see UPL-16 and Q-UPL-04).
- Editing an upload or a die after it has landed.

## 4. Reference data

The database ships with a fixed reference hierarchy, created by `npm run setup`.
Uploads attach to it; they never create it.

| Level        | Values                                                                           |
| ------------ | -------------------------------------------------------------------------------- |
| Facility     | `PROBE-FAB-1` — Probe Practice Facility                                          |
| Work Center  | `PROBE-WC-SORT` — Probe Wafer Sort (stage `wafer-sort`)                          |
| Device       | `PROBE-DEV-1` — Probe Practice Device 1; `PROBE-DEV-2` — Probe Practice Device 2 |
| Test Program | `PROBE-PGM-1` (device 1 only); `PROBE-PGM-2` (device 2 only)                     |

Each device carries exactly one test program: `PROBE-PGM-1` is not offered under
`PROBE-DEV-2`, and the reverse also holds. A mismatched pair is refused by UPL-05.

Users: `viewer` / `viewer`, `dev` / `dev`, `qa` / `qa`, `admin` / `admin`. Lots, Wafers
and Dies are **created by upload**, never pre-seeded — including the optional
**sample wafers** of section 6.8, which an admin loads and removes on demand and
which are uploaded through the ordinary path rather than seeded.

## 5. The file format

```csv
Lot,Wafer,X,Y,HB#,SB#,PF_Flag
LOT-DEMO-01,5,0,0,1,1,P
LOT-DEMO-01,5,2,1,2,2,F
```

| Column    | Type    | Rule                          |
| --------- | ------- | ----------------------------- |
| `Lot`     | text    | 1–32 characters               |
| `Wafer`   | integer | 1–9999                        |
| `X`       | integer | −32768–32767                  |
| `Y`       | integer | −32768–32767                  |
| `HB#`     | integer | 0 or greater                  |
| `SB#`     | integer | 0 or greater                  |
| `PF_Flag` | text    | `P` or `F`, case-insensitive  |
| `HB name` | text    | optional, up to 32 characters |
| `SB name` | text    | optional, up to 32 characters |

Header columns are matched by normalized name (case, underscores, hyphens and
repeated spaces are ignored), so these aliases are accepted: `Lot ID`, `LotID`;
`Wafer ID`, `WaferID`; `HB`, `HB #`, `HB number`, `Hard Bin`, `Hard Bin Number`,
`HardBin`; the same shapes for `SB` / `Soft Bin`; `PF`, `P/F`, `Pass Fail`,
`Pass/Fail Flag`; `HB name`, `Hard Bin Name`; `SB name`, `Soft Bin Name`.
Unrecognized header columns are ignored.

Bins `0` and `1` are passing bins. Every other hard bin is a failing bin.

## 6. Functional requirements

### 6.1 Submitting an upload

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-01** | The Upload screen offers two routes behind a `File` / `Paste CSV` tab pair: a drop zone that both accepts a dragged `.csv` or `.atdf` file and opens the file picker when clicked, or a text area for pasted rows. All three gestures produce the same stored result. The drop zone marks its drag-over state while a file is held over it, and names the chosen file and its size once one is selected.                     |
| **UPL-02** | **Device** and **Test program** are required. The program selector stays disabled until a device is chosen and clears when the device changes. Submitting without both shows `Choose a device and test program.`; the File tab with no file shows `Choose a CSV or ATDF file.`; the Paste tab with an empty box shows `Paste CSV rows.`                                                                                      |
| **UPL-03** | A submission returns `202` with `{ "uploadId": "<uuid>", "status": "Queued" }`. Parsing has **already finished** when that response arrives, so reading the upload immediately afterwards returns a terminal status.                                                                                                                                                                                                         |
| **UPL-04** | Submitting needs the `dev` or `qa` role — they are peers at the same rank. A `viewer` receives `403` `FORBIDDEN` `Your role does not permit this operation.`; a caller with no or an invalid token receives `401` `UNAUTHORIZED` `Authentication is required.`                                                                                                                                                               |
| **UPL-05** | The named Device and Test program must be a pair that exists, or the submission is refused with `400` `INVALID_REFERENCE` `The selected Device and Test Program combination does not exist.`                                                                                                                                                                                                                                 |
| **UPL-06** | On a multipart submission the file extension must be `.csv` or `.atdf`, or it is refused with `400` `BAD_FILE_TYPE` `Only .csv and .atdf files are accepted.` The extension chooses the reader. A multipart body carrying no file is refused with `400` `FILE_REQUIRED` `Choose a CSV or ATDF file to upload.`                                                                                                               |
| **UPL-07** | A multipart file larger than **100 MB** is refused with `413` `FILE_TOO_LARGE` `File is larger than the 100 MB file limit.`                                                                                                                                                                                                                                                                                                  |
| **UPL-69** | A multipart body that cannot be read — truncated mid-upload, or otherwise malformed — is refused with `400` `MALFORMED_UPLOAD` `The upload could not be read. It may have been interrupted — send the file again.` A parser failure is never reported as a `500`. A **well-formed** body carrying a zero-byte file is readable and therefore accepted, then rejected by the parser as `File is empty.` with a stored report. |
| **UPL-70** | A correctly signed, unexpired token whose subject is not a known user is refused with `401` `UNAUTHORIZED` `Your session refers to a user that no longer exists. Sign in again.` — never a foreign-key `500`. The seeded practice accounts therefore carry **fixed** ids, so re-creating the database does not orphan a token that is still live.                                                                            |
| **UPL-08** | A non-multipart submission must carry `Content-Type: text/csv`, or it is refused with `415` `UNSUPPORTED_MEDIA_TYPE` `Use multipart/form-data or text/csv.` A pasted body larger than **5 MB** is refused with `413` `FILE_TOO_LARGE` `File is larger than the 5 MB limit.` A pasted upload records the file name `pasted-wafer.csv`.                                                                                        |
| **UPL-09** | A file with more than **50,000 data rows** lands as an upload in status `Rejected` with the message `File contains more than the 50,000 row limit.`                                                                                                                                                                                                                                                                          |

### 6.2 Status

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-10** | A stored upload always carries one of three statuses. `Succeeded` — every data row was accepted. `Completed with errors` — at least one row was accepted and at least one rejected; the wafer is built from the accepted rows only. `Rejected` — nothing was created.                                                                                                                                                                                                                                      |
| **UPL-11** | `Queued` and `Parsing` remain in the API enum and in the history status filter, but because parsing is synchronous **no stored upload ever carries them**. Filtering history by either returns an empty list.                                                                                                                                                                                                                                                                                              |
| **UPL-12** | After submitting, the form is replaced by a result panel (`aria-live="polite"`) carrying the file name, the status badge, an accepted-versus-rejected meter, `Rows read`, `Rows accepted`, `Rows rejected`, `Submitted by`, and the terminal message when there is one. It re-reads the upload every second until the status is terminal, and does **not** navigate away by itself. Its actions are `View upload history`, `Upload another file`, and — when the upload landed a wafer — `Open the wafer`. |

### 6.3 Whole-file rejection

| ID         | Requirement                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-13** | A `Rejected` upload creates no Lot, Wafer or Die rows. Its `lot` and `wafer` read `null`, `rowsAccepted` is `0`, and `terminalMessage` carries the reason. |
| **UPL-14** | The rejection messages are fixed and part of the contract.                                                                                                 |

| Cause                                                    | Message                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| The CSV cannot be tokenised                              | `CSV could not be parsed.`                                        |
| No records, or no data rows after the header             | `File is empty or contains no data rows.`                         |
| A header was recognised but a required column is missing | `File is missing required column <Column>.`                       |
| A notch line names an angle other than 0/90/180/270      | `Notch angle must be 0, 90, 180, or 270 degrees.`                 |
| A pre-header line is not a notch declaration             | `Unsupported metadata on CSV line <n>.`                           |
| More than one notch line                                 | `File contains more than one notch declaration.`                  |
| Notch metadata with no recognisable header               | `A CSV with notch metadata must include a recognized header row.` |
| More than 50,000 data rows                               | `File contains more than the 50,000 row limit.`                   |
| Every data row failed validation                         | `Every data row failed validation.`                               |

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-15** | The first record that maps at least **two** canonical columns is the header. If it maps two to six of the seven, the file is rejected naming the first missing column in the order `Lot, Wafer, X, Y, HB#, SB#, PF_Flag`. A file whose first record maps fewer than two is treated as **headerless** and read positionally in that same fixed order. |
| **UPL-16** | Lines before the header may only be `Notch: 0`, `Notch: 90`, `Notch: 180` or `Notch: 270`. The angle is validated as above and then **discarded** — it is not stored on the wafer and appears nowhere in the UI or the API.                                                                                                                          |
| **UPL-17** | `Every data row failed validation.` is a `Rejected` upload that still carries a full validation report: `rowsRejected` equals the number of rows and every row's error is retrievable.                                                                                                                                                               |

### 6.3a ATDF parsing

ATDF is the ASCII rendering of STDF: one record per line as `TYPE:field|field|...`,
where a line beginning with a space continues the record above it. An ATDF carries
its own lot, wafer and bin metadata, so none of the CSV header rules (UPL-15,
UPL-16) apply to it.

| ID         | Requirement                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-61** | Continuation lines are folded into the record above before any field is read, so a wrapped `MIR` still yields its lot.                                                                                                     |
| **UPL-62** | The lot is `MIR` field 1 and must be 1–32 characters. The wafer number is `WIR` field 4, cross-checked against `WRR` field 4 when both are present; a disagreement rejects the file naming both values.                    |
| **UPL-63** | Each `PRR` becomes one die: pass/fail from its part flag, hard bin, soft bin, `X_COORD` and `Y_COORD`. Coordinates are stored **as recorded**, including negatives, and are never shifted into a positive frame.           |
| **UPL-64** | `HBR` and `SBR` supply each bin's name and pass/fail disposition. Names populate `hard_bin_name` / `soft_bin_name`, truncated at 32 characters.                                                                            |
| **UPL-65** | Pass/fail comes from the `PRR` part flag. Where an `HBR` disposition contradicts it, the row is rejected with `FLAG_BIN_MISMATCH`; the parser never silently prefers one source over the other.                            |
| **UPL-66** | `PTR` parametric records are counted toward nothing and discarded — no per-test measurement is stored.                                                                                                                     |
| **UPL-67** | A file is rejected outright when it is empty, carries no `FAR`, has no `MIR` lot, has neither `WIR` nor `WRR`, carries no `PRR` parts, exceeds the 50,000-die limit, or contains more than one `WIR` — one wafer per file. |
| **UPL-68** | Row-level checks reuse the CSV error codes so the validation report is format-agnostic, reporting the physical line where the record started.                                                                              |

### 6.4 Row validation

| ID         | Requirement                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-18** | A row is checked until the first failure and then abandoned, so a rejected row carries **exactly one** error. The checks run in this order: required values → `Lot` length → bin-name length → integer form → numeric range → flag value → flag/bin agreement → lot-and-wafer uniformity → duplicate coordinate. |
| **UPL-19** | Every rejected row is recorded with its **physical line number in the file** (metadata and header lines are counted), the column at fault, a stable error code, a human-readable message, and the raw text of the line with its line ending stripped.                                                            |
| **UPL-20** | The error codes and messages are fixed and part of the contract.                                                                                                                                                                                                                                                 |

| Code                | Condition                                                                       | Column                           | Message                                                       |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `MISSING_VALUE`     | A required column is empty or absent                                            | the first empty canonical column | `<Column> is required.`                                       |
| `OUT_OF_RANGE`      | `Lot` longer than 32 characters                                                 | `Lot`                            | `Lot must contain between 1 and 32 characters.`               |
| `OUT_OF_RANGE`      | `HB name` / `SB name` longer than 32 characters                                 | `HB name` / `SB name`            | `<HB name\|SB name> must contain no more than 32 characters.` |
| `NOT_AN_INTEGER`    | `Wafer`, `X`, `Y`, `HB#` or `SB#` is not a whole number (checked in that order) | the offending column             | `<Column> must be a whole number.`                            |
| `OUT_OF_RANGE`      | `Wafer` outside 1–9999, `X` or `Y` outside −32768–32767 (checked in that order) | the offending column             | `<Column> must be between <min> and <max>.`                   |
| `OUT_OF_RANGE`      | `HB#` or `SB#` below 0                                                          | the offending column             | `<Column> must be 0 or greater.`                              |
| `BAD_FLAG`          | `PF_Flag` is neither `P` nor `F`                                                | `PF_Flag`                        | `PF_Flag must be P or F.`                                     |
| `FLAG_BIN_MISMATCH` | The flag disagrees with the hard-bin classification                             | `PF_Flag`                        | `PF_Flag must be <P\|F> when HB# is <n>.`                     |
| `OUT_OF_RANGE`      | The row names a different lot or wafer than the first accepted row              | `Lot` or `Wafer`                 | `All rows in an upload must identify the same lot and wafer.` |
| `DUPLICATE_DIE`     | Another row in the same upload already claimed this coordinate                  | `X,Y`                            | `Die coordinate (<x>, <y>) appears more than once.`           |

| ID         | Requirement                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-21** | **One upload carries one wafer.** The first row that passes every other check fixes the upload's lot and wafer number; later rows naming a different lot or wafer are rejected, not split into a second wafer.                                                                                                    |
| **UPL-22** | Duplicate detection is per upload and per coordinate: the first row claiming an `X`,`Y` pair is kept and every later row carrying that pair is rejected. Only `HB#` decides pass or fail — `SB#` is never compared against the passing-bin set, so a die may carry a failing soft bin and still be a passing die. |

### 6.5 What lands

| ID         | Requirement                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-23** | A `Succeeded` or `Completed with errors` upload creates one **Lot** for the device (reused if the lot code already exists on that device), one **Wafer**, and one **Die** row per accepted data row.                                                                                                              |
| **UPL-24** | The Wafer records its **part count** (accepted rows), **pass count** (accepted rows carrying `P`, which is equivalent to hard bin 0 or 1 after UPL-20), and **yield** = pass count ÷ part count × 100. The API returns the yield **unrounded**; every screen renders it to two decimal places.                    |
| **UPL-25** | The Wafer records a **finish time**, the moment parsing completed. Because parsing is synchronous it equals the upload's `submittedAt`.                                                                                                                                                                           |
| **UPL-26** | **The Golden Rule.** For any landed wafer, the die counts summed across all bins equal the wafer's part count. This holds after every upload without exception.                                                                                                                                                   |
| **UPL-27** | Re-uploading a lot and wafer that already exist for the device is refused with `409` `WAFER_EXISTS` `This lot and wafer have already been uploaded.` The whole submission is rolled back: **no upload record is created**, so the refused attempt does not appear in Upload history and has no validation report. |

### 6.6 Upload history and the validation report

| ID         | Requirement                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UPL-28** | Upload history lists every upload newest first, under the column headers `File`, `Device / Program`, `Lot / Wafer`, `Status`, `Rows` (accepted and rejected) and `Submitted` (user and timestamp). `Rows read` appears on the live status panel and in the validation report, not in this table. |
| **UPL-29** | The list filters by exact status and searches file name **or** lot as a substring. It pages 25 rows at a time; the pager appears only when the total exceeds one page. `pageSize` is capped at 100.                                                                                              |
| **UPL-30** | Selecting a history row — by click, `Enter` or `Space` — opens the **validation report** as a modal dialog: the upload's counts, its terminal message, and the rejected rows in columns `Row`, `Column`, `Code`, `Message`, `Raw`, ordered by row number.                                        |
| **UPL-31** | The report shows the first 50 rejected rows. It has no pager of its own; the underlying endpoint pages 50 at a time and refuses a larger page size.                                                                                                                                              |
| **UPL-32** | An upload with no rejected rows shows `No validation errors.` — not a blank panel.                                                                                                                                                                                                               |
| **UPL-33** | An unknown upload id returns `404` `UPLOAD_NOT_FOUND` `Upload was not found.`                                                                                                                                                                                                                    |

### 6.7 Wafers and the wafer map

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-34** | The Wafers screen lists landed wafers by most recent finish time, under the column headers `Sequence`, `Lot / Wafer`, `Device / Program`, `Parts / Pass`, `Yield` (two decimal places) and `Finished`. Lot, device and program filter as substrings; the list pages 25 at a time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **UPL-35** | Selecting a wafer row — by click, `Enter` or `Space` — opens the wafer detail, which shows `Part count`, `Pass count`, `Yield`, `Finished`, the **wafer map**, and a **hard bin distribution** table of `Hard bin`, `Dies` and `Share` (die count ÷ dies on the wafer × 100, two decimal places).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **UPL-36** | The wafer map is drawn on a **canvas** as a round wafer: a disc centred on the die-grid bounds, sized to enclose every landed die, with a notch cut at the bottom. Every die site inside the disc is drawn — faintly where no die was measured — so the die pitch reads out to the wafer edge. The canvas is `role="img"` and its label states the die, pass, fail and cluster counts.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **UPL-37** | Beside the canvas the map renders a **visually-hidden mirror** carrying one element per die — `data-testid="wafer-map-data"`, `aria-hidden` — where each element exposes `data-x`, `data-y`, `data-hardbin`, `data-softbin`, `data-passfail` and a class of `die-p` or `die-f`. This is the machine-readable die contract: a canvas has no per-die DOM, so tests assert the data model here rather than against pixels.                                                                                                                                                                                                                                                                                                                                                                                             |
| **UPL-38** | Hovering a die shows a tooltip carrying its coordinate, `Pass` or `Fail`, and its hard and soft bin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **UPL-39** | A `Colour dies by` control offers `Pass / fail` (the default), `Hard Bin` and `Soft Bin`. `Pass / fail` paints passing dies blue and failing dies red. A bin mode ramps pass bins through one blue scale and fail bins through one red scale ordered by die count, so the dominant failing bin is the darkest, and the legend names every bin with its die count. A soft bin carries no pass/fail flag of its own, so bins `0` and `1` count as passing there — the same rule `PAR-18` applies. **Provenance:** the bin names are product terminology and a bin-coloured wafer map is product behaviour, but this three-way toggle is a playground affordance. yieldWerx itself exposes the choice as the _Bin Type_ report option (soft vs hard) and as separate _Soft-Bin_ and _Hard-Bin Wafer Map_ report types. |
| **UPL-40** | Pass and fail are a blue↔red pair, never green/red: green versus red is indistinguishable to a deuteranope (ΔE 4.1 against a ΔE 8 floor), and every wafer-map colour must clear that floor and 3:1 contrast against the map surface in both light and dark themes. A real yieldWerx wafer map paints passing dies **green** with failing bins coloured over them; this build trades that convention for colourblind safety, so a comparison against a production screenshot should expect the difference.                                                                                                                                                                                                                                                                                                           |
| **UPL-41** | The wafer map renders `This wafer has no die-level results.` when it is given no dies. An upload cannot produce such a wafer — an upload with no accepted row is `Rejected` (`UPL-10`) — so this is a component contract rather than a reachable state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **UPL-42** | An unknown wafer sequence returns `404` `WAFER_NOT_FOUND` `Wafer was not found.` A non-integer sequence returns `400` `FST_ERR_VALIDATION` `params/waferSequence must be integer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 6.7b Deleting an upload

| ID         | Requirement                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-59** | An `admin` can delete one upload by id. Deleting removes the upload record, its validation report, the wafer it landed, that wafer's dies, and the lot when no other wafer is left in it. It returns `204` with no body. Any lower role receives `403`; an unknown id receives `404` `UPLOAD_NOT_FOUND` `Upload was not found.` |
| **UPL-60** | Deletion is scoped to the named upload and is atomic — nothing else is touched, and a failure leaves the database as it was. There is no bulk delete and no cascade beyond the rows above.                                                                                                                                      |

### 6.8 Sample wafers

An optional demo set, so a fresh database can demonstrate every screen. It is
**not** reference data: the hierarchy in section 4 and the demo users are seeded
by `npm run setup` and are always present, while these wafers are loaded and
removed on demand.

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-53** | An `admin` can load and remove the sample wafers **individually or together** — the choice is per wafer, not all-or-nothing. Loading is refused for any lower role with `403`; so is removing. Reading the catalogue needs only `viewer`.                                                                                                                                                                                                 |
| **UPL-54** | Loading builds each wafer by pushing generated CSV text through the **ordinary upload path** — the same parser, the same validation, the same landing — so a sample wafer is indistinguishable from an uploaded one and obeys every rule in this document, including the Golden Rule of `UPL-26`.                                                                                                                                         |
| **UPL-55** | The set covers the app's screens: a healthy wafer (`DEMO-BASELINE`), a handling scratch with a dense knot (`DEMO-SCRATCH`), an edge ring across five bins (`DEMO-EDGE-RING`), and a partly bad file (`DEMO-BAD-ROWS`) that lands `Completed with errors` so the validation report is not empty. Every value is deterministic: loading twice produces identical wafers.                                                                    |
| **UPL-56** | **Removal is scoped to what the loader created.** Only uploads flagged as samples, and the wafers, dies, validation rows and now-empty `DEMO-` lots they produced, are deleted. An upload made by a user is never removed, and neither is reference data or any user.                                                                                                                                                                     |
| **UPL-57** | Loading a wafer that is already loaded is refused with `409` `SAMPLE_DATA_EXISTS`, naming the lot. An unknown wafer key is refused with `400` `UNKNOWN_SAMPLE_WAFER` rather than being silently ignored.                                                                                                                                                                                                                                  |
| **UPL-58** | The control lives in the header's avatar menu, for admins only. It opens a dialog listing every sample wafer with a checkbox, its lot, wafer number, die count and rejected-row count, and a `Loaded` badge with its wafer sequence once loaded. Wafers not yet loaded are pre-selected, so loading the whole set stays one action. The footer states how many are selected, how many of those would load, and how many would be removed. |

## 7. The distinction that must not be lost

A **rejected row** and a **failing die** are different things, and the application
must never present one as the other.

- A **failing die** was measured successfully and did not pass. It is a legitimate
  result. It lands, it counts toward part count, and it appears on the wafer map and
  in every report.
- A **rejected row** could not be read or trusted. It is a data-quality problem. It
  does not land, it does not count, and it appears only in the validation report.

**UPL-43** — The Upload screen and the validation report must never describe a
rejected row as a failure, and must never include failing dies in the rejected-row
count.

## 8. Interfaces

### 8.1 API

| Method   | Path                                                        | Purpose                                                                                                                 | Min role |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| `POST`   | `/api/auth/login`                                           | Username and password for a bearer token. Bad credentials → `401` `INVALID_CREDENTIALS` `Invalid username or password.` | —        |
| `GET`    | `/api/reference/devices`                                    | The devices of section 4.                                                                                               | viewer   |
| `GET`    | `/api/reference/test-programs?device=`                      | The programs of one device.                                                                                             | viewer   |
| `POST`   | `/api/uploads?device=&program=`                             | Submit multipart or `text/csv`. Returns `202`.                                                                          | dev, qa  |
| `GET`    | `/api/uploads?status=&search=&page=&pageSize=`              | Paged history.                                                                                                          | viewer   |
| `GET`    | `/api/uploads/{id}`                                         | One upload with its status and counts.                                                                                  | viewer   |
| `GET`    | `/api/uploads/{id}/errors?page=&pageSize=`                  | Paged validation report.                                                                                                | viewer   |
| `DELETE` | `/api/uploads/{id}`                                         | Delete the upload and everything it created. `204`.                                                                     | admin    |
| `GET`    | `/api/wafers?search=&lot=&device=&program=&page=&pageSize=` | Paged wafer list. `search` accepts `#sequence`, device, lot, `W##`, or program.                                         | viewer   |
| `GET`    | `/api/wafers/{waferSequence}`                               | One wafer with its die list.                                                                                            | viewer   |
| `GET`    | `/api/sample-data`                                          | The sample-wafer catalogue and which of them are loaded.                                                                | viewer   |
| `POST`   | `/api/sample-data`                                          | Load the wafers named in `{ "keys": [...] }`, or all when omitted. `201`.                                               | admin    |
| `DELETE` | `/api/sample-data?keys=`                                    | Remove the named wafers, or all when omitted.                                                                           | admin    |
| `GET`    | `/health`, `/ready`                                         | Process health, database readiness (`503` when degraded).                                                               | —        |
| `GET`    | `/openapi.json`, `/docs`                                    | The OpenAPI document and Swagger UI.                                                                                    | —        |

**UPL-44** — Every error response is `{ "statusCode": <int>, "code": "<CODE>", "message": "<text>" }`.
A request violating a route schema returns `400` with code `FST_ERR_VALIDATION` and a
message naming the offending parameter.

**UPL-45** — A caller with no valid token receives `401`; a caller whose role is below
the one listed receives `403`. Neither response reveals whether the resource exists.

**UPL-46** — The API is described by an OpenAPI 3.1 document served at
`/openapi.json`, and that document matches the implementation: every path, every
status code, every required field, and every enum.

### 8.2 Screens

| Screen             | Route                    | Contains                                                                                                                                                                                                                   |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sign in**        | `/login`                 | Username, password, error alert, demo-user hint.                                                                                                                                                                           |
| **Upload data**    | `/upload`                | Device and Test program selectors; `File` / `Paste CSV` tabs; the file input (`data-testid="csv-file"`, `accept=".csv,.atdf,text/csv,text/plain"`) or the paste text area; `Upload`; then the live status panel of UPL-12. |
| **Upload history** | `/uploads`               | The list of UPL-28 with its status filter, search box and pager; opens the validation report dialog.                                                                                                                       |
| **Wafers**         | `/wafers`                | The list of UPL-34 with its three filters and pager.                                                                                                                                                                       |
| **Wafer detail**   | `/wafers/:waferSequence` | The metrics, wafer map and bin distribution of UPL-35.                                                                                                                                                                     |

**UPL-47** — Every screen except Sign in requires a session. Without one the app
redirects to `/login`, and a `401` from any request signs the user out.

## 9. Non-functional requirements

| ID         | Requirement                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPL-48** | A 10,000-row upload completes within 10 seconds. Because parsing is synchronous, that time is the caller's wait.                                      |
| **UPL-49** | The 50,000-row ceiling is enforced before any row is validated, so an oversized file is refused without doing the work.                               |
| **UPL-50** | Every upload records the user who submitted it. No endpoint edits an upload, wafer, or die; only the scoped admin deletion in UPL-59/60 removes them. |
| **UPL-51** | The validation report is retained for as long as the upload row exists.                                                                               |
| **UPL-52** | An upload either lands completely or not at all: the upload row, the wafer, its dies and its validation report are written in one transaction.        |

## 10. Open questions

| ID           | Question                                                                                                                                                                                                                                                                               | Affects        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Q-UPL-01** | `202` with `status: "Queued"` describes an asynchronous pipeline the app no longer has, and `Queued`/`Parsing` are offered as history filters that can never match. Should the contract report the terminal status directly, or is the queued shape worth keeping for a future worker? | UPL-03, UPL-11 |
| **Q-UPL-02** | The size limits disagree by route: 100 MB for a file, 5 MB for pasted rows, with different messages. Which is the intended limit for this app?                                                                                                                                         | UPL-07, UPL-08 |
| **Q-UPL-03** | _(partly answered: `UPL-59` adds an admin delete by id.)_ A duplicate lot and wafer is refused with `409` and leaves **no trace** — the operator's attempt is absent from history. Should the attempt be recorded as a `Rejected` upload instead, so the audit trail is complete?      | UPL-27         |
| **Q-UPL-04** | The notch angle is parsed and validated, then thrown away, and any other pre-header metadata rejects the whole file. Should the notch be persisted and shown with the wafer map, or should the notch line simply be ignored?                                                           | UPL-16         |
| **Q-UPL-05** | Lot/wafer uniformity is reported as `OUT_OF_RANGE`, which reads as a numeric-range problem. Does it deserve its own error code?                                                                                                                                                        | UPL-20, UPL-21 |
| **Q-UPL-06** | Is the passing-bin set (`0` and `1`) fixed, or configurable per device? Yield in UPL-24 depends entirely on it.                                                                                                                                                                        | UPL-24         |
| **Q-UPL-07** | UPL-10 lands the accepted rows of a partly bad file, so a wafer's part count can be lower than the file the operator sent. Is a partial landing wanted, or should any rejected row refuse the file?                                                                                    | UPL-10, UPL-24 |

## 11. Developer-owned verification

Internal to the implementation, not reachable through the UI or the API, and
belonging in the development team's own tests:

- CSV tokenising: quoted fields containing commas, escaped quotes, a UTF-8
  byte-order mark, and mixed `CRLF` / `LF` / `CR` line endings.
- Headerless positional mapping, and header detection when a data row happens to
  look like a header.
- The bin-count aggregation behind UPL-26, proven directly against the die table.
- The transaction rollback behind UPL-27 and UPL-52, proven by asserting no orphan
  upload, lot, wafer, die or validation row survives a refused submission.
- Retention of the source bytes and their SHA-256 on the upload row.
- The database CHECK constraints: `pass_count <= part_count`, `0 <= yield <= 100`,
  `wafer_number` 1–9999, `x`/`y` −32768–32767, and the unique `(wafer_sequence, x, y)`.

## 12. Glossary

| Term                    | Meaning                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Die**                 | One chip site on the wafer, identified by its X and Y coordinate.                                                                        |
| **Hard bin / soft bin** | Two classifications of a die's test outcome. Hard is the coarse category, soft the detailed one. Only the hard bin decides pass or fail. |
| **Part count**          | The number of dies recorded for a wafer.                                                                                                 |
| **Yield**               | Passing dies ÷ part count, as a percentage.                                                                                              |
| **Lot**                 | A group of wafers processed together, unique per device.                                                                                 |
| **Wafer sequence**      | The app's own key for a wafer, distinct from the wafer number in the file.                                                               |
| **Rejected row**        | A data row that failed validation and did not land.                                                                                      |
| **Terminal message**    | The single sentence explaining why a whole file was refused.                                                                             |
