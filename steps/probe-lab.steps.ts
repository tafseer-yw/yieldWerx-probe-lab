/**
 * Starter BDD step definitions for the yieldWerx PROBE Lab app (probe-lab-app/).
 * Drives the four workflows through the UI — login → upload CSV → wafer map →
 * wafer triage → cluster detection → bin pareto — and checks the expected numbers
 * for the sample wafer (25 dies, 20 pass, 80% yield; one 5-die fail cluster;
 * failed bins HB2=4 and HB3=1). QA and Engineering extend this set as PROBE practice.
 */
import fs from 'node:fs';
import path from 'node:path';

import { credentialsFor } from '@core/config';
import { REPO_ROOT } from '@core/paths';
import { expect, Given, Then, When } from './fixtures';

const SAMPLE_CSV = path.join(REPO_ROOT, 'probe-lab-app', 'database', 'sample-wafer.csv');

/** Read the sample CSV with a unique lot so re-runs never hit the duplicate-wafer guard. */
function sampleCsvWithUniqueLot(): Buffer {
  const raw = fs.readFileSync(SAMPLE_CSV, 'utf-8');
  return Buffer.from(raw.replaceAll('LOT-DEMO-01', `LOT-E2E-${Date.now()}`));
}

Given('the engineer is signed in', async ({ page, config }) => {
  const creds = credentialsFor(config, 'engineer');
  await page.goto('/login');
  await page.getByLabel('Username').fill(creds.username);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  const systemStatus = page.getByRole('status', {
    name: 'System versions and database status',
  });
  await expect(systemStatus).toContainText('UIv0.1.0');
  await expect(systemStatus).toContainText('APIv0.1.0');
  await expect(systemStatus).toContainText('DBConnected');
  const collapse = page.getByTestId('nav-collapse');
  await expect(collapse).toHaveAttribute('data-direction', 'left');
  const collapseBox = await collapse.boundingBox();
  expect(collapseBox).not.toBeNull();
  expect(collapseBox?.width).toBe(14);
  expect(collapseBox?.height).toBe(34);
  await collapse.click();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
    'data-direction',
    'right',
  );
  await expect(systemStatus).toBeHidden();
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(collapse).toHaveAttribute('data-direction', 'left');
  await expect(systemStatus).toBeVisible();
});

When('the engineer uploads the sample wafer CSV', async ({ page }) => {
  await page.getByRole('link', { name: 'Upload data', exact: true }).click();
  await page.waitForURL('**/upload');
  await page.getByLabel('Device').selectOption('PROBE-DEV-1');
  await expect(
    page.getByRole('option', { name: 'PROBE-PGM-1 · Probe Practice Program 1' }),
  ).toBeAttached();
  await page.getByLabel('Test program').selectOption('PROBE-PGM-1');
  const csv = sampleCsvWithUniqueLot();
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
});

Then('the upload status shows {string}', async ({ page }, status: string) => {
  const row = page.getByRole('row').filter({ hasText: status }).first();
  await expect(row).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByText(status, { exact: true })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
});

Then('the wafers list shows a wafer with yield {int}', async ({ page }, yieldPct: number) => {
  await page.getByRole('link', { name: 'Wafers', exact: true }).click();
  await page.waitForURL('**/wafers');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: `${yieldPct}.00%` })
      .first(),
  ).toBeVisible({ timeout: 10_000 });
});

When('the engineer opens the most recent wafer', async ({ page }) => {
  await page.getByRole('link', { name: 'Wafers', exact: true }).click();
  await page.waitForURL('**/wafers');
  await page.getByRole('row').nth(1).click();
  await page.waitForURL('**/wafers/*');
});

Then('the wafer detail shows yield {int}', async ({ page }, yieldPct: number) => {
  await expect(page.getByText(`${yieldPct}.00%`).first()).toBeVisible({ timeout: 10_000 });
  const dieCounts = await page.getByTestId('wafer-map-data').evaluate((element) => {
    const dies = [...element.children] as HTMLElement[];
    return {
      total: dies.length,
      passing: dies.filter((die) => die.dataset.passfail === 'P').length,
      failing: dies.filter((die) => die.dataset.passfail === 'F').length,
    };
  });
  expect(dieCounts).toEqual({ total: 25, passing: 20, failing: 5 });
});

When('the engineer opens wafer triage for this wafer', async ({ page }) => {
  const analysisNav = page.getByRole('navigation', { name: 'Analysis' });
  await expect(analysisNav.getByRole('link', { name: /Wafer triage/u })).toBeVisible();
  await page.getByRole('button', { name: 'Triage wafer' }).click();
  await page.waitForURL('**/triage');
});

Then('wafer triage reports no close match with supporting analytics', async ({ page }) => {
  const result = page.getByTestId('triage-signature-result');
  await expect(result).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('combobox', { name: 'Find a wafer' })).toHaveValue(
    /#\d+ · PROBE-DEV-1 · LOT-E2E-\d+ · W05 · PROBE-PGM-1/u,
  );
  await expect(result.getByText('No close match')).toBeVisible();
  await expect(result.getByText('Handling scratch')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where failures appear' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top failure bins' })).toBeVisible();
  await expect(page.getByText('HB 2')).toBeVisible();
  await expect(result).toContainText('not a root-cause diagnosis');

  const explainerButton = page.getByRole('button', { name: 'About Wafer triage' });
  await explainerButton.click();
  const explainer = page.getByRole('note');
  await expect(explainer.getByText('What it is', { exact: true })).toBeVisible();
  await expect(explainer.getByText('How it works', { exact: true })).toBeVisible();
  await expect(explainer.getByText('Pattern-matching algorithm', { exact: true })).toBeVisible();
  await expect(explainer).toContainText('fixed pattern-matching algorithm');
  await expect(explainer).toContainText('does not train itself');
  await expect(explainer).toContainText('15 measurements');
  await expect(explainer).toContainText('at least 62%');
  await expect(explainer.getByRole('listitem')).toHaveCount(6);
  await expect(explainer.getByText('Why it helps (ROI)', { exact: true })).toBeVisible();
  await expect(explainer).toContainText('less time opening different pages');
  const scrollState = await explainer.evaluate((element) => {
    element.scrollTo({ top: Math.min(160, element.scrollHeight - element.clientHeight) });
    return {
      top: element.scrollTop,
      hasOverflow: element.scrollHeight > element.clientHeight,
    };
  });
  expect(scrollState.hasOverflow).toBeTruthy();
  expect(scrollState.top).toBeGreaterThan(0);
  await expect(explainer).toBeVisible();
  const buttonBox = await explainerButton.boundingBox();
  const explainerBox = await explainer.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(explainerBox).not.toBeNull();
  if (buttonBox && explainerBox) {
    expect(explainerBox.x).toBeGreaterThanOrEqual(buttonBox.x + buttonBox.width);
  }
  await page.getByRole('button', { name: 'Close help' }).click();
});

When('the engineer notes the most recent wafer sequence', async ({ page, scenarioState }) => {
  await page.getByRole('link', { name: 'Wafers', exact: true }).click();
  await page.waitForURL('**/wafers');
  const cell = page.getByRole('row').nth(1).getByRole('cell').first();
  const seq = Number(await cell.textContent());
  expect(Number.isInteger(seq) && seq > 0).toBeTruthy();
  scenarioState.set('waferSequence', seq);
});

When(
  'the engineer runs cluster detection with 4-way adjacency and minimum {int} connected dies',
  async ({ page, scenarioState }, minimum: number) => {
    const seq = scenarioState.get('waferSequence') as number;
    await page.getByRole('link', { name: 'Cluster detection', exact: true }).click();
    await page.waitForURL('**/detection');
    await page.getByLabel('Wafer sequence').fill(String(seq));
    await page.getByLabel('How dies touch').selectOption('4-way');
    await page.getByLabel('Minimum cluster size').fill(String(minimum));
    await page.getByRole('button', { name: 'Detect clusters' }).click();
  },
);

Then('the cluster detection reports {int} cluster', async ({ page }, count: number) => {
  const label = count === 1 ? `${count} cluster` : `${count} clusters`;
  await expect(page.getByText(label)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'About Cluster detection' }).click();
  const explainer = page.getByRole('note');
  await expect(explainer.getByText('How it works', { exact: true })).toBeVisible();
  await expect(explainer.getByText('Cluster detection algorithm', { exact: true })).toBeVisible();
  await expect(explainer).toContainText('breadth-first search');
  await expect(explainer).toContainText('A chain of touching failures');
  await expect(explainer).toContainText('top to bottom, then left to right');
  await expect(explainer.getByRole('listitem')).toHaveCount(6);
  await expect(explainer.getByText('Why it helps (ROI)', { exact: true })).toBeVisible();
  await expect(explainer).toContainText('long list of die locations');
  await page.getByRole('button', { name: 'Close help' }).click();
});

Then('the cluster detection reports a cluster of {int} dies', async ({ page }, dies: number) => {
  await expect(page.getByRole('row').filter({ hasText: String(dies) })).toBeVisible({
    timeout: 10_000,
  });
  const clusteredCoordinates = await page.getByTestId('wafer-map-data').evaluate((element) =>
    ([...element.children] as HTMLElement[])
      .filter((die) => die.dataset.cluster === 'true')
      .map((die) => `${die.dataset.x},${die.dataset.y}`)
      .sort(),
  );
  expect(clusteredCoordinates).toEqual(['1,2', '2,1', '2,2', '2,3', '3,2']);
});

When('the engineer runs the bin pareto report for failed bins', async ({ page, scenarioState }) => {
  const seq = scenarioState.get('waferSequence') as number;
  await page.getByRole('link', { name: 'Bin pareto', exact: true }).click();
  await page.waitForURL('**/reports/bin-pareto');
  await page.getByLabel('Wafer sequence').fill(String(seq));
  await page.getByRole('button', { name: 'Run report' }).click();
});

Then('the bin pareto reports the failed bins', async ({ page }) => {
  const bin2 = page.getByRole('row').filter({ hasText: 'Bin 2' });
  const bin3 = page.getByRole('row').filter({ hasText: 'Bin 3' });
  await expect(bin2).toContainText('4', { timeout: 10_000 });
  await expect(bin2).toContainText('16.00%');
  await expect(bin3).toContainText('1');
  await expect(bin3).toContainText('4.00%');
  await expect(page.getByRole('row')).toHaveCount(3);

  await page.getByRole('button', { name: 'About Bin pareto' }).click();
  const explainer = page.getByRole('note');
  await expect(explainer.getByText('How it works', { exact: true })).toBeVisible();
  await expect(explainer.getByText('Why it helps (ROI)', { exact: true })).toBeVisible();
  await expect(explainer).toContainText('few bins causing most of the loss');
  await page.getByRole('button', { name: 'Close help' }).click();
});

When('the engineer opens the PROBE guide', async ({ page }) => {
  await page.getByRole('link', { name: 'PROBE guide', exact: true }).click();
  await page.waitForURL('**/guide');
});

Then('the guide covers setup, plugins, the Dev track, and the QA track', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Get the lab running' })).toBeVisible();

  await page.getByRole('button', { name: /Plugins/u }).click();
  await expect(page.getByRole('link', { name: /Open GitHub repository/u })).toHaveCount(2);

  await page.getByRole('button', { name: /Dev track/u }).click();
  await expect(page.getByRole('heading', { name: 'Dev track', exact: true })).toBeVisible();
  await expect(
    page.getByText('/yw:build-feature <feature-slug> --requirement <path>'),
  ).toBeVisible();

  await page.getByRole('button', { name: /QA track/u }).click();
  await expect(page.getByRole('heading', { name: 'QA track', exact: true })).toBeVisible();
  await expect(page.getByText('/yw:probe-spec <feature-slug> <approved-spec>')).toBeVisible();
});

Then('sample wafers is an admin header action', async ({ page, config }) => {
  await page.getByRole('button', { name: /engineer/u }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');

  const admin = credentialsFor(config, 'admin');
  await page.getByLabel('Username').fill(admin.username);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');

  const header = page.getByRole('banner');
  await expect(header.getByRole('button', { name: 'Sample wafers', exact: true })).toBeVisible();
  await header.getByRole('button', { name: /admin/u }).click();
  await expect(page.getByRole('menuitem', { name: 'Sample wafers' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
});

Then(
  'the filters, analysis options, and responsive navigation are consistent',
  async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    await page
      .getByRole('navigation', { name: 'Data' })
      .getByRole('link', { name: 'Upload history', exact: true })
      .click();
    await expect(page).toHaveTitle('Upload history · yieldWerx PROBE Lab');
    const statusOptions = page.getByLabel('Status').getByRole('option');
    await expect(statusOptions).toHaveText([
      'All statuses',
      'Succeeded',
      'Completed with errors',
      'Rejected',
    ]);

    await page.getByRole('link', { name: 'Cluster detection', exact: true }).click();
    await expect(page.getByLabel('How dies touch').getByRole('option')).toHaveText([
      'Sides only (4-way)',
      'Sides and corners (8-way)',
    ]);
    await expect(page.getByLabel('Minimum cluster size')).toBeVisible();
    await expect(page.getByLabel('Wafer sequence')).toHaveAccessibleDescription(
      'From the Wafers screen',
    );
    await page.getByRole('link', { name: 'Bin pareto', exact: true }).click();
    await expect(page.getByLabel('Bins to show')).toBeVisible();
    await expect(page.getByLabel('Sort by').getByRole('option')).toHaveText([
      'Most dies first',
      'Bin number',
    ]);

    await page.getByTestId('nav-collapse').click();
    await page.setViewportSize({ width: 700, height: 800 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const mobileSidebar = page.getByRole('complementary');
    await expect(mobileSidebar.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    const sidebarBox = await mobileSidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(sidebarBox?.width).toBeGreaterThan(200);
    await mobileSidebar.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Expand navigation' }).click();
  },
);

Then('a viewer cannot open the upload workflow', async ({ page, config }) => {
  await page.getByTestId('nav-collapse').click();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  await page.getByRole('button', { name: /engineer/u }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const viewer = credentialsFor(config, 'viewer');
  await page.getByLabel('Username').fill(viewer.username);
  await page.getByLabel('Password').fill(viewer.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');

  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Overview' })
      .getByRole('link', { name: 'Dashboard', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upload data', exact: true })).toHaveCount(0);
  await page.goto('/upload');
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
