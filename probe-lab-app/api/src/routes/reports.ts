import type { FastifyInstance } from 'fastify';

import {
  reportBinSpecifications,
  reportBinTypes,
  reportSortValues,
  type BinParetoOptions,
  type BinParetoResponse,
} from '../../../shared/contracts.js';
import { deriveBinPareto } from '../bin-pareto.js';
import { binParetoCsvFilename, binParetoToCsv } from '../bin-pareto-csv.js';
import { apiError, requireRole } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { binParetoQuerystringSchema, errorResponseSchema } from './schemas.js';

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
  /**
   * One place where the report's defaults live. Both operations call it, so the
   * exported file cannot silently answer a different question from the screen
   * it claims to reproduce.
   */
  function resolveBinParetoOptions(query: BinParetoQuery): BinParetoOptions {
    return {
      binType: (query.binType ?? 'Hard Bin') as BinParetoOptions['binType'],
      specifyBins: (query.specifyBins ?? 'Failed Bins Only') as BinParetoOptions['specifyBins'],
      sortBy: (query.sortBy ?? 'Bin Occurrence') as BinParetoOptions['sortBy'],
      customBins: parseCustomBins(query.customBins),
    };
  }

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
        querystring: binParetoQuerystringSchema,
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
      const options = resolveBinParetoOptions(request.query);
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

  app.get<{
    Params: { waferSequence: number };
    Querystring: BinParetoQuery;
  }>(
    '/api/reports/wafers/:waferSequence/bin-pareto.csv',
    {
      /* The same guard as the report, by design: both return the same numbers,
         so a separate rule here would be a security defect waiting to happen. */
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Reports'],
        summary: 'Download the bin pareto for a wafer as CSV',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['waferSequence'],
          properties: { waferSequence: { type: 'integer', minimum: 1 } },
        },
        querystring: binParetoQuerystringSchema,
        response: {
          200: { type: 'string', description: 'The report as comma-separated text.' },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const wafer = await store.getWafer(request.params.waferSequence);
      if (!wafer) throw apiError(404, 'WAFER_NOT_FOUND', 'Wafer was not found.');
      const options = resolveBinParetoOptions(request.query);

      let report;
      try {
        report = deriveBinPareto(wafer, wafer.dies, options);
      } catch (error) {
        throw apiError(
          400,
          'INVALID_REPORT_OPTIONS',
          error instanceof Error ? error.message : 'Invalid report options.',
        );
      }

      /* Build the whole document before replying. A failure must produce the
         route's normal error response, never a 200 carrying a partial file —
         a truncated export that looks successful is the worst outcome here. */
      const csv = binParetoToCsv(report, options);
      const filename = binParetoCsvFilename(report, options, new Date());
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(csv);
    },
  );
}
