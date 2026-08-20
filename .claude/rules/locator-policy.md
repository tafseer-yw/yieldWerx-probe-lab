---
paths:
  - 'steps/**/*.ts'
---

# Locator policy (hard rule — Script Audit fails violations at `high`)

1. `page.getByTestId(...)` — **default for everything interactive/assertable
   that has no semantic role.** The app exposes `data-testid` where needed
   (e.g. the wafer-CSV file input `data-testid="csv-file"`).
2. `page.getByRole(...)` / `getByLabel(...)` — for genuinely semantic elements
   (buttons, links, rows, options, textboxes, comboboxes). Most of the UI is
   reachable this way (e.g. `getByRole('button', { name: 'Sign in' })`,
   `getByLabel('Username')`).
3. Everything else (raw CSS, XPath, text selectors) — **forbidden**; ESLint
   errors on `.locator('...')` in steps. An `eslint-disable` requires a written
   justification.

The wafer map and the bin pareto chart are **canvas** renderings, so there is
nothing per-die or per-bar to select. Each carries a readable counterpart to
assert against instead — never pixels, and never a screenshot diff:

- **Wafer map** → `getByTestId('wafer-map-data')` holds one element per die with
  `data-x` / `data-y` / `data-hardbin` / `data-softbin` / `data-passfail`, plus
  `data-cluster="true"` on dies a detection highlighted. It is visually hidden
  and `aria-hidden`, so assert attributes (`toHaveAttribute`), not visibility.
  Each die also carries `data-col` / `data-row` — the grid cell it was **drawn**
  at — and `getByTestId('wafer-map-chart')` carries `data-positive-x`,
  `data-positive-y` and `data-frame` (`declared` or `assumed`) for the
  coordinate frame those positions were computed in. Orientation is only
  assertable through these: a mirrored map still reports every `data-x`
  correctly.
- **Bin pareto chart** → the data table beside it carries every bin's number,
  name, die count, bin % and cumulative %.
