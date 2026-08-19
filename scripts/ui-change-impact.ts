/**
 * UI change-impact report (frontend-embedded mode only) — third of the three
 * UI change-detection scripts (gen-ui-contract → check-ui-contract →
 * ui-change-impact; see docs/ui-change-detection.md).
 *
 * WHY: when a frontend change lands, "which tests does this break / which
 * should I run?" must be answerable mechanically. Line-level test-impact
 * analysis does not work for E2E (a scenario exercises whole screens, not
 * lines); path→feature mapping does — so this script maps changed frontend
 * PATHS to page objects, and page objects to scenarios/tags/manual cases.
 *
 * HOW: reads the git diff (committed vs a base ref, plus staged and unstaged
 * work), filters it to frontend paths, and resolves — via ui-impact-map.json
 * — which page objects, scenarios, feature tags, and manual test cases are
 * affected, with the exact command to run them. Changed frontend files that
 * match no mapping are flagged so the map itself cannot silently rot. This
 * is the mechanical layer; the /change-impact skill is the reasoning layer
 * on top.
 *
 * Standalone framework repos (no frontend next to the tests) are out of
 * scope: without a resolvable frontendRoot this exits 0 with a notice.
 *
 * Run:  npm run ui:impact                 (base: origin/main, fallback main)
 *       npm run ui:impact -- --base <ref>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();

/**
 * Relevant subset of ui-impact-map.json: frontend location, frontend path
 * prefixes → page objects, and page object → downstream impact (tags,
 * feature files, manual cases). Same shape as in check-ui-contract.ts.
 */
interface ImpactMap {
  frontendRoot?: string;
  frontendGlobs?: Record<string, string[]>;
  pageMap?: Record<string, { tags?: string[]; features?: string[]; cases?: string[] }>;
}

/**
 * Run git with the given args and return stdout; any failure returns '' so
 * callers can treat "ref doesn't exist" and "not a repo" uniformly as
 * no-information rather than crashing the report.
 *
 * @param args - git CLI arguments (executed at the repo root).
 */
function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
  } catch {
    return '';
  }
}

/**
 * Pick the diff base ref: the requested ref if given, else the first of
 * origin/main → main that actually resolves in this clone. Returns undefined
 * when none resolve (fresh clone without remotes) — the report then covers
 * the working tree only rather than failing.
 *
 * @param requested - Explicit base ref from `--base`, if any.
 */
function resolveBase(requested?: string): string | undefined {
  const candidates = requested !== undefined ? [requested] : ['origin/main', 'main'];
  for (const ref of candidates) {
    if (git('rev-parse', '--verify', '--quiet', ref).trim() !== '') return ref;
  }
  return undefined;
}

/**
 * Changed paths, deduplicated across three diff sources: committed work
 * (`base...HEAD`, skipped when no base resolved), unstaged working-tree
 * changes, and staged changes — so the report reflects what the developer is
 * ABOUT to push, not just what is already committed.
 *
 * @param base - Diff base ref, or undefined for working-tree-only analysis.
 */
function changedFiles(base: string | undefined): string[] {
  const sets = [
    base !== undefined ? git('diff', '--name-only', `${base}...HEAD`) : '',
    git('diff', '--name-only'),
    git('diff', '--name-only', '--cached'),
  ];
  return [
    ...new Set(
      sets
        .join('\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
}

/*
 * CLI entry (npm run ui:impact). Flow: load ui-impact-map.json (missing map
 * or frontendRoot → benign standalone-mode notice) → collect changed files
 * and keep those under frontendRoot (separators normalized for Windows) →
 * resolve each via frontendGlobs prefix match to page objects, accumulate
 * their tags/features/cases, and print the impacted surface plus the exact
 * verify commands; unmapped frontend changes are flagged for a map update.
 */
if (require.main === module) {
  const argIndex = process.argv.indexOf('--base');
  const requestedBase = argIndex >= 0 ? process.argv[argIndex + 1] : undefined;

  const mapPath = path.join(REPO_ROOT, 'ui-impact-map.json');
  const map: ImpactMap | null = fs.existsSync(mapPath)
    ? (JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as ImpactMap)
    : null;
  const frontendRoot = map?.frontendRoot;

  if (
    map === null ||
    frontendRoot === undefined ||
    !fs.existsSync(path.join(REPO_ROOT, frontendRoot))
  ) {
    process.stdout.write(
      'UI change impact: no frontend found (frontend-embedded mode only).\n' +
        'This framework is running standalone — the report is n/a here. When\n' +
        'embedded in a frontend repo, set "frontendRoot" in ui-impact-map.json.\n',
    );
  } else {
    const base = resolveBase(requestedBase);
    const changed = changedFiles(base);
    const frontendChanged = changed
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f.startsWith(`${frontendRoot.replace(/\\/g, '/')}/`) || f === frontendRoot);

    process.stdout.write(
      `UI change impact — frontend: ${frontendRoot} · base: ${base ?? '(none — working tree only)'}\n` +
        `  changed files: ${changed.length} total, ${frontendChanged.length} in the frontend\n`,
    );

    if (frontendChanged.length === 0) {
      process.stdout.write('  No UI-impacting changes detected — no test updates required.\n');
    } else {
      // Resolve changed frontend paths -> page objects (prefix match).
      const pages = new Set<string>();
      const unmapped: string[] = [];
      for (const file of frontendChanged) {
        let matched = false;
        for (const [prefix, consumers] of Object.entries(map.frontendGlobs ?? {})) {
          if (file.startsWith(prefix.replace(/\\/g, '/'))) {
            consumers.forEach((c) => pages.add(c));
            matched = true;
          }
        }
        if (!matched) unmapped.push(file);
      }

      process.stdout.write('\n  Frontend changes:\n');
      for (const file of frontendChanged) process.stdout.write(`    · ${file}\n`);

      const tags = new Set<string>();
      const features = new Set<string>();
      const cases = new Set<string>();
      for (const page of pages) {
        const impact = map.pageMap?.[page];
        impact?.tags?.forEach((t) => tags.add(t));
        impact?.features?.forEach((f) => features.add(f));
        impact?.cases?.forEach((c) => cases.add(c));
      }

      if (pages.size > 0) {
        process.stdout.write('\n  Impacted framework surface:\n');
        for (const page of [...pages].sort()) process.stdout.write(`    page object: ${page}\n`);
        for (const feature of [...features].sort())
          process.stdout.write(`    scenarios:   ${feature}\n`);
        if (cases.size > 0)
          process.stdout.write(`    manual cases to review: ${[...cases].sort().join(', ')}\n`);
        if (tags.size > 0) {
          process.stdout.write(
            `\n  Verify before pushing:\n` +
              `    npm run ui:check\n` +
              `    npx bddgen && npx playwright test --project=chromium --grep "${[...tags].sort().join('|')}"\n`,
          );
        }
      }
      if (unmapped.length > 0) {
        process.stdout.write(
          `\n  ⚠ ${unmapped.length} changed frontend file(s) match no ui-impact-map.json entry —\n` +
            `    add a frontendGlobs mapping or confirm they are test-irrelevant:\n`,
        );
        for (const file of unmapped) process.stdout.write(`    · ${file}\n`);
      }
      process.stdout.write(
        '\n  For a reasoned report with proposed fixes, run the /change-impact skill.\n',
      );
    }
  }
}
