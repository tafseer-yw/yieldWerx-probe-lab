/**
 * Layered environment configuration, zod-validated at startup.
 *
 * WHY: the framework must run unchanged against local demo, staging, and CI
 * environments while keeping secrets out of the repo. Config therefore comes
 * from three layers with clear precedence (low → high):
 *   1. config/environments/<env>.json     — committed, no secrets
 *   2. .env / .env.<env>                  — local overrides, gitignored
 *   3. process.env E2E_*                  — CI-injected secrets & URLs
 *
 * The active environment is E2E_ENV (default "local"). Config is validated
 * once and cached; a schema violation aborts the run immediately with a
 * readable error — never mid-suite.
 *
 * Architecture fit: lives in src/core (the bottom layer — imports nothing
 * above it). Consumed via the `config` fixture in src/core/fixtures.ts, so
 * pages, API clients, and the DB layer all receive the same validated object
 * through DI rather than reading process.env themselves.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createLogger } from './logger';
import { ENV_CONFIG_DIR, REPO_ROOT } from './paths';

const log = createLogger('Config');
const SAFE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Username/password pair for one application role. Both default to '' so a
 * committed JSON file can declare a role without embedding secrets — the real
 * values are overlaid from E2E_<ROLE>_USERNAME / _PASSWORD env vars.
 */
const CredentialsSchema = z.object({
  username: z.string().default(''),
  password: z.string().default(''),
});

/**
 * SQL Server connection settings for the rule-engine DB verification layer.
 * `mock: true` (the default) routes all DB assertions to the in-memory stub
 * so suites stay runnable with no database reachable (see src/db/).
 *
 * TWO AUTHENTICATION MODES, and the required fields differ between them:
 *
 * - `sql` (default) — a SQL Server login. `username` and `password` are both
 *   required, and secrets must come from `.env`, never from committed JSON.
 * - `windows` — integrated/trusted connection, using the identity the test
 *   process already runs as. **No username or password is accepted**, because
 *   supplying either would silently be ignored and leave a reader believing a
 *   credential was in use.
 *
 * The `windows` mode exists because engineer workstations and the CI agent reach
 * SQL Server through the domain account rather than a SQL login, and requiring a
 * password there would mean inventing one purely to satisfy validation.
 */
const DbConfigSchema = z
  .object({
    /** When true, DB assertions run against the in-memory stub (see src/db/). */
    mock: z.boolean().default(true),
    /** How to authenticate when `mock` is false. */
    auth: z.enum(['sql', 'windows']).default('sql'),
    server: z.string().trim().default(''),
    port: z.number().int().positive().max(65_535).default(1433),
    database: z.string().trim().default(''),
    username: z.string().trim().default(''),
    password: z.string().default(''),
    trustServerCertificate: z.boolean().default(false),
  })
  .superRefine((db, context) => {
    if (db.mock) return;

    // Required for either mode: without these there is nothing to connect to.
    for (const field of ['server', 'database'] as const) {
      if (db[field].length === 0) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required when db.mock is false`,
        });
      }
    }

    if (db.auth === 'sql') {
      for (const field of ['username', 'password'] as const) {
        if (db[field].length === 0) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when db.mock is false and db.auth is "sql"`,
          });
        }
      }
      return;
    }

    // windows: reject credentials rather than ignore them. A config that carries a
    // username the driver never sends is a config that lies to whoever reads it.
    for (const field of ['username', 'password'] as const) {
      if (db[field].length > 0) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must be empty when db.auth is "windows" — a trusted connection uses the process identity, so a credential here would be silently ignored`,
        });
      }
    }
  });

/**
 * Centralized timeout budget (milliseconds). Named per operation class so
 * scenarios never hard-code magic waits — the no-hard-wait policy relies on
 * polling/wait helpers reading these bounds instead.
 */
const TimeoutsSchema = z.object({
  action: z.number().int().default(15_000),
  navigation: z.number().int().default(30_000),
  /** Upper bound for a Plotly render cycle (afterplot event). */
  chartRender: z.number().int().default(20_000),
  /** Upper bound for an async rule-engine queue job to complete. */
  queueJob: z.number().int().default(120_000),
  toast: z.number().int().default(10_000),
});

/**
 * Visual-regression reporting knobs.
 *
 * `screenshots` controls WHEN the `@visual` step attaches the baseline + actual
 * images to the report (Allure ingests all test attachments):
 *   - `always`      — attach both on every outcome, so a passing pixel gate
 *                     still shows what it approved (the default).
 *   - `on-failure`  — attach nothing extra; rely on the odiff matcher's own
 *                     expected/actual/diff attachments, which fire only when the
 *                     comparison fails. This is the "turn it off" setting.
 * The pixel comparison itself is unaffected — this only governs report evidence.
 */
const VisualConfigSchema = z.object({
  screenshots: z.enum(['always', 'on-failure']).default('always'),
});

/**
 * Top-level schema for one environment. Every nested section uses
 * `.prefault({})` so a minimal JSON file ({name, baseUrl, apiBaseUrl}) is
 * valid and all defaults apply — new environments start tiny and grow.
 */
export const EnvironmentConfigSchema = z.object({
  name: z.string(),
  /** UI origin. */
  baseUrl: z.url(),
  /** API origin. */
  apiBaseUrl: z.url(),
  auth: z
    .object({
      /** When true, auth setup writes empty storage states (no live login). */
      mock: z.boolean().default(false),
      /** Role name → credentials. Passwords come from env vars, never JSON. */
      roles: z.record(z.string().regex(SAFE_NAME_PATTERN), CredentialsSchema).default({}),
    })
    .prefault({}),
  db: DbConfigSchema.prefault({}),
  timeouts: TimeoutsSchema.prefault({}),
  visual: VisualConfigSchema.prefault({}),
  /** Feature flags for conditionally-present functionality. */
  features: z.record(z.string(), z.boolean()).default({}),
});

/** Fully-validated environment configuration (inferred from the zod schema). */
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
/** Username/password pair for one role (inferred from CredentialsSchema). */
export type Credentials = z.infer<typeof CredentialsSchema>;
/** Rule-engine database connection settings (inferred from DbConfigSchema). */
export type DbConfig = z.infer<typeof DbConfigSchema>;
/** Visual-regression reporting settings (inferred from VisualConfigSchema). */
export type VisualConfig = z.infer<typeof VisualConfigSchema>;

/** Environment used when E2E_ENV is unset — the committed local/demo config. */
export const DEFAULT_ENV = 'local';

/** Pure precedence rule used by {@link resolveEnvName} and its self-tests. */
export function selectEnvironmentName(
  processValue: string | undefined,
  genericDotEnvValue: string | undefined,
): string {
  if (processValue !== undefined) return processValue;
  const selected = genericDotEnvValue?.trim();
  return selected ? selected : DEFAULT_ENV;
}

/**
 * Resolve the active environment name. A shell/CI `E2E_ENV` wins; otherwise
 * the generic `.env` may select the environment before `.env.<env>` is known.
 * Falls back to {@link DEFAULT_ENV}. Kept as a function so tests and tooling
 * can flip `E2E_ENV` before the first `loadConfig()` call.
 */
export function resolveEnvName(): string {
  const genericDotEnv = path.join(REPO_ROOT, '.env');
  let dotEnvValue: string | undefined;
  if (fs.existsSync(genericDotEnv)) {
    dotEnvValue = dotenv.parse(fs.readFileSync(genericDotEnv)).E2E_ENV;
  }
  return selectEnvironmentName(process.env.E2E_ENV, dotEnvValue);
}

/**
 * Read dotenv files for the requested environment without mutating
 * `process.env`.
 *
 * Loads `.env` first, then `.env.<env>`, so the environment-specific file
 * wins over the generic one. The returned values are merged below process
 * variables, preserving CI-injected values as the highest-precedence layer.
 * Missing files are skipped silently.
 *
 * @param envName - Active environment name (e.g. "local", "staging").
 */
function loadDotEnvFiles(envName: string): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};
  for (const file of ['.env', `.env.${envName}`]) {
    const p = path.join(REPO_ROOT, file);
    if (fs.existsSync(p)) {
      Object.assign(values, dotenv.parse(fs.readFileSync(p)));
      log.debug(`Loaded ${file}`);
    }
  }
  return values;
}

/** Parse a boolean environment variable without silently accepting typos. */
function parseBooleanEnv(name: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be "true" or "false"; received ${JSON.stringify(value)}`);
}

/** Merge low-to-high environment layers while ignoring undefined values. */
export function mergeEnvironmentLayers(
  ...layers: ReadonlyArray<Readonly<NodeJS.ProcessEnv>>
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

/**
 * Overlay process.env values onto the JSON config (highest-precedence layer).
 *
 * Operates on a structuredClone so the raw parsed JSON is never mutated.
 * Only roles already declared in the JSON are overlaid — an env var for an
 * undeclared role is ignored, keeping the JSON the single source of which
 * roles exist. Boolean variables accept only `true` or `false`
 * (case-insensitive); typos fail before a test can silently switch modes.
 *
 * Recognized variables:
 *   E2E_BASE_URL, E2E_API_BASE_URL
 *   E2E_AUTH_MOCK
 *   E2E_<ROLE>_USERNAME / E2E_<ROLE>_PASSWORD  (e.g. E2E_ADMIN_PASSWORD)
 *   E2E_DB_SERVER / E2E_DB_PORT / E2E_DB_DATABASE / E2E_DB_USERNAME /
 *   E2E_DB_PASSWORD / E2E_DB_MOCK / E2E_DB_TRUST_SERVER_CERTIFICATE
 *   E2E_VISUAL_SCREENSHOTS  ("always" | "on-failure")
 *
 * @param raw - Parsed (unvalidated) JSON config for the environment.
 * @returns A new object with env-var values applied, ready for zod parsing.
 */
export function applyEnvironmentOverrides(
  raw: Record<string, unknown>,
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): Record<string, unknown> {
  const cfg = structuredClone(raw);

  if (env.E2E_BASE_URL) cfg.baseUrl = env.E2E_BASE_URL;
  if (env.E2E_API_BASE_URL) cfg.apiBaseUrl = env.E2E_API_BASE_URL;

  const auth = (cfg.auth ??= {}) as {
    mock?: boolean;
    roles?: Record<string, Record<string, string>>;
  };
  if (env.E2E_AUTH_MOCK !== undefined) {
    auth.mock = parseBooleanEnv('E2E_AUTH_MOCK', env.E2E_AUTH_MOCK);
  }
  const roles = (auth.roles ??= {});
  for (const role of Object.keys(roles)) {
    const prefix = `E2E_${role.toUpperCase()}`;
    const roleCreds = roles[role] ?? {};
    if (env[`${prefix}_USERNAME`]) roleCreds.username = env[`${prefix}_USERNAME`] as string;
    if (env[`${prefix}_PASSWORD`]) roleCreds.password = env[`${prefix}_PASSWORD`] as string;
    roles[role] = roleCreds;
  }

  if (env.E2E_VISUAL_SCREENSHOTS !== undefined) {
    const value = env.E2E_VISUAL_SCREENSHOTS.trim();
    if (value !== 'always' && value !== 'on-failure') {
      throw new Error(
        `E2E_VISUAL_SCREENSHOTS must be "always" or "on-failure"; received ${JSON.stringify(env.E2E_VISUAL_SCREENSHOTS)}`,
      );
    }
    const visual = (cfg.visual ??= {}) as Record<string, unknown>;
    visual.screenshots = value;
  }

  const db = (cfg.db ??= {}) as Record<string, unknown>;
  if (env.E2E_DB_SERVER) db.server = env.E2E_DB_SERVER;
  if (env.E2E_DB_PORT) db.port = Number(env.E2E_DB_PORT);
  if (env.E2E_DB_DATABASE) db.database = env.E2E_DB_DATABASE;
  if (env.E2E_DB_USERNAME) db.username = env.E2E_DB_USERNAME;
  if (env.E2E_DB_PASSWORD) db.password = env.E2E_DB_PASSWORD;
  if (env.E2E_DB_MOCK !== undefined) {
    db.mock = parseBooleanEnv('E2E_DB_MOCK', env.E2E_DB_MOCK);
  }
  if (env.E2E_DB_TRUST_SERVER_CERTIFICATE !== undefined) {
    db.trustServerCertificate = parseBooleanEnv(
      'E2E_DB_TRUST_SERVER_CERTIFICATE',
      env.E2E_DB_TRUST_SERVER_CERTIFICATE,
    );
  }

  return cfg;
}

/** Module-level cache: config is loaded and validated once per process. */
let cached: EnvironmentConfig | undefined;
/** Env name the cache was built for — a different name forces a reload. */
let cachedEnvName: string | undefined;

/**
 * Load, overlay, validate, and cache the environment configuration.
 *
 * Steps: (1) return the cache when the same env was already loaded;
 * (2) parse dotenv layers without mutating process.env; (3) read
 * config/environments/<env>.json — an unknown env fails with the list of
 * available names; (4) overlay E2E_* env vars; (5) zod-validate, failing fast
 * with a prettified error so a bad config never surfaces mid-suite.
 *
 * @param envName - Environment to load; defaults to E2E_ENV / "local".
 * @returns The validated, cached {@link EnvironmentConfig}.
 * @example
 * // In a step (via the fixture — the normal path):
 * Given('the app is configured', async ({ config }) => {
 *   expect(config.db.mock).toBe(true);
 * });
 */
export function loadConfig(envName = resolveEnvName()): EnvironmentConfig {
  if (cached && cachedEnvName === envName) return cached;

  if (!SAFE_NAME_PATTERN.test(envName)) {
    throw new Error(
      `Invalid environment name ${JSON.stringify(envName)}; use letters, numbers, underscores, or hyphens`,
    );
  }
  const dotEnvValues = loadDotEnvFiles(envName);

  const file = path.join(ENV_CONFIG_DIR, `${envName}.json`);
  if (!fs.existsSync(file)) {
    const available = fs.existsSync(ENV_CONFIG_DIR)
      ? fs
          .readdirSync(ENV_CONFIG_DIR)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace('.json', ''))
          .join(', ')
      : '(none)';
    throw new Error(`Unknown environment "${envName}". Available: ${available}`);
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  // Later spread wins: CI/process variables always outrank local dotenv files.
  const overlaid = applyEnvironmentOverrides(
    raw,
    mergeEnvironmentLayers(dotEnvValues, process.env),
  );

  const parsed = EnvironmentConfigSchema.safeParse(overlaid);
  if (!parsed.success) {
    throw new Error(
      `Environment config "${envName}" failed validation:\n${z.prettifyError(parsed.error)}`,
    );
  }

  cached = parsed.data;
  cachedEnvName = envName;
  log.info(`Environment: ${envName}`, { baseUrl: cached.baseUrl, dbMock: cached.db.mock });
  return cached;
}

/**
 * Credentials for a role; throws a readable error when missing.
 *
 * Two failure modes are distinguished: an undeclared role (lists the known
 * roles so typos are obvious) and a declared-but-empty credential pair when
 * auth is NOT mocked (names the exact E2E_* vars to set). With auth.mock on,
 * empty credentials are legal — no live login happens.
 *
 * @param config - The loaded environment configuration.
 * @param role - Role name as declared under auth.roles (e.g. "admin").
 * @returns The role's credentials, possibly empty in mock mode.
 */
export function credentialsFor(config: EnvironmentConfig, role: string): Credentials {
  const creds = config.auth.roles[role];
  if (!creds) {
    throw new Error(
      `No credentials configured for role "${role}". ` +
        `Known roles: ${Object.keys(config.auth.roles).join(', ') || '(none)'}`,
    );
  }
  if (!config.auth.mock && (!creds.username || !creds.password)) {
    throw new Error(
      `Credentials for role "${role}" are incomplete — set E2E_${role.toUpperCase()}_USERNAME / E2E_${role.toUpperCase()}_PASSWORD`,
    );
  }
  return creds;
}

/**
 * Resolve and validate the role assigned to a Playwright project.
 *
 * The requested role normally comes from project metadata or
 * `E2E_AUTH_ROLE`. Requiring it to be declared in config both catches typos
 * and keeps role names safe to use as storage-state filenames.
 */
export function resolveAuthRole(
  config: EnvironmentConfig,
  requestedRole = process.env.E2E_AUTH_ROLE ?? 'admin',
): string {
  if (!SAFE_NAME_PATTERN.test(requestedRole) || !config.auth.roles[requestedRole]) {
    throw new Error(
      `Unknown auth role ${JSON.stringify(requestedRole)}. ` +
        `Known roles: ${Object.keys(config.auth.roles).join(', ') || '(none)'}`,
    );
  }
  return requestedRole;
}
