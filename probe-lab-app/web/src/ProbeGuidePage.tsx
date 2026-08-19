import { useState, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { MarkdownPreview } from './MarkdownPreview.js';
import { Alert, Badge, Card, CardBody, CardHead, Icon } from './ui.js';

type GuideSection = 'start' | 'database' | 'plugins' | 'cowork' | 'dev' | 'qa';

const guideSections: Array<{ id: GuideSection; label: string; hint: string }> = [
  { id: 'start', label: 'Get started', hint: 'Run the lab' },
  { id: 'database', label: 'Database', hint: 'Schema and access' },
  { id: 'plugins', label: 'Plugins', hint: 'Clone and understand' },
  { id: 'cowork', label: 'Claude & Cowork', hint: 'Install and invoke' },
  { id: 'dev', label: 'Dev track', hint: 'Build and review' },
  { id: 'qa', label: 'QA track', hint: 'Design and automate' },
];

const validSections = new Set<GuideSection>(guideSections.map((section) => section.id));

/** One accepted argument, and what supplying it actually changes. */
interface SkillArg {
  /** Written exactly as the skill's argument-hint declares it. */
  token: string;
  /** Angle brackets mean required; square brackets mean optional. */
  required: boolean;
  /** What the skill does differently because you passed this. */
  detail: string;
}

/**
 * What this skill actually produced when both tracks were run on one small
 * feature (the bin pareto CSV export) in this repository.
 *
 * `ran: false` is a first-class answer, not a gap in the page. Some skills had
 * nothing to do for a feature this size, and some cannot run on a developer
 * machine at all — saying which, and why, is more useful than an invented
 * example that would read exactly like a real one.
 */
interface StepOutcome {
  ran: boolean;
  /** Plain sentences: what came out, or why nothing did. */
  detail: string;
  /** A short excerpt from the real artifact, copied verbatim. */
  sample?: string;
  /**
   * Set when the excerpt is Markdown, which is what most PROBE artifacts are.
   * The reader can then switch between the source they will find in the file
   * and the rendered document they would read — the raw form matters because
   * it is what the skill actually writes, and the rendered form matters
   * because it is how anyone will consume it.
   */
  format?: 'markdown';
  /** Where the real artifact lives, so a reader can open it. */
  path?: string;
}

interface TrackStep {
  /** The skill's real argument contract, as its SKILL.md declares it. */
  command: string;
  title: string;
  purpose: string;
  /** Every argument, explained one at a time. */
  args: SkillArg[];
  /** A runnable invocation against this lab's own features. */
  example: string;
  /** What it produced for the worked example. */
  outcome?: StepOutcome;
  agents?: string;
  /** Skills both tracks use. They appear in both lists on purpose. */
  shared?: boolean;
}

/** A stack profile: what `--stack` selects, and what changes when it does. */
interface StackProfile {
  id: string;
  name: string;
  status: 'current' | 'provisional' | 'qa-only';
  what: string;
  layers: string;
  useWhen: string;
}

/**
 * The five profiles the plugin ships. A dev-track skill reads its layer names,
 * conventions, commands and traps from whichever one `--stack` selects — which
 * is why the same skill produces a Liquibase-shaped migration on one stack and
 * an EF Core one on another, without a second skill existing.
 */
const stackProfiles: StackProfile[] = [
  {
    id: 'node-ts-spa',
    name: 'Node service + TypeScript SPA',
    status: 'current',
    what: 'This lab, and any application built as a Node/TypeScript HTTP service with a documented API, a relational datastore, and a single-page frontend.',
    layers:
      'service: routes → validation → authorization → domain → persistence, with the API document generated from the same definitions the routes use. web: screens → components → data access, every assertable element carrying its selector-policy identifier.',
    useWhen: 'Practising here, or building the greenfield lightweight stack.',
  },
  {
    id: 'dotnet-legacy',
    name: 'Legacy platform — web and desktop',
    status: 'current',
    what: 'The shipped yieldWerx product: ASP.NET MVC 5 on .NET Framework 4.7.2, Entity Framework 6 (Code-First, with an older EDMX model still in CLM), Dapper, SignalR, SQL Server, the WinForms desktop application, and the Windows-service analytics engines.',
    layers:
      'Client (browser UI · WinForms desktop · Power BI) → Application (Controller → BL Service → DL Service → Repository, one controller per module) → Engines (UploadService and BrokerService fanning JobCards to PAT, SWM, GDBN, SPC and the rest, each with its own queue) → Data (one SQL Server database, 294 tables and 934+ stored procedures).',
    useWhen:
      'Any change to the product that exists today — including the desktop reports, where a control needs a developer-set Name before it can be automated at all.',
  },
  {
    id: 'dotnet-modern',
    name: 'Modern service (SaaS direction)',
    status: 'provisional',
    what: 'The modernization path the knowledgebase records: REST on a single gateway retiring the legacy WCF services, zero-trust authorization on every call including internal ones, and rules-as-configuration that are versioned and audited.',
    layers:
      'Not yet fixed. No repository stands behind this profile, so it carries approved direction rather than verified facts — a design built against it states that in its own header, and nothing may cite it as evidence of how existing code works.',
    useWhen:
      'A new service on the modernization path. The first real repository on this stack replaces the profile with verified facts.',
  },
  {
    id: 'testcomplete-winforms',
    name: 'Desktop automation',
    status: 'qa-only',
    what: 'SmartBear TestComplete driving the WinForms desktop application: Gherkin in the Scenarios project item, Python step definitions, objects reached through Name Mapping aliases.',
    layers:
      'Project suite (.pjs) → projects (.mds) → Scenarios, Script units, NameMapping, TestedApps, Stores. Runs select by tag; only exit code 2 is a test failure, and an interactive user session is required — a headless agent cannot run it.',
    useWhen:
      'The QA desktop skills. Usually maintained by a different team, whose config points paths.features and paths.ledgers at the QA repository.',
  },
  {
    id: 'playwright-bdd',
    name: 'Web automation framework',
    status: 'qa-only',
    what: "The QA track's own automation stack — Playwright with playwright-bdd, Allure reporting, and the locator, chart and visual-regression conventions the framework already carries.",
    layers:
      'features → generated specs → step definitions → page and component objects → fixtures, with independent truth layers (oracle, API, database) behind any calculated assertion.',
    useWhen: 'Web scripting, stability runs, and CI promotion.',
  },
];

/** Nearly every skill takes this, and it means the same thing every time. */
const SLUG: SkillArg = {
  token: '<feature-slug>',
  required: true,
  detail:
    'The feature this run belongs to. Names its artifact folder and its ledger, so every stage of the same feature writes to one place. Reuse it exactly.',
};

const sharedStart: TrackStep[] = [
  {
    command:
      '/yw:forge-prd <feature-slug> [<the idea or problem, or a path to notes>] [--review | --sign-off "<name>"]',
    title: 'Write the requirement',
    purpose:
      'Writes down what we are building and why, in words an executive, a developer and a tester all read the same way. It asks you questions first and never invents a product decision — anything nobody has decided becomes an open question with a suggested answer.',
    args: [
      {
        token: '<feature-slug>',
        required: true,
        detail:
          'Names the PRD folder and every later artifact for this feature. Reuse it exactly at each stage.',
      },
      {
        token: '[<the idea or problem, or a path to notes>]',
        required: false,
        detail:
          'The raw request in your words, or a file to read it from. Omit it and the skill asks rather than inventing a problem statement.',
      },
      {
        token: '[--review | --sign-off "<name>"]',
        required: false,
        detail:
          'The lifecycle moves — use one or the other, never both. --review renames the draft to prd-in-review.md and names who should read it, changing no content. --sign-off "<name>" renames it to prd-signed-off.md and records that named human and a timestamp; it is only valid on their direct statement, because a bare "looks good" is not a sign-off.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Produced a PRD with two user stories, four open questions it refused to answer on its own, and a Terms table. Every story carries an "In plain words" line for readers with no wafer-test background.',
      format: 'markdown',
      sample:
        '### US-01 — Download the report I am looking at\n\n**As a** yield engineer, **I want** to download the bin pareto I have just run,\n**so that** I can put its numbers into a document without retyping them.\n\n**In plain words:** A pareto ranks the failure categories on a wafer from worst\nto least, so an engineer can see where most of the loss comes from. Today those\nnumbers live only on the screen. This gives a button that saves them as a file a\nspreadsheet can open.\n\n**Done means:**\n\n- A "Download CSV" button appears on the "Bin pareto" screen once a report has\n  been run.\n- The file holds one row per bin shown on screen, in the same order.\n- Each row carries the bin number, the bin name, the die count, the share of the\n  wafer, and the running share.\n- No button is offered before a report has been run.',
      path: 'docs/PRDs/bin-pareto-export/prd-draft.md',
    },
    example: '/yw:forge-prd bin-pareto-export "engineers retype pareto numbers by hand"',
    agents: 'requirement-clarifier',
    shared: true,
  },
  {
    command:
      '/yw:probe-spec <feature-slug> [<spec-path-or-text>] [--migrate-format | --reconcile] [--compare-implementation <env-or-url>] [--role <role>] [--build <id>]',
    title: 'Make the requirement testable',
    purpose:
      'Turns the PRD into a numbered checklist of things the product must do. Both tracks start here and share one copy — the developer and the tester are never working from two different readings of the same requirement.',
    args: [
      SLUG,
      {
        token: '[<spec-path-or-text>]',
        required: false,
        detail:
          'The signed-off PRD, another requirement document, or pasted text. This is the sole requirement authority; the knowledgebase only explains vocabulary.',
      },
      {
        token: '[--migrate-format | --reconcile]',
        required: false,
        detail:
          'Two ways to rerun on an analysis that already exists — use one or the other. --migrate-format updates an older analysis to the current shape without changing a single meaning. --reconcile compares it against a revised requirement, keeps criterion ids stable, and reports what the change invalidates in BOTH tracks; it is the only correct way to handle a changed requirement.',
      },
      {
        token: '[--compare-implementation <env-or-url>]',
        required: false,
        detail:
          'Chains straight into Implementation Probe against a running build once the analysis is written.',
      },
      {
        token: '[--role <role>]',
        required: false,
        detail:
          'Which role to sign in as for that comparison — behaviour often differs by permission.',
      },
      {
        token: '[--build <id>]',
        required: false,
        detail:
          'Records exactly which build was observed, so a later divergence can be attributed.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Produced four acceptance criteria (AC-01 to AC-04) and two testable categories, each with a plain-words explanation and a note on where to check it. These ids are used by every later step on both tracks.',
      format: 'markdown',
      sample:
        '### AC-01 — Download the shown report as a file\n\n**Summary:** Verify that the engineer can download the bin pareto they have run.\n**In plain words:** A pareto ranks the failure categories on a wafer from worst to\nleast. This lets the engineer save exactly what the screen is showing as a file a\nspreadsheet can open, instead of copying the numbers by hand.\n**Format:** Workflow\n\n```gherkin\nGiven The user has run a report on the "Bin pareto" screen\nWhen The user clicks the "Download CSV" button\nThen A comma-separated file is saved\nAnd The file holds one row for each bin shown on the screen\nAnd The rows are in the same order as the screen\n```',
      path: '.probe/artifacts/bin-pareto-export/10-spec/spec-analysis.md',
    },
    example: '/yw:probe-spec bin-pareto-export docs/PRDs/bin-pareto-export/prd-signed-off.md',
    agents: 'source-digester',
    shared: true,
  },
];

const crossSteps: TrackStep[] = [
  {
    command: '/yw:bug-report <feature-slug> <one-line-symptom>',
    title: 'File a defect candidate',
    purpose:
      'Turns "it looked wrong" into something someone can act on: what you did, what happened, what should have happened, and how bad it is.',
    args: [
      SLUG,
      {
        token: '<one-line-symptom>',
        required: true,
        detail:
          'What went wrong, in one sentence, as observed. The skill gathers the evidence around it rather than asking you to assemble a report.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Nothing to report — the two failures that appeared during this run were in the tests themselves and were fixed straight away, not defects in the product.',
    },
    example: '/yw:bug-report bin-pareto "cumulative line exceeds 100% on retested wafers"',
    shared: true,
  },
  {
    command: '/yw:flake-triage <feature-slug-or-scenario> [evidence-path]',
    title: 'Diagnose an intermittent failure',
    purpose:
      'Works out why a test sometimes passes and sometimes fails, and whether the fault is in the test or the product. Both happen, and the difference matters.',
    args: [
      {
        token: '<feature-slug-or-scenario>',
        required: true,
        detail:
          'Either the whole feature or one scenario id, when you already know which test is unstable.',
      },
      {
        token: '[evidence-path]',
        required: false,
        detail:
          'A prior run log or report to start from, so the triage does not have to re-provoke a failure you already captured.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Nothing flaked. The scenarios were run repeatedly during the mutation checks and behaved identically each time.',
    },
    example: '/yw:flake-triage TC-cluster-detection-014',
    agents: 'flake-hunter',
    shared: true,
  },
  {
    command: '/yw:change-impact [base-ref]',
    title: 'Ask what a change breaks',
    purpose:
      'Given a change, tells you which cases and which requirements it touches — so nobody finds out in production.',
    args: [
      {
        token: '[base-ref]',
        required: false,
        detail:
          'The branch or commit to compare against. Defaults to the working tree against its base, so a bare call answers "what have I broken right now?".',
      },
    ],
    outcome: {
      ran: false,
      detail:
        "Not run as a step. The equivalent question was answered by the suite itself: moving the report's option rules into shared code could have changed the existing report, and the existing scenarios confirmed it did not.",
    },
    example: '/yw:change-impact main',
    shared: true,
  },
  {
    command: '/yw:update-yieldwerx-knowledge <approved-change-request>',
    title: 'Record approved knowledge',
    purpose:
      'Adds a confirmed product fact to the shared knowledge base, so the next person does not have to rediscover it.',
    args: [
      {
        token: '<approved-change-request>',
        required: true,
        detail:
          'The change, in the words it was approved in. Approved facts only — this is not a place to record a guess, and the skill will not promote one.',
      },
    ],
    outcome: {
      ran: false,
      detail: 'Nothing to add. This feature produced no new product fact, only a new capability.',
    },
    example:
      '/yw:update-yieldwerx-knowledge "Bin Pareto replaces Bin Histogram; the cumulative line is required"',
    shared: true,
  },
  {
    command: "/yw:handoff '[<slug>] | close <slug> | list'",
    title: 'Stop without losing the thread',
    purpose:
      'Writes down what the next session needs to know when work stops mid-way: what is done, what is verified, what is still broken, and the one next thing to do.',
    args: [
      {
        token: '[<slug>]',
        required: false,
        detail:
          'Names the line of work, not the date. Reuse the same slug to update that handoff rather than accumulating copies.',
      },
      {
        token: 'close <slug>',
        required: false,
        detail:
          'Marks the work landed. A stale open handoff points the next session at a world that has moved on.',
      },
      {
        token: 'list',
        required: false,
        detail: 'Shows every open handoff with its branch, age, and next step.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not needed — the work finished inside one session. Its value shows up when a context runs out or the day ends mid-feature.',
    },
    example: '/yw:handoff bin-pareto-export',
    shared: true,
  },
];

const devSteps: TrackStep[] = [
  ...sharedStart,
  {
    command: '/yw:forge-tech-design <feature-slug> [--stack <profile-name>] [--ac AC-NN]',
    title: 'Design against the real layers',
    purpose:
      'Decides how to build it: which parts of the code change, what the new web address looks like, who is allowed to use it, and what could go wrong. It refuses to design while important questions are still unanswered.',
    args: [
      SLUG,
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail:
          'Which stack to design against — this is what decides whether you get a Controller/BL/DL/Repository map or a Node routes-and-domain one. Defaults to the first entry in your config; never guessed.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail:
          'Design only the named criterion instead of the whole feature. Useful when one criterion is unblocked and the rest are still open questions.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        "Mapped the change across four layers and wrote one decision record. It also refused to finish cleanly — it returned NEEDS_INFO because the PRD's four open questions were still unanswered, and named which ones blocked what.",
      format: 'markdown',
      sample:
        '| Layer | Change | Grounding |\n| ----- | ------ | --------- |\n| `service/` route | Add `GET /api/reports/wafers/:waferSequence/bin-pareto.csv`, same query parameters as the existing report route | verified-in-code: `routes/reports.ts:100` serves the report at `/api/reports/wafers/:waferSequence/bin-pareto` |\n| `service/` domain | Reuse `deriveBinPareto()` unchanged; add a formatter that turns its result into comma-separated text | verified-in-code: `bin-pareto.ts:21` exports `deriveBinPareto` |\n\n## Closing state\n`NEEDS_INFO` — four open questions (Q-01, Q-02, Q-03, Q-05) control expected\nvalues in this design. Recommended answers are carried from the analysis and',
      path: '.probe/artifacts/bin-pareto-export/60-design/tech-design.md',
    },
    example: '/yw:forge-tech-design bin-pareto-export --stack node-ts-spa',
    agents: 'tech-designer',
  },
  {
    command:
      '/yw:scaffold-app <app-slug> [--stack <profile-name>] [--surfaces api,ui,db,auth,queue] [--dry-run]',
    title: 'Start a new application',
    purpose:
      'Stands up a brand-new application with the wiring already in place. For starting something, not for changing something.',
    args: [
      {
        token: '<app-slug>',
        required: true,
        detail: 'Names the application being stood up, and the directory it is created in.',
      },
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail: 'Which stack to scaffold. Decides the whole shape of what is generated.',
      },
      {
        token: '[--surfaces api,ui,db,auth,queue]',
        required: false,
        detail:
          'Which surfaces to create. Ask only for what the application needs — an unused queue is scaffolding nobody maintains.',
      },
      {
        token: '[--dry-run]',
        required: false,
        detail:
          'Prints what would be created without writing anything. Worth doing first on a stack you have not scaffolded before.',
      },
    ],
    outcome: {
      ran: false,
      detail: 'Not applicable — this feature was added to an app that already existed.',
    },
    example: '/yw:scaffold-app wafer-portal --stack node-ts-spa --surfaces api,ui,db',
  },
  {
    command:
      '/yw:build-feature <feature-slug> [--stack <profile-name>] [--layer backend|frontend|both] [--ac AC-NN] [--category CAT-NN] [--requirement <path>] [--no-requirement "<reason>"]',
    title: 'Build the feature',
    purpose:
      'Writes the actual code, following the design rather than improvising. It builds a whole journey end to end, and keeps going until the real commands pass instead of stopping at "it should work now".',
    args: [
      SLUG,
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail:
          'Which stack you are building in — decides the layers, conventions, commands, and known traps the build follows.',
      },
      {
        token: '[--layer backend|frontend|both]',
        required: false,
        detail:
          'Which side to implement. A backend-only run still designs the whole journey but implements one side, and emits the endpoint and payload handoff the frontend needs. Defaults to both.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail: 'Build only what one acceptance criterion requires.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail: 'Build one testable category rather than the whole feature.',
      },
      {
        token: '[--requirement <path>]',
        required: false,
        detail: 'Point at the requirement document when there is no spec analysis to read.',
      },
      {
        token: '[--no-requirement "<reason>"]',
        required: false,
        detail:
          'Build with no requirement at all — allowed, but the reason is recorded in the build report where a reviewer will see it.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        "Changed five files. The report's option rules moved into one shared place so the screen and the file cannot drift apart, and the download reuses the report's existing permission check rather than inventing a second one.",
      sample:
        "export function binParetoToCsv(report: BinParetoResponse, options: BinParetoOptions): string {\n  const lines: string[] = [\n    csvRow(['Lot', report.header.lot]),\n    csvRow(['Wafer', report.header.waferNumber]),\n    csvRow(['Device', report.header.device]),\n    csvRow(['Test program', report.header.testProgram]),",
      path: 'probe-lab-app/api/src/bin-pareto-csv.ts',
    },
    example: '/yw:build-feature bin-pareto-export --stack node-ts-spa --layer backend',
    agents: 'requirement-clarifier · testability-scout · build-verifier',
  },
  {
    command:
      '/yw:forge-migration <feature-slug or change description> [--stack <profile-name>] [--data-only]',
    title: 'Change the database safely',
    purpose:
      'Writes database changes that are safe to run on a live system, under rules that keep them boring — never edit one that has already run, add before you remove.',
    args: [
      {
        token: '<feature-slug or change description>',
        required: true,
        detail:
          'Either the feature whose design calls for the change, or the change stated directly for a standalone correction.',
      },
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail:
          'Decides the migration format — a SQL Server changeset on the legacy platform, an EF Core migration on the modern one, plain SQL on the lab stack.',
      },
      {
        token: '[--data-only]',
        required: false,
        detail:
          'A data correction with no schema change. Keeps the safety rules that apply to rows and skips the ones about columns.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Deliberately not needed, and the design says so in writing. The export is built entirely from data the report already reads, so there is no new table, column or seed — recorded as a decision rather than left as an oversight.',
    },
    example: '/yw:forge-migration "add export_audit table" --stack node-ts-spa',
    agents: 'build-verifier',
  },
  {
    command: '/yw:forge-unit-tests <feature-slug> [--stack <profile-name>] [--ac AC-NN]',
    title: 'Cover what QA routed to you',
    purpose:
      'Writes the small, fast tests that check the fiddly logic directly, without a browser. It covers exactly the criteria the spec said belong at this level, so nothing is left to "someone will test that later".',
    args: [
      SLUG,
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail:
          'Decides the real test framework — xUnit and Moq on .NET, node --test here. The suite that already exists always wins over the one the stack usually has.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail: 'Cover one routed criterion instead of the whole hand-off list.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Ten tests on the file builder, covering AC-02 and AC-04. Two of them exist for failures that stay silent rather than crashing: a bin name containing a comma would shift every later column, and one containing a quote must be doubled.',
      sample:
        '✔ AC-02 — every bin becomes one row carrying the five reported values\n✔ AC-02 — rows keep the order the report produced, not a re-sorted one\n✔ AC-04 — the file states the options the report was run with\n✔ AC-04 — a custom bin selection names the bins it selected\n…\nℹ tests 10\nℹ pass 10\nℹ fail 0',
    },
    example: '/yw:forge-unit-tests bin-pareto-export --ac AC-02',
    agents: 'build-verifier',
  },
  {
    command:
      '/yw:revise-feature <feature-slug> -- <what must change> [--breaking-ok "<authorization>"] [--ac AC-NN]',
    title: 'Change existing behavior',
    purpose:
      'Changes something that already works, without quietly breaking whoever depends on it. It makes you say out loud when a change would break existing behaviour.',
    args: [
      SLUG,
      {
        token: '-- <what must change>',
        required: true,
        detail:
          'The change in your words, after a bare double dash so it is never confused with a flag.',
      },
      {
        token: '[--breaking-ok "<authorization>"]',
        required: false,
        detail:
          'Permits a breaking change, recording who authorized it. Without this the skill preserves compatibility even when that costs more work.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail:
          'Scope the revision to what one acceptance criterion requires, leaving the rest of the feature alone.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        "Not used: this feature was additive, so nothing that already worked changed shape. The one thing that came close — moving the report's option rules into a shared place — kept its behaviour identical, which is why the existing tests still pass untouched.",
    },
    example: '/yw:revise-feature bin-pareto -- "sort by bin number by default"',
    agents: 'requirement-clarifier · testability-scout · build-verifier',
  },
  {
    command:
      '/yw:fix-defect <feature-slug> "<defect-slug-or-symptom>" [--candidate <path>] [--tc TC-id] [--no-test "<reason>"]',
    title: 'Fix a defect',
    purpose:
      'Fixes a reported bug and adds the test that would have caught it, so it cannot come back unnoticed.',
    args: [
      SLUG,
      {
        token: '"<defect-slug-or-symptom>"',
        required: true,
        detail: 'The bug candidate id, or the symptom as observed if none was filed.',
      },
      {
        token: '[--candidate <path>]',
        required: false,
        detail:
          'A bug-report candidate file, so the fix starts from captured evidence instead of a re-description.',
      },
      {
        token: '[--tc TC-id]',
        required: false,
        detail:
          'The existing test case this defect belongs to, keeping the regression attached to the right case.',
      },
      {
        token: '[--no-test "<reason>"]',
        required: false,
        detail:
          'Skip the failing-test-first rule. The reason lands in the fix report where a reviewer sees it — this is the exception, not a shortcut.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'No defect was reported against this feature. The two failures that did surface during the run were caught by the suite itself and fixed in the same commit.',
    },
    example: '/yw:fix-defect bin-pareto "cumulative percentage exceeds 100"',
    agents: 'build-verifier',
  },
  {
    command: '/yw:sync-styleguide <feature-slug or --all> [--stack <profile-name>] [--fix]',
    title: 'Hold the design system',
    purpose:
      'Checks the interface you built against your own design rules, and can fix the differences.',
    args: [
      {
        token: '<feature-slug or --all>',
        required: true,
        detail:
          "One feature's changed interface, or --all to measure the drift across every screen.",
      },
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail:
          "Which stack's interface conventions apply — it decides which styleguide and token files are read as the source of truth.",
      },
      {
        token: '[--fix]',
        required: false,
        detail:
          'Applies only mechanical corrections — a raw colour to the token that owns it, an off-scale value to the nearest step. Anything needing judgement stays a reported finding.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not run as a step, though the rule it enforces was followed: the download button reuses the existing button style and a new icon drawn to match the upload one, rather than introducing a new look.',
    },
    example: '/yw:sync-styleguide bin-pareto-export --fix',
    agents: 'build-verifier',
  },
  {
    command:
      '/yw:seed-testability <feature-slug> [--from-recon <path>] [--surface ui|api|results|all] [--rank high|medium|all]',
    title: 'Repair legacy testability gaps',
    purpose:
      'Adds the small handles automated tests need to find things on screen. Doing this in the app is a developer job — without it, testers resort to brittle tricks that break the next time the page is restyled.',
    args: [
      SLUG,
      {
        token: '[--from-recon <path>]',
        required: false,
        detail:
          'A recon gap list to work through, so you fix what was actually found rather than what you expect to be missing.',
      },
      {
        token: '[--surface ui|api|results|all]',
        required: false,
        detail:
          'Which surface to repair: interface identifiers, the served API document, or readable calculated results.',
      },
      {
        token: '[--rank high|medium|all]',
        required: false,
        detail:
          'How deep to go. Start at high — those are the gaps actually blocking a test today.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        "Added two handles. The repository's own rules refused the test that tried to work around the missing one with a CSS selector, which is exactly the point: the gap got fixed in the app instead of worked around in the test.",
      sample: 'data-testid="bin-pareto-download-csv"\n    <tbody data-testid="bin-pareto-rows">',
      path: 'probe-lab-app/web/src/BinParetoPage.tsx',
    },
    example: '/yw:seed-testability bin-pareto --surface all --rank high',
    agents: 'testability-scout',
  },
  {
    command:
      '/yw:review-code <feature-slug> [branch|--staged|--files <path,...>] [--focus correctness|security|data|observability|all] [--depth quick|thorough]',
    title: 'Review before the pull request',
    purpose:
      'Reads the change the way a careful reviewer would, before anyone else has to. It checks the code against what the requirement actually asked for, not just whether it compiles.',
    args: [
      SLUG,
      {
        token: '[branch|--staged|--files <path,...>]',
        required: false,
        detail:
          'What to review: a branch against its base, only what you have staged, or an explicit file list.',
      },
      {
        token: '[--focus correctness|security|data|observability|all]',
        required: false,
        detail:
          'Narrow the lens to correctness, security, data integrity, or observability. Defaults to all, which is usually right before a pull request.',
      },
      {
        token: '[--depth quick|thorough]',
        required: false,
        detail:
          'Quick is a fast pass for a small change; thorough reads the surrounding code and the requirement too.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not run as its own step. The review happened inside the build instead, which is how it usually goes on a change this size — but that means no separate review record exists, and on a larger change you would want one.',
    },
    example: '/yw:review-code bin-pareto-export --staged --depth thorough',
    agents: 'code-reviewer · build-verifier',
  },
  {
    command:
      '/yw:ship-change <feature-slug> [commit|describe|both] [--push] [--open-pr] [--base <ref>]',
    title: 'Commit and describe',
    purpose:
      'Turns finished work into a commit with a message that explains why, not just what. It can open the pull request too, and it never merges anything itself.',
    args: [
      SLUG,
      {
        token: '[commit|describe|both]',
        required: false,
        detail:
          'Make the local commits, write the pull-request body, or both. Describe alone is useful when you want to read the body before anything is committed.',
      },
      {
        token: '[--push]',
        required: false,
        detail:
          'Pushes the branch. Withheld by default — pushing is an outward action and needs you to ask for it.',
      },
      {
        token: '[--open-pr]',
        required: false,
        detail: 'Opens the pull request. Also withheld by default, and never merges.',
      },
      {
        token: '[--base <ref>]',
        required: false,
        detail: 'The branch to target, when it is not the repository default.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        "One commit carrying both tracks' work, with a message recording what was verified and — just as important — what was deliberately left for a human: the PRD's open questions and the unapproved Design Gate.",
      sample:
        'feat(bin-pareto): export the report as CSV, built through\n                  both PROBE tracks\n\n probe-lab-app/api/src/bin-pareto-csv.ts      |  94 +++++\n probe-lab-app/api/src/routes/reports.ts      |  93 ++++--\n probe-lab-app/tests/bin-pareto-csv.test.ts   | 169 +++++++\n steps/bin-pareto-export.steps.ts             | 223 ++++++++\n features/.../downloading-the-report.feature  |  25 ++\n 12 files changed',
    },
    example: '/yw:ship-change bin-pareto-export both',
    agents: 'code-reviewer',
  },
  {
    command: '/yw:review-pr <pr-number-or-url> [--repo <path>] [--post]',
    title: 'Review the opened request',
    purpose:
      'Reviews an opened pull request as its reviewer, checking the claims in the description against what the code actually does. It never merges.',
    args: [
      {
        token: '<pr-number-or-url>',
        required: true,
        detail:
          'The pull request to review. The host is read from the remote — gh for GitHub, az repos for Azure DevOps.',
      },
      {
        token: '[--repo <path>]',
        required: false,
        detail: 'Which checkout to review from, when you are not sitting in it.',
      },
      {
        token: '[--post]',
        required: false,
        detail:
          'Posts the findings to the host as review comments. Off by default: the review artifact stands on its own, and posting is an outward action.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'No pull request exists yet for this work, so there was nothing to review. It reads the diff against what the description claims, which is the check a human reviewer most often skips.',
    },
    example: '/yw:review-pr 42',
    agents: 'code-reviewer',
  },
  ...crossSteps,
];

const qaSteps: TrackStep[] = [
  ...sharedStart,
  {
    command: '/yw:ask-yieldwerx <question>',
    title: 'Get product context',
    purpose:
      'Answers product questions from the company knowledge base and cites where each answer came from. It explains what words mean; it never replaces the approved requirement.',
    args: [
      {
        token: '<question>',
        required: true,
        detail:
          'Ask in plain words. Answers are sourced and cited — an uncited claim is treated as unknown rather than guessed.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        "Not needed. The terms this feature uses — bin pareto, hard bin, soft bin — were already defined in the PRD's own Terms table, which is where a reader looks first.",
    },
    example: '/yw:ask-yieldwerx "what is the difference between hard bin and soft bin?"',
    agents: 'knowledgebase routing skill',
  },
  {
    command: '/yw:probe-implementation <feature-slug> <env-or-url> [--role <role>] [--build <id>]',
    title: 'Compare intent with the build',
    purpose:
      'Compares a running build against the written requirement and reports where they differ. Useful when the software already exists and nobody is quite sure what it does.',
    args: [
      SLUG,
      {
        token: '<env-or-url>',
        required: true,
        detail:
          'Which running build to observe. Named and recorded, so a later divergence can be attributed to a version.',
      },
      {
        token: '[--role <role>]',
        required: false,
        detail:
          'Sign in as this role — behaviour and visibility usually differ by permission, and comparing as the wrong one produces false divergences.',
      },
      {
        token: '[--build <id>]',
        required: false,
        detail: 'The exact build identifier, recorded in the comparison report.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Nothing to compare against — this feature did not exist yet, so the requirement had no implementation to check it against. It comes into its own on a feature that was built before it was written down.',
    },
    example: '/yw:probe-implementation bin-pareto local --role qa',
    agents: 'implementation-prober',
  },
  {
    command:
      '/yw:forge-cases <feature-slug> [--scenario-type positive|functional|negative|edge|all] [--category CAT-NN] [--ac AC-NN]',
    title: 'Design the cases',
    purpose:
      'Writes the test cases in plain Given/When/Then language, so anyone can read what will be checked without knowing how it is automated. These are the cases a human approves before any automation is written.',
    args: [
      SLUG,
      {
        token: '[--scenario-type positive|functional|negative|edge|all]',
        required: false,
        detail:
          'Which kind of scenario to design — this is the scenario tag, not the test level. A scoped run appends without declaring the feature complete.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail:
          'Design the cases for one testable category. Each category becomes one feature file, so this is the natural unit of a review.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail:
          'Design only the cases one acceptance criterion needs, leaving the rest of the feature untouched.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Two case files, four scenarios, covering both categories from the spec. Each scenario is tagged with the criterion it proves, so coverage can be traced back to the requirement rather than counted.',
      sample:
        '@manual @automated @regression @feature:bin-pareto-export @cat:CAT-01\n  Background:\n    Given the QA user is signed in\n    And a wafer with several failing bins is loaded\n\n  @smoke @testtype:e2e @ac:AC-03\n  Scenario: No download is offered before a report has been run\n    When the QA user opens the bin pareto screen\n    Then the "Download CSV" button is not offered',
      path: 'features/bin-pareto-export/downloading-the-report.feature',
    },
    example: '/yw:forge-cases bin-pareto-export --scenario-type all',
    agents: 'test-case-designer',
  },
  {
    command: '/yw:forge-security-tests <feature-slug> [--owasp A01,A07,...] [--category CAT-NN]',
    title: 'Design the security cases',
    purpose:
      'Writes the security cases no scanner can judge — who is allowed to do what, and whether the system says so consistently.',
    args: [
      SLUG,
      {
        token: '[--owasp A01,A07,...]',
        required: false,
        detail:
          'Limit to named categories. Defaults to every authored category that applies to the feature.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail:
          'Author the security cases for one testable category only, rather than the whole feature.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        "Not run as a step, though the question it asks was answered in the design: the download reuses the report's existing permission check, because two sets of rules for the same numbers is how they eventually disagree. That reuse is verified — signed out, the download returns 401.",
    },
    example: '/yw:forge-security-tests bin-pareto-export --owasp A01,A07',
  },
  {
    command: '/yw:update-cases <feature-slug> -- <what needs to change>',
    title: 'Amend existing cases',
    purpose:
      'Changes existing cases when the requirement moves, keeping their ids so history is not lost.',
    args: [
      SLUG,
      {
        token: '-- <what needs to change>',
        required: true,
        detail:
          'The amendment in your words, after a bare double dash. Use this rather than re-running Case Forge — re-forging renumbers ids and orphans the records bound to them.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Nothing to update — the cases were new. This is for the second time a requirement changes, not the first time it is written.',
    },
    example:
      '/yw:update-cases bin-pareto-export -- "Q-01 answered: file name is wafer-bintype-date"',
    agents: 'test-case-designer',
  },
  {
    command: '/yw:gate-design <feature-slug> [--category CAT-NN] [approved]',
    title: 'Assemble the Design Gate digest',
    purpose:
      'Collects the evidence about the test cases into one page and shows it to a named person, who says yes or no. It works out no verdict of its own — the decision and the timestamp are recorded, and that is the whole gate.',
    args: [
      SLUG,
      {
        token: '[--category CAT-NN]',
        required: false,
        detail:
          'Gate one category so teams can approve and sync categories independently, in parallel.',
      },
      {
        token: '[approved]',
        required: false,
        detail:
          'Records your approval of the digest in front of you. "continue" and "go ahead" are not approvals — the skill will ask which you mean.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        "The evidence was assembled but no approval exists, because approving is a person's job and Claude may never write that row. This is the real state of the example: the cases are ready and waiting for a human to read them and say so.",
    },
    example: '/yw:gate-design bin-pareto-export',
  },
  {
    command: '/yw:sync-cases <feature-slug> [--live] [--category CAT-NN]',
    title: 'Push cases to the tracker',
    purpose:
      'Copies approved cases into your test-management system. It always shows you the plan first, and will not write anything for real without both an explicit instruction and a recorded human approval.',
    args: [
      SLUG,
      {
        token: '[--live]',
        required: false,
        detail:
          'Actually writes to the tracker. Without it you get the exact create/update plan and nothing leaves the repository — always read that plan first.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail: 'Sync one approved category. The approval check narrows to that category row.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        "Not run, for two independent reasons — either alone would have stopped it. The Design Gate has no approval, and this lab's only configured project is the live YWPD product project, so a practice run would have created real records in it.",
    },
    example: '/yw:sync-cases bin-pareto-export',
  },
  {
    command:
      '/yw:ui-recon <feature-slug> [env] [--with-api-recon] [--spec <path-or-url>] [--with-case-execution] [--tc <id,id,...>] [--role <role>] [--continue-on-failure]',
    title: 'Recon the running interface',
    purpose:
      'Walks the real screen before anyone writes automation, and records how each thing on it can be found reliably. It reports anything that cannot be, so the app gets fixed instead of the test getting clever.',
    args: [
      SLUG,
      {
        token: '[env]',
        required: false,
        detail:
          'Which environment to walk. Recon observes a real build, so the environment it names is recorded as the evidence source.',
      },
      {
        token: '[--with-api-recon]',
        required: false,
        detail:
          'Observe network behaviour during the same walk, instead of a second session that has to reproduce the state.',
      },
      {
        token: '[--spec <path-or-url>]',
        required: false,
        detail: 'The served API document to reconcile observed calls against.',
      },
      {
        token: '[--with-case-execution]',
        required: false,
        detail: 'Record per-step verdicts while walking, so recon doubles as an execution pass.',
      },
      {
        token: '[--tc <id,id,...>]',
        required: false,
        detail: 'Limit to named cases rather than the whole approved scope.',
      },
      {
        token: '[--role <role>]',
        required: false,
        detail:
          'Which role to sign in as. What a screen exposes usually differs by permission, so the inventory is only valid for the role that produced it.',
      },
      {
        token: '[--continue-on-failure]',
        required: false,
        detail:
          'Keep going past a failing case to gather the rest. Stop instead if the failure corrupts shared state.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Walked the bin pareto screen and found one problem: the results table had no stable handle, so a test could only reach it by describing its styling. It went to the dev track and was fixed in the app as a test handle, rather than worked around in the test.',
    },
    example:
      '/yw:ui-recon bin-pareto-export local --with-api-recon --spec http://127.0.0.1:5000/openapi.json',
    agents: 'ui-recon-agent',
  },
  {
    command: '/yw:api-recon <feature-slug> [env] [--spec <path-or-url>] [--capture-ui]',
    title: 'Reconcile the API surface',
    purpose:
      'Looks at what the server actually offers — the addresses, the inputs, the responses — and writes it down, so tests are built against reality rather than a document that has drifted.',
    args: [
      SLUG,
      {
        token: '[env]',
        required: false,
        detail:
          'Which environment to observe. The inventory records it, because an endpoint present in one environment may not exist in another.',
      },
      {
        token: '[--spec <path-or-url>]',
        required: false,
        detail:
          'The OpenAPI document. Swagger alone is input to recon, never a substitute for checking what the service actually returns.',
      },
      {
        token: '[--capture-ui]',
        required: false,
        detail:
          'Drive the interface to provoke the calls, when an operation is hard to exercise directly.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        "Confirmed the new download address appears in the app's published API document alongside the report it mirrors, and that it answers correctly when a wafer is missing, the options are wrong, or nobody is signed in.",
      sample:
        '/api/reports/wafers/{waferSequence}/bin-pareto\n/api/reports/wafers/{waferSequence}/bin-pareto.csv\n\nunknown wafer 404   bad option 400   no sign-in 401',
    },
    example: '/yw:api-recon bin-pareto-export local --spec http://127.0.0.1:5000/openapi.json',
  },
  {
    command: '/yw:desktop-recon <feature-slug> [--build <id>] [--category CAT-NN]',
    title: 'Recon the desktop application',
    purpose:
      'The same reconnaissance as the web version, for the Windows desktop application, and reports the controls the developers still need to name.',
    args: [
      SLUG,
      {
        token: '[--build <id>]',
        required: false,
        detail:
          'Which desktop build was walked. Recorded, because the inventory is only true of that build.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail: "Walk one category's screens rather than the whole feature.",
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not applicable — this feature is a web screen, and this machine has no Windows desktop build to walk.',
    },
    example: '/yw:desktop-recon bin-pareto --build 2026.8.1',
    agents: 'desktop-recon-agent',
  },
  {
    command:
      '/yw:execute-cases <feature-slug> [env] [--tc <id,id,...>] [--role <role>] [--continue-on-failure]',
    title: 'Execute and preserve evidence',
    purpose:
      'Runs approved cases by hand and records what happened, step by step. Used before automation exists, or for the cases that will always need a person.',
    args: [
      SLUG,
      {
        token: '[env]',
        required: false,
        detail:
          'Which environment to execute against. It is recorded with the verdicts, because a pass on one environment is not a pass on another.',
      },
      {
        token: '[--tc <id,id,...>]',
        required: false,
        detail:
          'Run named cases only, rather than the whole approved set — for re-running just what failed.',
      },
      {
        token: '[--role <role>]',
        required: false,
        detail:
          'Execute as this role. A case whose expected result depends on permission must be run as the role it was written for.',
      },
      {
        token: '[--continue-on-failure]',
        required: false,
        detail:
          'Keep executing after a failure. Never use it after failed cleanup — the next case then starts from corrupted state and its verdict means nothing.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Skipped because all four cases were automatable and were automated the same day. On a feature with cases a machine cannot judge — anything about how something looks or feels — this is where those get run.',
    },
    example: '/yw:execute-cases bin-pareto-export local --continue-on-failure',
  },
  {
    command: '/yw:log-exploratory <feature-slug>',
    title: 'Record exploratory work',
    purpose:
      'Records what you found while poking around without a script. Unplanned exploration finds things planned cases never will, and this keeps that from being lost.',
    args: [SLUG],
    outcome: {
      ran: false,
      detail:
        "Not run. The exploration that did happen went into recon and the design instead, so nothing was lost here — but on a bigger feature this is where a tester's hunch gets written down.",
    },
    example: '/yw:log-exploratory bin-pareto-export',
  },
  {
    command: '/yw:forge-oracle <feature-slug>',
    title: 'Build the independent oracle',
    purpose:
      'Works out the right answer independently of the code, so a test can tell correct from merely consistent. Without one, a test only proves the code agrees with itself.',
    args: [SLUG],
    outcome: {
      ran: false,
      detail:
        'Not needed as its own step: the screen is already an independent answer. Every test compares the saved file against the table on the page, which is calculated by a different path from the file.',
    },
    example: '/yw:forge-oracle bin-pareto-export',
  },
  {
    command:
      '/yw:forge-scripts <feature-slug> [--scenario-type positive|functional|negative|edge|all] [--category CAT-NN] [--ac AC-NN] [--tc TC-id]',
    title: 'Automate the web cases',
    purpose:
      'Turns approved cases into automation that actually runs. It only automates cases a human has already approved, so the automation can never quietly become the definition of what is correct.',
    args: [
      SLUG,
      {
        token: '[--scenario-type positive|functional|negative|edge|all]',
        required: false,
        detail:
          'Automate one kind of scenario this cycle. The work set is your selector intersected with the approved automate-now set — a selector can narrow it, never widen it.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail:
          'Automate one category — one category is one feature file, so this keeps a cycle to a reviewable slice.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail: 'Automate the scenarios covering one criterion.',
      },
      {
        token: '[--tc TC-id]',
        required: false,
        detail:
          'Automate one named case. Useful for finishing a straggler without reopening the whole category.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Automated all four scenarios. The screen is what each test compares against — it reads the table the engineer is looking at, then downloads the file and checks the two agree. Building the expected file with the same code the app uses would produce a test that cannot fail.',
      sample:
        "Then('the rows are in the same order as the screen', ({ scenarioState }) => {\n  const fileBins = savedFile(scenarioState).rows.map((row) => row[0]);\n  const screenBins = shownRows(scenarioState).map((row) => row.binNumber);\n  expect(fileBins).toEqual(screenBins);\n});",
      path: 'steps/bin-pareto-export.steps.ts',
    },
    example: '/yw:forge-scripts bin-pareto-export --scenario-type functional',
    agents: 'e2e-scripter · plotly-specialist when charts are in scope',
  },
  {
    command: '/yw:forge-desktop-scripts <feature-slug> [--category CAT-NN] [--tc TC-id]',
    title: 'Automate the desktop cases',
    purpose:
      'Automates the desktop application from the same approved cases, so one written case can drive both the web and the desktop.',
    args: [
      SLUG,
      {
        token: '[--category CAT-NN]',
        required: false,
        detail: 'Automate one category of desktop-tagged scenarios.',
      },
      {
        token: '[--tc TC-id]',
        required: false,
        detail:
          'Automate one named desktop case. Selection is always on the desktop surface tag, never on a test level.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not applicable — no desktop application is involved, and the tool it drives needs a Windows machine with a logged-in session.',
    },
    example: '/yw:forge-desktop-scripts bin-pareto --category CAT-02',
    agents: 'testcomplete-scripter',
  },
  {
    command:
      '/yw:forge-api-tests <feature-slug> [--stack <profile-name>] [--tc TC-id] [--operation operation-id] [--layer contract|integration|ui-interception|fuzz|all]',
    title: 'Automate the API cases',
    purpose:
      'Tests the server directly, without a browser. Faster and steadier than driving the screen, and it catches things the screen hides.',
    args: [
      SLUG,
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail: "Which stack's client and test framework to build against.",
      },
      {
        token: '[--tc TC-id]',
        required: false,
        detail: 'Implement one approved case rather than the whole set.',
      },
      {
        token: '[--operation operation-id]',
        required: false,
        detail:
          'Target one API operation from the recon inventory, instead of every operation the feature touches.',
      },
      {
        token: '[--layer contract|integration|ui-interception|fuzz|all]',
        required: false,
        detail:
          'Contract checks status, headers and schema; integration checks business state; ui-interception checks request-driven interface behaviour; fuzz generates cases from the schema.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not run as a step. The server behaviour was checked directly during the build — the file matches the report row for row, and missing wafers, bad options and missing sign-ins all answer correctly — but that was a one-off check, not a test that will run again tomorrow.',
    },
    example: '/yw:forge-api-tests bin-pareto-export --layer contract',
  },
  {
    command:
      '/yw:forge-performance-tests <feature-slug> [--stack <profile-name>] [--profile smoke|load|spike|stress|endurance] [--operation operation-id]',
    title: 'Automate the workload',
    purpose:
      'Measures whether it is fast enough under load, against a target the requirement actually states rather than a number someone picked.',
    args: [
      SLUG,
      {
        token: '[--stack <profile-name>]',
        required: false,
        detail:
          'Which stack the workload runs against — it decides the client, the base URL convention, and how the run is launched.',
      },
      {
        token: '[--profile smoke|load|spike|stress|endurance]',
        required: false,
        detail:
          'Smoke proves the script is correct; load is expected traffic; spike a sudden surge; stress finds the breaking point; endurance finds leaks. Pick the smallest that answers your question.',
      },
      {
        token: '[--operation operation-id]',
        required: false,
        detail:
          'Which API operation the workload drives. Without it the skill covers every operation the requirement sets an objective for.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'No performance target to test against: the PRD sets none, and its one open question about size limits was answered "no limit for now". Inventing a number here would test an opinion rather than a requirement.',
    },
    example: '/yw:forge-performance-tests bin-pareto-export --profile smoke',
  },
  {
    command:
      '/yw:scan-security <scope> [--verbs deps-scan,sast,baseline-scan,api-scan,fuzz] [--target <url> --authorize] [--env <name>]',
    title: 'Run and triage the scanners',
    purpose:
      'Runs security scanners across the code and the running app, sorts real findings from noise, and turns confirmed ones into bugs.',
    args: [
      {
        token: '<scope>',
        required: true,
        detail:
          'The feature or area to scan. It names the report and scopes which findings are considered in-scope for triage.',
      },
      {
        token: '[--verbs deps-scan,sast,baseline-scan,api-scan,fuzz]',
        required: false,
        detail:
          'deps-scan and sast read the repository and are safe to run always. baseline-scan, api-scan and fuzz reach a running target.',
      },
      {
        token: '[--target <url> --authorize]',
        required: false,
        detail:
          'Required together for any active scan. Without both, the skill refuses — an active scan sends attack traffic, so it is never assumed to be fine.',
      },
      {
        token: '[--env <name>]',
        required: false,
        detail:
          'Which environment. A shared environment is refused outright; production needs an approved window stated in the request.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Cannot run here — none of the scanners it drives are installed on this machine, and installing them is your decision rather than one to make silently.',
    },
    example: '/yw:scan-security bin-pareto-export --verbs deps-scan,sast',
    agents: 'security-analyst',
  },
  {
    command:
      '/yw:audit-scripts <feature-slug> [branch] [--scenario-type positive|functional|negative|edge|all] [--category CAT-NN] [--ac AC-NN] [--tc TC-id]',
    title: 'Review the automation (advisory)',
    purpose:
      'Checks the automation itself, looking for tests that pass no matter what. A test that cannot fail is worse than no test, because it reports safety that was never checked.',
    args: [
      SLUG,
      {
        token: '[branch]',
        required: false,
        detail: 'Which branch to review. Defaults to the current one.',
      },
      {
        token: '[--scenario-type positive|functional|negative|edge|all]',
        required: false,
        detail: 'Narrow to one kind of scenario. This is the scenario tag, not the test level.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail: 'Narrow to one testable category — one category is one feature file.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail: 'Narrow to the scenarios covering one acceptance criterion.',
      },
      {
        token: '[--tc TC-id]',
        required: false,
        detail:
          'Narrow to one named case. Any of these four selectors scopes the review, and a scoped review states exactly which cases it covered so nobody reads it as feature-wide.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'Proved the four scenarios can fail. Reversing the row order failed the two that check order; removing an option line failed the one that checks options; dropping a column failed the one that checks each row. Restoring the code turned all four green again. Without that, four green ticks prove only that four tests ran.',
    },
    example: '/yw:audit-scripts bin-pareto-export',
    agents: 'script-auditor',
  },
  {
    command:
      '/yw:green-run <feature-slug> [branch] [--scenario-type positive|functional|negative|edge|all] [--category CAT-NN] [--ac AC-NN] [--tc TC-id]',
    title: 'Prove repeatability',
    purpose:
      'Runs the suite and records the result as evidence. A feature is only counted as stable once it passes three times in a row, because a single green run can be luck.',
    args: [
      SLUG,
      {
        token: '[branch]',
        required: false,
        detail:
          'Which branch to run. Defaults to the current one; the branch is recorded with the evidence so a streak cannot be assembled from different branches.',
      },
      {
        token: '[--scenario-type positive|functional|negative|edge|all]',
        required: false,
        detail: 'Narrow to one kind of scenario. This is the scenario tag, not the test level.',
      },
      {
        token: '[--category CAT-NN]',
        required: false,
        detail: 'Narrow to one testable category — one category is one feature file.',
      },
      {
        token: '[--ac AC-NN]',
        required: false,
        detail: 'Narrow to the scenarios covering one acceptance criterion.',
      },
      {
        token: '[--tc TC-id]',
        required: false,
        detail:
          'Narrow to one named case. Any of these four selectors runs a subset — useful iteration evidence, labelled as such. A subset never stands in for the feature, and only full runs count towards a stability streak.',
      },
    ],
    outcome: {
      ran: true,
      detail:
        'One green run recorded: 4 scenarios for this feature, and 11 across the whole suite with 31 app tests alongside. That is one of the three consecutive runs a stability streak needs, so this feature is not stable yet — and the ledger says so rather than rounding up.',
      sample:
        '4 passed (4.1s)      this feature\n11 passed (8.8s)     whole browser suite\n31 pass, 0 fail      app tests\n\nstreak: 1 of 3',
    },
    example: '/yw:green-run bin-pareto-export',
    agents: 'flake-hunter on a failure',
  },
  {
    command: '/yw:gate-merge <feature-slug>',
    title: 'Assemble the Merge Gate digest',
    purpose:
      'The same kind of human decision as the design gate, taken before the work merges. It gathers what happened — coverage, runs, reviews — and a person decides.',
    args: [SLUG],
    outcome: {
      ran: false,
      detail:
        'Not reached. It needs the three-run stability streak, and only one run has been recorded so far.',
    },
    example: '/yw:gate-merge bin-pareto-export',
  },
  {
    command: '/yw:testops-promote <feature-slug>',
    title: 'Promote into CI',
    purpose:
      'Moves proven automation into the scheduled runs, so it keeps checking the product after everyone has moved on.',
    args: [SLUG],
    outcome: {
      ran: false,
      detail:
        'Not reached — promotion follows the merge gate, and that is waiting on the stability streak.',
    },
    example: '/yw:testops-promote bin-pareto-export',
    agents: 'testops-engineer',
  },
  {
    command: '/yw:gate-ops <feature-slug> [N-runs]',
    title: 'Assemble the Ops Gate digest',
    purpose: 'The last human decision: is this good enough to keep running unattended.',
    args: [
      SLUG,
      {
        token: '[N-runs]',
        required: false,
        detail:
          'How many consecutive pipeline runs form the evidence window. Defaults to 5 — raise it for a suite you have reason to distrust.',
      },
    ],
    outcome: {
      ran: false,
      detail:
        'Not reached. It is the last of the three human decisions, and the first one has not been taken yet — which is what the example is really showing: the machine can carry work a long way, and then it waits.',
    },
    example: '/yw:gate-ops bin-pareto-export 5',
  },
  ...crossSteps,
];

function initialSection(value: string | null): GuideSection {
  return value && validSections.has(value as GuideSection) ? (value as GuideSection) : 'start';
}

export function ProbeGuidePage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = initialSection(searchParams.get('section'));
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (id: string): void => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Card>
        <CardHead
          kicker="Interactive handbook"
          title="PROBE Lab guide"
          subtitle="From first install to a complete Dev or QA practice run. Progress is kept for this page session only."
        />
        <CardBody>
          <nav className="guide-tabs" aria-label="PROBE guide sections">
            {guideSections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                className={active === section.id ? 'guide-tab is-active' : 'guide-tab'}
                aria-current={active === section.id ? 'page' : undefined}
                onClick={() => setSearchParams({ section: section.id })}
              >
                <span className="guide-tab-number">{index + 1}</span>
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.hint}</small>
                </span>
              </button>
            ))}
          </nav>
        </CardBody>
      </Card>

      {active === 'start' ? <GettingStarted completed={completed} toggle={toggle} /> : null}
      {active === 'database' ? <DatabaseGuide completed={completed} toggle={toggle} /> : null}
      {active === 'plugins' ? <PluginIntroduction completed={completed} toggle={toggle} /> : null}
      {active === 'cowork' ? <CoworkGuide completed={completed} toggle={toggle} /> : null}
      {active === 'dev' ? (
        <TrackGuide kind="dev" steps={devSteps} completed={completed} toggle={toggle} />
      ) : null}
      {active === 'qa' ? (
        <TrackGuide kind="qa" steps={qaSteps} completed={completed} toggle={toggle} />
      ) : null}
    </>
  );
}

interface ChecklistProps {
  completed: Set<string>;
  toggle: (id: string) => void;
}

function GettingStarted({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="Install and run the lab"
        subtitle="Five steps from an empty folder to a running app. Everything is local and offline."
      />
      <CardBody>
        <div className="guide-callout-grid">
          <GuideCallout title="Before you start" icon="info">
            Node.js 22.18 or newer, npm, and Git. Check with <code>node -v</code> — an older Node
            fails during install rather than at runtime. Git LFS is needed only if you also clone
            the Knowledgebase, whose documents use it.
          </GuideCallout>
          <GuideCallout title="Where it runs" icon="target">
            Web app: <code>http://127.0.0.1:3000</code>
            <br />
            API: <code>http://127.0.0.1:5000</code>
            <br />
            OpenAPI document: <code>/openapi.json</code>
          </GuideCallout>
        </div>

        <p className="guide-arg-label">Step 1 — Get the repository</p>
        <CommandBlock
          command={
            'git clone https://github.com/tafseer-yw/yieldWerx-probe-lab.git\ncd yieldWerx-probe-lab'
          }
          compact
        />

        <p className="guide-arg-label">Step 2 — Install dependencies</p>
        <CommandBlock command="npm install" compact />
        <p className="guide-note">
          One command covers both packages. This repository holds two: the test framework at the
          root, and the app under <code>probe-lab-app/</code> with its own dependencies. The root
          install finishes by installing the app&rsquo;s as well.
        </p>

        <p className="guide-arg-label">Step 3 — Install the browser Playwright drives</p>
        <CommandBlock command="npx playwright install chromium" compact />
        <p className="guide-note">
          Separate from <code>npm install</code> on purpose — this downloads a browser binary, not
          an npm package. Skip it and the suite fails on its first scenario.
        </p>

        <p className="guide-arg-label">Step 4 — Start the lab</p>
        <CommandBlock command="npm run app:dev" compact />
        <p className="guide-note">
          Seeds the database, then runs the API and the web app together. Leave it running and use a
          second terminal for everything else.
        </p>

        <p className="guide-arg-label">Step 5 — Confirm the install is complete</p>
        <CommandBlock command={'node scripts/ensure-deps.mjs --check\nnpm test'} compact />
        <p className="guide-note">
          The first prints nothing and exits <code>0</code> when every declared package is present,
          naming whatever is missing otherwise; it installs nothing, so it is safe to run any time.
          The second runs the app tests and the browser scenarios, starting the app itself if it is
          not already up.
        </p>

        <Alert tone="good">
          <strong>A missing dependency will not stop you.</strong> Every command in both packages
          checks its dependencies first and installs them if they are absent, so a fresh clone, a
          skipped install, or a <code>git pull</code> that added a package all repair themselves on
          the next command you run. The one exception is{' '}
          <code>npm run &lt;script&gt; --ignore-scripts</code>, which skips that check along with
          every other hook.
        </Alert>

        <Alert tone="info">
          Sign in with <code>dev / dev</code> or <code>qa / qa</code> for uploads, or{' '}
          <code>admin / admin</code> to manage sample wafers. These are local practice credentials
          only.
        </Alert>

        <p className="guide-arg-label">If something goes wrong</p>
        <dl className="guide-args">
          <div className="guide-arg">
            <dt>
              <code>tsx: command not found</code>
            </dt>
            <dd>
              The app&rsquo;s dependencies were never installed — usually an install that ran as{' '}
              <code>--omit=dev</code> or with <code>NODE_ENV=production</code>, which skips
              development dependencies, and tsx is one. Run the command again; it now installs them
              for you.
            </dd>
          </div>
          <div className="guide-arg">
            <dt>
              <code>EADDRINUSE</code> on 3000 or 5000
            </dt>
            <dd>
              An earlier run still holds the port. Find it with{' '}
              <code>netstat -ano | findstr :5000</code> on Windows, or <code>lsof -i :5000</code> on
              macOS and Linux, then stop that process.
            </dd>
          </div>
          <div className="guide-arg">
            <dt>The app starts but has no wafers</dt>
            <dd>
              The database seeded empty. Delete{' '}
              <code>probe-lab-app/data/practice-probe-db.sqlite*</code> and run{' '}
              <code>npm run app:dev</code> again to recreate and reseed it.
            </dd>
          </div>
          <div className="guide-arg">
            <dt>Playwright cannot find a browser</dt>
            <dd>
              Step 3 was skipped, or ran against a different Node installation. Rerun{' '}
              <code>npx playwright install chromium</code>.
            </dd>
          </div>
        </dl>

        <Checklist
          prefix="start"
          items={[
            'Confirm Node 22.18 or newer with node -v',
            'Clone the repository and enter it',
            'Run npm install',
            'Install the Playwright Chromium browser',
            'Start the app with npm run app:dev',
            'Open the dashboard and sign in',
            'Run npm test from a second terminal',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}

function PluginIntroduction({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="PROBE and Knowledgebase"
        subtitle="Two plugins, two responsibilities, installed in the same Claude environment."
      />
      <CardBody>
        <div className="guide-callout-grid">
          <GuideCallout title="yieldWerx PROBE" icon="check">
            Owns the Dev and QA workflows, evidence lifecycle, specialist agents, reviews, and
            gates.{' '}
            <ExternalLink href="https://github.com/tafseer-yw/yieldwerx-probe">
              Open GitHub repository
            </ExternalLink>
          </GuideCallout>
          <GuideCallout title="yieldWerx Knowledgebase" icon="file">
            Supplies source-traceable product and domain context. It explains terms but never
            replaces the approved requirement.{' '}
            <ExternalLink href="https://github.com/tafseer-yw/yieldwerx-knowledgebase">
              Open GitHub repository
            </ExternalLink>
          </GuideCallout>
        </div>
        <CommandBlock
          label="Clone PROBE"
          command="git clone https://github.com/tafseer-yw/yieldwerx-probe.git"
        />
        <CommandBlock
          label="Clone the Knowledgebase"
          command={
            'git lfs install\ngit clone https://github.com/tafseer-yw/yieldwerx-knowledgebase.git'
          }
        />
        <Alert tone="info">
          Cloning gives you local source for inspection and contribution. It does not install the
          plugins into Claude; complete the Claude & Cowork section next.
        </Alert>
        <Checklist
          prefix="plugins"
          items={[
            'Read the PROBE repository overview',
            'Install Git LFS',
            'Clone both repositories as sibling folders',
            'Keep requirements separate from Knowledgebase context',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}

function CoworkGuide({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="Install in Claude Desktop and use in Cowork"
        subtitle="Plugins work in Claude chat and Cowork; specialist sub-agents run in Cowork."
      />
      <CardBody>
        <Alert tone="info">
          Claude plugins require a paid plan. On Team or Enterprise, your organization must also
          allow Cowork and Skills, and an admin may manage which plugins are available.
        </Alert>
        <ol className="guide-steps">
          <li>
            Open the latest Claude Desktop, switch to <strong>Cowork</strong>, then open{' '}
            <strong>Customize → Plugins</strong>.
          </li>
          <li>
            Under Personal plugins, select{' '}
            <strong>+ → Add marketplace → Add from a repository</strong>.
          </li>
          <li>
            Add both GitHub repository URLs shown below and install <strong>yieldWerx PROBE</strong>{' '}
            plus <strong>yieldWerx Knowledgebase</strong>.
          </li>
          <li>
            Start a Cowork task, grant access only to the local repository folder you intend to
            practice in, and review the proposed plan.
          </li>
          <li>
            Type <strong>/</strong> or use the <strong>+</strong> menu, choose a <code>/yw:*</code>{' '}
            skill, then provide its arguments.
          </li>
        </ol>
        <CommandBlock
          label="Marketplace repositories"
          command={
            'https://github.com/tafseer-yw/yieldwerx-probe.git\nhttps://github.com/tafseer-yw/yieldwerx-knowledgebase.git'
          }
        />
        <CommandBlock
          label="Claude Code alternative"
          command={
            '/plugin marketplace add https://github.com/tafseer-yw/yieldwerx-probe.git\n/plugin marketplace add https://github.com/tafseer-yw/yieldwerx-knowledgebase.git\n/plugin install yieldwerx-knowledgebase@yieldwerx-company\n/plugin install yw@yieldwerx\n/reload-plugins'
          }
        />
        <GuideCallout title="How skills and agents differ" icon="info">
          You invoke public skills such as <code>/yw:build-feature</code> or{' '}
          <code>/yw:forge-cases</code>. Those skills delegate bounded work to their specialist
          agents. Do not treat internal agent names as slash commands.
        </GuideCallout>
        <p className="guide-links">
          <ExternalLink href="https://support.claude.com/en/articles/13837440-use-plugins-in-claude">
            Anthropic plugin instructions
          </ExternalLink>
          <ExternalLink href="https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork">
            Anthropic Cowork guide
          </ExternalLink>
        </p>
        <Checklist
          prefix="cowork"
          items={[
            'Open Cowork in Claude Desktop',
            'Add both marketplaces',
            'Install both plugins',
            'Connect the PROBE Lab folder',
            'Open the slash menu and verify /yw skills appear',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}

/**
 * What `--stack` selects. Dev-track skills read their layer names, conventions,
 * commands and traps from the chosen profile — which is why one skill produces a
 * SQL Server changeset on one stack and an EF Core migration on another, with no
 * second skill existing.
 */
function StackGuide(): ReactElement {
  return (
    <section className="guide-stacks" aria-labelledby="guide-stacks-title">
      <h3 id="guide-stacks-title">The stacks a dev skill can target</h3>
      <p className="guide-stacks-lead">
        Every dev skill accepts <code>--stack</code>. It is not decoration: it decides which layers
        the design maps onto, which commands run, and which traps the skill watches for. Omit it and
        the first stack in <code>probe.config.yaml</code> is used; name one that is not configured
        and the skill stops rather than guessing.
      </p>
      <div className="guide-stack-grid">
        {stackProfiles.map((stack) => (
          <article className="guide-stack" key={stack.id}>
            <header>
              <code>{stack.id}</code>
              <span className={`guide-stack-status is-${stack.status}`}>
                {stack.status === 'current'
                  ? 'dev track'
                  : stack.status === 'provisional'
                    ? 'provisional'
                    : 'QA track'}
              </span>
            </header>
            <h4>{stack.name}</h4>
            <p>{stack.what}</p>
            <p className="guide-stack-layers">
              <strong>Layers:</strong> {stack.layers}
            </p>
            <p className="guide-stack-when">
              <strong>Reach for it when:</strong> {stack.useWhen}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TrackGuide({
  kind,
  steps,
  completed,
  toggle,
}: ChecklistProps & { kind: 'dev' | 'qa'; steps: TrackStep[] }): ReactElement {
  const isDev = kind === 'dev';
  return (
    <Card>
      <CardHead
        kicker="Focused practice page"
        title={isDev ? 'Dev track' : 'QA track'}
        subtitle={
          isDev
            ? 'Build and correct the application without waiting on QA gates.'
            : 'Turn approved requirements into reviewed cases, automation, and durable evidence.'
        }
        actions={<Badge tone={isDev ? 'accent' : 'good'}>{steps.length} stages</Badge>}
      />
      <CardBody>
        <Alert tone="info">
          {isDev
            ? 'QA artifacts are optional enrichment for Dev skills, never a precondition. Dev skills do not edit QA-owned artifacts.'
            : 'QA observes the build but does not edit application code. Human reviewers own gate approvals and scoped bypass decisions.'}
        </Alert>
        <WorkedExampleNote />
        {isDev ? <StackGuide /> : null}
        <Alert>
          <strong>Practice target — Wafer triage:</strong>{' '}
          {isDev
            ? 'Trace the shared DTO, documented endpoint, weighted matcher, and standalone triage UI; preserve the insufficient-data and no-close-match safeguards.'
            : 'Exercise exact reference matches, the unfamiliar 25-die no-close case, and fewer than three failures; verify the score is never presented as confidence or diagnosis.'}
        </Alert>
        <div className="guide-track-list">
          {steps.map((step, index) => {
            const id = `${kind}-${index}`;
            return (
              <article
                className={completed.has(id) ? 'guide-track-step is-complete' : 'guide-track-step'}
                key={step.command}
              >
                <label className="guide-step-check">
                  <input type="checkbox" checked={completed.has(id)} onChange={() => toggle(id)} />
                  <span>{index + 1}</span>
                </label>
                <div className="guide-track-copy">
                  <h3>
                    {step.title}
                    {step.shared ? <span className="guide-shared-tag">both tracks</span> : null}
                  </h3>
                  <p>{step.purpose}</p>
                  <p className="guide-arg-label">Signature</p>
                  <CommandBlock command={step.command} compact />
                  <p className="guide-arg-label">What each argument does</p>
                  <dl className="guide-args">
                    {step.args.map((arg) => (
                      <div className="guide-arg" key={arg.token}>
                        <dt>
                          <code>{arg.token}</code>
                          <span className={arg.required ? 'guide-arg-req' : 'guide-arg-opt'}>
                            {arg.required ? 'required' : 'optional'}
                          </span>
                        </dt>
                        <dd>{arg.detail}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="guide-arg-label">Example</p>
                  <CommandBlock command={step.example} compact />
                  {step.outcome ? <StepOutcomeBlock outcome={step.outcome} /> : null}
                  {step.agents ? (
                    <p className="guide-agent">
                      <strong>Delegates to:</strong> {step.agents}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function Checklist({
  prefix,
  items,
  completed,
  toggle,
}: ChecklistProps & { prefix: string; items: string[] }): ReactElement {
  const count = items.filter((_, index) => completed.has(`${prefix}-${index}`)).length;
  return (
    <section className="guide-checklist" aria-labelledby={`${prefix}-checklist`}>
      <div className="guide-checklist-head">
        <h3 id={`${prefix}-checklist`}>Your checklist</h3>
        <Badge tone={count === items.length ? 'good' : 'neutral'}>
          {count} / {items.length}
        </Badge>
      </div>
      <div
        className="guide-progress"
        role="progressbar"
        aria-label={`${count} of ${items.length} complete`}
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={count}
      >
        <span style={{ width: `${items.length === 0 ? 0 : (count / items.length) * 100}%` }} />
      </div>
      {items.map((item, index) => {
        const id = `${prefix}-${index}`;
        return (
          <label className="guide-check" key={id}>
            <input type="checkbox" checked={completed.has(id)} onChange={() => toggle(id)} />
            <span>{item}</span>
          </label>
        );
      })}
    </section>
  );
}

/**
 * What the skill produced on the worked example. Kept visually quieter than the
 * signature above it: it is evidence that the step is real, not the reference a
 * reader came for.
 */
/**
 * Explains the example blocks once, at the top of each track, so a reader knows
 * what they are looking at before they meet the first one.
 */
function WorkedExampleNote(): ReactElement {
  return (
    <Alert tone="good">
      <strong>Every skill below shows what it actually did.</strong> Both tracks were run end to end
      on one small feature of this app — a <em>Download CSV</em> button on the Bin pareto screen —
      and each skill carries the real thing it produced, from the written requirement through to
      four passing automated tests. Where a skill had nothing to do for a feature this size, or
      cannot run on a laptop, it says so and says why. Nothing below is made up to fill a gap.
    </Alert>
  );
}

function StepOutcomeBlock({ outcome }: { outcome: StepOutcome }): ReactElement {
  /*
   * Markdown excerpts open rendered, because that is how anyone actually reads
   * a PRD or a spec analysis. The source stays one click away, since it is what
   * the skill really writes and what the reader will open in their editor.
   */
  const [showSource, setShowSource] = useState(false);
  const isMarkdown = outcome.format === 'markdown' && outcome.sample !== undefined;

  return (
    <div
      className={outcome.ran ? 'guide-outcome' : 'guide-outcome is-skipped'}
      data-testid="step-outcome"
    >
      <div className="guide-outcome-head">
        <p className="guide-outcome-label">
          {outcome.ran ? 'What it produced here' : 'Not exercised by this example'}
        </p>
        {isMarkdown ? (
          <div className="guide-view-toggle" role="group" aria-label="How to show this excerpt">
            <button
              type="button"
              className={showSource ? '' : 'is-active'}
              aria-pressed={!showSource}
              onClick={() => setShowSource(false)}
            >
              Preview
            </button>
            <button
              type="button"
              className={showSource ? 'is-active' : ''}
              aria-pressed={showSource}
              onClick={() => setShowSource(true)}
            >
              Markdown
            </button>
          </div>
        ) : null}
      </div>
      <p className="guide-outcome-detail">{outcome.detail}</p>
      {outcome.sample ? (
        isMarkdown && !showSource ? (
          <div className="guide-outcome-preview" data-testid="outcome-preview">
            <MarkdownPreview source={outcome.sample} />
          </div>
        ) : (
          <pre className="guide-outcome-sample" data-testid="outcome-source">
            {outcome.sample}
          </pre>
        )
      ) : null}
      {outcome.path ? <p className="guide-outcome-path">{outcome.path}</p> : null}
    </div>
  );
}

function CommandBlock({
  label,
  command,
  compact = false,
}: {
  label?: string;
  command: string;
  compact?: boolean;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={compact ? 'guide-command is-compact' : 'guide-command'}>
      {label ? <span className="guide-command-label">{label}</span> : null}
      <pre>
        <code>{command}</code>
      </pre>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => void copy()}
        aria-label={`Copy ${label ?? 'command'}`}
      >
        <Icon name={copied ? 'check' : 'clipboard'} size={14} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function GuideCallout({
  title,
  icon,
  children,
}: {
  title: string;
  icon: 'check' | 'file' | 'info' | 'target';
  children: ReactNode;
}): ReactElement {
  return (
    <section className="guide-callout">
      <span className="guide-callout-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </section>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a className="guide-external" href={href} target="_blank" rel="noreferrer">
      {children}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

function DatabaseGuide({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="The practice database"
        subtitle="One SQLite file, created by the seed script and reached only through the store layer."
      />
      <CardBody>
        <div className="guide-callout-grid">
          <GuideCallout title="Where the file lives" icon="target">
            <code>probe-lab-app/data/practice-probe-db.sqlite</code>, in WAL mode, so a{' '}
            <code>-wal</code> and a <code>-shm</code> file sit beside it. The whole{' '}
            <code>data/</code> folder is gitignored, so the database is never committed. Point{' '}
            <code>YW_DB_PATH</code> somewhere else to move it.
          </GuideCallout>
          <GuideCallout title="How the code reaches it" icon="file">
            <code>better-sqlite3</code>, synchronously, with no ORM and no query builder. Every
            statement lives behind the <code>ApplicationStore</code> interface in{' '}
            <code>api/src/store.ts</code>. Route modules are handed a store and never open a
            connection themselves.
          </GuideCallout>
          <GuideCallout title="Why it is boxed in" icon="info">
            SQLite stands in for the real application&apos;s SQL Server. Because{' '}
            <code>store.ts</code> is the only module that imports the driver, changing engine is a
            one-file change and the routes never notice.
          </GuideCallout>
        </div>

        <h3>Where it lives in code</h3>
        <ul className="guide-steps">
          <li>
            <code>database/schema.sql</code> — the whole schema: ten tables and five indexes. Every
            statement is <code>CREATE ... IF NOT EXISTS</code>, so re-applying it is safe.
          </li>
          <li>
            <code>scripts/setup.ts</code> — run by <code>npm run setup</code>. Creates the file,
            applies the schema, then seeds the reference data and the four practice users.
          </li>
          <li>
            <code>api/src/store.ts</code> — <code>ApplicationStore</code> is the contract,{' '}
            <code>SqliteApplicationStore</code> the implementation. It sets{' '}
            <code>journal_mode = WAL</code> and <code>foreign_keys = ON</code>, and runs a small
            idempotent migration so a database made before a column existed still opens.
          </li>
          <li>
            <code>api/src/app.ts</code> — builds one store per process and passes it to every route
            module.
          </li>
          <li>
            <code>api/src/config.ts</code> — reads <code>YW_DB_PATH</code>, defaulting to{' '}
            <code>./data/practice-probe-db.sqlite</code>.
          </li>
        </ul>

        <h3>What the tables hold</h3>
        <ul className="guide-steps">
          <li>
            <strong>Seeded reference data</strong> — <code>app_user</code>, <code>facility</code>,{' '}
            <code>work_center</code>, <code>device</code>, <code>test_program</code>. These exist
            before you do anything and are never created by an upload.
          </li>
          <li>
            <strong>Created only by an upload</strong> — <code>lot</code>, <code>upload</code>,{' '}
            <code>wafer</code>, <code>die</code>, <code>upload_error</code>. A freshly seeded
            database holds no wafers at all.
          </li>
          <li>
            <code>wafer</code> carries <code>part_count</code>, <code>pass_count</code> and{' '}
            <code>yield</code>. <code>die</code> carries one row per die, with <code>x</code>,{' '}
            <code>y</code>, <code>hard_bin</code>, <code>soft_bin</code> and{' '}
            <code>pass_fail_flag</code>.
          </li>
          <li>
            <code>upload</code> keeps the original bytes and their SHA-256 next to the row counts,
            so any parse result can be traced back to the exact file that produced it.
          </li>
        </ul>

        <Alert tone="info">
          Cluster detection and bin pareto are computed per request and never stored, so{' '}
          <code>die</code> is the independent truth when you check a calculated result. Count the
          die rows yourself rather than trusting the number the screen just rendered.
        </Alert>

        <CommandBlock
          label="Re-seed after deleting data/practice-probe-db.sqlite*"
          command="npm run setup --prefix probe-lab-app"
        />

        <Checklist
          prefix="database"
          items={[
            'Find data/practice-probe-db.sqlite after the first run',
            'Read database/schema.sql end to end',
            'Trace one API route down to its store method',
            'Re-seed the database from scratch',
            'Check a wafer yield against its die rows',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}
