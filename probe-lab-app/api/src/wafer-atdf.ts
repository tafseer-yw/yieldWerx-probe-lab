/*
 * Wafer ATDF reader — ATDF is the ASCII rendering of STDF, one record per line
 * as `TYPE:field|field|...`, where a line beginning with a space continues the
 * record above it.
 *
 * Only the records a wafer map, cluster view, and bin pareto actually consume are
 * read; the parametric PTR results (tens of thousands per wafer) are counted and
 * ignored, because nothing in this app stores a per-test measurement.
 *
 *   MIR  field 1  → lot code
 *   WIR  field 4  → wafer id, confirmed against WRR field 4 when present
 *   HBR/SBR       → bin number, its pass/fail disposition, and its name
 *   PRR           → one die: pass/fail flag, hard bin, soft bin, X, Y
 *
 * Pass/fail comes from the PRR flag the tester recorded, and the bin's HBR
 * disposition is used to contradict it rather than to replace it: a disagreement
 * is a FLAG_BIN_MISMATCH row error, exactly as a CSV whose PF_Flag fights its
 * HB# would be. That keeps a wrong result visible instead of silently picking a
 * winner.
 *
 * Validation error codes are shared with the CSV reader so PROBE scenarios and
 * the validation report treat both formats identically.
 */
import {
  dieCoordinateRange,
  maximumWaferRows,
  waferNumberRange,
  type ParsedDie,
  type UploadErrorCode,
  type UploadParseResult,
  type UploadValidationError,
} from './wafer-upload.js';

/** One logical ATDF record, after continuation lines have been folded in. */
interface AtdfRecord {
  type: string;
  fields: string[];
  /** 1-based line where the record started, for error reporting. */
  line: number;
  raw: string;
}

interface BinDefinition {
  name: string | null;
  /** 'P' or 'F' when the file states a disposition, null when it leaves it blank. */
  disposition: 'P' | 'F' | null;
}

const MAX_TEXT_LENGTH = 32;

/**
 * Folds ATDF continuation lines (any line starting with a space) into the record
 * above, then splits each record into its type and pipe-separated fields.
 */
function readRecords(text: string): AtdfRecord[] {
  const records: AtdfRecord[] = [];
  const lines = text.split(/\r\n|\n|\r/u);

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue;
    if (line.startsWith(' ') || line.startsWith('\t')) {
      const previous = records.at(-1);
      // A continuation with nothing to continue is not a record; skip it.
      if (!previous) continue;
      previous.raw += line.slice(1);
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    records.push({
      type: line.slice(0, separator).trim().toUpperCase(),
      fields: [],
      line: index + 1,
      raw: line.slice(separator + 1),
    });
  }

  for (const record of records) record.fields = record.raw.split('|');
  return records;
}

function field(record: AtdfRecord, index: number): string {
  return record.fields[index]?.trim() ?? '';
}

function rejected(rowsRead: number, message: string): UploadParseResult {
  return { kind: 'rejected', rowsRead, message, errors: [] };
}

function dieError(
  record: AtdfRecord,
  column: string,
  code: UploadErrorCode,
  message: string,
): UploadValidationError {
  return { rowNumber: record.line, column, code, message, rawText: record.raw.slice(0, 500) };
}

/** Reads an integer field, returning null when it is absent or not an integer. */
function integerField(record: AtdfRecord, index: number): number | null {
  const text = field(record, index);
  if (text.length === 0) return null;
  if (!/^[+-]?\d+$/u.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function binName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed;
}

/**
 * HBR/SBR give `head|site|bin|count|disposition|name`. Head and site are blank on
 * the summary records that describe the whole wafer, which is the form this app
 * reads; a per-site duplicate of the same bin number does not change its name.
 */
function readBinDefinitions(
  records: AtdfRecord[],
  type: 'HBR' | 'SBR',
): Map<number, BinDefinition> {
  const definitions = new Map<number, BinDefinition>();
  for (const record of records) {
    if (record.type !== type) continue;
    const bin = integerField(record, 2);
    if (bin === null || bin < 0) continue;
    const disposition = field(record, 4).toUpperCase();
    const existing = definitions.get(bin);
    definitions.set(bin, {
      name: binName(field(record, 5)) ?? existing?.name ?? null,
      disposition:
        disposition === 'P' || disposition === 'F' ? disposition : (existing?.disposition ?? null),
    });
  }
  return definitions;
}

export function parseWaferAtdf(input: string | Buffer): UploadParseResult {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  const records = readRecords(text);
  const partRecords = records.filter((record) => record.type === 'PRR');

  if (text.trim().length === 0) {
    return rejected(0, 'File is empty.');
  }
  // A file with content but no recognizable records is the wrong format, not an
  // empty one — say which, so the wrong-tab mistake is obvious.
  if (records.length === 0 || !records.some((record) => record.type === 'FAR')) {
    return rejected(
      partRecords.length,
      'File is not an ATDF: no FAR record was found. ATDF records look like FAR:A|4|2.',
    );
  }

  const lotRecord = records.find((record) => record.type === 'MIR');
  const lot = lotRecord ? field(lotRecord, 0) : '';
  if (lot.length === 0) {
    return rejected(partRecords.length, 'ATDF is missing the MIR lot identifier.');
  }
  if (lot.length > MAX_TEXT_LENGTH) {
    return rejected(
      partRecords.length,
      `MIR lot identifier must contain between 1 and ${MAX_TEXT_LENGTH} characters.`,
    );
  }

  const waferStart = records.find((record) => record.type === 'WIR');
  const waferEnd = records.find((record) => record.type === 'WRR');
  if (!waferStart && !waferEnd) {
    return rejected(partRecords.length, 'ATDF contains no wafer: a WIR or WRR record is required.');
  }
  const startId = waferStart ? integerField(waferStart, 3) : null;
  const endId = waferEnd ? integerField(waferEnd, 3) : null;
  if (startId !== null && endId !== null && startId !== endId) {
    return rejected(
      partRecords.length,
      `Wafer id differs between WIR (${startId}) and WRR (${endId}).`,
    );
  }
  const wafer = startId ?? endId;
  if (wafer === null) {
    return rejected(partRecords.length, 'ATDF wafer record carries no wafer id.');
  }
  if (wafer < waferNumberRange.minimum || wafer > waferNumberRange.maximum) {
    return rejected(
      partRecords.length,
      `Wafer id must be between ${waferNumberRange.minimum} and ${waferNumberRange.maximum}.`,
    );
  }

  // More than one wafer in a file would silently collapse into one map.
  if (records.filter((record) => record.type === 'WIR').length > 1) {
    return rejected(
      partRecords.length,
      'ATDF contains more than one wafer; upload one wafer per file.',
    );
  }

  if (partRecords.length === 0) {
    return rejected(0, 'ATDF contains no PRR part records, so it holds no dies.');
  }
  if (partRecords.length > maximumWaferRows) {
    return rejected(
      partRecords.length,
      `File contains more than the ${maximumWaferRows.toLocaleString('en-US')} die limit.`,
    );
  }

  const hardBins = readBinDefinitions(records, 'HBR');
  const softBins = readBinDefinitions(records, 'SBR');

  const acceptedDies: ParsedDie[] = [];
  const errors: UploadValidationError[] = [];
  const coordinates = new Set<string>();

  for (const record of partRecords) {
    const flagText = field(record, 4).toUpperCase();
    // PART_FLG may carry trailing condition letters; the disposition is the first.
    const flag = flagText.charAt(0);
    if (flag !== 'P' && flag !== 'F') {
      errors.push(
        dieError(record, 'PART_FLG', 'BAD_FLAG', 'PRR pass/fail flag must start with P or F.'),
      );
      continue;
    }

    const hardBin = integerField(record, 5);
    const softBin = integerField(record, 6);
    const x = integerField(record, 7);
    const y = integerField(record, 8);

    const missing = (
      [
        ['HARD_BIN', hardBin],
        ['SOFT_BIN', softBin],
        ['X_COORD', x],
        ['Y_COORD', y],
      ] satisfies Array<[string, number | null]>
    ).find(([column, value]) => value === null && field(record, columnIndex(column)).length === 0);
    if (missing) {
      errors.push(dieError(record, missing[0], 'MISSING_VALUE', `${missing[0]} is required.`));
      continue;
    }

    const notInteger = (
      [
        ['HARD_BIN', hardBin],
        ['SOFT_BIN', softBin],
        ['X_COORD', x],
        ['Y_COORD', y],
      ] satisfies Array<[string, number | null]>
    ).find(([, value]) => value === null);
    if (notInteger) {
      errors.push(
        dieError(
          record,
          notInteger[0],
          'NOT_AN_INTEGER',
          `${notInteger[0]} must be a whole number.`,
        ),
      );
      continue;
    }
    if (hardBin === null || softBin === null || x === null || y === null) continue;

    if (hardBin < 0 || softBin < 0) {
      const column = hardBin < 0 ? 'HARD_BIN' : 'SOFT_BIN';
      errors.push(dieError(record, column, 'OUT_OF_RANGE', `${column} must be 0 or greater.`));
      continue;
    }
    const outOfRange = (
      [
        ['X_COORD', x],
        ['Y_COORD', y],
      ] satisfies Array<[string, number]>
    ).find(([, value]) => value < dieCoordinateRange.minimum || value > dieCoordinateRange.maximum);
    if (outOfRange) {
      errors.push(
        dieError(
          record,
          outOfRange[0],
          'OUT_OF_RANGE',
          `${outOfRange[0]} must be between ${dieCoordinateRange.minimum} and ${dieCoordinateRange.maximum}.`,
        ),
      );
      continue;
    }

    // The bin's own disposition must agree with the part's recorded result.
    const declared = hardBins.get(hardBin)?.disposition ?? null;
    if (declared !== null && declared !== flag) {
      errors.push(
        dieError(
          record,
          'PART_FLG',
          'FLAG_BIN_MISMATCH',
          `PRR flag is ${flag} but HBR declares hard bin ${hardBin} as ${declared}.`,
        ),
      );
      continue;
    }

    const key = `${x}:${y}`;
    if (coordinates.has(key)) {
      errors.push(
        dieError(record, 'X_COORD', 'DUPLICATE_DIE', `Die (${x}, ${y}) appears more than once.`),
      );
      continue;
    }
    coordinates.add(key);

    acceptedDies.push({
      rowNumber: record.line,
      rawText: record.raw.slice(0, 500),
      lot,
      wafer,
      x,
      y,
      hardBin,
      hardBinName: hardBins.get(hardBin)?.name ?? null,
      softBin,
      softBinName: softBins.get(softBin)?.name ?? null,
      passFailFlag: flag,
    });
  }

  if (acceptedDies.length === 0) {
    return {
      kind: 'rejected',
      rowsRead: partRecords.length,
      message: 'Every PRR record was rejected, so no dies could be stored.',
      errors,
    };
  }

  return {
    kind: 'ready',
    status: errors.length === 0 ? 'Succeeded' : 'Completed with errors',
    rowsRead: partRecords.length,
    lot,
    wafer,
    // ATDF carries wafer flat/notch orientation in WCR, not an angle this app models.
    notchAngle: null,
    acceptedDies,
    errors,
  };
}

/** PRR field positions, so a missing-value check can look at the raw text. */
function columnIndex(column: string): number {
  switch (column) {
    case 'HARD_BIN':
      return 5;
    case 'SOFT_BIN':
      return 6;
    case 'X_COORD':
      return 7;
    default:
      return 8;
  }
}
