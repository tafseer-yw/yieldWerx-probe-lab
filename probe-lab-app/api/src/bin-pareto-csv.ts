import type { BinParetoOptions, BinParetoResponse } from '../../shared/contracts.js';

/*
 * Turns a bin pareto result into the comma-separated text the export serves.
 *
 * Formatting only — it never recomputes anything. The rows come from
 * deriveBinPareto() exactly as the screen received them, because the whole
 * promise of this feature is that the file and the screen agree. A second
 * calculation here, however small, is how they would eventually disagree.
 */

/** Header lines sit above the table (Q-02) so the table itself stays sortable. */
const optionLabels: Record<string, string> = {
  binType: 'Bin type',
  specifyBins: 'Bins to show',
  sortBy: 'Sort by',
};

/**
 * Quote a field for CSV.
 *
 * A bin name is operator-supplied text, so it can contain a comma, a quote, or
 * a newline. Any of those unescaped shifts every later column into the wrong
 * one, and the file still opens — silently wrong is the failure mode that
 * matters here, not a crash.
 */
function csvField(value: string | number): string {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvField).join(',');
}

/**
 * The file name a reader can tell apart from its neighbours (Q-01): the lot,
 * the wafer, the bin type, and the date the export was taken.
 *
 * `takenOn` is passed in rather than read from the clock so the caller owns the
 * timestamp and a test can assert an exact name.
 */
export function binParetoCsvFilename(
  report: BinParetoResponse,
  options: BinParetoOptions,
  takenOn: Date,
): string {
  const parts = [
    report.header.lot,
    `W${report.header.waferNumber}`,
    options.binType,
    takenOn.toISOString().slice(0, 10),
  ];
  /* Anything that is not a letter, digit, or hyphen becomes a hyphen: lot codes
     are free text and a slash or a colon in a file name is rejected or silently
     rewritten depending on the operating system. */
  return `${parts.join('-').replace(/[^A-Za-z0-9-]+/g, '-')}.csv`;
}

/**
 * The exported document: the option header lines, a blank line, then the table
 * with one row per bin in the order the report produced them.
 */
export function binParetoToCsv(report: BinParetoResponse, options: BinParetoOptions): string {
  const lines: string[] = [
    csvRow(['Lot', report.header.lot]),
    csvRow(['Wafer', report.header.waferNumber]),
    csvRow(['Device', report.header.device]),
    csvRow(['Test program', report.header.testProgram]),
    csvRow([optionLabels.binType ?? 'Bin type', options.binType]),
    csvRow([optionLabels.specifyBins ?? 'Bins to show', options.specifyBins]),
    csvRow([optionLabels.sortBy ?? 'Sort by', options.sortBy]),
  ];
  if (options.specifyBins === 'Custom') {
    lines.push(csvRow(['Custom bins', options.customBins.join(' ')]));
  }
  lines.push('');
  lines.push(csvRow(['Bin number', 'Bin name', 'Die count', 'Bin %', 'Cumulative %']));
  for (const bin of report.bins) {
    lines.push(
      csvRow([
        bin.binNumber,
        bin.binName,
        bin.dieCount,
        bin.binPercentage,
        bin.cumulativePercentage,
      ]),
    );
  }
  /* CRLF, which is what the CSV convention specifies and what spreadsheets on
     Windows expect; a trailing break keeps the last row a complete line. */
  return `${lines.join('\r\n')}\r\n`;
}
