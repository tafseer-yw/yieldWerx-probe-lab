/*
 * Wafer CSV parser — faithful port of the real app's wafer-upload domain module,
 * trimmed to the practice scope: header detection (with aliases), optional
 * notch metadata, per-row validation, duplicate detection, and lot/wafer
 * consistency. The coordinate-frame metadata (positiveX/flipX/map bounds) is
 * intentionally dropped — the practice wafer detail does not expose it.
 *
 * The validation error codes are kept identical to the real app so PROBE
 * scenarios transfer: MISSING_VALUE, NOT_AN_INTEGER, OUT_OF_RANGE, BAD_FLAG,
 * DUPLICATE_DIE, FLAG_BIN_MISMATCH.
 */
import { parse } from 'csv-parse/sync';

export const waferCsvColumns = ['Lot', 'Wafer', 'X', 'Y', 'HB#', 'SB#', 'PF_Flag'] as const;
export const maximumWaferRows = 50_000;

export type UploadErrorCode =
  | 'MISSING_VALUE'
  | 'NOT_AN_INTEGER'
  | 'OUT_OF_RANGE'
  | 'BAD_FLAG'
  | 'DUPLICATE_DIE'
  | 'FLAG_BIN_MISMATCH';

export interface ParsedDie {
  rowNumber: number;
  rawText: string;
  lot: string;
  wafer: number;
  x: number;
  y: number;
  hardBin: number;
  hardBinName: string | null;
  softBin: number;
  softBinName: string | null;
  passFailFlag: 'P' | 'F';
}

export interface UploadValidationError {
  rowNumber: number;
  column: string;
  code: UploadErrorCode;
  message: string;
  rawText: string;
}

export type UploadParseResult =
  | {
      kind: 'ready';
      status: 'Succeeded' | 'Completed with errors';
      rowsRead: number;
      lot: string;
      wafer: number;
      notchAngle: 0 | 90 | 180 | 270 | null;
      acceptedDies: ParsedDie[];
      errors: UploadValidationError[];
    }
  | {
      kind: 'rejected';
      rowsRead: number;
      message: string;
      errors: UploadValidationError[];
    };

interface CsvRecord {
  record: string[];
  raw: string;
  info: { lines: number };
}

interface RowErrorInput {
  row: CsvRecord;
  column: string;
  code: UploadErrorCode;
  message: string;
}

type RequiredField = 'lot' | 'wafer' | 'x' | 'y' | 'hardBin' | 'softBin' | 'flag';
type OptionalField = 'hardBinName' | 'softBinName';
type CsvField = RequiredField | OptionalField;
type ColumnIndexes = Partial<Record<CsvField, number>>;

const requiredFields: Array<{ field: RequiredField; column: (typeof waferCsvColumns)[number] }> = [
  { field: 'lot', column: 'Lot' },
  { field: 'wafer', column: 'Wafer' },
  { field: 'x', column: 'X' },
  { field: 'y', column: 'Y' },
  { field: 'hardBin', column: 'HB#' },
  { field: 'softBin', column: 'SB#' },
  { field: 'flag', column: 'PF_Flag' },
];

const headerAliases = new Map<string, CsvField>([
  ['lot', 'lot'],
  ['lot id', 'lot'],
  ['lotid', 'lot'],
  ['wafer', 'wafer'],
  ['wafer id', 'wafer'],
  ['waferid', 'wafer'],
  ['x', 'x'],
  ['y', 'y'],
  ['hb#', 'hardBin'],
  ['hb #', 'hardBin'],
  ['hb', 'hardBin'],
  ['hb number', 'hardBin'],
  ['hard bin', 'hardBin'],
  ['hard bin number', 'hardBin'],
  ['hardbin', 'hardBin'],
  ['sb#', 'softBin'],
  ['sb #', 'softBin'],
  ['sb', 'softBin'],
  ['sb number', 'softBin'],
  ['soft bin', 'softBin'],
  ['soft bin number', 'softBin'],
  ['softbin', 'softBin'],
  ['pf flag', 'flag'],
  ['pf', 'flag'],
  ['p/f', 'flag'],
  ['pass fail', 'flag'],
  ['pass fail flag', 'flag'],
  ['pass/fail', 'flag'],
  ['pass/fail flag', 'flag'],
  ['hb name', 'hardBinName'],
  ['hard bin name', 'hardBinName'],
  ['hardbin name', 'hardBinName'],
  ['sb name', 'softBinName'],
  ['soft bin name', 'softBinName'],
  ['softbin name', 'softBinName'],
]);

const passHardBins = new Set([0, 1]);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ');
}

function mapHeader(record: string[]): ColumnIndexes {
  const indexes: ColumnIndexes = {};
  record.forEach((value, index) => {
    const field = headerAliases.get(normalizeHeader(value));
    if (field !== undefined && indexes[field] === undefined) indexes[field] = index;
  });
  return indexes;
}

function headerMatchCount(indexes: ColumnIndexes): number {
  return requiredFields.filter(({ field }) => indexes[field] !== undefined).length;
}

function missingHeaderColumn(indexes: ColumnIndexes): string {
  return requiredFields.find(({ field }) => indexes[field] === undefined)?.column ?? 'Lot';
}

function positionalIndexes(): ColumnIndexes {
  return { lot: 0, wafer: 1, x: 2, y: 3, hardBin: 4, softBin: 5, flag: 6 };
}

function notchAngle(record: string[]): 0 | 90 | 180 | 270 | 'invalid' | null {
  const populated = record.map((value) => value.trim()).filter(Boolean);
  if (populated.length !== 1) return null;
  const match = /^notch\s*:\s*(-?\d+)$/iu.exec(populated[0] ?? '');
  if (!match) return null;
  const angle = Number(match[1]);
  return angle === 0 || angle === 90 || angle === 180 || angle === 270 ? angle : 'invalid';
}

function rowError({ row, column, code, message }: RowErrorInput): UploadValidationError {
  return {
    rowNumber: row.info.lines,
    column,
    code,
    message,
    rawText: row.raw.replace(/[\r\n]+$/u, ''),
  };
}

function integerError(row: CsvRecord, column: string, value: string): UploadValidationError | null {
  if (!/^-?\d+$/u.test(value)) {
    return rowError({
      row,
      column,
      code: 'NOT_AN_INTEGER',
      message: `${column} must be a whole number.`,
    });
  }
  return null;
}

function rangeError(
  row: CsvRecord,
  column: string,
  value: number,
  minimum: number,
  maximum?: number,
): UploadValidationError | null {
  if (!Number.isSafeInteger(value)) {
    return rowError({
      row,
      column,
      code: 'OUT_OF_RANGE',
      message: `${column} must be a safe whole number.`,
    });
  }
  if (value < minimum || (maximum !== undefined && value > maximum)) {
    const range =
      maximum === undefined ? `${minimum} or greater` : `between ${minimum} and ${maximum}`;
    return rowError({ row, column, code: 'OUT_OF_RANGE', message: `${column} must be ${range}.` });
  }
  return null;
}

function parseRecords(input: string | Buffer): CsvRecord[] {
  return parse(input, {
    bom: true,
    info: true,
    raw: true,
    record_delimiter: ['\r\n', '\n', '\r'],
    relax_column_count: true,
    skip_empty_lines: true,
  }) as unknown as CsvRecord[];
}

export function parseWaferCsv(input: string | Buffer): UploadParseResult {
  let records: CsvRecord[];

  try {
    records = parseRecords(input);
  } catch {
    return { kind: 'rejected', rowsRead: 0, message: 'CSV could not be parsed.', errors: [] };
  }

  if (records.length === 0) {
    return {
      kind: 'rejected',
      rowsRead: 0,
      message: 'File is empty or contains no data rows.',
      errors: [],
    };
  }

  const mappedRecords = records.map((row) => mapHeader(row.record));
  const headerIndex = mappedRecords.findIndex((indexes) => headerMatchCount(indexes) >= 2);
  let indexes = positionalIndexes();
  let dataRecords = records;
  let parsedNotch: 0 | 90 | 180 | 270 | null = null;

  if (headerIndex >= 0) {
    const headerIndexes = mappedRecords[headerIndex] ?? {};
    const missingColumn = missingHeaderColumn(headerIndexes);
    if (headerMatchCount(headerIndexes) !== requiredFields.length) {
      return {
        kind: 'rejected',
        rowsRead: Math.max(0, records.length - headerIndex - 1),
        message: `File is missing required column ${missingColumn}.`,
        errors: [],
      };
    }
    for (const metadata of records.slice(0, headerIndex)) {
      const angle = notchAngle(metadata.record);
      if (angle === 'invalid') {
        return {
          kind: 'rejected',
          rowsRead: Math.max(0, records.length - headerIndex - 1),
          message: 'Notch angle must be 0, 90, 180, or 270 degrees.',
          errors: [],
        };
      }
      if (angle === null) {
        // Coordinate-frame metadata is not supported in the practice scope;
        // an unrecognized metadata line rejects the file.
        return {
          kind: 'rejected',
          rowsRead: Math.max(0, records.length - headerIndex - 1),
          message: `Unsupported metadata on CSV line ${metadata.info.lines}.`,
          errors: [],
        };
      }
      if (parsedNotch !== null) {
        return {
          kind: 'rejected',
          rowsRead: Math.max(0, records.length - headerIndex - 1),
          message: 'File contains more than one notch declaration.',
          errors: [],
        };
      }
      parsedNotch = angle;
    }
    indexes = headerIndexes;
    dataRecords = records.slice(headerIndex + 1);
  } else if (notchAngle(records[0]?.record ?? []) !== null) {
    return {
      kind: 'rejected',
      rowsRead: Math.max(0, records.length - 1),
      message: 'A CSV with notch metadata must include a recognized header row.',
      errors: [],
    };
  }

  if (dataRecords.length === 0) {
    return {
      kind: 'rejected',
      rowsRead: 0,
      message: 'File is empty or contains no data rows.',
      errors: [],
    };
  }

  if (dataRecords.length > maximumWaferRows) {
    return {
      kind: 'rejected',
      rowsRead: dataRecords.length,
      message: `File contains more than the ${maximumWaferRows.toLocaleString('en-US')} row limit.`,
      errors: [],
    };
  }

  const acceptedDies: ParsedDie[] = [];
  const errors: UploadValidationError[] = [];
  const coordinates = new Set<string>();
  let targetLot: string | undefined;
  let targetWafer: number | undefined;

  for (const row of dataRecords) {
    const value = (field: CsvField): string => {
      const index = indexes[field];
      return index === undefined ? '' : (row.record[index]?.trim() ?? '');
    };
    const values = requiredFields.map(({ field }) => value(field));
    const missingIndex = values.findIndex((value) => value.length === 0);
    if (missingIndex >= 0) {
      const column = waferCsvColumns[missingIndex] ?? waferCsvColumns[0];
      errors.push(
        rowError({ row, column, code: 'MISSING_VALUE', message: `${column} is required.` }),
      );
      continue;
    }

    const [
      lot = '',
      waferText = '',
      xText = '',
      yText = '',
      hardBinText = '',
      softBinText = '',
      flagText = '',
    ] = values;
    const hardBinName = value('hardBinName') || null;
    const softBinName = value('softBinName') || null;

    if (lot.length > 32) {
      errors.push(
        rowError({
          row,
          column: 'Lot',
          code: 'OUT_OF_RANGE',
          message: 'Lot must contain between 1 and 32 characters.',
        }),
      );
      continue;
    }
    const longBinName = (
      [
        ['HB name', hardBinName],
        ['SB name', softBinName],
      ] satisfies Array<[string, string | null]>
    ).find(([, name]) => name !== null && name.length > 32);
    if (longBinName) {
      errors.push(
        rowError({
          row,
          column: longBinName[0] ?? 'HB name',
          code: 'OUT_OF_RANGE',
          message: `${longBinName[0]} must contain no more than 32 characters.`,
        }),
      );
      continue;
    }

    const integerChecks = [
      integerError(row, 'Wafer', waferText),
      integerError(row, 'X', xText),
      integerError(row, 'Y', yText),
      integerError(row, 'HB#', hardBinText),
      integerError(row, 'SB#', softBinText),
    ];
    const integerErrorFound = integerChecks.find((error) => error !== null);
    if (integerErrorFound !== undefined) {
      errors.push(integerErrorFound);
      continue;
    }

    const wafer = Number(waferText);
    const x = Number(xText);
    const y = Number(yText);
    const hardBin = Number(hardBinText);
    const softBin = Number(softBinText);

    const rangeChecks = [
      rangeError(row, 'Wafer', wafer, 1, 25),
      rangeError(row, 'X', x, 0, 99),
      rangeError(row, 'Y', y, 0, 99),
      rangeError(row, 'HB#', hardBin, 0),
      rangeError(row, 'SB#', softBin, 0),
    ];
    const invalidRange = rangeChecks.find((error) => error !== null);
    if (invalidRange !== undefined) {
      errors.push(invalidRange);
      continue;
    }

    const flag = flagText.toUpperCase();
    if (flag !== 'P' && flag !== 'F') {
      errors.push(
        rowError({ row, column: 'PF_Flag', code: 'BAD_FLAG', message: 'PF_Flag must be P or F.' }),
      );
      continue;
    }

    const expectedFlag = passHardBins.has(hardBin) ? 'P' : 'F';
    if (flag !== expectedFlag) {
      errors.push(
        rowError({
          row,
          column: 'PF_Flag',
          code: 'FLAG_BIN_MISMATCH',
          message: `PF_Flag must be ${expectedFlag} when HB# is ${hardBin}.`,
        }),
      );
      continue;
    }

    if (targetLot !== undefined && (lot !== targetLot || wafer !== targetWafer)) {
      const column = lot !== targetLot ? 'Lot' : 'Wafer';
      errors.push(
        rowError({
          row,
          column,
          code: 'OUT_OF_RANGE',
          message: 'All rows in an upload must identify the same lot and wafer.',
        }),
      );
      continue;
    }

    const coordinate = `${x}:${y}`;
    if (coordinates.has(coordinate)) {
      errors.push(
        rowError({
          row,
          column: 'X,Y',
          code: 'DUPLICATE_DIE',
          message: `Die coordinate (${x}, ${y}) appears more than once.`,
        }),
      );
      continue;
    }

    targetLot ??= lot;
    targetWafer ??= wafer;
    coordinates.add(coordinate);
    acceptedDies.push({
      rowNumber: row.info.lines,
      rawText: row.raw.replace(/[\r\n]+$/u, ''),
      lot,
      wafer,
      x,
      y,
      hardBin,
      hardBinName,
      softBin,
      softBinName,
      passFailFlag: flag,
    });
  }

  if (acceptedDies.length === 0 || targetLot === undefined || targetWafer === undefined) {
    return {
      kind: 'rejected',
      rowsRead: dataRecords.length,
      message: 'Every data row failed validation.',
      errors,
    };
  }

  return {
    kind: 'ready',
    status: errors.length === 0 ? 'Succeeded' : 'Completed with errors',
    rowsRead: dataRecords.length,
    lot: targetLot,
    wafer: targetWafer,
    notchAngle: parsedNotch,
    acceptedDies,
    errors,
  };
}
