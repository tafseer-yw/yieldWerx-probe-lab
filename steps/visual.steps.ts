/**
 * Step definitions for the @visual scenarios (features/probe-lab/visual.feature).
 *
 * Capture stays on Playwright (testid scoping, frozen animations); comparison
 * is odiff through `toHaveScreenshotOdiff` — anti-aliasing-aware, so the
 * canvas edge pixels that made pixelmatch flaky are ignored while genuine
 * recolors still register. Tolerances are pinned in src/core/visual.ts and
 * guarded by the framework self-test.
 *
 * Container-only: the Before hook skips every @visual scenario on a host run.
 * Baselines are only valid from inside the pinned Playwright image — a host
 * GPU/font stack renders differently, and a host-generated baseline would
 * quietly gate everyone else's merges on one laptop's fonts.
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

/*
 * The visual sample keeps its ORIGINAL lot code. The functional suite stamps a
 * unique lot per run to dodge the duplicate-wafer guard, but a visual baseline
 * pins pixels — and the lot code is drawn on the screen. A changing lot would
 * change the pixels and fail every run against the committed baseline, so the
 * upload here is idempotent instead: if the sample lot is already present,
 * reuse it.
 */
/** The sample wafer's row on the wafers list, if it has landed. */
function sampleWaferRow(page: import('@playwright/test').Page): import('@playwright/test').Locator {
  return page.getByRole('row').filter({ hasText: 'LOT-DEMO-01' }).first();
}

Given('the sample wafer is uploaded for visual checks', async ({ page }) => {
  await page.goto('/wafers');
  if ((await sampleWaferRow(page).count()) > 0) return;

  await page.getByRole('link', { name: 'Upload data', exact: true }).click();
  await page.waitForURL('**/upload');
  await page.getByRole('combobox', { name: 'Device' }).selectOption('PROBE-DEV-1');
  await expect(
    page.getByRole('option', { name: 'PROBE-PGM-1 · Probe Practice Program 1' }),
  ).toBeAttached();
  await page.getByRole('combobox', { name: 'Test program' }).selectOption('PROBE-PGM-1');
  const csv = fs.readFileSync(SAMPLE_CSV);
  const dataTransfer = await page.evaluateHandle(
    (bytes: number[]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'wafer.csv', { type: 'text/csv' }));
      return transfer;
    },
    [...csv],
  );
  await page.getByTestId('upload-dropzone').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByText('wafer.csv', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload' }).click();

  /* The upload is queued; the wafer appears once processing completes. The
     wafers list is a cached query that does not refetch on a client-side nav,
     so reload the page until the row lands rather than trusting the stale list.
     Slower in the container, hence the generous poll window. */
  await expect(async () => {
    await page.goto('/wafers');
    await expect(sampleWaferRow(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});

When(
  'the QA user runs the bin pareto report for all bins of that wafer',
  async ({ page, scenarioState }) => {
    await page.goto('/wafers');
    const cell = page
      .getByRole('row')
      .filter({ hasText: 'LOT-DEMO-01' })
      .first()
      .getByRole('cell')
      .first();
    const sequence = Number(await cell.textContent());
    expect(Number.isInteger(sequence) && sequence > 0).toBeTruthy();
    scenarioState.set('visual:wafer-sequence', sequence);

    await page.goto('/reports/bin-pareto');
    await page.getByLabel('Wafer sequence').fill(String(sequence));
    await page.getByRole('combobox', { name: 'Bins to show' }).selectOption('All Bins');
    await page.getByRole('button', { name: 'Run report' }).click();
    await expect(page.getByRole('heading', { name: 'Bin loss', level: 2 })).toBeVisible();
  },
);

When('the QA user opens the sample wafer', async ({ page }) => {
  /* Open by lot on a freshly loaded list, so the click is deterministic rather
     than a guess at row position on a possibly-cached list. */
  await page.goto('/wafers');
  await sampleWaferRow(page).click();
  await page.waitForURL('**/wafers/*');
});

Then('the wafer map matches the approved image {string}', async ({ page }, snapshot: string) => {
  const chart = page.getByTestId('wafer-map-chart');
  await expect(chart).toBeVisible();
  /* The data layer must be populated before pixels are pinned, so the capture
     is of a drawn wafer rather than an empty canvas that resembles one. Read
     the container's children the way the functional steps do — no CSS. */
  await expect
    .poll(async () =>
      page.getByTestId('wafer-map-data').evaluate((element) => element.children.length),
    )
    .toBeGreaterThan(0);
  try {
    await expect(chart).toHaveScreenshotOdiff(snapshot, VISUAL_ODIFF_OPTIONS);
  } finally {
    await attachVisualEvidence(test.info(), chart, snapshot);
  }
});

Then(
  'the bin pareto chart matches the approved image {string}',
  async ({ page }, snapshot: string) => {
    const chart = page.getByTestId('bin-pareto-chart');
    await expect(chart).toBeVisible();
    try {
      await expect(chart).toHaveScreenshotOdiff(snapshot, VISUAL_ODIFF_OPTIONS);
    } finally {
      await attachVisualEvidence(test.info(), chart, snapshot);
    }
  },
);
