/**
 * Shared AIO Tests helpers — config loading, auth header, and a read-only
 * connectivity probe. Used by both `scripts/aio-check.ts` (`npm run aio:check`)
 * and `scripts/aio-sync.ts` (`npm run sync:cases`, which pre-flights the same
 * check before any live push). No CLI entry; no writes.
 *
 * Secrets are NEVER read here from config — the token is passed in by the
 * caller, which sources it from the environment (each user's own `.env`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const REPO_ROOT = process.cwd();

export const configSchema = z
  .object({
    apiBaseUrl: z.string().url(),
    projectKey: z.string().min(1),
    auth: z.enum(['aioauth', 'basic']).default('aioauth'),
    scriptType: z.string().default('BDD'),
    folderTemplate: z.string().min(1),
    defaults: z
      .object({
        status: z.string().default('Published'),
        type: z.string().default(''),
        owner: z.string().default(''),
        tags: z.array(z.string()).default([]),
        labels: z.array(z.string()).default([]),
      })
      .default({ status: 'Published', type: '', owner: '', tags: [], labels: [] }),
    requirement: z
      .object({ prdPathTemplate: z.string().default('docs/PRDs/{feature}.md') })
      .passthrough()
      .default({ prdPathTemplate: 'docs/PRDs/{feature}.md' }),
    requirementMap: z.record(z.string(), z.string()).default({}),
  })
  .passthrough();

export type SyncConfig = z.infer<typeof configSchema>;

/** Load + zod-validate config/aio-sync.json (env overrides base URL/projectKey). */
export function loadConfig(): SyncConfig {
  const file = path.join(REPO_ROOT, 'config', 'aio-sync.json');
  if (!fs.existsSync(file)) throw new Error('config/aio-sync.json not found.');
  // Strip a UTF-8 BOM before parsing: config/aio-sync.json carries one (written
  // on Windows), and JSON.parse rejects it, which broke every read-back helper
  // while `probe aio sync` kept working because the plugin's loader strips it.
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
  const cfg = configSchema.parse(raw);
  return {
    ...cfg,
    apiBaseUrl: process.env.AIO_API_BASE_URL ?? cfg.apiBaseUrl,
    projectKey: process.env.AIO_PROJECT_KEY ?? cfg.projectKey,
  };
}

/** Build the AIO Authorization header (AioAuth token, or Basic email:token). */
export function authHeader(cfg: SyncConfig, token: string, email?: string): string {
  if (cfg.auth === 'basic' && email) {
    return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }
  return `AioAuth ${token}`;
}

export interface ConnectivityResult {
  ok: boolean;
  status: number | null;
  detail: string;
}

/**
 * Read-only connectivity probe: an authenticated GET against the project's
 * test-case listing. Distinguishes token failure (401), permission (403),
 * wrong project/path (404), and network reachability — enough to validate the
 * token + base + projectKey before the sync stage runs. Never writes.
 */
export async function checkConnectivity(
  cfg: SyncConfig,
  token: string,
  email?: string,
): Promise<ConnectivityResult> {
  const url = `${cfg.apiBaseUrl}/project/${cfg.projectKey}/testcase?maxResults=1`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(cfg, token, email), Accept: 'application/json' },
    });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        detail: `authenticated; project ${cfg.projectKey} reachable`,
      };
    }
    const snippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    const detail =
      res.status === 401
        ? 'token invalid or expired (401) — check AIO_API_TOKEN in your .env'
        : res.status === 403
          ? `authenticated but no permission on project ${cfg.projectKey} (403)`
          : res.status === 404
            ? `not found (404) — verify projectKey "${cfg.projectKey}" and apiBaseUrl "${cfg.apiBaseUrl}" against the AIO Swagger`
            : `unexpected ${res.status}: ${snippet}`;
    return { ok: false, status: res.status, detail };
  } catch (err) {
    return {
      ok: false,
      status: null,
      detail: `could not reach ${cfg.apiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
