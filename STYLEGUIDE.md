# yieldWerx PROBE Lab style guide

> **Normative status:** This document is the usage authority for new and changed
> PROBE Lab UI. Exact values live in
> [`probe-lab-app/web/src/styles.css`](probe-lab-app/web/src/styles.css), the
> canonical token and component stylesheet.
>
> **Scope:** The React app under `probe-lab-app/web/src/`. Swagger UI, generated
> reports, BDD files, and third-party UI are out of scope.
>
> **Owner:** PROBE Lab frontend owner. Token or interaction changes require design
> review. **Last verified:** 2026-08-18.

PROBE Lab is a compact, fully offline practice workspace for Dev and QA tracks.
It should feel calm, modern, precise, and safe to explore. It is a practice app,
not production tester-control software and not a generic component playground.

## Authority and conflict resolution

Use this order when sources disagree:

1. `styles.css` owns exact tokens, themes, component styles, breakpoints, and motion.
2. This guide owns usage, casing, interaction, accessibility, and composition.
3. [`ui.tsx`](probe-lab-app/web/src/ui.tsx) owns shared UI primitives.
4. [`theme.ts`](probe-lab-app/web/src/theme.ts) owns theme selection and persistence.
5. [`help.ts`](probe-lab-app/web/src/help.ts) owns reviewed field and analysis copy.

Screenshots and prototypes show intent but are not independent authorities. Resolve
any drift in the same change. After changing the system, run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run app:build
npm test
```

## Principles

- Prefer understandable wording and predictable behavior over novelty.
- Use semantic tokens instead of copying resolved colors into page code.
- Reuse a shared primitive before creating a page-specific version.
- Keep the app lightweight and offline; do not add a framework or icon package for
  a control the local system already provides.
- Never communicate status, pass/fail, selection, or chart meaning through color alone.
- Preserve keyboard operation, focus order, readable zoom, and touch usability.
- Analysis language must not imply that triage diagnoses, learns, re-bins, or saves.

## Tokens and themes

CSS custom properties at the top of `styles.css` are the runtime token source.
Components consume `var(--token-name)`; page components do not create palettes.

| Group    | Tokens                                                                              | Use                                                 |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Surfaces | `--page`, `--surface`, `--surface-2`, `--surface-3`, `--surface-inset`, `--sidebar` | Page, cards, quiet groups, inset areas, navigation  |
| Text     | `--ink`, `--ink-2`, `--ink-3`, `--ink-inverse`                                      | Primary, secondary, muted, inverse text             |
| Lines    | `--border`, `--border-strong`, `--hairline`                                         | Controls, cards, dividers                           |
| Brand    | `--accent`, hover/active/ink/soft companions                                        | Actions, active navigation, links, focus, selection |
| Status   | `--good`, `--warning`, `--critical` and their text/surface/border companions        | Success, caution, error only                        |
| Data     | pass/fail, series, map, grid, and axis tokens                                       | Wafer maps and charts                               |
| Shape    | `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`                                              | Compact controls through dialogs                    |
| Layout   | gutter, inset, sidebar, and topbar tokens                                           | Shell and content rhythm                            |
| Motion   | `--ease` and named shadows                                                          | Short transitions and layer elevation               |

Light mode is the base. Dark mode is a selected palette, not an inversion. It
follows the OS until the user makes an explicit choice. New surfaces use tokens so
both modes remain complete.

Raw colors belong only in canonical token declarations, inline SVG data, canvas
fallbacks, or documented artwork. Add a semantic token before adding a new UI color.

## Color and meaning

- Blue is the brand/action color and passing-die mark.
- Red is the failing-die mark and critical status color.
- Pass/fail includes a label, count, or machine-readable value.
- Cluster membership uses a ring plus a legend label.
- Chart series are named in the legend and repeated in a table.
- Do not introduce a rainbow bin palette. Ordered ramps plus labels carry identity.

### Status treatment

Statuses are intentionally borderless, transparent, simple, and not pill-shaped.
`StatusBadge` pairs a semantic icon with text. Do not add a filled chip background,
capsule border, or status-only dot. Alerts are separate message regions and may use
a soft surface and border.

## Typography

The fully offline application uses the local system stack:

```css
system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
```

| Role                   | Implemented style                      |
| ---------------------- | -------------------------------------- |
| Page title             | `h1`, 20px, weight 600                 |
| Card/dialog title      | `h2`, 17px, weight 600                 |
| Section/empty heading  | `h3`, 14px, weight 600                 |
| Small internal heading | `h4`, 13px, weight 600                 |
| Body                   | 14px, 1.5 line height                  |
| Secondary copy         | `.muted`, 13px                         |
| Field label            | 12px, weight 600                       |
| Kicker/table header    | 11px uppercase rendering with tracking |
| Numeric data           | `.num` with `tabular-nums`             |
| Code/coordinates       | local monospace stack                  |

Semantic heading order matters more than visual size. Text must wrap on narrow
screens and remain usable at 200% zoom.

## Voice and casing

Use language a new learner can understand without domain knowledge.

- Sentence case for page/card titles, navigation, buttons, tabs, fields, statuses,
  empty states, and help: **Wafer triage**, **Dev track**, **API docs**.
- Preserve acronyms and identifiers: QA, API, DB, CSV, PROBE, `PROBE-DEV-1`.
- Uppercase is a rendering effect only for kickers, tiny system labels, and table
  headings. Never uppercase an action label.
- Prefer “groups of failed dies that touch” over “contiguous components.”
- Define hard bin, soft bin, yield, and wafer sequence in contextual help.
- Say “fixed pattern matching,” never AI, ML, trained model, prediction, or diagnosis.

## Spacing, shape, and elevation

Use the existing 4px-based rhythm. Common values are 4, 6, 8, 12, 16, 20, 24,
and 32px.

- 6px radius: compact internal controls.
- 8px: standard controls.
- 12px: cards and modern panels.
- 16px: large dialogs or exceptional containers.
- Pill radius is only for inherently round geometry such as tracks and circles.
- Cards use the implemented hairline border and quiet small shadow.
- Floating help, menus, and dialogs use stronger elevation.
- Do not add shadows to ordinary nested groups.

## Layout and responsive behavior

The shell has a 252px expanded sidebar, 74px collapsed desktop rail, 64px top bar,
and content capped at 1320px. Desktop uses a 32px page gutter and 24px card inset.

| Boundary         | Behavior                                            |
| ---------------- | --------------------------------------------------- |
| Above 1080px     | Two-column analysis layouts may remain side by side |
| 1080px and below | Two-column analysis and triage layouts stack        |
| 960px and below  | Sidebar becomes an off-canvas drawer                |
| 720px and below  | Gutters reduce and header utility labels hide       |
| 620px and below  | Guide commands and tabs become one column           |

The sidebar starts expanded after login. Users may collapse it during a session.
The mobile drawer always shows full labels even if the desktop rail was collapsed.

Under `pointer: coarse`, inputs use 40px height and 16px text to prevent focus zoom.
Form, pager, dialog, segmented, and help targets also grow. Compact header controls
stay small enough to fit, with spacing and accessible names preserved.

## Motion

Transition only changed properties; never use `transition: all`. Feedback is quick
and quiet, and motion never carries required meaning. The global
`prefers-reduced-motion` rule reduces animation and transition duration.

## Components

### Buttons

- Use `.btn` with primary, secondary, ghost, or danger variants.
- Use at most one primary action per decision region.
- Preserve a label or equivalent accessible name while loading and prevent repeats.
- Icon-only controls use `btn-icon` and an `aria-label`.
- Do not make a `div` or generic `span` behave like a button.
- Use concise, sentence-case action labels.

### Forms

- Build standard labelled controls with `Field`.
- Labels remain visible; placeholders are examples, not replacements.
- `Field` programmatically associates helper text with its control.
- Preserve values after errors and explain corrections in plain text.
- Use native constraints followed by server validation.
- Disabled and read-only are different states; do not substitute one for the other.

### Filters and selectors

- Use `.filter-bar` or `.filters` and allow wrapping.
- “All” clears a filter rather than representing a stored status.
- Show only choices the app can produce. History exposes terminal statuses, not
  transient internal states.
- Show code and name together when both matter, for example
  `PROBE-PGM-1 · Probe Practice Program 1`.
- Prefer learner-friendly labels while preserving API values, such as
  “Sides only (4-way).”

### Cards and statistics

- Use `Card`, `CardHead`, and `CardBody` instead of reproducing their structure.
- Titles identify the region; subtitles say what users will find.
- Stat numerals use tabular figures; foot text supplies scope or denominator.
- Avoid nested cards unless the child is independently actionable.

### Tables

- Wrap tables in `.table-wrap`; use `table.data` and `scope="col"` headings.
- Right-align numeric columns and use `.num`.
- Clickable rows also support Enter and Space with visible focus.
- Keep underlying identifiers and validation evidence available.
- Status meaning never depends on row color.

### Dialogs and contextual help

- Dialogs are modal, labelled, initially focused, focus-trapped, Escape-aware, and
  restore focus on close.
- Do not dismiss a dialog while a state-changing request is busy.
- Field help opens beside its label. Analysis explainers open beside the page title
  and explain what, how, algorithm when relevant, and ROI.
- Help stays open while its own content scrolls.
- Lead with language a 12-year-old can follow; technical detail may follow.

### Status, loading, empty, and error states

- Use `StatusBadge`, `Skeleton`, `EmptyState`, and `Alert`.
- Skeletons approximate the final region and are hidden from assistive technology.
- Empty states distinguish no data from request failure and respect role permissions.
- Errors state what failed and how to recover without leaking internals or secrets.

### Data visualization

- Canvas is a rendering surface, not the only data source.
- Wafer maps expose a hidden per-die mirror for automation and auditing.
- Bin pareto repeats each chart value in a table.
- Every canvas has an accessible summary and each mark is named in a legend.
- Tooltip math accounts for responsive canvas scaling.

## Navigation and page identity

- The shell begins with a “Skip to main content” link.
- Routes set the browser title as `Page · yieldWerx PROBE Lab`.
- Navigation labels match page titles.
- Role-restricted actions are not advertised to unauthorized roles.
- Header utilities remain compact on mobile.
- **API docs** and **PROBE guide** use sentence case everywhere.

## Accessibility contract

1. Text and meaningful graphics remain readable in light and dark mode.
2. Every keyboard control has a visible `:focus-visible` indicator.
3. Native semantics are preferred; custom controls implement role, name, state,
   Enter, Space, and Escape behavior.
4. Meaning never depends on color, location, or motion alone.
5. Labels, hints, constraints, errors, and progress are programmatically exposed.
6. Dialog focus is contained and restored.
7. Content works at 200% zoom without losing information or actions.
8. Touch controls remain usable without focus zoom.
9. Route titles and the skip link make navigation understandable.
10. Canvas views have an accessible summary and readable data equivalent.

## Deliberate differences from the reference system

The reference guide informed this document, but these items do not fit PROBE Lab:

- No MUI or Mantine: local React primitives keep the lab lightweight and offline.
- No healthcare palette: the lab uses semiconductor statuses and pass/fail roles.
- No OpenSans download: the system font avoids an external asset.
- No filled or pill-shaped status chips: use transparent icon plus text.
- No separate JavaScript token module yet: CSS properties are the single runtime
  source and work directly for CSS and canvas renderers.
- No blanket 44px desktop height: compact desktop density is preserved while touch
  controls are selectively enlarged.

## Review checklist

- [ ] Existing token and shared primitive reused where possible.
- [ ] No unexplained raw color, radius, shadow, or z-index added to a page.
- [ ] Light, dark, narrow, and coarse-pointer modes considered.
- [ ] Sentence case and simple learner-facing wording used.
- [ ] Hover, active, focus, disabled, loading, empty, and error states work.
- [ ] Keyboard order, accessible names, descriptions, and dialog focus verified.
- [ ] Status and chart meaning has a non-color cue.
- [ ] Tables and visualizations expose their underlying data accessibly.
- [ ] Text wraps and survives zoom and long identifiers.
- [ ] Typecheck, lint, format, build, app/API, and browser tests pass.

## Maintained references

- [Canonical stylesheet and tokens](probe-lab-app/web/src/styles.css)
- [Shared UI primitives](probe-lab-app/web/src/ui.tsx)
- [Theme behavior](probe-lab-app/web/src/theme.ts)
- [Reviewed help language](probe-lab-app/web/src/help.ts)
- [Regression scenarios](features/probe-lab/workflow.feature)
