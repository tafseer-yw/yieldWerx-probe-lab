/**
 * Bug-candidate reporter — the collector stage of the bug lifecycle
 * (docs/bug-lifecycle.md).
 *
 * Every final test failure and retry-then-pass flake is written as candidate
 * JSON to
 * .probe/artifacts/bug-sync/candidates/<fingerprint>.json with the metadata a
 * Jira bug needs: scenario, tags, failing Gherkin step, normalized error,
 * evidence paths, env, commit. Candidates are NOT bugs — most E2E failures
 * are test/sync/env issues. Classification (/flake-triage or /bug-report)
 * marks the app-bug ones; only those are filed by scripts/jira-bug-sync.ts.
 *
 * The fingerprint (scenario + failing step + normalized error) is the dedup
 * key across runs, retries, and shards: re-failures update the existing
 * candidate's occurrence list instead of spawning a new one, and the filer
 * uses it as a Jira label so a known open bug gets a comment, not a duplicate.
 *
 * WHY a Playwright Reporter (not a fixture): reporters see every retry and
 * final outcome, which is exactly the vantage point needed to distinguish a
 * terminal failure from a retry-then-pass flake. Wired in
 * playwright.config.ts; lives in src/core because it depends on nothing
 * above the core layer.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { z } from 'zod';

import { REPO_ROOT } from './paths';

/** Version stamp written into every candidate so the filer can migrate old files. */
export const CANDIDATE_SCHEMA_VERSION = 3;

/** Repo-relative directory where candidate JSON files accumulate (gitignored). */
export const CANDIDATES_DIR = path.join('.probe', 'artifacts', 'bug-sync', 'candidates');

/**
 * On-disk shape of one bug candidate. Collector fields are overwritten on
 * every re-failure (fresh evidence is listed first); the triage fields at the bottom are
 * human/skill-owned and preserved across merges (see {@link mergeCandidate}).
 */
export interface BugCandidate {
  /** Schema version ({@link CANDIDATE_SCHEMA_VERSION}) for forward migration. */
  schemaVersion: number;
  /** Dedup key — see {@link fingerprintFailure}. Doubles as the file name. */
  fingerprint: string;
  /** Scenario title with @tags stripped. */
  scenario: string;
  /** Full Playwright title path (project > file > describe > test). */
  titlePath: string[];
  /** Scenario tags (e.g. @smoke, @wafermap). */
  tags: string[];
  /** Repo-relative file:line of the scenario. */
  location: string;
  /** Playwright project name (browser/config slice). */
  project: string;
  /** Deepest failing Gherkin step title. */
  failingStep: string;
  /** Raw (truncated) and normalized error text. */
  error: { message: string; normalized: string };
  /** Report attachments with file paths (traces, screenshots, logs). */
  attachments: Array<{ name: string; path: string }>;
  /** Whether the test ultimately failed or passed only after a retry. */
  outcome: 'failed' | 'flaky';
  /** Human approval of the exact evidence set eligible for outbound filing. */
  evidenceReview: {
    reviewedAt: string;
    reviewedBy: string;
    approvedPaths: string[];
    approvedSensitivePaths: string[];
  } | null;
  /** Provenance — this reporter always writes 'automated'. */
  foundDuring: 'automated' | 'manual';
  /** Runtime context captured at failure time for reproduction. */
  environment: { env: string; commit: string; os: string; node: string; ci: boolean };
  /** ISO timestamps of every observed failure (accumulates across runs). */
  occurrences: string[];
  /** Triage fields — set by /flake-triage//bug-report, consumed by the filer. */
  classification: 'app-bug' | 'test-bug' | 'sync-gap' | 'data' | 'environment' | 'infra' | null;
  severity: 'blocker' | 'high' | 'medium' | 'low' | null;
  triageNotes: string | null;
  jira: { key: string; url: string; filedAt: string } | null;
}

const relativeEvidencePath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => !path.isAbsolute(value) && !value.split(/[\\/]/).some((segment) => segment === '..'),
    'must be a repository-relative path without parent traversal',
  );

const candidateFields = {
  fingerprint: z.string().regex(/^[0-9a-f]{12}$/),
  scenario: z.string().min(1).max(500),
  titlePath: z.array(z.string().max(500)).max(50),
  tags: z.array(z.string().max(200)).max(100),
  location: z.string().min(1).max(2048),
  project: z.string().min(1).max(200),
  failingStep: z.string().min(1).max(1000),
  error: z.object({ message: z.string().max(2000), normalized: z.string().max(300) }).strict(),
  attachments: z
    .array(z.object({ name: z.string().min(1).max(200), path: relativeEvidencePath }).strict())
    .max(100),
  foundDuring: z.enum(['automated', 'manual']),
  environment: z
    .object({
      env: z.string().min(1).max(100),
      commit: z.string().min(1).max(100),
      os: z.string().min(1).max(500),
      node: z.string().min(1).max(100),
      ci: z.boolean(),
    })
    .strict(),
  occurrences: z.array(z.string().min(1).max(100)).min(1).max(1000),
  classification: z
    .enum(['app-bug', 'test-bug', 'sync-gap', 'data', 'environment', 'infra'])
    .nullable(),
  severity: z.enum(['blocker', 'high', 'medium', 'low']).nullable(),
  triageNotes: z.string().max(10_000).nullable(),
  jira: z
    .object({
      key: z.string().min(1).max(100),
      url: z.string().url().max(2048),
      filedAt: z.string().min(1).max(100),
    })
    .strict()
    .nullable(),
};

const evidenceReviewSchema = z
  .object({
    reviewedAt: z.iso.datetime(),
    reviewedBy: z.string().min(1).max(200),
    approvedPaths: z.array(relativeEvidencePath).max(100),
    approvedSensitivePaths: z.array(relativeEvidencePath).max(100),
  })
  .strict()
  .superRefine((review, context) => {
    if (new Set(review.approvedPaths).size !== review.approvedPaths.length) {
      context.addIssue({ code: 'custom', path: ['approvedPaths'], message: 'contains duplicates' });
    }
    if (new Set(review.approvedSensitivePaths).size !== review.approvedSensitivePaths.length) {
      context.addIssue({
        code: 'custom',
        path: ['approvedSensitivePaths'],
        message: 'contains duplicates',
      });
    }
    for (const sensitivePath of review.approvedSensitivePaths) {
      if (!review.approvedPaths.includes(sensitivePath)) {
        context.addIssue({
          code: 'custom',
          path: ['approvedSensitivePaths'],
          message: `${sensitivePath} is not present in approvedPaths`,
        });
      }
    }
  });

const legacyCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...candidateFields,
    outcome: z.enum(['failed', 'flaky']).optional(),
  })
  .strict();

const legacyV2CandidateSchema = z
  .object({
    schemaVersion: z.literal(2),
    ...candidateFields,
    outcome: z.enum(['failed', 'flaky']),
  })
  .strict();

const reviewedCandidateSchema = z
  .object({
    schemaVersion: z.literal(CANDIDATE_SCHEMA_VERSION),
    ...candidateFields,
    outcome: z.enum(['failed', 'flaky']),
    evidenceReview: evidenceReviewSchema.nullable(),
  })
  .strict();

/**
 * Validate untrusted candidate JSON and migrate schema-v1/v2 shapes in
 * memory. This is shared by the reporter and Jira filer so malformed queue
 * files fail closed instead of being trusted via a TypeScript cast.
 */
export function parseBugCandidate(value: unknown): BugCandidate {
  const parsed = z
    .union([legacyCandidateSchema, legacyV2CandidateSchema, reviewedCandidateSchema])
    .safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid bug candidate: ${details}`);
  }
  return {
    ...parsed.data,
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    outcome: parsed.data.outcome ?? 'failed',
    evidenceReview: 'evidenceReview' in parsed.data ? parsed.data.evidenceReview : null,
  };
}

// ANSI color-code matcher — ESC assembled at runtime because a control
// character (literal or \u-escaped) in a regex literal fails no-control-regex.
const ANSI_COLORS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Strip the volatile parts of an error message so the same defect always
 * yields the same fingerprint: ANSI color codes, absolute paths, durations,
 * and literal numbers (expected/actual values vary run to run — the SHAPE of
 * the failure is the identity, not the numbers).
 *
 * Order matters: colors first (they wrap everything), then Windows and POSIX
 * paths → `<path>`, **runtime-unique entity names → `<generated>`**, durations
 * → `<duration>` (before the generic digit pass would eat them), all remaining
 * digits → `#`, then whitespace collapse, lowercase, and a 300-char cap to keep
 * fingerprint material bounded.
 *
 * ⚠ THE `<generated>` PASS IS LOAD-BEARING, and it was missing.
 * Test data is created with a random suffix so runs cannot collide —
 * `QA-CD-RUN-POL-a3f9c1d2`. That suffix is **hexadecimal**, so the `\d+ → #`
 * pass rewrote its digits and left its letters untouched, producing a different
 * fingerprint on every run for any assertion whose message quotes an entity
 * name. The observed cost: `TC-api-auto-003` accumulated **36 candidates for one
 * defect**, and because Jira de-duplication keys on the fingerprint, filing that
 * queue would have created 36 tickets for it and kept creating more. A
 * fingerprint that changes per run is not a fingerprint.
 *
 * @param message - Raw error message from a test result.
 * @returns Normalized, lowercased, truncated failure text.
 */
export function normalizeError(message: string): string {
  return (
    message
      .replace(ANSI_COLORS, '')
      .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<path>') // Windows paths
      .replace(/\/[^\s'"]*\/[^\s'"]+/g, '<path>') // POSIX paths
      // Reserved `QA-` catalogue names and any runtime-unique suffix on them.
      // Deliberately before the digit pass: afterwards the suffix is a mix of `#`
      // and letters and no longer matches as one token.
      .replace(/QA-[A-Za-z0-9-]*-[0-9a-f]{6,}/gi, '<generated>')
      // A bare hex blob (uuid fragment, request id) that no other rule caught.
      .replace(/\b[0-9a-f]{8,}\b/gi, '<generated>')
      .replace(/\d+(\.\d+)?(ms|s)\b/g, '<duration>')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 300)
  );
}

/** A Scenario Outline example row's own leaf title, e.g. `Example #2`. */
const EXAMPLE_LEAF = /^Example #\d+$/;

/**
 * Projects whose failures are NEVER application defects, so no bug candidate is
 * collected for them.
 *
 * `framework-selftest` tests this repository's own utilities against the bundled
 * demo app. When that app is absent — as it is in a standalone checkout — 13 chart
 * and accessibility tests fail for purely environmental reasons, and every one of
 * them was landing in the bug queue as a candidate awaiting triage. That is worse
 * than noise: it padded the queue to the point where the genuine API defects were
 * a minority of it, and a careless `--live` run would have raised Jira tickets
 * against the product for our own missing test fixture.
 *
 * A framework self-test failure means the framework or its environment is broken,
 * which is a `test-bug`/`environment` finding by definition — never an `app-bug` —
 * so filtering here is more honest than classifying each one afterwards.
 */
const NON_APPLICATION_PROJECTS = new Set(['framework-selftest']);

/**
 * The scenario a failure belongs to, with tags stripped.
 *
 * WHY THIS IS NOT JUST `test.title`. For a Scenario Outline, `playwright-bdd`
 * names each example row `Example #N` and puts the real scenario title one level
 * up in `titlePath`. Taking the leaf therefore produced candidates — and would
 * have produced **Jira tickets** — literally titled `Example #1`, with no way to
 * tell which case or requirement they came from.
 *
 * It also mattered for identity, not just presentation: `Example #2` is the same
 * string for every outline in the suite, so two unrelated defects whose failing
 * step and normalized error happened to match would have collapsed into one
 * fingerprint and one ticket.
 *
 * Resolving to the parent has a deliberate consequence: every example row of one
 * outline now shares a scenario, so rows failing the same way on the same step
 * collapse to ONE candidate. That is correct — `minCount` 0 and 1 breaching the
 * same floor is one defect, and should be one ticket, not two.
 *
 * @param title - The test's own (leaf) title.
 * @param titlePath - Full ancestry, project and file first, leaf last.
 * @returns The scenario title, tags removed.
 */
export function scenarioIdentity(title: string, titlePath: readonly string[]): string {
  const strip = (value: string): string => value.replace(/\s*@[^\s]+/g, '').trim();
  const leaf = strip(title);
  if (!EXAMPLE_LEAF.test(leaf)) return leaf;
  // Walk outwards for the nearest ancestor that is a scenario rather than another
  // example row, a file, or the project. Fall back to the leaf so a shape this
  // does not recognise still yields a non-empty identity.
  for (let index = titlePath.length - 2; index >= 0; index -= 1) {
    const candidate = strip(titlePath[index] ?? '');
    if (candidate === '' || EXAMPLE_LEAF.test(candidate)) continue;
    if (/\.(spec|feature)\.[jt]s$/.test(candidate) || candidate.includes('\\')) break;
    // The example index is deliberately NOT appended. Keeping it would give every
    // row a distinct identity and defeat the collapse described above; rows that
    // fail differently are already separated by the normalized error, and the row's
    // own values remain in the error text and attachments for reproduction.
    return candidate;
  }
  return leaf;
}

/**
 * Stable failure identity: scenario + failing step + normalized error.
 *
 * SHA-1 truncated to 12 hex chars — collision-safe at candidate-count scale
 * and short enough to serve as a file name and a Jira label.
 *
 * @param scenario - Scenario title (tags stripped).
 * @param step - Failing Gherkin step title.
 * @param errorMessage - Raw error message (normalized internally).
 * @returns 12-character hex fingerprint.
 */
export function fingerprintFailure(scenario: string, step: string, errorMessage: string): string {
  const material = `${scenario}\n${step}\n${normalizeError(errorMessage)}`;
  return crypto.createHash('sha1').update(material).digest('hex').slice(0, 12);
}

/**
 * A re-failure updates the existing candidate: current and still-present
 * evidence is retained, occurrences accumulate, and triage state (classification, severity,
 * notes, jira key) is PRESERVED — a re-run must never erase a human verdict.
 *
 * @param existing - Candidate already on disk (may carry triage state).
 * @param fresh - Newly built candidate from the current failure.
 * @returns Merged candidate ready to be written back.
 */
export function mergeCandidate(existing: BugCandidate, fresh: BugCandidate): BugCandidate {
  const existingPaths = new Set(existing.attachments.map((attachment) => attachment.path));
  const hasFreshEvidence = fresh.attachments.some(
    (attachment) => !existingPaths.has(attachment.path),
  );
  const attachments = [...fresh.attachments, ...existing.attachments].filter(
    (attachment, index, all) =>
      all.findIndex(
        (candidate) => candidate.name === attachment.name && candidate.path === attachment.path,
      ) === index,
  );
  return {
    ...fresh,
    attachments: attachments.slice(0, 100),
    occurrences: [...new Set([...existing.occurrences, ...fresh.occurrences])],
    classification: existing.classification,
    severity: existing.severity,
    triageNotes: existing.triageNotes,
    jira: existing.jira,
    // Approval is bound to an exact evidence set; newly copied evidence must
    // be reviewed rather than inheriting a verdict for older files.
    evidenceReview: hasFreshEvidence ? null : existing.evidenceReview,
  };
}

/** True when `candidatePath` resolves inside `baseDir` (or is the base itself). */
function isPathWithin(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(baseDir), path.resolve(candidatePath));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** Convert repository-relative paths to a portable form for archived JSON. */
function portableRelative(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

/**
 * Copy Playwright evidence into the durable candidate package. Sources must
 * be regular files physically contained by the repository (symlink targets
 * are checked); external files are deliberately ignored to prevent the
 * reporter from becoming an exfiltration path.
 */
export function copyCandidateEvidence(
  rootDir: string,
  fingerprint: string,
  attachments: ReadonlyArray<{ name: string; path?: string }>,
): Array<{ name: string; path: string }> {
  const evidenceDir = path.join(
    rootDir,
    '.probe',
    'artifacts',
    'bug-sync',
    'evidence',
    fingerprint,
  );
  const copied: Array<{ name: string; path: string }> = [];
  const realRoot = fs.realpathSync(rootDir);

  attachments.forEach((attachment, index) => {
    if (attachment.path === undefined || !fs.existsSync(attachment.path)) return;
    const source = fs.realpathSync(attachment.path);
    if (!isPathWithin(realRoot, source) || !fs.statSync(source).isFile()) return;

    fs.mkdirSync(evidenceDir, { recursive: true });
    const safeBase = path
      .basename(source)
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .slice(-160);
    const destination = path.join(
      evidenceDir,
      `${Date.now()}-${process.pid}-${index}-${crypto.randomUUID()}-${safeBase || 'evidence.bin'}`,
    );
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    copied.push({
      name: attachment.name.slice(0, 200) || 'evidence',
      path: portableRelative(rootDir, destination),
    });
  });
  return copied;
}

/** Sleep synchronously for the short advisory-lock retry window. */
function lockWait(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

/** Acquire an exclusive lock file, recovering only locks stale for 30 seconds. */
function acquireCandidateLock(lockPath: string): number {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (
          !(statError instanceof Error) ||
          !('code' in statError) ||
          statError.code !== 'ENOENT'
        ) {
          throw statError;
        }
      }
      lockWait(25);
    }
  }
  throw new Error(`Timed out acquiring bug-candidate lock: ${lockPath}`);
}

/** Replace a JSON file from a same-directory temp file. */
function writeJsonAtomically(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try {
    try {
      fs.renameSync(temporary, file);
    } catch (error) {
      // Windows does not consistently replace an existing target via rename.
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      fs.unlinkSync(file);
      fs.renameSync(temporary, file);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/**
 * Merge and persist a candidate under an inter-process advisory lock. The
 * lock closes the read/merge/write race between independent Playwright
 * shards, while the temp-file replacement avoids partially written JSON.
 */
export function persistCandidate(rootDir: string, fresh: BugCandidate): string {
  const dir = path.join(rootDir, CANDIDATES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${fresh.fingerprint}.json`);
  const lockPath = `${file}.lock`;
  const lock = acquireCandidateLock(lockPath);
  try {
    const merged = fs.existsSync(file)
      ? mergeCandidate(parseBugCandidate(JSON.parse(fs.readFileSync(file, 'utf-8'))), fresh)
      : fresh;
    const realRoot = fs.realpathSync(rootDir);
    const durable = {
      ...merged,
      attachments: merged.attachments.filter((attachment) => {
        const candidatePath = path.resolve(rootDir, attachment.path);
        if (!isPathWithin(rootDir, candidatePath) || !fs.existsSync(candidatePath)) return false;
        const realPath = fs.realpathSync(candidatePath);
        return isPathWithin(realRoot, realPath) && fs.statSync(realPath).isFile();
      }),
    };
    writeJsonAtomically(file, durable);
  } finally {
    fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
  return file;
}

/**
 * Deepest errored step title — with playwright-bdd this is the Gherkin step.
 *
 * Walks the step tree depth-first; each errored `test.step` overwrites the
 * previous match so the LAST (deepest/latest) failing step wins. Falls back
 * to a marker string for hook/setup failures that have no step at all.
 *
 * @param result - The final test result whose step tree is inspected.
 * @returns The failing step title, or a placeholder when none exists.
 */
function findFailingStep(result: TestResult): string {
  let failing = '';
  const visit = (steps: TestResult['steps']): void => {
    for (const step of steps) {
      if (step.error !== undefined && step.category === 'test.step') failing = step.title;
      visit(step.steps);
    }
  };
  visit(result.steps);
  return failing || '(no step — hook or setup failure)';
}

/**
 * Short git HEAD hash for reproduction context; 'unknown' when git is
 * unavailable (e.g. an exported artifact dir) — never fails the run.
 */
function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Playwright Reporter implementation. Collects failures and flakes during
 * the run, then writes/merges candidate files once in onEnd. Cross-process
 * lock files and atomic replacement protect the same fingerprint when CI
 * uses independent Playwright shards.
 */
class BugCandidateReporter implements Reporter {
  /** Short git hash captured once at run start. */
  private commit = 'unknown';
  /** Playwright rootDir; all stored paths are made relative to it. */
  /* The repo root, not config.rootDir: with playwright-bdd the latter is the
     generated .features-gen dir, and bug:sync reads candidates from the repo
     root. Locations are still reported relative to config.rootDir below. */
  private readonly rootDir = REPO_ROOT;
  private testRootDir = process.cwd();
  /** Final failures and retry-then-pass flakes, keyed by Playwright test id. */
  private observations = new Map<
    string,
    { test: TestCase; result: TestResult; outcome: BugCandidate['outcome'] }
  >();

  /** Capture run-level context (git commit, root dir) before any test runs. */
  onBegin(config: FullConfig): void {
    this.commit = gitCommit();
    this.testRootDir = config.rootDir;
  }

  /**
   * Track the LAST failure per test. A subsequent retry pass converts it to
   * a durable flake candidate so CI cannot silently discard the evidence.
   *
   * @param test - The test case that just finished (possibly a retry).
   * @param result - Its result for this attempt.
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.observations.set(test.id, { test, result, outcome: 'failed' });
      return;
    }
    const prior = this.observations.get(test.id);
    if (result.status === 'passed' && result.retry > 0 && prior !== undefined) {
      this.observations.set(test.id, { ...prior, test, outcome: 'flaky' });
      return;
    }
    this.observations.delete(test.id);
  }

  /**
   * Persist candidates for terminal failures and retry-then-pass flakes.
   * Quarantined/expected failures remain policy concerns, not candidates.
   * Each candidate merges by fingerprint so triage survives re-runs.
   */
  onEnd(): void {
    const written: string[] = [];
    for (const { test, result, outcome } of this.observations.values()) {
      const playwrightOutcome = test.outcome();
      if (
        (outcome === 'failed' && playwrightOutcome !== 'unexpected') ||
        (outcome === 'flaky' && playwrightOutcome !== 'flaky')
      ) {
        continue; // @quarantine / expected failures
      }
      if (NON_APPLICATION_PROJECTS.has(test.parent.project()?.name ?? '')) {
        continue; // framework's own tests — never an application defect
      }
      const candidate = this.buildCandidate(test, result, outcome);
      const file = persistCandidate(this.rootDir, candidate);
      written.push(path.relative(this.rootDir, file));
    }
    if (written.length > 0) {
      process.stdout.write(
        `\nBug candidates (${written.length}) — triage with /flake-triage or /bug-report, ` +
          `then file: npm run bug:sync\n${written.map((f) => `  · ${f}`).join('\n')}\n`,
      );
    }
  }

  /**
   * Assemble one {@link BugCandidate} from a failed test: strips @tags from
   * the title, resolves the failing Gherkin step, normalizes the error (raw
   * message capped at 2000 chars), keeps only attachments that exist as
   * files, and snapshots the runtime environment. Triage fields start null —
   * classification is a human/skill decision, never the collector's.
   *
   * @param test - The failed test case.
   * @param result - Its final (post-retry) result.
   * @returns A fully-populated candidate with triage fields nulled.
   */
  private buildCandidate(
    test: TestCase,
    result: TestResult,
    outcome: BugCandidate['outcome'],
  ): BugCandidate {
    const tags = test.tags;
    const scenario = scenarioIdentity(test.title, test.titlePath());
    const failingStep = findFailingStep(result);
    const message = result.error?.message ?? result.status;
    const fingerprint = fingerprintFailure(scenario, failingStep, message);
    return {
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      fingerprint,
      scenario,
      titlePath: test.titlePath(),
      tags,
      location: `${portableRelative(this.testRootDir, test.location.file)}:${test.location.line}`,
      project: test.parent.project()?.name ?? 'unknown',
      failingStep,
      error: { message: message.slice(0, 2000), normalized: normalizeError(message) },
      attachments: copyCandidateEvidence(this.rootDir, fingerprint, result.attachments),
      outcome,
      evidenceReview: null,
      foundDuring: 'automated',
      environment: {
        env: process.env.E2E_ENV ?? 'local',
        commit: this.commit,
        os: `${os.platform()} ${os.release()}`,
        node: process.version,
        ci: process.env.CI !== undefined,
      },
      occurrences: [new Date().toISOString()],
      classification: null,
      severity: null,
      triageNotes: null,
      jira: null,
    };
  }
}

export default BugCandidateReporter;
