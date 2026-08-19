import {
  reportBinSpecifications,
  reportBinTypes,
  reportSortValues,
} from '../../../shared/contracts.js';

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['statusCode', 'code', 'message'],
  properties: {
    statusCode: { type: 'integer', minimum: 400, maximum: 599 },
    code: { type: 'string' },
    message: { type: 'string' },
  },
} as const;

/**
 * The bin pareto report's query parameters.
 *
 * Shared rather than inline because two operations now accept them: the report
 * itself and its CSV export. A second hand-written copy is how the two quietly
 * start accepting different inputs — the export would keep working while
 * answering a slightly different question from the screen it claims to mirror.
 */
export const binParetoQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    binType: { type: 'string', enum: reportBinTypes },
    specifyBins: { type: 'string', enum: reportBinSpecifications },
    sortBy: { type: 'string', enum: reportSortValues },
    customBins: { type: 'string', maxLength: 255 },
  },
} as const;
