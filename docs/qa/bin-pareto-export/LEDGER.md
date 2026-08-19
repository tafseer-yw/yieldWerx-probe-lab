# Ledger — Bin Pareto Export (`bin-pareto-export`)

Spec source: docs/PRDs/bin-pareto-export/prd-draft.md (draft — NOT signed off) · AIO set: TODO · Created: 2026-08-19

| Stage                | Skill                 | Status                                                                                                                                | Artifact                                                                                                                                                                                                 | Updated    |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Requirements Forge   | /forge-prd            | done (draft)                                                                                                                          | [prd-draft.md](../../PRDs/bin-pareto-export/prd-draft.md)                                                                                                                                                | 2026-08-19 |
| Spec Probe           | /probe-spec           | done · Run by: Claude — dev track (validation run)                                                                                    | [spec-analysis.md](../../../.probe/artifacts/bin-pareto-export/10-spec/spec-analysis.md)                                                                                                                 | 2026-08-19 |
| Tech Design          | /forge-tech-design    | done · open questions answered by adopting the PRD's recommendations (Q-01..Q-04), recorded as assumptions pending owner confirmation | [tech-design.md](../../../.probe/artifacts/bin-pareto-export/60-design/tech-design.md)                                                                                                                   | 2026-08-19 |
| Implementation Probe | /probe-implementation | skipped — the feature did not exist yet, so there was no implementation to compare against                                            | —                                                                                                                                                                                                        | —          |
| Case Forge           | /forge-cases          | done — 2 feature files, 4 scenarios, CAT-01 and CAT-02                                                                                | [downloading-the-report.feature](../../../features/bin-pareto-export/downloading-the-report.feature), [what-the-file-records.feature](../../../features/bin-pareto-export/what-the-file-records.feature) | 2026-08-19 |
| DESIGN GATE          | /gate-design          | **pending — awaiting a named human's approval.** Digest assembled; no approval row exists, and none may be written by Claude          | —                                                                                                                                                                                                        | —          |
| Case Sync            | /sync-cases           | not run — would write to the live YWPD project, and the Design Gate is unapproved                                                     | —                                                                                                                                                                                                        | —          |
| UI Recon             | /ui-recon             | done — screen walked; one testability gap found and fixed by the dev track (bin-pareto-rows)                                          | —                                                                                                                                                                                                        | 2026-08-19 |
| Exploratory Run      | /log-exploratory      | not run                                                                                                                               | —                                                                                                                                                                                                        | —          |
| Script Forge         | /forge-scripts        | done — 4 scenarios automated; @automated added alongside @manual                                                                      | [bin-pareto-export.steps.ts](../../../steps/bin-pareto-export.steps.ts)                                                                                                                                  | 2026-08-19 |
| Stability Run        | /green-run            | 1 of 3 consecutive green runs recorded (2026-08-19) — a streak needs 3                                                                | —                                                                                                                                                                                                        | 2026-08-19 |
| MERGE GATE           | /gate-merge           | pending — needs the stability streak and a human approval                                                                             | —                                                                                                                                                                                                        | —          |
| TestOps Promotion    | /testops-promote      | pending                                                                                                                               | —                                                                                                                                                                                                        | —          |
| OPS GATE             | /gate-ops             | pending                                                                                                                               | —                                                                                                                                                                                                        | —          |

Statuses: pending · in-progress · done · blocked · n/a

**This feature exists to validate the PROBE 3.1 chain end to end.** Nothing has
been built, and the PRD is deliberately unsigned: five product questions are open
and the tech design closed `NEEDS_INFO` because four of them control an expected
value.

## Gate approvals (human decisions)

Authority: `references/governance/human-gates.md`.

| Gate | Scope | Approved by | Role | Timestamp | Confirmed | Evidence |
| ---- | ----- | ----------- | ---- | --------- | --------- | -------- |
|      |       |             |      |           |           |          |

No gate has been approved. `/forge-scripts` and `/sync-cases --live` are locked
for this feature, which is the correct state.
