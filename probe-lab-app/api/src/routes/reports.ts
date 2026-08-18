import type { FastifyInstance } from 'fastify';

import {
  reportBinSpecifications,
  reportBinTypes,
  reportSortValues,
  type BinParetoResponse,
} from '../../../shared/contracts.js';
import { deriveBinPareto } from '../bin-pareto.js';
import { apiError, requireRole } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { errorResponseSchema } from './schemas.js';

interface BinParetoQuery {
  binType?: string;
  specifyBins?: string;
  sortBy?: string;
  customBins?: string;
}

const percentage = { type: 'number', minimum: 0, maximum: 100 } as const;

const binParetoResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['header', 'bins', 'options'],
  properties: {
    header: {
      type: 'object',
      additionalProperties: false,
      required: [
        'waferSequence',
        'lot',
        'waferNumber',
        'device',
        'testProgram',
        'totalDies',
        'passCount',
        'yield',
      ],
      properties: {
        waferSequence: { type: 'integer', minimum: 1 },
        lot: { type: 'string' },
        waferNumber: { type: 'integer', minimum: 1, maximum: 25 },
        device: { type: 'string' },
        testProgram: { type: 'string' },
        totalDies: { type: 'integer', minimum: 0 },
        passCount: { type: 'integer', minimum: 0 },
        yield: percentage,
      },
    },
    bins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['binNumber', 'binName', 'dieCount', 'binPercentage', 'cumulativePercentage'],
        properties: {
          binNumber: { type: 'integer', minimum: 0 },
          binName: { type: 'string' },
          dieCount: { type: 'integer', minimum: 0 },
          binPercentage: percentage,
          cumulativePercentage: percentage,
        },
      },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      required: ['binType', 'specifyBins', 'customBins', 'sortBy'],
      properties: {
        binType: { type: 'string', enum: reportBinTypes },
        specifyBins: { type: 'string', enum: reportBinSpecifications },
        customBins: { type: 'array', items: { type: 'integer', minimum: 0 } },
        sortBy: { type: 'string', enum: reportSortValues },
      },
    },
  },
} as const;

function parseCustomBins(raw: string | undefined): number[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

export async function registerReportRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.get<{
    Params: { waferSequence: number };
    Querystring: BinParetoQuery;
    Reply: BinParetoResponse;
  }>(
    '/api/reports/wafers/:waferSequence/bin-pareto',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Reports'],
        summary: 'Get the bin pareto for a wafer',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['waferSequence'],
          properties: { waferSequence: { type: 'integer', minimum: 1 } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            binType: { type: 'string', enum: reportBinTypes },
            specifyBins: { type: 'string', enum: reportBinSpecifications },
            sortBy: { type: 'string', enum: reportSortValues },
            customBins: { type: 'string', maxLength: 255 },
          },
        },
        response: {
          200: binParetoResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const wafer = await store.getWafer(request.params.waferSequence);
      if (!wafer) throw apiError(404, 'WAFER_NOT_FOUND', 'Wafer was not found.');
      const options = {
        binType: (request.query.binType ?? 'Hard Bin') as 'Hard Bin' | 'Soft Bin',
        specifyBins: (request.query.specifyBins ?? 'Failed Bins Only') as
          'All Bins' | 'Failed Bins Only' | 'Custom',
        sortBy: (request.query.sortBy ?? 'Bin Occurrence') as 'Bin Occurrence' | 'Bin Number',
        customBins: parseCustomBins(request.query.customBins),
      };
      try {
        return deriveBinPareto(wafer, wafer.dies, options);
      } catch (error) {
        throw apiError(
          400,
          'INVALID_REPORT_OPTIONS',
          error instanceof Error ? error.message : 'Invalid report options.',
        );
      }
    },
  );
}
