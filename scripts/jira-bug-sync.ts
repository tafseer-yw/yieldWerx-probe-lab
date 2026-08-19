/**
 * Jira bug filer — the last stage of the outbound bug pipeline
 * (docs/bug-lifecycle.md). Files CLASSIFIED app-bug candidates to Jira via
 * REST v3 with fingerprint-based dedup:
 *
 *   - an open issue already carries the `fp-<hash>` label → add an occurrence
 *     comment (run date, env, commit) instead of a duplicate ticket;
 *   - otherwise create the bug with full metadata (labels, priority from our
 *     severity ladder, evidence attachments) and write the issue key back
 *     into the candidate, moving it to bug-sync/filed/.
 *
 * WHY dedup by fingerprint: a recurring failure across nightly runs must
 * accumulate occurrences on ONE ticket, not spam the backlog — the
 * fingerprint label makes the dedup key queryable in Jira itself (JQL on
 * `labels = "fp-<hash>"`), independent of summary wording.
 *
 * Never files unclassified candidates: most E2E failures are test/sync/env
 * issues, and raw-failure auto-filing kills the channel's signal. Triage first
 * (/flake-triage or /bug-report sets classification + severity).
 *
 * Auth: JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN + JIRA_PROJECT_KEY env
 * vars (deliberately independent of the zod E2E config). Outbound writes
 * additionally require `--live` or `JIRA_SYNC_MODE=live`; otherwise the
 * command is a dry run even when credentials are present.
 *
 * Run:  npm run bug:sync                     (dry-run all app-bug candidates)
 *       npm run bug:sync -- --live            (explicit live filing)
 *       npm run bug:sync -- --candidate .probe/artifacts/bug-sync/candidates/<fp>.json
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  CANDIDATES_DIR,
  parseBugCandidate,
  type BugCandidate,
} from '../src/core/bugCandidateReporter';
import { resolveWithinDirectory } from '../src/utils/files';

const REPO_ROOT = process.cwd();

/**
 * Merge `.env` under the real process environment.
 *
 * Without this the script reads `process.env` only, so credentials placed in
 * the gitignored `.env` — the obvious place to put them, and where the rest of
 * the framework already looks — are silently ignored and live mode fails with
 * "Live Jira sync requires: ...". Mirrors `src/core/config.ts`: the file is
 * parsed rather than injected, and a real shell or CI variable always wins.
 *
 * @returns Environment values with process variables taking precedence.
 */
function environmentWithDotEnv(): NodeJS.ProcessEnv {
  const file = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(file)) return process.env;
  const fromFile = dotenv.parse(fs.readFileSync(file));
  const merged: NodeJS.ProcessEnv = { ...fromFile };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** Where successfully filed candidates are moved (out of the triage queue). */
const FILED_DIR = path.join('.probe', 'artifacts', 'bug-sync', 'filed');

/**
 * Framework severity ladder → Jira priority name. `info` is deliberately
 * absent: info-level findings are not fileable bugs.
 */
const PRIORITY: Record<string, string> = {
  blocker: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Resolved Jira connection settings (all sourced from environment variables). */
export interface JiraEnv {
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
  issueType: string;
  /** Extra labels applied to every filed bug, from `JIRA_EXTRA_LABELS`. */
  extraLabels: string[];
  /** Issue key every filed bug is linked to, from `JIRA_LINK_TO`. */
  linkTo: string | null;
  /** Jira link type name used for `linkTo`. Defaults to `Relates`. */
  linkType: string;
  /**
   * Epic/parent key every filed bug is created under, from `JIRA_PARENT_KEY`.
   *
   * Prefer this over `linkTo` when the target is an Epic: in a team-managed
   * project `parent` is what makes a bug an actual member of the epic, so it
   * appears in the epic's issue list and rolls up. A `Relates` link only
   * records an association.
   */
  parentKey: string | null;
  /** Project-specific required fields, from `JIRA_EXTRA_FIELDS`. */
  extraFields: Record<string, unknown>;
}

/**
 * Resolve Jira settings in explicit dry-run/live mode. Live mode fails closed
 * on partial credentials or an insecure URL; issue type defaults to "Bug".
 */
export function resolveJiraEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  forceLive = false,
): JiraEnv | null {
  const mode = forceLive ? 'live' : (source.JIRA_SYNC_MODE ?? 'dry-run');
  if (mode !== 'dry-run' && mode !== 'live') {
    throw new Error(`JIRA_SYNC_MODE must be "dry-run" or "live", received: ${mode}`);
  }
  if (mode === 'dry-run') return null;

  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'] as const;
  const missing = required.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Live Jira sync requires: ${missing.join(', ')}`);
  }

  const baseUrl = new URL(source.JIRA_BASE_URL as string);
  if (baseUrl.protocol !== 'https:') throw new Error('Live Jira sync requires an HTTPS base URL');
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('JIRA_BASE_URL must not contain credentials, a query, or a fragment');
  }
  const projectKey = source.JIRA_PROJECT_KEY as string;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(projectKey)) {
    throw new Error(`Invalid JIRA_PROJECT_KEY: ${projectKey}`);
  }
  const issueType = source.JIRA_ISSUE_TYPE?.trim() || 'Bug';
  if (issueType.length > 100) throw new Error('JIRA_ISSUE_TYPE must be at most 100 characters');

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    email: source.JIRA_EMAIL as string,
    token: source.JIRA_API_TOKEN as string,
    projectKey,
    issueType,
    ...resolveFilingOptions(source),
  };
}

/** Routing settings that shape a filed issue but carry no credentials. */
export interface FilingOptions {
  extraLabels: string[];
  linkTo: string | null;
  linkType: string;
  parentKey: string | null;
  /**
   * Project-specific required fields, as raw Jira `fields` JSON from
   * `JIRA_EXTRA_FIELDS`.
   *
   * Jira screens routinely demand fields the REST `createmeta` endpoint does
   * not report — YWPD's Bug screen requires Components, Affects versions and a
   * custom iteration field, none of which createmeta lists. Rather than hard-code
   * one project's schema, the caller supplies them verbatim.
   */
  extraFields: Record<string, unknown>;
}

/**
 * Resolve the non-credential filing options.
 *
 * Split out from {@link resolveJiraEnvironment} so DRY-RUN can show them too:
 * the preview returns `null` for the credentialed environment, and previewing
 * labels or a parent that the live run would actually apply — but the preview
 * omitted — is precisely the preview/live divergence that makes a dry run
 * untrustworthy. These values are safe to read in any mode.
 *
 * @param source - Environment to read from.
 */
export function resolveFilingOptions(source: NodeJS.ProcessEnv): FilingOptions {
  // Campaign labels, e.g. JIRA_EXTRA_LABELS="API Testing,cluster-detection".
  // Sanitized through the same `label()` rule as tag-derived labels, so a value
  // containing spaces becomes hyphenated ("API Testing" -> "API-Testing")
  // rather than being rejected by Jira.
  const extraLabels = [
    ...new Set(
      (source.JIRA_EXTRA_LABELS ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .map(label),
    ),
  ];

  const issueKey = (raw: string | undefined, name: string): string | null => {
    const value = raw?.trim();
    if (value === undefined || value.length === 0) return null;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,19}-\d+$/.test(value)) {
      throw new Error(`Invalid ${name} issue key: ${value}`);
    }
    return value.toUpperCase();
  };

  let extraFields: Record<string, unknown> = {};
  const rawFields = source.JIRA_EXTRA_FIELDS?.trim();
  if (rawFields !== undefined && rawFields.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawFields);
    } catch (error) {
      throw new Error('JIRA_EXTRA_FIELDS is not valid JSON', { cause: error });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('JIRA_EXTRA_FIELDS must be a JSON object of Jira field ids');
    }
    for (const reserved of ['project', 'issuetype', 'summary', 'description', 'labels']) {
      if (reserved in parsed) {
        throw new Error(
          `JIRA_EXTRA_FIELDS must not override "${reserved}" — it is owned by the filer`,
        );
      }
    }
    extraFields = parsed as Record<string, unknown>;
  }

  return {
    extraLabels,
    linkTo: issueKey(source.JIRA_LINK_TO, 'JIRA_LINK_TO'),
    linkType: source.JIRA_LINK_TYPE?.trim() || 'Relates',
    parentKey: issueKey(source.JIRA_PARENT_KEY, 'JIRA_PARENT_KEY'),
    extraFields,
  };
}

/**
 * Sanitize one value into a valid Jira label: leading `@` (Gherkin tag
 * syntax) stripped, anything outside a conservative charset replaced with
 * `-` (Jira labels cannot contain spaces).
 *
 * @param value - Raw tag or token, e.g. "@wafermap".
 */
function label(value: string): string {
  return value.replace(/^@/, '').replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Full label set for a candidate: the fixed `e2e-auto` channel marker, the
 * `fp-<hash>` dedup key, a `found-<stage>` provenance label, and the
 * scenario's own tags (minus `@severity:`/`@epic:` which map to dedicated
 * Jira fields/labels elsewhere). Deduplicated via Set.
 *
 * @param c - The bug candidate being filed.
 * @param extra - Campaign labels from `JIRA_EXTRA_LABELS`, already sanitized.
 */
function candidateLabels(c: BugCandidate, extra: readonly string[] = []): string[] {
  const tagLabels = c.tags
    .filter((t) => !t.startsWith('@severity:') && !t.startsWith('@epic:'))
    .map(label);
  return [
    ...new Set([
      'e2e-auto',
      `fp-${c.fingerprint}`,
      `found-${c.foundDuring}`,
      ...tagLabels,
      ...extra,
    ]),
  ];
}

/**
 * Issue summary: "[E2E] <scenario> — <failing step>", truncated to fit
 * Jira's 255-char summary limit.
 *
 * @param c - The bug candidate being filed.
 */
function summaryLine(c: BugCandidate): string {
  return `[E2E] ${c.scenario} — ${c.failingStep}`.slice(0, 250);
}

/*
 * Minimal ADF builders — Jira Cloud REST v3 rejects plain-text descriptions
 * and comments; everything must be Atlassian Document Format.
 */

/** ADF paragraph node wrapping one plain-text run. */
function adfParagraph(text: string): object {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
/** ADF code-block node — used for the raw error message so Jira preserves formatting. */
function adfCode(text: string): object {
  return { type: 'codeBlock', content: [{ type: 'text', text }] };
}
/** ADF document root wrapping the given block nodes. */
function adfDoc(content: object[]): object {
  return { type: 'doc', version: 1, content };
}

/**
 * Build the ADF issue description: scenario, failing step,
 * severity/classification, environment (env, commit, project, OS, CI),
 * source location, and occurrence count as paragraphs; then the raw error in
 * a code block; then triage notes and evidence paths when present.
 *
 * @param c - The bug candidate being filed.
 */
function description(c: BugCandidate): object {
  const lines = [
    `Scenario: ${c.scenario}`,
    `Failing step: ${c.failingStep}`,
    `Test outcome: ${c.outcome}`,
    `Severity: ${c.severity ?? 'unset'} · Classification: ${c.classification ?? 'unset'}`,
    `Environment: ${c.environment.env} · commit ${c.environment.commit} · ` +
      `${c.project} · ${c.environment.os} · CI: ${c.environment.ci}`,
    `Location: ${c.location}`,
    `Occurrences: ${c.occurrences.length} (first ${c.occurrences[0]})`,
  ];
  const blocks: object[] = lines.map(adfParagraph);
  blocks.push(adfParagraph('Error:'), adfCode(c.error.message));
  if (c.triageNotes) blocks.push(adfParagraph(`Triage notes: ${c.triageNotes}`));
  if (c.attachments.length > 0)
    blocks.push(adfParagraph(`Evidence: ${c.attachments.map((a) => a.path).join(' · ')}`));
  return adfDoc(blocks);
}

/**
 * Perform one authenticated Jira REST call (Basic auth: email + API token,
 * base64-encoded per Atlassian Cloud convention). JSON in/out; the caller
 * inspects the Response for status handling.
 *
 * @param env - Resolved Jira connection settings.
 * @param method - HTTP method.
 * @param apiPath - Path under the base URL, e.g. "/rest/api/3/issue".
 * @param body - Optional payload, JSON-stringified when present.
 */
async function jira(
  env: JiraEnv,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${env.baseUrl}${apiPath}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.email}:${env.token}`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function jiraIssueKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/.test(value)) {
    throw new Error(`Jira returned an invalid issue key: ${String(value)}`);
  }
  return value;
}

/**
 * The dedup lookup: newest OPEN issue (statusCategory != Done) carrying this
 * candidate's `fp-<hash>` label, or null. Closed issues intentionally don't
 * match — a regression after a fix deserves a fresh ticket, not a comment on
 * a resolved one.
 *
 * @param env - Resolved Jira connection settings.
 * @param fp - The candidate's failure fingerprint hash.
 * @returns The existing issue key, or null when this failure is new.
 */
async function findOpenByFingerprint(env: JiraEnv, fp: string): Promise<string | null> {
  const jql = `project = ${env.projectKey} AND labels = "fp-${fp}" AND statusCategory != Done ORDER BY created DESC`;
  const res = await jira(env, 'POST', '/rest/api/3/search/jql', {
    jql,
    maxResults: 1,
    fields: ['key'],
  });
  if (!res.ok) throw new Error(`Jira search failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { issues?: Array<{ key?: unknown }> };
  const key = data.issues?.[0]?.key;
  return key === undefined ? null : jiraIssueKey(key);
}

/**
 * Dedup path: append an occurrence comment (latest occurrence date, env,
 * commit, running total) to an existing open issue instead of filing a
 * duplicate.
 *
 * @param env - Resolved Jira connection settings.
 * @param key - Existing issue key found by fingerprint.
 * @param c - The re-occurring candidate.
 */
async function addOccurrenceComment(env: JiraEnv, key: string, c: BugCandidate): Promise<void> {
  const res = await jira(env, 'POST', `/rest/api/3/issue/${key}/comment`, {
    body: adfDoc([
      adfParagraph(
        `Re-occurred: ${c.occurrences[c.occurrences.length - 1]} · env ${c.environment.env} · ` +
          `commit ${c.environment.commit} · total occurrences: ${c.occurrences.length}`,
      ),
    ]),
  });
  if (!res.ok) throw new Error(`Jira comment failed (${res.status}): ${await res.text()}`);
}

/**
 * Create the Jira issue for a new (non-duplicate) candidate: summary, ADF
 * description, labels, and priority mapped from the severity ladder
 * (defaulting unset severity to medium). A 400 response triggers ONE retry
 * without the priority field — team-managed Jira projects often have no
 * priority field and reject payloads that set it.
 *
 * @param env - Resolved Jira connection settings.
 * @param c - The bug candidate being filed.
 * @returns The created issue key.
 */
async function createIssue(env: JiraEnv, c: BugCandidate): Promise<string> {
  if (c.severity === null) throw new Error(`Candidate ${c.fingerprint} has no triaged severity`);
  const fields: Record<string, unknown> = {
    project: { key: env.projectKey },
    issuetype: { name: env.issueType },
    summary: summaryLine(c),
    description: description(c),
    labels: candidateLabels(c, env.extraLabels),
    priority: { name: PRIORITY[c.severity] },
  };
  if (env.parentKey !== null) fields.parent = { key: env.parentKey };
  Object.assign(fields, env.extraFields);

  let res = await jira(env, 'POST', '/rest/api/3/issue', { fields });
  if (res.status === 400) {
    // Team-managed projects often have no priority field — retry without it.
    delete fields.priority;
    res = await jira(env, 'POST', '/rest/api/3/issue', { fields });
  }
  if (res.status === 400 && fields.parent !== undefined) {
    // Only drop `parent` when Jira actually complained about IT. A 400 listing
    // other missing required fields is not evidence the parent was rejected —
    // stripping it there turns one clear error into two and loses the epic.
    const detail = await res.text();
    if (/\bparent\b/i.test(detail)) {
      console.warn(
        `  ! ${env.parentKey} was rejected as a parent — filing without it. ` +
          `Set the epic manually. Jira said: ${detail.slice(0, 200)}`,
      );
      delete fields.parent;
      res = await jira(env, 'POST', '/rest/api/3/issue', { fields });
    } else {
      throw new Error(`Jira create failed (400): ${detail}`);
    }
  }
  if (!res.ok) throw new Error(`Jira create failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { key?: unknown };
  const key = jiraIssueKey(data.key);

  // Link to the campaign/umbrella ticket, if one is configured. Done as a
  // separate call rather than an `issuelinks` field on create: many Jira
  // configurations reject that field on the create screen, and a failure there
  // would lose the whole issue rather than just the link.
  if (env.linkTo !== null) await linkIssue(env, key, env.linkTo);
  return key;
}

/**
 * Link a freshly created bug to an existing issue.
 *
 * Deliberately non-fatal: the bug itself is already filed and its evidence is
 * intact, so a link failure is reported and the run continues rather than
 * leaving a filed issue behind a thrown error. A missing link is visible and
 * cheap to add by hand; a lost issue is not.
 *
 * @param env - Resolved Jira connection settings.
 * @param inward - The newly created bug key.
 * @param outward - The issue it should be linked to.
 */
async function linkIssue(env: JiraEnv, inward: string, outward: string): Promise<void> {
  const res = await jira(env, 'POST', '/rest/api/3/issueLink', {
    type: { name: env.linkType },
    inwardIssue: { key: inward },
    outwardIssue: { key: outward },
  });
  if (!res.ok) {
    console.warn(
      `  ! ${inward} was filed but could not be linked to ${outward} ` +
        `(${res.status}) — add the link manually, or check that "${env.linkType}" is a valid link type.`,
    );
  }
}

/**
 * Upload the candidate's evidence files (traces, screenshots, logs) as issue
 * attachments via multipart form-data with Jira's required
 * `X-Atlassian-Token: no-check` XSRF header. Missing, escaped, oversized, or
 * rejected evidence is fatal: the candidate remains queued until its full
 * evidence package is attached successfully.
 *
 * @param env - Resolved Jira connection settings.
 * @param key - Issue key to attach evidence to.
 * @param attachments - The explicitly reviewed attachment subset to upload.
 */
const EVIDENCE_ROOTS = [
  path.join(REPO_ROOT, '.probe', 'artifacts', 'bug-sync', 'evidence'),
  path.join(REPO_ROOT, 'test-results'),
  path.join(REPO_ROOT, 'reports'),
];
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function isSensitiveEvidence(attachment: BugCandidate['attachments'][number]): boolean {
  const extension = path.extname(attachment.path).toLowerCase();
  return (
    extension === '.har' ||
    extension === '.zip' ||
    /(^|[^a-z])(trace|har)([^a-z]|$)/i.test(`${attachment.name} ${attachment.path}`)
  );
}

/**
 * Enforce live-filing readiness and return the reviewed upload set. Review is
 * bound to the exact current path set. Traces/HARs remain excluded unless the
 * reviewer lists them again in `approvedSensitivePaths`.
 */
export function approvedEvidenceForLiveFiling(
  candidate: BugCandidate,
): BugCandidate['attachments'] {
  if (candidate.classification !== 'app-bug' || candidate.severity === null) {
    throw new Error(`Candidate ${candidate.fingerprint} needs app-bug classification and severity`);
  }
  const review = candidate.evidenceReview;
  if (review === null) {
    throw new Error(`Candidate ${candidate.fingerprint} evidence has not been explicitly reviewed`);
  }

  const currentPaths = candidate.attachments.map((attachment) => attachment.path);
  const approvedPaths = new Set(review.approvedPaths);
  if (
    approvedPaths.size !== currentPaths.length ||
    currentPaths.some((attachmentPath) => !approvedPaths.has(attachmentPath))
  ) {
    throw new Error(
      `Candidate ${candidate.fingerprint} evidence review does not match the current attachment set`,
    );
  }

  const approvedSensitivePaths = new Set(review.approvedSensitivePaths);
  for (const approvedPath of approvedSensitivePaths) {
    const attachment = candidate.attachments.find((item) => item.path === approvedPath);
    if (attachment === undefined || !isSensitiveEvidence(attachment)) {
      throw new Error(`Sensitive approval is invalid for non-sensitive path: ${approvedPath}`);
    }
  }
  return candidate.attachments.filter(
    (attachment) => !isSensitiveEvidence(attachment) || approvedSensitivePaths.has(attachment.path),
  );
}

function isInside(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(baseDir), path.resolve(candidatePath));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** Resolve one evidence path, including symlink containment and size checks. */
export function resolveEvidenceAttachment(attachmentPath: string): string {
  const lexical = resolveWithinDirectory(REPO_ROOT, attachmentPath, 'Evidence attachment');
  const allowedRoot = EVIDENCE_ROOTS.find((root) => isInside(root, lexical));
  if (allowedRoot === undefined) {
    throw new Error(
      `Evidence attachment is outside approved artifact directories: ${attachmentPath}`,
    );
  }
  if (!fs.existsSync(lexical)) throw new Error(`Evidence attachment is missing: ${attachmentPath}`);
  const realFile = fs.realpathSync(lexical);
  const realRoot = fs.existsSync(allowedRoot) ? fs.realpathSync(allowedRoot) : allowedRoot;
  if (!isInside(realRoot, realFile)) {
    throw new Error(
      `Evidence attachment symlink escapes its artifact directory: ${attachmentPath}`,
    );
  }
  const stat = fs.statSync(realFile);
  if (!stat.isFile())
    throw new Error(`Evidence attachment is not a regular file: ${attachmentPath}`);
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Evidence attachment exceeds 25 MiB: ${attachmentPath}`);
  }
  return realFile;
}

async function attachEvidence(
  env: JiraEnv,
  key: string,
  attachments: BugCandidate['attachments'],
): Promise<void> {
  const resolved = attachments.map((att) => ({ att, abs: resolveEvidenceAttachment(att.path) }));
  for (const { att, abs } of resolved) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(abs)]), path.basename(att.path));
    const res = await fetch(`${env.baseUrl}/rest/api/3/issue/${key}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.email}:${env.token}`).toString('base64')}`,
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    });
    if (!res.ok) {
      throw new Error(
        `Jira attachment failed (${res.status}) for ${att.path}: ${(await res.text()).slice(0, 1000)}`,
      );
    }
  }
}

/**
 * Load candidates to process: the one file named by `--candidate` when
 * given, otherwise every *.json in the candidates queue directory (empty
 * list when the directory doesn't exist yet). Each result keeps its source
 * path so `main` can move the file to filed/ after a successful sync.
 *
 * @param single - Optional path (absolute or repo-relative) to one candidate.
 */
export function resolveCandidateFile(candidatePath: string): string {
  const queueDir = path.resolve(REPO_ROOT, CANDIDATES_DIR);
  const requested = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(REPO_ROOT, candidatePath);
  if (!isInside(queueDir, requested) || path.extname(requested).toLowerCase() !== '.json') {
    throw new Error(`Candidate must be a .json file inside ${CANDIDATES_DIR}: ${candidatePath}`);
  }
  if (!fs.existsSync(requested)) throw new Error(`Candidate file not found: ${candidatePath}`);
  const realQueue = fs.realpathSync(queueDir);
  const realCandidate = fs.realpathSync(requested);
  if (!isInside(realQueue, realCandidate) || !fs.statSync(realCandidate).isFile()) {
    throw new Error(`Candidate escapes its queue or is not a regular file: ${candidatePath}`);
  }
  return realCandidate;
}

function readCandidate(file: string): BugCandidate {
  try {
    return parseBugCandidate(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (error) {
    throw new Error(
      `Cannot load bug candidate ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function loadCandidates(single?: string): Array<{ file: string; candidate: BugCandidate }> {
  if (single !== undefined) {
    const file = resolveCandidateFile(single);
    return [{ file, candidate: readCandidate(file) }];
  }
  const dir = path.join(REPO_ROOT, CANDIDATES_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = path.join(dir, f);
      const resolved = resolveCandidateFile(file);
      return { file: resolved, candidate: readCandidate(resolved) };
    });
}

/**
 * Orchestrates the sync (npm run bug:sync). Flow: load candidates → keep
 * only `classification === 'app-bug'` (everything else is held with a triage
 * reminder) → per candidate: dry-run printout when Jira env is absent; skip
 * when already filed (candidate carries a Jira key); comment on the open
 * fingerprint match when found; otherwise create the issue and upload
 * evidence. After filing, the issue key/url is written back into the
 * candidate JSON and the file moved from the candidates queue to filed/ so
 * repeat runs are naturally idempotent.
 */
function archiveFiledCandidate(file: string, candidate: BugCandidate): string {
  const filedDir = path.join(REPO_ROOT, FILED_DIR);
  fs.mkdirSync(filedDir, { recursive: true });
  const filedAt = candidate.jira?.filedAt.replace(/[^0-9A-Za-z]/g, '-') ?? 'unknown-date';
  const target = path.join(
    filedDir,
    `${candidate.fingerprint}-${filedAt}-${crypto.randomUUID()}.json`,
  );
  fs.writeFileSync(file, `${JSON.stringify(candidate, null, 2)}\n`);
  fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(file);
  return target;
}

export async function main(
  args: string[] = process.argv.slice(2),
  source: NodeJS.ProcessEnv = environmentWithDotEnv(),
): Promise<void> {
  const argIndex = args.indexOf('--candidate');
  if (argIndex >= 0 && (args[argIndex + 1] === undefined || args[argIndex + 1]?.startsWith('--'))) {
    throw new Error('--candidate requires a candidate JSON path');
  }
  const single = argIndex >= 0 ? args[argIndex + 1] : undefined;
  const env = resolveJiraEnvironment(source, args.includes('--live'));
  // Resolved separately so the dry-run preview shows the same labels, parent and
  // link the live run would apply.
  const filing = resolveFilingOptions(source);

  const all = loadCandidates(single);
  if (all.length === 0) {
    process.stdout.write(`No bug candidates found in ${CANDIDATES_DIR}.\n`);
    return;
  }

  const fileable = all.filter(
    ({ candidate }) => candidate.classification === 'app-bug' && candidate.severity !== null,
  );
  const held = all.length - fileable.length;

  process.stdout.write(
    `Jira bug sync — ${all.length} candidate(s), ${fileable.length} triaged app-bug` +
      (held > 0 ? `, ${held} held (classification and severity required)` : '') +
      '\n',
  );

  for (const { file, candidate } of fileable) {
    const summary = summaryLine(candidate);
    if (candidate.severity === null)
      throw new Error(`Candidate ${candidate.fingerprint} has no severity`);

    // ALREADY FILED IS DECIDED FIRST, and the order is the point.
    //
    // The evidence gate exists to control what LEAVES this repository. A candidate
    // that already carries a Jira key uploads nothing — it is only being archived
    // out of the triage queue — so demanding an evidence review for it gates an
    // action that never happens. Computing `approvedEvidence` first made the whole
    // command exit non-zero on a candidate it was going to archive anyway, which is
    // the kind of false failure that teaches people to ignore a red build.
    if (env !== null && candidate.jira !== null) {
      const archived = archiveFiledCandidate(file, candidate);
      process.stdout.write(`  already filed as ${candidate.jira.key} — archived ${archived}\n`);
      continue;
    }

    let approvedEvidence: BugCandidate['attachments'];
    try {
      approvedEvidence = approvedEvidenceForLiveFiling(candidate);
    } catch (error) {
      if (env !== null) throw error;
      process.stdout.write(
        `\n  HOLD: ${summary}\n` +
          `    ${error instanceof Error ? error.message : String(error)}\n` +
          '    Review the exact attachment paths before using live mode.\n',
      );
      continue;
    }
    candidate.attachments.forEach((attachment) => resolveEvidenceAttachment(attachment.path));
    if (env === null) {
      const excluded = candidate.attachments.length - approvedEvidence.length;
      process.stdout.write(
        `\n  DRY RUN (pass --live or set JIRA_SYNC_MODE=live with complete Jira credentials)\n` +
          `  would create: ${summary}\n` +
          (filing.parentKey !== null ? `    parent: ${filing.parentKey}\n` : '') +
          (filing.linkTo !== null ? `    link: ${filing.linkType} → ${filing.linkTo}\n` : '') +
          (Object.keys(filing.extraFields).length > 0
            ? `    extra fields: ${JSON.stringify(filing.extraFields)}\n`
            : '') +
          `    priority: ${PRIORITY[candidate.severity]} · labels: ${candidateLabels(candidate, filing.extraLabels).join(', ')}\n` +
          `    dedup key: fp-${candidate.fingerprint} (open issue with this label → comment, not duplicate)\n` +
          `    attachments: ${approvedEvidence.map((a) => a.path).join(' · ') || '(none)'}` +
          (excluded > 0 ? ` · ${excluded} sensitive artifact(s) excluded` : '') +
          '\n',
      );
      continue;
    }
    const existing = await findOpenByFingerprint(env, candidate.fingerprint);
    if (existing !== null) {
      await attachEvidence(env, existing, approvedEvidence);
      await addOccurrenceComment(env, existing, candidate);
      process.stdout.write(`  ${existing}: added occurrence comment (fingerprint match)\n`);
      candidate.jira = {
        key: existing,
        url: `${env.baseUrl}/browse/${existing}`,
        filedAt: new Date().toISOString(),
      };
    } else {
      const key = await createIssue(env, candidate);
      await attachEvidence(env, key, approvedEvidence);
      candidate.jira = {
        key,
        url: `${env.baseUrl}/browse/${key}`,
        filedAt: new Date().toISOString(),
      };
      process.stdout.write(`  created ${key}: ${summary}\n    ${candidate.jira.url}\n`);
    }
    // Unique, exclusive archive names preserve every regression occurrence.
    archiveFiledCandidate(file, candidate);
  }
}

/* CLI entry (npm run bug:sync): run the sync; any thrown error fails the process with exit 1. */
if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`bug:sync failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
