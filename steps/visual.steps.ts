/**
 * Step definitions for the @visual scenarios (features/probe-lab/visual.feature).
 *
 * These are the reference for the page-object model: the steps read as intent,
 * and every locator and interaction lives in a page object (src/pages) or
 * component (src/components), injected by fixtures. Assertions stay in the
 * steps — page objects never assert.
 *
 * Capture stays on Playwright (testid scoping, frozen animations); comparison
 * is odiff through `toHaveScreenshotOdiff` — anti-aliasing-aware, so the canvas
 * edge pixels that made pixelmatch flaky are ignored while genuine recolors
 * still register. Tolerances are pinned in src/core/visual.ts and guarded by
 * the framework self-test.
 *
 * Container-only: the Before hook skips every @visual scenario on a host run.
 * A host GPU/font stack renders differently, and a host-generated baseline
 * would quietly gate everyone else's merges on one laptop's fonts.
 */
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '@core/paths';
import { attachVisualEvidence, visualRunPermitted, VISUAL_ODIFF_OPTIONS } from '@core/visual';
import { Before, expect, Given, test, Then, When } from './fixtures';

Before({ tags: '@visual' }, async () => {
  test.skip(
    !visualRunPermitted(),
    'Visual scenarios run only inside the pinned container (npm run test:visual). ' +
      'FORCE_VISUAL=1 overrides for local diagnosis, never for baselines.',
  );
});

const SAMPLE_CSV = path.join(REPO_ROOT, 'probe-lab-app', 'database', 'sample-wafer.csv');

/* The sample keeps its ORIGINAL lot code (LOT-DEMO-01): a visual baseline pins
   pixels, and the lot is drawn on the screen, so a per-run unique lot would
   change the pixels and fail against the committed baseline. The upload is
   therefore idempotent — reuse the sample lot if it is already present. */
const SAMPLE_LOT = 'LOT-DEMO-01';

Given(
  'the sample wafer is uploaded for visual checks',
  async ({ page, wafersPage, uploadPage }) => {
    await wafersPage.goto();
    if ((await wafersPage.rowForLot(SAMPLE_LOT).count()) > 0) return;

    await uploadPage.goto();
    await uploadPage.stageCsv(fs.readFileSync(SAMPLE_CSV));
    await expect(page.getByText('wafer.csv', { exact: true })).toBeVisible();
    await uploadPage.submit();

    /* The upload is queued; the wafer appears once processing completes, and the
     list is a cached query that does not refetch on a client-side nav. goto()
     remounts it, so poll on a fresh load until the row lands. */
    await expect(async () => {
      await wafersPage.goto();
      await expect(wafersPage.rowForLot(SAMPLE_LOT)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  },
);

When('the QA user opens the sample wafer', async ({ wafersPage }) => {
  await wafersPage.goto();
  await wafersPage.openLot(SAMPLE_LOT);
});

When(
  'the QA user runs the bin pareto report for all bins of that wafer',
  async ({ wafersPage, binParetoPage }) => {
    await wafersPage.goto();
    const sequence = await wafersPage.sequenceForLot(SAMPLE_LOT);
    await binParetoPage.goto();
    await binParetoPage.run(sequence, { binsToShow: 'All Bins' });
  },
);

Then(
  'the wafer map matches the approved image {string}',
  async ({ waferDetailPage }, snapshot: string) => {
    await expect(waferDetailPage.map).toBeVisible();
    /* Pin pixels only once the wafer is drawn, not against an empty canvas. */
    await expect.poll(() => waferDetailPage.dieCount()).toBeGreaterThan(0);
    try {
      await expect(waferDetailPage.map).toHaveScreenshotOdiff(snapshot, VISUAL_ODIFF_OPTIONS);
    } finally {
      await attachVisualEvidence(test.info(), waferDetailPage.map, snapshot);
    }
  },
);

Then(
  'the bin pareto chart matches the approved image {string}',
  async ({ binParetoPage }, snapshot: string) => {
    await expect(binParetoPage.chart).toBeVisible();
    try {
      await expect(binParetoPage.chart).toHaveScreenshotOdiff(snapshot, VISUAL_ODIFF_OPTIONS);
    } finally {
      await attachVisualEvidence(test.info(), binParetoPage.chart, snapshot);
    }
  },
);
