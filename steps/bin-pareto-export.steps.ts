/**
 * Step definitions for the bin pareto export cases
 * (features/bin-pareto-export/). Automates CAT-01 and CAT-02 from
 * .probe/artifacts/bin-pareto-export/10-spec/spec-analysis.md.
 *
 * The screen is the oracle here, not the code: every assertion compares the
 * saved file against what the table on the page is showing. Deriving the
 * expectation from the same formatter the app uses would produce a test that
 * cannot fail.
 */
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '@core/paths';
import { expect, Given, Then, When } from './fixtures';

const SAMPLE_CSV = path.join(REPO_ROOT, 'probe-lab-app', 'database', 'sample-wafer.csv');

/** A unique lot per run, so re-runs never trip the duplicate-wafer guard. */
function sampleCsvWithUniqueLot(): Buffer {
  const raw = fs.readFileSync(SAMPLE_CSV, 'utf-8');
  return Buffer.from(raw.replaceAll('LOT-DEMO-01', `LOT-E2E-${Date.now()}`));
}

/** One bin row as the screen renders it, in the screen's own order. */
interface ScreenRow {
  binNumber: string;
  binName: string;
  dieCount: string;
  binShare: string;
  runningShare: string;
}

/** The saved file, split into its option header lines and its table rows. */
interface SavedFile {
  headerLines: string[];
  columnNames: string[];
  rows: string[][];
}

/* Carried between steps through scenarioState, the only DI mechanism the
   framework permits: a module-level variable would be shared by every scenario
   in the worker, so two scenarios running in sequence could assert against each
   other's file. */
const SAVED_FILE = 'bin-pareto-export:saved-file';
const SCREEN_ROWS = 'bin-pareto-export:screen-rows';

const TABLE_HEADER = 'Bin number,Bin name,Die count,Bin %,Cumulative %';

/** Split one CSV line, honouring quoted fields that contain a comma. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function parseSavedFile(text: string): SavedFile {
  const lines = text.split('\r\n');
  const headerIndex = lines.indexOf(TABLE_HEADER);
  expect(headerIndex, 'the saved file must contain the table header line').toBeGreaterThan(-1);
  return {
    headerLines: lines.slice(0, headerIndex).filter((line) => line.length > 0),
    columnNames: splitCsvLine(TABLE_HEADER),
    rows: lines
      .slice(headerIndex + 1)
      .filter((line) => line.length > 0)
      .map(splitCsvLine),
  };
}

const WAFER_SEQUENCE = 'bin-pareto-export:wafer-sequence';

/**
 * Create the wafer this feature reports on, rather than hoping one is there.
 *
 * The first version of this step navigated to the wafer list and asserted the
 * heading, which established nothing — the scenarios then reported against a
 * hardcoded sequence 1 and passed only while some earlier run happened to have
 * left that wafer behind. They went red the moment the database was reseeded,
 * which is the failure this step existed to prevent.
 */
Given('a wafer with several failing bins is loaded', async ({ page, scenarioState }) => {
  await page.getByRole('link', { name: 'Upload data', exact: true }).click();
  await page.waitForURL('**/upload');
  await page.getByLabel('Device').selectOption('PROBE-DEV-1');
  await expect(
    page.getByRole('option', { name: 'PROBE-PGM-1 · Probe Practice Program 1' }),
  ).toBeAttached();
  await page.getByLabel('Test program').selectOption('PROBE-PGM-1');

  const csv = sampleCsvWithUniqueLot();
  const dataTransfer = await page.evaluateHandle((bytes: number[]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'wafer.csv', { type: 'text/csv' }));
    return transfer;
  }, [...csv]);
  await page.getByTestId('upload-dropzone').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByText('wafer.csv', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload' }).click();

  /* Wait for the wafer to finish processing before reading its sequence: the
     upload is queued, so the list is briefly empty of it. The sample wafer's
     yield is the signal that this row is the one just uploaded. */
  await page.getByRole('link', { name: 'Wafers', exact: true }).click();
  await page.waitForURL('**/wafers');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: '80.00%' })
      .first(),
  ).toBeVisible({ timeout: 15_000 });

  const cell = page.getByRole('row').nth(1).getByRole('cell').first();
  const sequence = Number(await cell.textContent());
  expect(Number.isInteger(sequence) && sequence > 0).toBeTruthy();
  scenarioState.set(WAFER_SEQUENCE, sequence);
});

/** The wafer this scenario uploaded. */
function waferSequence(scenarioState: Map<string, unknown>): string {
  const value = scenarioState.get(WAFER_SEQUENCE);
  expect(value, 'no wafer was uploaded in this scenario').toBeDefined();
  return String(value);
}

When('the QA user opens the bin pareto screen', async ({ page }) => {
  await page.goto('/reports/bin-pareto');
  await expect(page.getByRole('heading', { name: 'Bin pareto', level: 1 })).toBeVisible();
});

Then('the {string} button is not offered', async ({ page }, label: string) => {
  await expect(page.getByRole('button', { name: label })).toHaveCount(0);
});

Given('the QA user has run a bin pareto report', async ({ page, scenarioState }) => {
  await page.goto('/reports/bin-pareto');
  await page.getByLabel('Wafer sequence').fill(waferSequence(scenarioState));
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByRole('heading', { name: 'Bin loss', level: 2 })).toBeVisible();
});

Given(
  'the QA user has run a bin pareto report with bin type {string} and bins to show {string}',
  async ({ page, scenarioState }, binType: string, specifyBins: string) => {
    await page.goto('/reports/bin-pareto');
    await page.getByLabel('Wafer sequence').fill(waferSequence(scenarioState));
    await page.getByLabel('Bin type').selectOption(binType);
    await page.getByLabel('Bins to show').selectOption(specifyBins);
    await page.getByRole('button', { name: 'Run report' }).click();
    await expect(page.getByRole('heading', { name: 'Bin loss', level: 2 })).toBeVisible();
  },
);

When('the QA user downloads the report as a file', async ({ page, scenarioState }) => {
  /* Read the screen table BEFORE downloading: the comparison is file against
     what the engineer was actually looking at. */
  const bodyRows = page.getByTestId('bin-pareto-rows').getByRole('row');
  const screenRows: ScreenRow[] = await bodyRows.evaluateAll((rows) =>
    rows.map((row) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim() ?? '');
      return {
        binNumber: cells[0] ?? '',
        binName: cells[1] ?? '',
        dieCount: cells[2] ?? '',
        binShare: cells[3] ?? '',
        runningShare: cells[4] ?? '',
      };
    }),
  );

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('bin-pareto-download-csv').click(),
  ]).then(([event]) => event);

  const savedPath = await download.path();
  expect(savedPath, 'the browser must have saved a file').not.toBeNull();
  scenarioState.set(SCREEN_ROWS, screenRows);
  scenarioState.set(SAVED_FILE, parseSavedFile(fs.readFileSync(savedPath, 'utf-8')));
});

/** The saved file this scenario downloaded, failing loudly if no step saved one. */
function savedFile(scenarioState: Map<string, unknown>): SavedFile {
  const value = scenarioState.get(SAVED_FILE) as SavedFile | undefined;
  expect(value, 'no file was downloaded in this scenario').toBeDefined();
  return value as SavedFile;
}

function shownRows(scenarioState: Map<string, unknown>): ScreenRow[] {
  const value = scenarioState.get(SCREEN_ROWS) as ScreenRow[] | undefined;
  expect(value, 'the screen table was not read in this scenario').toBeDefined();
  return value as ScreenRow[];
}

Then('a comma-separated file is saved', ({ scenarioState }) => {
  expect(savedFile(scenarioState).columnNames).toEqual([
    'Bin number',
    'Bin name',
    'Die count',
    'Bin %',
    'Cumulative %',
  ]);
});

Then('the file holds one row for each bin shown on the screen', ({ scenarioState }) => {
  expect(savedFile(scenarioState).rows).toHaveLength(shownRows(scenarioState).length);
});

Then('the rows are in the same order as the screen', ({ scenarioState }) => {
  const fileBins = savedFile(scenarioState).rows.map((row) => row[0]);
  const screenBins = shownRows(scenarioState).map((row) => row.binNumber);
  expect(fileBins).toEqual(screenBins);
});

Then(
  'each row carries the bin number, bin name, die count, bin share and running share',
  ({ scenarioState }) => {
    const { rows } = savedFile(scenarioState);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveLength(5);
      for (const field of row) expect(field.length).toBeGreaterThan(0);
    }
  },
);

Then('the values in each row match the screen for that bin', ({ scenarioState }) => {
  const { rows } = savedFile(scenarioState);
  const onScreen = shownRows(scenarioState);
  expect(rows).toHaveLength(onScreen.length);

  rows.forEach((row, index) => {
    const shown = onScreen[index];
    expect(row[0]).toBe(shown?.binNumber);
    expect(row[1]).toBe(shown?.binName);
    /* The screen groups thousands for readability; the file must not, or a
       spreadsheet reads "1,234" as two columns. Compare on the number. */
    expect(Number(row[2])).toBe(Number(shown?.dieCount.replaceAll(',', '')));
    expect(Number(row[3])).toBeCloseTo(Number(shown?.binShare.replace('%', '')), 2);
    expect(Number(row[4])).toBeCloseTo(Number(shown?.runningShare.replace('%', '')), 2);
  });
});

Then('the file records bin type {string}', ({ scenarioState }, binType: string) => {
  expect(savedFile(scenarioState).headerLines).toContain(`Bin type,${binType}`);
});

Then('the file records bins to show {string}', ({ scenarioState }, specifyBins: string) => {
  expect(savedFile(scenarioState).headerLines).toContain(`Bins to show,${specifyBins}`);
});

Then('the file names the wafer it came from', ({ scenarioState }) => {
  const { headerLines } = savedFile(scenarioState);
  const lot = headerLines.find((line) => line.startsWith('Lot,'));
  const wafer = headerLines.find((line) => line.startsWith('Wafer,'));
  expect(lot, 'the file must name the lot').toBeDefined();
  expect(wafer, 'the file must name the wafer number').toBeDefined();
  expect(lot?.split(',')[1]?.length).toBeGreaterThan(0);
});
