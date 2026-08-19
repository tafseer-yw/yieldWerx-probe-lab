/**
 * Security scanners behind one guard, each run in Docker so nothing has to be
 * installed on the machine. The verbs mirror the PROBE scan-security contract:
 *
 *   node scripts/security-scan.mjs deps       # dependency vulnerabilities (osv-scanner)
 *   node scripts/security-scan.mjs sast       # static analysis (semgrep)
 *   node scripts/security-scan.mjs baseline   # ZAP passive baseline against a RUNNING app
 *
 * Two rules, both fail closed:
 * - `deps` and `sast` read the repository and are always safe to run.
 * - `baseline` sends traffic to a running target, so it refuses without BOTH
 *   SECURITY_SCAN_TARGET and SECURITY_SCAN_AUTHORIZE=true — the same rule as a
 *   live case-management push: never assume a target is fine to probe. A
 *   non-local target is refused outright; point ZAP at shared or production
 *   systems through the PROBE skill's authorization flow, not this script.
 *
 * Like ensure-deps.mjs, this imports node: builtins only.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(REPO_ROOT, 'reports', 'security');

/* Pinned images: a floating `latest` scanner changes what "no findings" means
   from one week to the next without anyone deciding that. */
const IMAGES = {
  deps: 'ghcr.io/google/osv-scanner:v2.2.4',
  sast: 'semgrep/semgrep:1.140.0',
  baseline: 'zaproxy/zap-stable:2.16.1',
};

function say(message) {
  console.log(`security: ${message}`);
}

function fail(message) {
  console.error(`security: ${message}`);
  process.exit(1);
}

function dockerReady() {
  const probe = spawnSync('docker info', { shell: true, stdio: 'ignore' });
  return probe.status === 0;
}

function run(command) {
  say(command);
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
    cwd: REPO_ROOT,
  });
  return result.status ?? 1;
}

const verb = process.argv[2];
if (!['deps', 'sast', 'baseline'].includes(verb ?? '')) {
  fail('usage: node scripts/security-scan.mjs <deps|sast|baseline>');
}
if (!dockerReady()) {
  fail(
    'Docker is not running — these scanners run in containers so nothing needs installing. Start Docker and retry.',
  );
}
fs.mkdirSync(REPORT_DIR, { recursive: true });

if (verb === 'deps') {
  /* Both lockfiles, so the app's dependencies are scanned too. Needs network:
     osv-scanner queries the OSV database. Exit 1 = vulnerabilities found —
     a real result, passed through, never swallowed. */
  const status = run(
    `docker run --rm -v "${REPO_ROOT}:/src:ro" -v "${REPORT_DIR}:/out" ${IMAGES.deps}` +
      ` scan --lockfile /src/package-lock.json --lockfile /src/probe-lab-app/package-lock.json` +
      ` --format table --output /out/deps-scan.txt`,
  );
  if (fs.existsSync(path.join(REPORT_DIR, 'deps-scan.txt'))) {
    say(`report: reports/security/deps-scan.txt`);
  }
  if (status === 0) say('no known vulnerabilities in either lockfile.');
  else if (status === 1) fail('vulnerabilities found — read the report above.');
  else fail(`osv-scanner failed (exit ${status}) — that is a scan error, not a clean result.`);
}

if (verb === 'sast') {
  /* p/owasp-top-ten is fetched from the Semgrep registry at run time (network
     needed); findings land in the report and a non-empty finding set exits 1. */
  const status = run(
    `docker run --rm -v "${REPO_ROOT}:/src" -e SEMGREP_SEND_METRICS=off ${IMAGES.sast}` +
      ` semgrep scan --config p/owasp-top-ten --error --exclude node_modules --exclude .features-gen` +
      ` --json --output /src/reports/security/sast-scan.json /src`,
  );
  say('report: reports/security/sast-scan.json');
  if (status === 0) say('no findings.');
  else if (status === 1) fail('findings reported — read the report.');
  else fail(`semgrep failed (exit ${status}) — that is a scan error, not a clean result.`);
}

if (verb === 'baseline') {
  const target = (process.env.SECURITY_SCAN_TARGET ?? '').trim();
  const authorized = /^(1|true|yes)$/i.test(process.env.SECURITY_SCAN_AUTHORIZE ?? '');
  if (!target || !authorized) {
    fail(
      'a baseline scan sends traffic to a running target, so it refuses without BOTH:\n' +
        '  SECURITY_SCAN_TARGET=http://host.docker.internal:3000  (the running app, as Docker sees it)\n' +
        '  SECURITY_SCAN_AUTHORIZE=true                           (your explicit go-ahead)\n' +
        'Start the app first: npm run app:dev',
    );
  }
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(target);
  if (!local) {
    fail(
      `refusing non-local target ${target} — scan shared or production systems through the PROBE authorization flow, not this script.`,
    );
  }
  /* ZAP baseline: passive spider + analysis, no active attack payloads.
     Exit 0 = clean, 1 = fail-level alerts, 2 = warn-level alerts. */
  const status = run(
    `docker run --rm -v "${REPORT_DIR}:/zap/wrk" --add-host host.docker.internal:host-gateway ${IMAGES.baseline}` +
      ` zap-baseline.py -t "${target}" -r baseline-report.html -I`,
  );
  say('report: reports/security/baseline-report.html');
  if (status === 0) say('baseline clean.');
  else fail(`baseline scan exited ${status} — read the report.`);
}
