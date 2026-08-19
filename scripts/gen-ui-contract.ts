/**
 * Generates ui-contract.json — the UI contract manifest: every locator/chart
 * hook the framework consumes from the application under test. First of the
 * three UI change-detection scripts (gen-ui-contract → check-ui-contract →
 * ui-change-impact; see docs/ui-change-detection.md — frontend-embedded mode
 * only, standalone repos are n/a by design).
 *
 * WHY: this is the machine-readable half of locator policy P1: when this
 * framework is embedded in a frontend repo, `npm run ui:check` diffs this
 * manifest against the frontend source so a removed/renamed data-testid
 * fails BEFORE the developer pushes.
 *
 * HOW: statically scans the consumer layers (src/pages, src/components,
 * steps) for `getByTestId(...)` / `byTestId(...)` call sites, merges the
 * hand-maintained DYNAMIC_CONSUMERS list, and attaches the Plotly chart
 * contract. Deterministic by construction (sorted keys, no timestamps) and
 * drift-guarded by tests/selftest/ui-contract.spec.ts, like the goldens —
 * regenerating on an unchanged tree must produce an identical file.
 *
 * Run:  npx tsx scripts/gen-ui-contract.ts   (npm run ui:contract)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();

/** Framework layers that consume application locators. */
const CONSUMER_DIRS = ['src/pages', 'src/components', 'steps'];

/**
 * TestIds consumed through dynamic helpers that static extraction cannot see
 * (e.g. a page object that passes ids through a local `read()` helper rather
 * than naming each one at a `getByTestId` call site). Keep this list in sync
 * when adding dynamic consumers — the Script Audit checks for unmanifested
 * testId usage.
 *
 * Empty since the demo page objects were severed into yieldwerx-playground.
 */
const DYNAMIC_CONSUMERS: Record<string, string[]> = {};

/**
 * The Plotly chart contract (runtime shape — documented in
 * src/plotly/WaferMap.ts and validated live during /ui-recon). The static
 * checker verifies the container testIds exist; the trace/meta shape is
 * asserted at runtime by the framework self-tests and scenarios.
 */
const CHART_CONTRACT = {
  'wafer-map-chart': {
    traces: [
      'wafer (heatmap: z=hardBin, customdata=[hardBin, softBin, inked])',
      'HB<bin> (one per failing hard bin)',
      'Inked (customdata per point = [hardBin])',
    ],
    layoutMeta: ['lotId', 'waferId', 'notch', 'notchAngle'],
  },
  'pass-fail-histogram': {
    traces: ['pass-fail (bar: x=[Pass, Fail], y=die counts)'],
    layoutMeta: [],
  },
};

/**
 * Shape of ui-contract.json: schema version, the command that regenerates
 * the file, every consumed testId with its consuming files, and the chart
 * contract. `pattern: true` marks dynamic template ids the static checker
 * must skip.
 */
interface UiContract {
  version: number;
  regenerate: string;
  testIds: Record<string, { consumers: string[]; pattern?: true }>;
  chartContract: typeof CHART_CONTRACT;
}

/**
 * Recursively list all .ts files under a directory (consumer-layer scan).
 *
 * @param dir - Absolute directory to walk.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Remove comments from TypeScript source before testId extraction.
 *
 * JSDoc `@example` blocks legitimately show `getByTestId('...')` snippets;
 * without this pass those documentation-only ids would leak into the
 * manifest and the frontend would be asked to provide testIds nothing
 * actually consumes. Strips block comments (slash-star to star-slash,
 * including JSDoc) and full-line `//` comments; trailing `//` comments are
 * left alone so
 * string literals containing `//` (URLs) are never mangled — a commented-out
 * call site on its own line is still excluded.
 *
 * @param source - Raw .ts file contents.
 * @returns Source with comment text blanked out.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Build the manifest object (exported so the drift-guard self-test can
 * rebuild and compare without touching disk).
 *
 * Steps:
 * 1. Scan every .ts file in CONSUMER_DIRS for `getByTestId('...')` /
 *    `byTestId('...')` call sites in executable code — comments are stripped
 *    first (see stripComments) so JSDoc examples never pollute the contract
 *    (single regex over the source — no AST needed for this call shape) —
 *    and record testId → consuming files.
 * 2. Merge DYNAMIC_CONSUMERS for ids reached through helpers the regex
 *    cannot see.
 * 3. Sort ids and each consumer list so output is deterministic; normalize
 *    path separators to `/` so Windows and POSIX runs emit identical JSON.
 *    Ids containing `${` are template patterns (e.g. `filter-${name}`) —
 *    flagged `pattern: true`: recorded for documentation, but the static
 *    checker cannot verify them (runtime recon covers those).
 * 4. Attach CHART_CONTRACT and the regeneration command.
 *
 * @returns The complete, deterministic manifest ready for serialization.
 */
export function buildUiContract(): UiContract {
  const testIds: Record<string, Set<string>> = {};
  const add = (id: string, consumer: string): void => {
    (testIds[id] ??= new Set()).add(consumer.replace(/\\/g, '/'));
  };

  const pattern = /(?:getByTestId|byTestId)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  for (const dir of CONSUMER_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(REPO_ROOT, file);
      const source = stripComments(fs.readFileSync(file, 'utf-8'));
      for (const match of source.matchAll(pattern)) {
        const id = match[1];
        if (id !== undefined) add(id, rel);
      }
    }
  }
  for (const [id, consumers] of Object.entries(DYNAMIC_CONSUMERS)) {
    for (const consumer of consumers) add(id, consumer);
  }

  const sorted: Record<string, { consumers: string[]; pattern?: true }> = {};
  for (const id of Object.keys(testIds).sort()) {
    const consumers = testIds[id];
    if (!consumers) continue;
    // Ids containing an interpolation are dynamic patterns (e.g. a component
    // that scopes `filter-${name}`) — recorded for documentation, but the
    // static checker cannot verify them (runtime recon covers those).
    sorted[id] = id.includes('${')
      ? { consumers: [...consumers].sort(), pattern: true }
      : { consumers: [...consumers].sort() };
  }

  return {
    version: 1,
    regenerate: 'npm run ui:contract',
    testIds: sorted,
    chartContract: CHART_CONTRACT,
  };
}

/* CLI entry (npm run ui:contract): write ui-contract.json at the repo root. */
if (require.main === module) {
  const outPath = path.join(REPO_ROOT, 'ui-contract.json');
  const manifest = buildUiContract();
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const count = Object.keys(manifest.testIds).length;
  process.stdout.write(`Wrote ${outPath} (${count} testIds + chart contract)\n`);
}
