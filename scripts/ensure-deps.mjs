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

function say(message) {
  console.log(`probe-lab: ${message}`);
}

/**
 * Why this package needs installing, or null when it does not.
 *
 * The test is the one that actually answers "will the next command run": is
 * every package this project declares present on disk. That catches every
 * failure mode above, including the reported one — `--omit=dev` leaves a
 * node_modules that looks fine right up until tsx turns out not to be in it —
 * and it catches a `git pull` that adds a dependency.
 *
 * Deliberately NOT a hash of package-lock.json, which an earlier version of
 * this file used. `npm install` rewrites the lockfile on some platforms (on
 * macOS it strips the `libc` constraints from optional Linux packages), so a
 * lockfile-hash stamp never settles: install, lockfile churns, hash mismatches,
 * install again. A guard that reinstalls on every command and dirties git each
 * time is worse than the bug it was written for.
 *
 * `node_modules/.package-lock.json` is npm's own record of what it laid down.
 * Its absence beside a present node_modules means an interrupted install.
 */
function reasonToInstall(dir) {
  const modules = path.join(dir, 'node_modules');
  if (!fs.existsSync(modules)) return 'dependencies are not installed';
  if (!fs.existsSync(path.join(modules, '.package-lock.json'))) {
    return 'the dependency tree looks incomplete';
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  /* A scoped name is two path segments, so split rather than use the raw name. */
  const absent = declared.filter((name) => !fs.existsSync(path.join(modules, ...name.split('/'))));
  if (absent.length === 0) return null;

  const shown = absent.slice(0, 3).join(', ');
  return absent.length <= 3
    ? `${shown} ${absent.length === 1 ? 'is' : 'are'} declared but not installed`
    : `${absent.length} declared packages are missing (${shown}, …)`;
}

/**
 * `--include=dev` is the load-bearing flag, not decoration. Without it this
 * install inherits `--omit=dev` or `NODE_ENV=production` from whatever invoked
 * it and quietly reproduces the exact failure being repaired.
 */
function install(dir, label) {
  /*
   * Run through a shell, as one string, on every platform.
   *
   * Windows needs the shell: npm there is a .cmd, and since the CVE-2024-27980
   * fix (Node 18.20.2 / 20.12.2) spawning a .cmd or .bat without `shell: true`
   * throws EINVAL — which would have made this guard fail on exactly the
   * machines it was written for.
   *
   * One string rather than an args array because passing args alongside
   * `shell: true` is deprecated (DEP0190) and prints a warning on every run.
   * That is safe only because every token here is a fixed literal with no
   * spaces, quotes or interpolation; the one value that varies, the directory,
   * travels in `cwd` and never touches the command line.
   */
  const result = spawnSync('npm install --include=dev --no-audit --no-fund', {
    cwd: dir,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
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

  const reason = reasonToInstall(dir);
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
