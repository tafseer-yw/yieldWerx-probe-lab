/*
 * Shared contract for every wafer upload reader.
 *
 * The CSV reader (wafer-csv.ts) and the ATDF reader (wafer-atdf.ts) both produce
 * an UploadParseResult, so the store, the routes, and every downstream workflow
 * stay format-agnostic — only the reader knows which format it read.
 *
 * The ranges below are the STDF ranges rather than the narrower ones the CSV
 * practice format started with. Real wafer data carries wafer numbers past 25
 * and die coordinates measured from the wafer centre, so both formats accept the
 * same span and a die keeps the coordinates its source file recorded.
 */

import type { PositiveXDirection, PositiveYDirection } from '../../shared/contracts.js';

export const maximumWaferRows = 50_000;

/** STDF WAFER_ID runs well past the 25 the CSV format originally allowed. */
export const waferNumberRange = { minimum: 1, maximum: 9_999 } as const;

/** STDF X_COORD/Y_COORD are signed 2-byte integers, so negatives are normal. */
export const dieCoordinateRange = { minimum: -32_768, maximum: 32_767 } as const;

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
      /*
       * The coordinate frame the file declared, or null where it declared none.
       * The wafer map needs it to place a die on the correct side of the wafer,
       * so it is carried rather than dropped — see DieCoordinateFrame.
       */
      positiveX: PositiveXDirection | null;
      positiveY: PositiveYDirection | null;
      acceptedDies: ParsedDie[];
      errors: UploadValidationError[];
    }
  | {
      kind: 'rejected';
      rowsRead: number;
      message: string;
      errors: UploadValidationError[];
    };
