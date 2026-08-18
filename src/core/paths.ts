/**
 * Canonical filesystem paths, resolved once from the repo root.
 *
 * WHY: every path the framework touches (auth states, test data, golden
 * fixtures, environment configs, artifacts) is defined here as an absolute
 * path so no other module ever does its own `__dirname` arithmetic. That
 * keeps path logic correct regardless of the process CWD (Playwright
 * workers, bddgen, standalone scripts) and gives grep a single place to
 * find where anything lives on disk.
 *
 * Architecture fit: bottom of src/core — imports only node:path, imported by
 * everything above (config, data loaders, auth setup, page objects).
 */

import path from 'node:path';

/** Repository root (src/core/ is two levels down). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Per-role storage states written by auth setup. */
export const AUTH_DIR = path.join(REPO_ROOT, '.auth');

/** JSON datasets consumed by DataLoader. */
export const TEST_DATA_DIR = path.join(REPO_ROOT, 'test-data');

/** Golden wafer fixtures (input CSV + expected results). */
export const GOLDEN_DIR = path.join(TEST_DATA_DIR, 'golden');

/** Environment config JSON files. */
export const ENV_CONFIG_DIR = path.join(REPO_ROOT, 'config', 'environments');

/** Scratch output for generated wafer files, downloads, exports. */
export const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results', 'artifacts');

/**
 * Absolute path of the storage-state file for one authenticated role.
 * Auth setup writes these; playwright projects load them per role so
 * scenarios start already logged in without repeating the UI login.
 *
 * @param role - Role name (e.g. "admin", "analyst").
 * @returns Absolute path like `<repo>/.auth/admin.json`.
 */
export function authStatePath(role: string): string {
  return path.join(AUTH_DIR, `${role}.json`);
}
