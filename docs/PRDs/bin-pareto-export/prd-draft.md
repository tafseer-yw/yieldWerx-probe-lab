# PRD — Bin Pareto Export

## Status

The lifecycle state and who moved it there.

- **State:** draft
- **Owner:** Tafseer Haider
- **Revision note:** 2026-08-19 first draft, written to exercise the PROBE
  Requirements Forge end to end. The premise is stated in Problem; every product
  decision it implies is an open question, not a choice made here.

## Problem

What hurts today, in plain words, and what it costs.

An engineer who runs a "Bin pareto" report can read it on screen but cannot take
the numbers anywhere. To put a bin breakdown into a supplier review or a weekly
summary, they retype the figures by hand from the chart. That takes minutes each
time and introduces transcription mistakes into documents that leave the company.

## What we will build

The change, described in the product's own words.

A "Download CSV" button on the "Bin pareto" screen. It gives the engineer a
comma-separated file holding exactly the rows the report is showing — the same
bins, in the same order, under the same options they chose. Opening the file in a
spreadsheet reproduces the table beside the chart.

## Who it is for

The roles that will touch this, and what each gets.

| Role | What this gives them |
| ---- | -------------------- |
| Yield engineer | The report's numbers in a spreadsheet, without retyping |
| Quality reviewer | A file to attach to a supplier review |

## User stories

The behavior, one story at a time. IDs are stable forever.

### US-01 — Download the report I am looking at

**As a** yield engineer, **I want** to download the bin pareto I have just run,
**so that** I can put its numbers into a document without retyping them.

**In plain words:** A pareto ranks the failure categories on a wafer from worst
to least, so an engineer can see where most of the loss comes from. Today those
numbers live only on the screen. This gives a button that saves them as a file a
spreadsheet can open.

**Done means:**

- A "Download CSV" button appears on the "Bin pareto" screen once a report has
  been run.
- The file holds one row per bin shown on screen, in the same order.
- Each row carries the bin number, the bin name, the die count, the share of the
  wafer, and the running share.
- No button is offered before a report has been run.

### US-02 — The file matches the options I chose

**As a** quality reviewer, **I want** the downloaded file to state which options
produced it, **so that** a reader months later knows what they are looking at.

**In plain words:** The same wafer can be reported several ways — by hard bin or
soft bin, all bins or only failing ones. A file with bare numbers and no record
of those choices cannot be trusted later, because nobody can tell which question
it answered.

**Done means:**

- The file names the wafer it came from.
- The file states the bin type, which bins were included, and the sort order
  used.
- Those values match the options the report was run with.

## Scope

What is included in this change.

- The "Download CSV" button on the "Bin pareto" screen and the file it produces.

## Out of scope

What is deliberately not included — named, so nobody discovers it in QA.

- Any other report screen.
- Spreadsheet and document file types other than comma-separated values.
- Scheduling or emailing a report.

## Success measures

How we will know it worked, in numbers where possible.

| Measure | Today | Target |
| ------- | ----- | ------ |
| Engineer minutes spent retyping one pareto | about 5 | under 1 |

## Open questions

What must be settled before build or test can be trusted.

| Q | Question | Who can answer | Recommended answer | Why | Status |
| -- | -------- | -------------- | ------------------ | --- | ------ |
| Q-01 | What should the downloaded file be named? | Product owner | The wafer identifier, the bin type, and the date, joined by hyphens | A reader with several files open can tell them apart without opening each one | open |
| Q-02 | Should the options appear as header lines in the file, or as extra columns on every row? | Product owner | Header lines above the table | Spreadsheet users sort and filter the table; repeated option columns get in the way of that | open |
| Q-03 | Which roles may download? | Product owner | Every role that can already run the report | Withholding a file from someone already reading the same numbers on screen protects nothing | open |
| Q-04 | How many rows may one file hold? | Developer | No limit for now; revisit if a wafer ever reports more than a few hundred bins | The screen already shows every bin, so the file matching it adds no new load | open |

## Terms

The product's own words for the things in this document.

| Term (exactly as the product writes it) | Plain meaning | Where used |
| --------------------------------------- | ------------- | ---------- |
| Bin pareto | The screen that ranks failure categories biggest-first. | Report screen |
| Bin type | The choice between hard bin and soft bin numbering. | Report options |
| Bins to show | The choice of all bins, failing bins only, or a named set. | Report options |
| Sort by | The choice of ordering by bin occurrence or bin number. | Report options |
| Wafer sequence | The identifier that selects one wafer. | Report options |
| hard bin | The pass or fail category the tester assigns to a chip. | Report options |
| soft bin | The category later analysis assigns, which may differ from the tester's. | Report options |
