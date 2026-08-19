/**
 * Connection check for the two external systems PROBE writes to: AIO Tests
 * (case sync) and Jira (bug filing).
 *
 * WHY: `/yw:sync-cases` is defined against six verbs, and `check` is the first
 * of them — "confirm the token authenticates against the configured project"
 * (see vendor/probe/plugins/yieldwerx-probe/references/integrations/
 * case-management.md). Without it, the first time anyone learns the token is
 * wrong is halfway through a `--live` push, with some records already created.
 * This script is that verb, runnable on its own.
 *
 * READ-ONLY BY CONSTRUCTION. Every request here is a GET. Nothing in this file
 * can create, update, or delete a record in either system, so it is always safe
 * to run — including against production — and needs no human authorization.
 *
 * Usage:
 *   npm run check:connections   # both
 *   npm run check:aio           # AIO Tests only
 *   npm run check:jira          # Jira only
 *
 * Exit code is 0 only when every requested check passes, so CI can gate on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { REPO_ROOT } from '../src/core/paths';
import { resolveEnvName } from '../src/core/config';

/** How long any single request may take before it is called unreachable. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Env layering, matching src/core/config.ts: `.env.<env>` wins over `.env`, and
 * a real process env var wins over both (dotenv never overwrites).
 *
 * The environment name comes from resolveEnvName() rather than
 * `process.env.E2E_ENV` directly, because E2E_ENV is itself commonly set inside
 * `.env` — reading it from the process first would resolve to the default and
 * silently skip `.env.<env>` entirely. That function already encodes the rule:
 * a shell/CI value wins, otherwise the generic `.env` selects the environment
 * before `.env.<env>` is known.
 */
function loadEnv(): string {
  const activeEnv = resolveEnvName();
  for (const file of [`.env.${activeEnv}`, '.env']) {
    const full = path.join(REPO_ROOT, file);
    if (fs.existsSync(full)) dotenv.config({ path: full });
  }
  return activeEnv;
}

type Status = 'pass' | 'fail' | 'skip';

interface Line {
  label: string;
  value: string;
}

interface Result {
  system: string;
  status: Status;
  /** What was established, shown on success and failure alike. */
  lines: Line[];
  /** Why it failed, in one sentence. */
  problem?: string;
  /** The concrete next action. Never "check your configuration". */
  fix?: string;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Show enough of a token to tell two of them apart, never enough to use one.
 * Output may be pasted into a ticket or a CI log, so this is not optional.
 */
function mask(secret: string): string {
  if (secret.length <= 8) return `${'*'.repeat(secret.length)} (${secret.length} chars)`;
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

interface Fetched {
  ok: boolean;
  status: number;
  body: unknown;
  /** Set only when the request never produced a response at all. */
  transportError?: string;
}

async function get(url: string, headers: Record<string, string>): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch {
      /* A non-JSON body is itself a finding — an HTML login page usually means
         the base URL points at a UI route rather than the API. Keep the text. */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, transportError: describeError(error) };
  }
}

/**
 * Node's fetch reports every transport failure as the message "fetch failed"
 * and hides the real reason — ENOTFOUND, ECONNREFUSED, a TLS error — one or
 * more levels down in `cause`. Walk the chain so the diagnosis can be specific
 * instead of telling the reader only that something went wrong.
 */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    parts.push(code ? `${current.message} (${code})` : current.message);
    current = (current as { cause?: unknown }).cause;
  }
  if (parts.length === 0) return String(error);
  /* Innermost first: it is the one that says what actually happened. */
  return parts.reverse().join(' ← ');
}

/** Reads a string field from an unknown JSON body without asserting a shape. */
function str(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A token sent over plain HTTP is disclosed to anything on the path. Refuse
 * rather than "successfully" checking a connection that leaked the credential.
 */
function httpsProblem(base: string, varName: string): Result['problem'] | undefined {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return `${varName} is not a valid URL: ${base}`;
  }
  if (parsed.protocol === 'https:') return undefined;
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return undefined;
  return `${varName} uses ${parsed.protocol}//, which would send the credential in clear text`;
}

function missing(names: string[]): string[] {
  return names.filter((n) => (process.env[n] ?? '').trim() === '');
}

/** Turns a transport failure into the specific thing that is actually wrong. */
function diagnoseTransport(message: string, host: string): string {
  if (/timed out|TimeoutError|aborted/i.test(message))
    return `No response from ${host} within ${REQUEST_TIMEOUT_MS / 1000}s — host unreachable, or a proxy is swallowing the request.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message))
    return `${host} does not resolve — check the hostname, or that you are on the network/VPN that can see it.`;
  if (/ECONNREFUSED/i.test(message)) return `${host} refused the connection.`;
  if (/certificate|CERT_|self-signed|SSL/i.test(message))
    return `TLS failed against ${host}: ${message}`;
  return `Request to ${host} failed: ${message}`;
}

/* ------------------------------------------------------------------ */
/* AIO Tests                                                           */
/* ------------------------------------------------------------------ */

/**
 * Non-secret AIO settings, if the repo keeps them in a committed file. This is
 * the shape test-ops/e2e uses (config/aio-sync.json: apiBaseUrl, projectKey,
 * auth), and the same precedence — the file supplies conventions, the
 * environment supplies secrets and overrides.
 *
 * The BOM strip is not defensive padding. That file is edited on Windows and
 * carries a UTF-8 BOM; JSON.parse rejects it outright, which silently broke
 * every read-back helper in test-ops while the plugin's own loader kept working
 * because it strips one.
 */
function aioFileConfig(): { apiBaseUrl?: string; projectKey?: string; auth?: string } {
  const file = path.join(REPO_ROOT, 'config', 'aio-sync.json');
  if (!fs.existsSync(file)) return {};
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
    if (typeof raw !== 'object' || raw === null) return {};
    const o = raw as Record<string, unknown>;
    return {
      apiBaseUrl: typeof o.apiBaseUrl === 'string' ? o.apiBaseUrl : undefined,
      projectKey: typeof o.projectKey === 'string' ? o.projectKey : undefined,
      auth: typeof o.auth === 'string' ? o.auth : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * AIO Tests. The endpoint is the one test-ops/e2e has proven in the field:
 *
 *   GET /project/{jiraProjectId}/testcase?maxResults=1
 *
 * It is in the published OpenAPI document
 * (https://tcms.aiojiraapps.com/aio-tcms/api/v1/openapi.json), and it is the
 * right probe rather than merely a reachable one: Case Sync's job is reading
 * and writing test cases, so proving *case* access is proving the thing that
 * matters. A project-config read can succeed while case access is denied.
 * `maxResults=1` keeps it cheap on a project with thousands of cases.
 *
 * Auth is the spec's `api` security scheme: an `Authorization` header carrying
 * the token with `AioAuth ` prepended. Basic is also accepted, which is what
 * AIO_AUTH_MODE=basic selects — the only mode that needs AIO_EMAIL.
 */
async function checkAio(): Promise<Result> {
  const lines: Line[] = [];
  const file = aioFileConfig();
  const base = trimBase(
    process.env.AIO_API_BASE_URL ??
      file.apiBaseUrl ??
      'https://tcms.aiojiraapps.com/aio-tcms/api/v1',
  );
  const mode = (process.env.AIO_AUTH_MODE ?? file.auth ?? 'aioauth').toLowerCase();
  const required = [
    'AIO_API_TOKEN',
    ...(file.projectKey ? [] : ['AIO_PROJECT_KEY']),
    ...(mode === 'basic' ? ['AIO_EMAIL'] : []),
  ];

  const absent = missing(required);
  if (absent.length > 0) {
    return {
      system: 'AIO Tests',
      status: 'skip',
      lines: [{ label: 'auth mode', value: mode }],
      problem: `not configured — ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} unset`,
      fix: `Set ${absent.join(', ')} in .env (see .env.example). The token comes from AIO Tests → API Token.`,
    };
  }

  const token = (process.env.AIO_API_TOKEN ?? '').trim();
  const project = (process.env.AIO_PROJECT_KEY ?? file.projectKey ?? '').trim();
  const email = (process.env.AIO_EMAIL ?? '').trim();

  lines.push({ label: 'base URL', value: base });
  lines.push({ label: 'project', value: project });
  lines.push({ label: 'auth mode', value: mode });
  lines.push({ label: 'token', value: mask(token) });

  const insecure = httpsProblem(base, 'AIO_API_BASE_URL');
  if (insecure) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: insecure,
      fix: 'Point AIO_API_BASE_URL at the https:// endpoint. Nothing was sent.',
    };
  }

  const authorization =
    mode === 'basic'
      ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
      : `AioAuth ${token}`;

  const url = `${base}/project/${encodeURIComponent(project)}/testcase?maxResults=1`;
  const res = await get(url, { Authorization: authorization });

  if (res.transportError) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: diagnoseTransport(res.transportError, new URL(base).host),
    };
  }

  lines.push({ label: 'GET …/testcase?maxResults=1', value: String(res.status) });

  if (res.status === 401) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: 'The token was rejected (401).',
      fix:
        mode === 'basic'
          ? 'Confirm AIO_EMAIL and AIO_API_TOKEN are the pair AIO issued, or drop AIO_AUTH_MODE to use the default AioAuth token mode.'
          : 'Regenerate the token in AIO Tests → API Token and update AIO_API_TOKEN. Paste it raw — the script adds the "AioAuth " prefix itself.',
    };
  }
  if (res.status === 403) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: `The token is valid, but it has no permission on project "${project}" (403).`,
      fix: 'Grant this AIO account access to that project. The token itself is fine — reissuing it will not help.',
    };
  }
  if (res.status === 404) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: `The token authenticated, but nothing was found at that path (404).`,
      fix: `Verify AIO_PROJECT_KEY "${project}" and AIO_API_BASE_URL "${base}" — a wrong base URL and a wrong project key both land here. Cloud is /aio-tcms/api/v1; Server/DC is /<context>/rest/aio-tcms-api/1.0.`,
    };
  }
  if (!res.ok) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: `Unexpected ${res.status} from AIO Tests.`,
      fix:
        typeof res.body === 'string'
          ? res.body.slice(0, 300)
          : JSON.stringify(res.body).slice(0, 300),
    };
  }

  /* The config call proves auth and project. Case Sync's `explore` verb also
     needs the folder tree, so prove that separately rather than let a later
     permission error surface mid-sync. */
  const folders = await get(`${base}/project/${encodeURIComponent(project)}/testcase/folder`, {
    Authorization: authorization,
  });
  lines.push({
    label: 'GET …/testcase/folder',
    value: folders.transportError ? 'unreachable' : String(folders.status),
  });
  if (!folders.ok && !folders.transportError) {
    return {
      system: 'AIO Tests',
      status: 'fail',
      lines,
      problem: `Authenticated, but the case folder tree returned ${folders.status}.`,
      fix: 'Case Sync needs to read folders to check for duplicates. Grant this token access to test cases in that project.',
    };
  }

  return { system: 'AIO Tests', status: 'pass', lines };
}

/* ------------------------------------------------------------------ */
/* Jira                                                                */
/* ------------------------------------------------------------------ */

/**
 * Jira Cloud platform REST API v3, Basic auth with the Atlassian account email
 * as username and an API token as password (never the account password).
 *
 *   GET /rest/api/3/myself                  — proves the credential
 *   GET /rest/api/3/project/{projectIdOrKey} — proves the project is visible
 *
 * Two calls rather than one, because they fail for different reasons and a
 * single combined verdict would send you looking in the wrong place.
 */
async function checkJira(): Promise<Result> {
  const lines: Line[] = [];
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'];

  const absent = missing(required);
  if (absent.length > 0) {
    return {
      system: 'Jira',
      status: 'skip',
      lines: [],
      problem: `not configured — ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} unset`,
      fix: `Set ${absent.join(', ')} in .env (see .env.example). The token comes from id.atlassian.com → Security → API tokens.`,
    };
  }

  const base = trimBase((process.env.JIRA_BASE_URL ?? '').trim());
  const email = (process.env.JIRA_EMAIL ?? '').trim();
  const token = (process.env.JIRA_API_TOKEN ?? '').trim();
  const project = (process.env.JIRA_PROJECT_KEY ?? '').trim();
  const issueType = (process.env.JIRA_ISSUE_TYPE ?? 'Bug').trim();

  lines.push({ label: 'base URL', value: base });
  lines.push({ label: 'account', value: email });
  lines.push({ label: 'project', value: project });
  lines.push({ label: 'token', value: mask(token) });

  const insecure = httpsProblem(base, 'JIRA_BASE_URL');
  if (insecure) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: insecure,
      fix: 'Point JIRA_BASE_URL at the https:// site URL. Nothing was sent.',
    };
  }

  /* A base URL carrying credentials, a query, or a fragment is a
     misconfiguration that would otherwise be sent to Jira — and embedded
     credentials would then sit in every log line that echoes the URL. */
  const parsedBase = new URL(base);
  if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: 'JIRA_BASE_URL carries credentials, a query string, or a fragment.',
      fix: 'It must be the bare site URL, e.g. https://your-company.atlassian.net. Nothing was sent.',
    };
  }

  /* Jira project keys are uppercase-ish short identifiers. Catching a typo here
     costs nothing; catching it as a 404 later reads like a permissions problem. */
  if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(project)) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: `JIRA_PROJECT_KEY "${project}" is not a valid Jira project key.`,
      fix: 'A key starts with a letter and is up to 20 letters, digits, or underscores. Nothing was sent.',
    };
  }
  if (issueType.length > 100) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: 'JIRA_ISSUE_TYPE is longer than the 100 characters Jira accepts.',
      fix: 'Nothing was sent.',
    };
  }

  const authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  const me = await get(`${base}/rest/api/3/myself`, { Authorization: authorization });
  if (me.transportError) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: diagnoseTransport(me.transportError, new URL(base).host),
    };
  }

  lines.push({ label: 'GET /rest/api/3/myself', value: String(me.status) });

  if (me.status === 401) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: 'Jira rejected the credential (401).',
      fix: 'JIRA_API_TOKEN must be an API token from id.atlassian.com → Security → API tokens, not the account password, and JIRA_EMAIL must be the account that owns it.',
    };
  }
  if (me.status === 403) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: 'The credential is valid but Jira refused it (403).',
      fix: 'The account is authenticated but lacks API access — often a site-level restriction or a deactivated user.',
    };
  }
  if (!me.ok) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: `Unexpected ${me.status} from /rest/api/3/myself.`,
      fix:
        typeof me.body === 'string' && me.body.trimStart().startsWith('<')
          ? 'The response was HTML, not JSON — JIRA_BASE_URL is probably pointing at a UI route rather than the site root.'
          : undefined,
    };
  }

  const who = str(me.body, 'displayName') ?? str(me.body, 'emailAddress') ?? 'authenticated';
  lines.push({ label: 'signed in as', value: who });

  const proj = await get(`${base}/rest/api/3/project/${encodeURIComponent(project)}`, {
    Authorization: authorization,
  });
  lines.push({
    label: `GET /rest/api/3/project/${project}`,
    value: proj.transportError ? 'unreachable' : String(proj.status),
  });

  if (proj.status === 404) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: `Signed in as ${who}, but project "${project}" is not visible to that account (404).`,
      fix: 'Set JIRA_PROJECT_KEY to a project key this account can browse — a key that exists but is not shared with the account also returns 404.',
    };
  }
  if (!proj.ok) {
    return {
      system: 'Jira',
      status: 'fail',
      lines,
      problem: `Unexpected ${proj.status} reading project "${project}".`,
    };
  }

  const projectName = str(proj.body, 'name');
  if (projectName) lines.push({ label: 'project name', value: projectName });

  /* The project payload usually carries its issue types. Validate the configured
     one against it when present, and say nothing rather than claim a check that
     did not happen when it is absent. */
  const rawTypes =
    typeof proj.body === 'object' && proj.body !== null
      ? (proj.body as Record<string, unknown>).issueTypes
      : undefined;
  if (Array.isArray(rawTypes)) {
    const names = rawTypes
      .map((t) =>
        typeof t === 'object' && t !== null ? (t as Record<string, unknown>).name : null,
      )
      .filter((n): n is string => typeof n === 'string');
    if (names.length > 0 && !names.includes(issueType)) {
      return {
        system: 'Jira',
        status: 'fail',
        lines,
        problem: `JIRA_ISSUE_TYPE "${issueType}" is not an issue type in ${project}.`,
        fix: `Available: ${names.join(', ')}.`,
      };
    }
    if (names.includes(issueType)) lines.push({ label: 'issue type', value: `${issueType} ✓` });
  } else {
    lines.push({ label: 'issue type', value: `${issueType} (not verified — none listed)` });
  }

  /* Say plainly what this check does not cover. A Jira screen can require
     fields that neither the project payload nor the createmeta endpoint
     reports — test-ops hit exactly this on YWPD, whose Bug screen demands
     Components, Affects versions, and a custom iteration field. A green
     connection therefore means the credential and project are good, not that
     an issue will be accepted. */
  lines.push({
    label: 'note',
    value: 'connection only — a Bug screen may still require fields this cannot see',
  });

  return { system: 'Jira', status: 'pass', lines };
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */

const MARK: Record<Status, string> = { pass: '✓', fail: '✗', skip: '–' };

function report(results: Result[]): void {
  for (const r of results) {
    console.log(`\n${MARK[r.status]} ${r.system} — ${r.status.toUpperCase()}`);
    const width = Math.max(0, ...r.lines.map((l) => l.label.length));
    for (const l of r.lines) console.log(`    ${l.label.padEnd(width)}  ${l.value}`);
    if (r.problem) console.log(`\n    ${r.problem}`);
    if (r.fix) console.log(`    → ${r.fix}`);
  }
}

async function main(): Promise<void> {
  const activeEnv = loadEnv();

  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = requested.length > 0 ? requested : ['aio', 'jira'];

  const unknown = targets.filter((t) => t !== 'aio' && t !== 'jira');
  if (unknown.length > 0) {
    console.error(`Unknown target(s): ${unknown.join(', ')}. Use "aio", "jira", or neither.`);
    process.exit(2);
  }

  console.log(`Connection check — read-only, GET requests only (env: ${activeEnv})`);

  const results: Result[] = [];
  if (targets.includes('aio')) results.push(await checkAio());
  if (targets.includes('jira')) results.push(await checkJira());

  report(results);

  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'skip');

  console.log();
  if (failed.length === 0 && skipped.length === 0) {
    console.log('All checks passed.');
    process.exit(0);
  }

  /* An unconfigured system is a failed check, not a pass. Case Sync cannot run
     without it, and exiting 0 here would let CI report a connection it never
     made. */
  const names = [...failed, ...skipped].map((r) => r.system).join(', ');
  console.log(`Not usable: ${names}.`);
  process.exit(1);
}

/* Not top-level await: this package has no "type": "module", so tsx compiles
   these files as CommonJS and a top-level await would not parse. */
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(2);
});
