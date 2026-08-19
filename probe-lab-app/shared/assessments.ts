/*
 * The PROBE assessment catalogue: 15 self-paced assessments per track, ordered
 * from first skills to a capstone, plus the scoring rules that turn recorded
 * results into points and levels.
 *
 * WHY THIS LIVES IN shared/: the API validates ids and computes scores from it,
 * and the web renders it — one source, so the two can never disagree about what
 * an assessment is worth.
 *
 * The build targets referenced by dev-track assessments were chosen from what
 * this app actually has and lacks: it stores lots but has no per-lot report, it
 * lets an admin load and delete data with no audit trail, it accepts a CSV that
 * lists the same die twice and keeps the last row silently, and it has no way
 * to compare two wafers. Each of those gaps is a real, scoped module a
 * developer can build here without inventing context.
 *
 * SCORING. Passing an assessment adds its points; failing one subtracts half
 * its points (rounded up) for as long as the failure stands; the total never
 * goes below zero. Re-recording replaces the previous result, so a later pass
 * recovers the ground — the penalty is for unaddressed failure, not for having
 * tried. Results are self-recorded on the honor system, the same way a PROBE
 * gate records a human's statement: the record is the person's word, and the
 * page says so rather than pretending to verify it.
 */

export type AssessmentTrack = 'dev' | 'qa';

export type AssessmentEffort = 'starter' | 'core' | 'advanced' | 'expert';

/** What each result state is worth. Fail penalty: half points, rounded up. */
export const EFFORT_POINTS: Record<AssessmentEffort, number> = {
  starter: 10,
  core: 20,
  advanced: 35,
  expert: 60,
};

/** Rough honest time expectation, shown so people can plan a session. */
export const EFFORT_TIME: Record<AssessmentEffort, string> = {
  starter: 'about an hour',
  core: 'half a day',
  advanced: 'a day',
  expert: 'two to three days',
};

export interface Assessment {
  /** Stable id — recorded results reference it, so it never changes. */
  id: string;
  track: AssessmentTrack;
  /** 1-based position within its track, first skills first. */
  order: number;
  title: string;
  effort: AssessmentEffort;
  /** The /yw: skills this assessment exercises. */
  skills: string[];
  /** What to do, in plain words. */
  mission: string;
  /** Concrete checks — pass means every one of these is true. */
  passWhen: string[];
}

export type AssessmentOutcome = 'passed' | 'failed';

export const assessmentCatalogue: Assessment[] = [
  /* ------------------------------- DEV TRACK ------------------------------ */
  {
    id: 'dev-01',
    track: 'dev',
    order: 1,
    title: 'Read a requirement with Spec Probe',
    effort: 'starter',
    skills: ['/yw:probe-spec'],
    mission:
      'Run Spec Probe on the wafer-upload requirements in docs/PRDs and produce the spec analysis both tracks would start from. The point is to see a requirement turned into numbered, checkable statements before any code or cases exist.',
    passWhen: [
      'spec-analysis.md exists with acceptance criteria carrying stable AC ids',
      'Every criterion has an "In plain words" line a newcomer can follow',
      'The Terms table lists every product label exactly as the app writes it',
      'The spec validator reports no errors',
    ],
  },
  {
    id: 'dev-02',
    track: 'dev',
    order: 2,
    title: 'Write a PRD people can disagree with',
    effort: 'starter',
    skills: ['/yw:forge-prd'],
    mission:
      'Write the PRD for "wafer notes": an engineer wants to pin a short note to a wafer so the next person knows what was already looked at. Keep every undecided detail as an open question with a recommended answer — do not settle product decisions yourself.',
    passWhen: [
      'prd-draft.md has at least two user stories with "Done means" bullets',
      'Open questions carry recommended answers and name who can decide',
      'No solution design leaks in — no endpoints, tables, or component names',
      'validate-prd passes',
    ],
  },
  {
    id: 'dev-03',
    track: 'dev',
    order: 3,
    title: 'Give the tests something to hold',
    effort: 'starter',
    skills: ['/yw:seed-testability'],
    mission:
      'Audit the upload history screen for controls a test can only reach by describing their styling, and add the missing stable handles. This is the developer half of the deal that keeps automation from being brittle.',
    passWhen: [
      'A written gap list names each control and why it is unreachable',
      'data-testid handles added where no semantic role exists',
      'Existing scenarios still green; lint still clean',
    ],
  },
  {
    id: 'dev-04',
    track: 'dev',
    order: 4,
    title: 'Design before you build',
    effort: 'core',
    skills: ['/yw:forge-tech-design'],
    mission:
      'Turn the wafer-notes PRD into a tech design: which layers change, the API shape, who may write a note, and what could go wrong. If the PRD left questions open, the design must say what it assumed rather than quietly choosing.',
    passWhen: [
      'Layer map covers route, storage, and screen with grounding notes',
      'Every claim about existing code is verified-in-code or marked proposed',
      'Open questions are carried as named assumptions, not silently answered',
      'One decision record explains the main trade-off',
    ],
  },
  {
    id: 'dev-05',
    track: 'dev',
    order: 5,
    title: 'A small backend change, end to end',
    effort: 'core',
    skills: ['/yw:build-feature'],
    mission:
      'Build GET /api/reports/lots — one row per lot with its wafer count and average yield. The app stores lots but offers no way to see them summarised; this closes that gap with a read-only endpoint built the way the sibling report routes are.',
    passWhen: [
      'The operation appears in the served openapi.json',
      'Auth matches the sibling report routes — signed out gets 401',
      'One lot checked by hand against its wafers, not against the code',
      'Typecheck, lint, and the app tests stay green',
    ],
  },
  {
    id: 'dev-06',
    track: 'dev',
    order: 6,
    title: 'Unit tests that can actually fail',
    effort: 'core',
    skills: ['/yw:forge-unit-tests'],
    mission:
      'Write unit tests for the wafer CSV parser around its awkward rows: a bin that is not a number, a die listed twice, a row with a missing column. Expected values must be worked out by hand — a test that derives its expectation from the code it checks cannot fail.',
    passWhen: [
      'At least six tests, each expectation written out by hand',
      'Edge rows covered: bad bin, duplicate coordinate, short row',
      'One deliberate mutation of the parser makes at least one test fail',
    ],
  },
  {
    id: 'dev-07',
    track: 'dev',
    order: 7,
    title: 'A screen that matches the house style',
    effort: 'core',
    skills: ['/yw:build-feature', '/yw:sync-styleguide'],
    mission:
      'Build the Lot summary screen on top of the endpoint from the previous assessment, using only the components and tokens the app already has. Then run the styleguide check and fix whatever it reports.',
    passWhen: [
      'The screen renders the lot report with the existing table and card styles',
      'No new colors, fonts, or one-off components invented',
      'Interactive elements carry semantic roles or data-testid handles',
      'The styleguide check reports no drift',
    ],
  },
  {
    id: 'dev-08',
    track: 'dev',
    order: 8,
    title: 'Review a real diff',
    effort: 'core',
    skills: ['/yw:review-code'],
    mission:
      'Review a teammate’s open branch (or your lot-summary work) with fresh eyes: check the code against what the requirement asked for, not just whether it runs. Every finding must point at a line and survive being checked.',
    passWhen: [
      'At least three concrete findings, each with file and line',
      'Each finding verified against the diff — no invented claims',
      'The requirement was read: at least one finding is about behaviour, not style',
    ],
  },
  {
    id: 'dev-09',
    track: 'dev',
    order: 9,
    title: 'Ship it so the next person understands why',
    effort: 'core',
    skills: ['/yw:ship-change', '/yw:review-pr'],
    mission:
      'Commit your lot-summary work with a message that explains why, open the pull request, and review a peer’s open PR as its reviewer — claims in the description checked against the diff, ending in a clear GO or NO-GO.',
    passWhen: [
      'Commit message explains the why, and what was verified',
      'PR body claims match what the diff actually does',
      'Your review of a peer’s PR states GO/NO-GO with evidence',
      'Nothing merged by the reviewer — merging is the owner’s call',
    ],
  },
  {
    id: 'dev-10',
    track: 'dev',
    order: 10,
    title: 'Change behaviour without breaking anyone',
    effort: 'advanced',
    skills: ['/yw:revise-feature'],
    mission:
      'The bin pareto "Custom" bins field accepts commas only; make it also accept spaces as separators. Every scenario that passed before must pass after, and the change must state out loud whether anything existing could break.',
    passWhen: [
      'New separator covered by hand-written unit tests',
      'Every pre-existing scenario still green, unmodified',
      'A written statement of what could have broken and why it does not',
    ],
  },
  {
    id: 'dev-11',
    track: 'dev',
    order: 11,
    title: 'Fix a defect you did not write',
    effort: 'advanced',
    skills: ['/yw:fix-defect'],
    mission:
      'Pair exercise: a teammate plants a small calculation bug on a branch — for example, cumulative percentage skipping the first bin — and hands you only the symptom. Diagnose from the symptom, name the root cause, and fix it with a regression test.',
    passWhen: [
      'Root cause named in writing before the fix is made',
      'A regression test that fails on the planted bug and passes after',
      'The fix touches the cause, not the symptom',
    ],
  },
  {
    id: 'dev-12',
    track: 'dev',
    order: 12,
    title: 'A table that was not there: audit log',
    effort: 'advanced',
    skills: ['/yw:forge-migration', '/yw:build-feature'],
    mission:
      'The app lets an admin load and delete data with no record of who did it. Add an audit_event table recording who loaded or removed sample wafers and who deleted uploads, plus an admin-only way to read it. The schema change must be additive and safe to re-run on an existing database.',
    passWhen: [
      'New table added additively — setup re-runs safely on an existing database',
      'Load, remove, and delete actions each write an event with user and time',
      'An admin can read the trail; other roles are refused',
      'Unit tests cover the recording',
    ],
  },
  {
    id: 'dev-13',
    track: 'dev',
    order: 13,
    title: 'Guard the front door',
    effort: 'advanced',
    skills: ['/yw:build-feature', '/yw:forge-unit-tests'],
    mission:
      'Today a CSV that lists the same die coordinate twice is accepted and the last row silently wins — plausible wrong data, the worst defect class this repo names. Make the duplicate a row-level upload error the engineer can see, without rejecting the whole file.',
    passWhen: [
      'A duplicate (x, y) die produces an upload_error row naming both rows',
      'The rest of the file still lands; nothing silently overwritten',
      'The error is visible on the upload errors screen',
      'Unit tests cover duplicate, near-duplicate, and clean files',
    ],
  },
  {
    id: 'dev-14',
    track: 'dev',
    order: 14,
    title: 'Make it fast, with numbers',
    effort: 'advanced',
    skills: ['/yw:build-feature'],
    mission:
      'Seed a few hundred wafers, measure the wafer list endpoint, find where the time actually goes, and fix it — an index, a query change, or honest pagination. The rule: no change without a before number, no claim without an after number.',
    passWhen: [
      'Before and after timings recorded with the method used to take them',
      'The change is justified by the measurement, not by intuition',
      'Existing behaviour unchanged — same rows, same order, suite green',
    ],
  },
  {
    id: 'dev-15',
    track: 'dev',
    order: 15,
    title: 'Capstone: a module from idea to pull request',
    effort: 'expert',
    skills: [
      '/yw:forge-prd',
      '/yw:probe-spec',
      '/yw:forge-tech-design',
      '/yw:build-feature',
      '/yw:forge-unit-tests',
      '/yw:seed-testability',
      '/yw:ship-change',
    ],
    mission:
      'Build "Wafer compare" — pick two wafers and see their maps side by side with the yield difference — through the whole dev track: PRD, spec analysis, tech design, implementation, unit tests, testability handles, and a pull request. Every stage leaves its artifact.',
    passWhen: [
      'PRD, spec analysis, and tech design exist and agree with each other',
      'The feature works end to end against seeded wafers',
      'Unit tests and testability handles in place; suite green',
      'Ledger rows filled for every stage; PR opened with an honest description',
    ],
  },

  /* ------------------------------- QA TRACK ------------------------------- */
  {
    id: 'qa-01',
    track: 'qa',
    order: 1,
    title: 'Read a requirement with Spec Probe',
    effort: 'starter',
    skills: ['/yw:probe-spec'],
    mission:
      'Run Spec Probe on the bin-pareto requirements in docs/PRDs and produce the spec analysis QA work starts from. Both tracks share this skill and this artifact — whoever runs it second reads the existing analysis instead of writing a rival one.',
    passWhen: [
      'spec-analysis.md exists with acceptance criteria carrying stable AC ids',
      'Every criterion has an "In plain words" line and a "where to check" note',
      'Testable categories each name the test data they need',
      'The spec validator reports no errors',
    ],
  },
  {
    id: 'qa-02',
    track: 'qa',
    order: 2,
    title: 'Design cases anyone can read',
    effort: 'starter',
    skills: ['/yw:forge-cases'],
    mission:
      'Write the test cases for one category of cluster detection in plain Given/When/Then — cases a manager could read and a human will approve before any automation exists.',
    passWhen: [
      'One feature file for the category, scenarios tagged with their AC ids',
      'Titles say what is being proved, in product words — no test jargon',
      'Every criterion in the category covered, or deferred with a written reason',
      'Tagged @manual — provenance that a person designed them',
    ],
  },
  {
    id: 'qa-03',
    track: 'qa',
    order: 3,
    title: 'File a bug someone can act on',
    effort: 'starter',
    skills: ['/yw:bug-report'],
    mission:
      'Upload the sample CSV after breaking a few rows on purpose, study what the app tells you, and file a bug dossier on the worst part of that experience — or on any genuine find. The measure is whether a stranger could reproduce and judge it.',
    passWhen: [
      'Steps a stranger can follow to see it, with the exact file used',
      'Expected versus actual stated separately, without blending them',
      'Severity chosen from the ladder with one sentence of justification',
    ],
  },
  {
    id: 'qa-04',
    track: 'qa',
    order: 4,
    title: 'Walk the screen before automating it',
    effort: 'core',
    skills: ['/yw:ui-recon'],
    mission:
      'Recon the wafer triage screen: inventory every control a test would touch, record how each can be found reliably, and route anything unreachable to the dev track instead of planning a workaround.',
    passWhen: [
      'Inventory lists each control with its stable locator',
      'Every gap routed to the dev track as a testability ask',
      'No CSS or XPath workarounds proposed anywhere',
    ],
  },
  {
    id: 'qa-05',
    track: 'qa',
    order: 5,
    title: 'Run the cases by hand, honestly',
    effort: 'core',
    skills: ['/yw:execute-cases'],
    mission:
      'Execute your cluster-detection cases manually against the local app and record a verdict per step. The discipline being tested is honesty: "not run" and "blocked" are respectable verdicts; a pass without having looked is not.',
    passWhen: [
      'Per-step verdicts recorded for every scenario in the category',
      'Any failure links to a bug dossier, not just a note',
      'The run record names the build and the data used',
    ],
  },
  {
    id: 'qa-06',
    track: 'qa',
    order: 6,
    title: 'Explore without a script and write it down',
    effort: 'core',
    skills: ['/yw:log-exploratory'],
    mission:
      'Spend a 45-minute charter exploring ATDF upload — odd files, wrong extensions, huge wafer numbers — and log the session. Unscripted exploration finds what planned cases never will, but only if it leaves a record.',
    passWhen: [
      'A charter written before starting, and kept to',
      'The paths tried are listed, including the boring ones',
      'At least two observations, each either cleared or routed onward',
    ],
  },
  {
    id: 'qa-07',
    track: 'qa',
    order: 7,
    title: 'Automate two approved scenarios',
    effort: 'core',
    skills: ['/yw:forge-scripts'],
    mission:
      'Automate two of your approved cluster-detection scenarios with Playwright steps. Only approved cases get automated — automation implements the case of record, it never quietly becomes it.',
    passWhen: [
      'Steps use getByRole and getByTestId only — the locator lint stays clean',
      '@automated added alongside @manual, never replacing it',
      'Both scenarios green from a freshly seeded database',
    ],
  },
  {
    id: 'qa-08',
    track: 'qa',
    order: 8,
    title: 'Prove your tests can fail',
    effort: 'core',
    skills: ['/yw:audit-scripts'],
    mission:
      'Audit your own automation by mutation: break the app deliberately in two different ways and confirm the right scenario fails each time, then restore it. A test that cannot fail is worse than no test.',
    passWhen: [
      'Two deliberate app mutations, each failing the scenario that owns it',
      'App restored and everything green again',
      'The audit written up: what was broken, what caught it',
    ],
  },
  {
    id: 'qa-09',
    track: 'qa',
    order: 9,
    title: 'Earn a stability streak',
    effort: 'core',
    skills: ['/yw:green-run'],
    mission:
      'Run the automated slice three consecutive times and record each run in the ledger. One green run can be luck; the streak is the evidence. A red run resets the count and gets investigated — never deleted.',
    passWhen: [
      'Three consecutive green runs recorded with dates',
      'Any red run kept in the record with what was done about it',
      'The ledger row states the streak honestly',
    ],
  },
  {
    id: 'qa-10',
    track: 'qa',
    order: 10,
    title: 'Catch the flake',
    effort: 'advanced',
    skills: ['/yw:flake-triage'],
    mission:
      'Pair exercise: a teammate plants a timing-dependent step on a branch — an assertion that usually wins its race. Reproduce the instability deliberately, classify whether the fault is in the test or the app, and fix the right one.',
    passWhen: [
      'The mechanism named: what raced with what',
      'Classified correctly as a test bug or an app bug',
      'Fixed at the cause, then ten consecutive green runs',
    ],
  },
  {
    id: 'qa-11',
    track: 'qa',
    order: 11,
    title: 'Test the API without the browser',
    effort: 'advanced',
    skills: ['/yw:api-recon', '/yw:forge-api-tests'],
    mission:
      'Recon the reports API against the served openapi.json, then write contract and integration tests for it directly — status, shape, and one business value computed by hand from the seeded wafer, not read back from the code.',
    passWhen: [
      'Recon inventory reconciled against the served API document',
      'Contract checks cover success and each documented error',
      'One integration check asserts a value worked out by hand',
    ],
  },
  {
    id: 'qa-12',
    track: 'qa',
    order: 12,
    title: 'Pin the charts with visual regression',
    effort: 'advanced',
    skills: ['/yw:forge-scripts'],
    mission:
      'The wafer map and bin pareto are drawn on a canvas, so a wrong color or a broken axis is invisible to every DOM assertion. Add a @visual scenario that pins one chart to a committed baseline with odiff, generate the baseline in the pinned container (npm run test:visual:baseline), then prove it can fail by recoloring the chart and watching the diff catch it.',
    passWhen: [
      'A @visual scenario asserts the chart against a named baseline with toHaveScreenshotOdiff',
      'The baseline is generated in the container, never on the host',
      'A deliberate recolor fails the scenario; reverting it goes green',
      'The framework self-test for the pinned odiff tolerances still passes',
    ],
  },
  {
    id: 'qa-13',
    track: 'qa',
    order: 13,
    title: 'Run a k6 performance test against real objectives',
    effort: 'advanced',
    skills: ['/yw:forge-performance-tests'],
    mission:
      'Design and run the k6 smoke and load profiles for the wafer-reports journey. The p95 objective must trace to an approved number — if none exists, propose one and get it approved; an invented target measures an opinion. Keep the functional checks inside the load test, because a fast response that returns garbage is not a pass.',
    passWhen: [
      'npm run perf:smoke is green with a summary written under reports/k6',
      'The p95 threshold traces to an approved number, not an invented one',
      'Each response is checked for status AND shape, feeding business_errors',
      'The load profile is run only with PERF_ALLOW_LOAD after reviewing it',
    ],
  },
  {
    id: 'qa-14',
    track: 'qa',
    order: 14,
    title: 'Read a load run and route the bottleneck',
    effort: 'advanced',
    skills: ['/yw:forge-performance-tests', '/yw:bug-report'],
    mission:
      'Run the load profile against a database seeded with a few hundred wafers, read the per-operation p95 from the summary, and identify which endpoint dominates. Route a slow one to the dev track with the numbers attached — a performance finding is only actionable with a before number.',
    passWhen: [
      'The summary is read per operation, not as one global average',
      'The dominant operation is named with its measured p95',
      'A finding is filed with the method used to measure it',
      'No claim of "slow" without a number behind it',
    ],
  },
  {
    id: 'qa-15',
    track: 'qa',
    order: 15,
    title: 'Security cases a scanner cannot write',
    effort: 'advanced',
    skills: ['/yw:forge-security-tests'],
    mission:
      'Write executable access-control and authentication cases for this app: a viewer must not upload or delete, a qa user must not manage sample wafers, an expired or forged token must fail closed, and sign-in must not reveal whether a username exists. Scanners cannot judge who should be allowed to do what — that takes a person who knows the rules.',
    passWhen: [
      'Cases cover each role boundary and the auth failures the app claims to enforce',
      'Written as tests that run (probe-lab-app/tests), not prose',
      'Tagged with their OWASP 2025 category (A01, A07)',
      'Any hole found is filed as a bug with severity justified',
    ],
  },
  {
    id: 'qa-16',
    track: 'qa',
    order: 16,
    title: 'Run the scanners and triage what they find',
    effort: 'advanced',
    skills: ['/yw:scan-security'],
    mission:
      'Run the dependency and static scanners (npm run security:deps, security:sast), and the ZAP baseline against the running app under explicit authorization. Then do the part a scanner cannot: separate a real finding from noise, and route confirmed ones to bug-report with a severity you can defend.',
    passWhen: [
      'deps and sast run; reports land under reports/security',
      'The baseline runs only with SECURITY_SCAN_TARGET and SECURITY_SCAN_AUTHORIZE set',
      'Each finding is triaged real-or-noise with a reason',
      'Confirmed findings routed to bug-report; false positives recorded as such',
    ],
  },
  {
    id: 'qa-17',
    track: 'qa',
    order: 17,
    title: 'Assemble a gate a human can trust',
    effort: 'advanced',
    skills: ['/yw:gate-design'],
    mission:
      'Assemble the Design Gate digest for your cluster-detection work: coverage counts, run results, and a Gaps section that hides nothing. Then present it to a named person and record their decision. The gate computes no verdict — it is a record of a human saying yes.',
    passWhen: [
      'Digest carries facts and a Gaps section, no readiness stamp',
      'A named human’s approval recorded with a timestamp',
      'Nothing removed from the digest to make approval easier',
    ],
  },
  {
    id: 'qa-18',
    track: 'qa',
    order: 18,
    title: 'Earn the merge gate',
    effort: 'advanced',
    skills: ['/yw:green-run', '/yw:gate-merge'],
    mission:
      'Bring one feature to the merge gate: a three-run green streak recorded honestly, the coverage and run evidence assembled into the merge digest, and a named human’s approval. A red run in the streak stays in the record and resets the count — never deleted.',
    passWhen: [
      'Three consecutive green runs recorded with dates',
      'The merge digest carries coverage, runs, and a Gaps section',
      'A named human’s approval recorded with a timestamp',
    ],
  },
  {
    id: 'qa-19',
    track: 'qa',
    order: 19,
    title: 'Promote automation to the scheduled runs',
    effort: 'core',
    skills: ['/yw:testops-promote'],
    mission:
      'Move proven automation into the runs that keep checking the product after everyone has moved on — the smoke slice, the visual project, the security tests. Promotion follows the merge gate; it makes durable what a one-off run proved once.',
    passWhen: [
      'The promoted set is named, with why each piece belongs in scheduled runs',
      'The tag or project it runs under is stated',
      'Anything deliberately left out of the schedule is named, with the reason',
    ],
  },
  {
    id: 'qa-20',
    track: 'qa',
    order: 20,
    title: 'Capstone: QA a feature you did not build',
    effort: 'expert',
    skills: [
      '/yw:probe-spec',
      '/yw:forge-cases',
      '/yw:gate-design',
      '/yw:ui-recon',
      '/yw:forge-scripts',
      '/yw:forge-api-tests',
      '/yw:forge-security-tests',
      '/yw:audit-scripts',
      '/yw:green-run',
      '/yw:gate-merge',
    ],
    mission:
      'Take a feature someone else built — a dev capstone, or the bin pareto CSV export — through the whole QA track: spec analysis, cases, a recorded gate approval, recon, UI automation, an API test, a security case, a visual pin where a chart is involved, a mutation audit, a three-run streak, and the merge-gate digest. Every stage leaves its artifact.',
    passWhen: [
      'Every stage artifact exists and the ledger tells the true story',
      'Coverage spans UI, API, and at least one security case',
      'At least one real finding routed to bug-report or the dev track',
      'Automation passed the mutation audit; the merge digest is complete',
    ],
  },
];

/* ------------------------------- scoring -------------------------------- */

export interface AssessmentResultRecord {
  assessmentId: string;
  outcome: AssessmentOutcome;
}

/** Points a pass is worth. */
export function pointsFor(assessment: Pick<Assessment, 'effort'>): number {
  return EFFORT_POINTS[assessment.effort];
}

/** What a standing failure costs: half the points, rounded up. */
export function penaltyFor(assessment: Pick<Assessment, 'effort'>): number {
  return Math.ceil(EFFORT_POINTS[assessment.effort] / 2);
}

const byId = new Map(assessmentCatalogue.map((assessment) => [assessment.id, assessment]));

export function findAssessment(id: string): Assessment | undefined {
  return byId.get(id);
}

/**
 * Total score for a set of recorded results. Unknown ids are ignored rather
 * than thrown, so a result recorded against an assessment that was later
 * renamed degrades to nothing instead of breaking every reader.
 */
export function scoreResults(results: AssessmentResultRecord[]): number {
  let total = 0;
  for (const result of results) {
    const assessment = byId.get(result.assessmentId);
    if (!assessment) continue;
    total += result.outcome === 'passed' ? pointsFor(assessment) : -penaltyFor(assessment);
  }
  return Math.max(0, total);
}

export interface AssessmentLevel {
  index: number;
  name: string;
  /** Points needed to hold this level. */
  minPoints: number;
}

/**
 * Six levels, fab-themed. The top is reachable at ~80% of everything passed,
 * so it rewards sustained work without demanding perfection. Maximum possible
 * score across both tracks is 770.
 */
export const ASSESSMENT_LEVELS: AssessmentLevel[] = [
  { index: 0, name: 'Cleanroom Visitor', minPoints: 0 },
  { index: 1, name: 'Probe Trainee', minPoints: 40 },
  { index: 2, name: 'Wafer Handler', minPoints: 120 },
  { index: 3, name: 'Yield Analyst', minPoints: 240 },
  { index: 4, name: 'Process Engineer', minPoints: 420 },
  { index: 5, name: 'Fab Master', minPoints: 620 },
];

export function levelForScore(score: number): AssessmentLevel {
  let current = ASSESSMENT_LEVELS[0]!;
  for (const level of ASSESSMENT_LEVELS) {
    if (score >= level.minPoints) current = level;
  }
  return current;
}

export function nextLevelAfter(score: number): AssessmentLevel | null {
  return ASSESSMENT_LEVELS.find((level) => level.minPoints > score) ?? null;
}

/* ----------------------------- API payloads ----------------------------- */

export interface AssessmentStatusEntry extends Assessment {
  points: number;
  penalty: number;
  timeHint: string;
  status: AssessmentOutcome | null;
  attempts: number;
  /** The pull request the work was submitted through, when one was recorded. */
  evidenceUrl: string | null;
  updatedAt: string | null;
}

export interface AssessmentSummary {
  score: number;
  level: AssessmentLevel;
  nextLevel: AssessmentLevel | null;
  passed: number;
  failed: number;
  /** The maximum score if every assessment were passed. */
  maxScore: number;
}

export interface AssessmentStanding {
  username: string;
  role: string;
  score: number;
  levelName: string;
  passed: number;
  failed: number;
}

export interface AssessmentsResponse {
  assessments: AssessmentStatusEntry[];
  summary: AssessmentSummary;
  standings: AssessmentStanding[];
}

export const MAX_ASSESSMENT_SCORE = assessmentCatalogue.reduce(
  (total, assessment) => total + pointsFor(assessment),
  0,
);
