/**
 * Make a missing or stale dependency tree fix itself instead of stopping the
 * user.
 *
 * WHY: `npm run app:dev` was failing across the team with `sh: tsx: command
 * not found`. tsx is declared correctly in probe-lab-app/package.json — the
 * tree simply was not installed, and there are four ordinary ways to arrive
 * there, all reproduced:
 *
 *   1. Clone, then run `npm run app:dev` without `npm install` first.
 *   2. `npm install --omit=dev` at the root. The nested install inherits the
 *      flag, and tsx is a devDependency, so it is skipped.
 *   3. `NODE_ENV=production npm install` — the same thing by another route.
 *   4. `npm install --ignore-scripts`, which skips `postinstall` entirely, so
 *      probe-lab-app is never installed at all.
 *
 * Cases 2 and 3 are now also prevented at source: `postinstall` passes
 * `--include=dev`, which overrides both. This script covers the rest, and
 * covers a tree that has gone stale since the last install — a `git pull` that
 * adds a dependency leaves node_modules present but wrong, and `postinstall`
 * does not run again on its own.
 *
 * NOTHING MAY BE IMPORTED HERE BUT `node:` BUILTINS. The whole point is to run
 * when the dependency tree is absent, so a single import of a package would
 * reintroduce the failure it exists to remove. That is also why this is .mjs
 * run by `node` and not .ts run by `tsx`: tsx is the thing that goes missing.
 *
 * Usage:
 *   node scripts/ensure-deps.mjs            # both packages
 *   node scripts/ensure-deps.mjs app        # probe-lab-app only
 *   node scripts/ensure-deps.mjs root       # the framework only
 *   node scripts/ensure-deps.mjs --check    # report, install nothing (CI)
 *
 * Silent when everything is already in order, because it runs ahead of most
 * npm scripts in this repo and a guard that narrates every healthy run is
 * noise people learn to scroll past.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The two installable packages, by the name callers pass on the command line. */
const TARGETS = {
  root: { dir: REPO_ROOT, label: 'framework' },
  app: { dir: path.join(REPO_ROOT, 'probe-lab-app'), label: 'probe-lab-app' },
};

/**
 * Where the fingerprint of the last successful install is kept. Inside
 * node_modules on purpose: deleting node_modules must also delete the claim
 * that it was ever installed, and nothing here can be committed by accident.
 */
const STAMP = '.probe-deps-stamp';

function say(message) {
  console.log(`probe-lab: ${message}`);
}

/**
 * Fingerprint of what the tree is supposed to contain. The lockfile is the
 * right input — it changes on every dependency change, including a transitive
 * one that package.json does not mention.
 */
function fingerprint(dir) {
  for (const file of ['package-lock.json', 'package.json']) {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      return createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  }
  return null;
}

/**
 * Why this package needs installing, or null when it does not.
 *
 * `node_modules/.package-lock.json` is npm's own record of what it laid down.
 * Its absence next to a present node_modules means an interrupted or partial
 * install, which looks healthy to a bare directory check and then fails at the
 * first missing binary.
 */
function reasonToInstall(dir, { adopt } = { adopt: false }) {
  const modules = path.join(dir, 'node_modules');
  if (!fs.existsSync(modules)) return 'dependencies are not installed';
  if (!fs.existsSync(path.join(modules, '.package-lock.json'))) {
    return 'the dependency tree looks incomplete';
  }
  const expected = fingerprint(dir);
  if (expected === null) return null;

  const stampPath = path.join(modules, STAMP);
  if (!fs.existsSync(stampPath)) {
    /* No stamp: this package was installed before the guard existed. npm's own
       record says the tree is complete, so adopt it rather than forcing a
       reinstall on everyone who already had a working checkout. `adopt` is
       false under --check, which must report without touching anything. */
    if (adopt) fs.writeFileSync(stampPath, expected);
    return null;
  }
  const recorded = fs.readFileSync(stampPath, 'utf8').trim();
  return recorded === expected ? null : 'dependencies changed since the last install';
}

/**
 * `--include=dev` is the load-bearing flag, not decoration. Without it this
 * install inherits `--omit=dev` or `NODE_ENV=production` from whatever invoked
 * it and quietly reproduces the exact failure being repaired.
 */
function install(dir, label) {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--include=dev', '--no-audit', '--no-fund'],
    { cwd: dir, stdio: 'inherit', env: process.env },
  );
  if (result.error) {
    say(`could not run npm for ${label}: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    say(`npm install failed for ${label} (exit ${result.status}).`);
    say(
      `Run it yourself to see why:  cd ${path.relative(process.cwd(), dir) || '.'} && npm install`,
    );
    return false;
  }
  const stamp = fingerprint(dir);
  if (stamp) fs.writeFileSync(path.join(dir, 'node_modules', STAMP), stamp);
  return true;
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const named = args.filter((a) => !a.startsWith('-'));
const unknown = named.filter((n) => !(n in TARGETS));
if (unknown.length > 0) {
  say(`unknown target(s): ${unknown.join(', ')}. Use "root", "app", or neither.`);
  process.exit(2);
}
const selected = named.length > 0 ? named : Object.keys(TARGETS);

let failed = false;
for (const name of selected) {
  const { dir, label } = TARGETS[name];
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue;

  const reason = reasonToInstall(dir, { adopt: !checkOnly });
  if (reason === null) continue;

  if (checkOnly) {
    say(`${label}: ${reason}`);
    failed = true;
    continue;
  }

  say(`${label}: ${reason} — installing now, this runs once.`);
  if (!install(dir, label)) failed = true;
  else say(`${label}: ready.`);
}

process.exit(failed ? 1 : 0);
