import assert from 'node:assert/strict';
import test from 'node:test';

import { binParetoCsvFilename, binParetoToCsv } from '../api/src/bin-pareto-csv.js';
import type { BinParetoOptions, BinParetoResponse } from '../shared/contracts.js';

/*
 * Unit coverage for the CSV export, routed here from spec-analysis.md:
 * AC-02 (every row carries the five reported values) and AC-04 (the file
 * records the options that produced it).
 *
 * The expected values below are written out by hand rather than derived from
 * the code under test — a test that builds its expectation with the same
 * function it is checking cannot fail.
 */

const options: BinParetoOptions = {
  binType: 'Hard Bin',
  specifyBins: 'Failed Bins Only',
  sortBy: 'Bin Occurrence',
  customBins: [],
};

function report(overrides: Partial<BinParetoResponse> = {}): BinParetoResponse {
  return {
    header: {
      waferSequence: 7,
      lot: 'LOT-A1',
      waferNumber: 3,
      device: 'DEV-X',
      testProgram: 'PROG-1',
      totalDies: 100,
      passCount: 80,
      yield: 80,
    },
    options,
    bins: [
      {
        binNumber: 4,
        binName: 'Leakage',
        dieCount: 12,
        binPercentage: 12,
        cumulativePercentage: 12,
      },
      { binNumber: 9, binName: 'Open', dieCount: 8, binPercentage: 8, cumulativePercentage: 20 },
    ],
    ...overrides,
  } as BinParetoResponse;
}

function lines(csv: string): string[] {
  return csv.split('\r\n');
}

test('AC-02 — every bin becomes one row carrying the five reported values', () => {
  const rows = lines(binParetoToCsv(report(), options));
  const header = rows.indexOf('Bin number,Bin name,Die count,Bin %,Cumulative %');

  assert.notEqual(header, -1, 'the table header line must be present');
  assert.equal(rows[header + 1], '4,Leakage,12,12,12');
  assert.equal(rows[header + 2], '9,Open,8,8,20');
});

test('AC-02 — rows keep the order the report produced, not a re-sorted one', () => {
  const descending = report({
    bins: [
      { binNumber: 9, binName: 'Open', dieCount: 8, binPercentage: 8, cumulativePercentage: 8 },
      {
        binNumber: 4,
        binName: 'Leakage',
        dieCount: 12,
        binPercentage: 12,
        cumulativePercentage: 20,
      },
    ],
  } as Partial<BinParetoResponse>);
  const rows = lines(binParetoToCsv(descending, options));
  const header = rows.indexOf('Bin number,Bin name,Die count,Bin %,Cumulative %');

  assert.equal(rows[header + 1], '9,Open,8,8,8');
  assert.equal(rows[header + 2], '4,Leakage,12,12,20');
});

test('AC-04 — the file states the options the report was run with', () => {
  const rows = lines(binParetoToCsv(report(), options));

  assert.ok(rows.includes('Lot,LOT-A1'));
  assert.ok(rows.includes('Wafer,3'));
  assert.ok(rows.includes('Bin type,Hard Bin'));
  assert.ok(rows.includes('Bins to show,Failed Bins Only'));
  assert.ok(rows.includes('Sort by,Bin Occurrence'));
});

test('AC-04 — a custom bin selection names the bins it selected', () => {
  const custom: BinParetoOptions = {
    ...options,
    specifyBins: 'Custom',
    customBins: [4, 9],
  };
  const rows = lines(binParetoToCsv(report(), custom));

  assert.ok(rows.includes('Bins to show,Custom'));
  assert.ok(rows.includes('Custom bins,4 9'));
});

test('AC-04 — no custom-bin line appears when the selection is not custom', () => {
  const rows = lines(binParetoToCsv(report(), options));
  assert.equal(
    rows.some((row) => row.startsWith('Custom bins,')),
    false,
  );
});

test('a bin name containing a comma stays in one column', () => {
  const awkward = report({
    bins: [
      {
        binNumber: 4,
        binName: 'Leakage, high',
        dieCount: 12,
        binPercentage: 12,
        cumulativePercentage: 12,
      },
    ],
  } as Partial<BinParetoResponse>);
  const rows = lines(binParetoToCsv(awkward, options));
  const header = rows.indexOf('Bin number,Bin name,Die count,Bin %,Cumulative %');

  /* Unquoted, this row would read as six columns and shift every value after
     the name into the wrong one — while still opening cleanly in a spreadsheet. */
  assert.equal(rows[header + 1], '4,"Leakage, high",12,12,12');
});

test('a bin name containing a quote escapes it by doubling', () => {
  const awkward = report({
    bins: [
      {
        binNumber: 4,
        binName: 'Bin "A"',
        dieCount: 1,
        binPercentage: 1,
        cumulativePercentage: 1,
      },
    ],
  } as Partial<BinParetoResponse>);
  const rows = lines(binParetoToCsv(awkward, options));
  const header = rows.indexOf('Bin number,Bin name,Die count,Bin %,Cumulative %');

  assert.equal(rows[header + 1], '4,"Bin ""A""",1,1,1');
});

test('the document ends with a complete line', () => {
  assert.ok(binParetoToCsv(report(), options).endsWith('\r\n'));
});

test('the file name identifies the lot, wafer, bin type and date', () => {
  const name = binParetoCsvFilename(report(), options, new Date('2026-08-19T10:30:00Z'));
  assert.equal(name, 'LOT-A1-W3-Hard-Bin-2026-08-19.csv');
});

test('a lot code with characters a file system rejects is made safe', () => {
  const odd = report({
    header: { ...report().header, lot: 'LOT/A:1' },
  } as Partial<BinParetoResponse>);
  const name = binParetoCsvFilename(odd, options, new Date('2026-08-19T10:30:00Z'));

  assert.equal(name, 'LOT-A-1-W3-Hard-Bin-2026-08-19.csv');
  assert.equal(/[/:]/.test(name), false);
});
