import fs from 'node:fs';

import type { Locator, TestInfo } from '@playwright/test';
import type { OdiffScreenshotOptions } from 'playwright-odiff';

/**
 * Pinned odiff options for `@visual` scenarios — the single source of truth
 * for visual-regression tolerance. The step passes these to
 * `toHaveScreenshotOdiff`; the config self-test asserts they have not drifted.
 *
 * The values are the ones test-ops/e2e reviewed and adopted, ported unchanged:
 * - `antialiasing: true` — ignore anti-aliased pixels. This is the reason
 *   odiff is the engine instead of Playwright's bundled pixelmatch: sub-pixel
 *   anti-aliasing on canvas edges is the dominant false-positive source, and
 *   both of this app's visual subjects (wafer map, bin pareto) are canvases.
 * - `threshold: 0.1` — per-pixel color-delta sensitivity (0 exact … 1 ignore).
 *   Modest, so a genuine recolor still registers.
 * - `maxDiffPixelRatio: 0.001` — at most 0.1% of pixels may differ overall.
 *
 * A visual failure is a RENDERING finding. A wrong number is caught by the
 * data-layer assertions against `wafer-map-data` and the report table, and is
 * always the more severe class — pixels prove drawing, not arithmetic.
 */
export const VISUAL_ODIFF_OPTIONS: OdiffScreenshotOptions = {
  threshold: 0.1,
  antialiasing: true,
  maxDiffPixelRatio: 0.001,
};

/**
 * Where committed baselines live, relative to the repo root. Referenced by
 * playwright.config.ts (snapshotPathTemplate) and the config self-test, so the
 * two cannot drift apart.
 */
export const VISUAL_BASELINE_TEMPLATE = 'tests/visual/baselines/{projectName}/{arg}{ext}';

/**
 * Attach the committed baseline AND the current render to the report, so a
 * reviewer can eyeball what the pixel gate approved — the odiff matcher itself
 * attaches expected/actual/diff only on failure, which leaves a passing run
 * with no images at all.
 *
 * Best-effort by design: a missing baseline (the first run, before baselines
 * exist) is skipped rather than turning a real assertion result into an
 * attachment error.
 */
export async function attachVisualEvidence(
  testInfo: TestInfo,
  locator: Locator,
  snapshot: string,
): Promise<void> {
  const baselinePath = testInfo.snapshotPath(snapshot);
  if (fs.existsSync(baselinePath)) {
    await testInfo.attach(`${snapshot} (baseline)`, {
      path: baselinePath,
      contentType: 'image/png',
    });
  }
  const actual = await locator.screenshot({ animations: 'disabled' });
  await testInfo.attach(`${snapshot} (actual)`, { body: actual, contentType: 'image/png' });
}

/**
 * True when this process is running inside the pinned Playwright container.
 *
 * Baselines are only valid when generated and compared inside that image —
 * host-rendered screenshots differ per GPU and font stack, so a host run
 * would fail against container baselines and, worse, a host-generated
 * baseline would quietly gate everyone else's merges on one laptop's fonts.
 * `FORCE_VISUAL=1` is a diagnostic escape hatch for looking at diffs locally,
 * never an approved baseline workflow.
 */
export function visualRunPermitted(): boolean {
  return process.env.E2E_IN_CONTAINER === '1' || process.env.FORCE_VISUAL === '1';
}
