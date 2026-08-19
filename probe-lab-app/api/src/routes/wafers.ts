import type { FastifyInstance } from 'fastify';

import type { WaferPage } from '../../../shared/contracts.js';
import { apiError, requireRole } from '../security.js';
import type { ApplicationStore, WaferListFilter } from '../store.js';
import { errorResponseSchema } from './schemas.js';

interface WaferQuery {
  search?: string;
  lot?: string;
  device?: string;
  program?: string;
  page?: number;
  pageSize?: number;
}

const waferSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'waferSequence',
    'lot',
    'waferNumber',
    'device',
    'testProgram',
    'partCount',
    'passCount',
    'yield',
    'finishTime',
  ],
  properties: {
    waferSequence: { type: 'integer', minimum: 1 },
    lot: { type: 'string' },
    waferNumber: { type: 'integer', minimum: 1, maximum: 25 },
    device: { type: 'string' },
    testProgram: { type: 'string' },
    partCount: { type: 'integer', minimum: 0 },
    passCount: { type: 'integer', minimum: 0 },
    yield: { type: 'number', minimum: 0, maximum: 100 },
    finishTime: { type: 'string', format: 'date-time' },
  },
} as const;

const dieSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dieId', 'x', 'y', 'hardBin', 'softBin', 'passFailFlag'],
  properties: {
    dieId: { type: 'integer', minimum: 1 },
    x: { type: 'integer' },
    y: { type: 'integer' },
    hardBin: { type: 'integer', minimum: 0 },
    hardBinName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    softBin: { type: 'integer', minimum: 0 },
    softBinName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    passFailFlag: { type: 'string', enum: ['P', 'F'] },
  },
} as const;

export async function registerWaferRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.get<{ Querystring: WaferQuery; Reply: WaferPage }>(
    '/api/wafers',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Wafers'],
        summary: 'List landed wafers',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: {
              type: 'string',
              maxLength: 64,
              description:
                'Find by sequence (#42), device, lot, wafer number (W07), or test program.',
            },
            lot: { type: 'string', maxLength: 32 },
            device: { type: 'string', maxLength: 32 },
            program: { type: 'string', maxLength: 32 },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'page', 'pageSize', 'total'],
            properties: {
              items: { type: 'array', items: waferSummarySchema },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const filter: WaferListFilter = {
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 25,
      };
      if (request.query.search) filter.search = request.query.search;
      if (request.query.lot) filter.lot = request.query.lot;
      if (request.query.device) filter.device = request.query.device;
      if (request.query.program) filter.program = request.query.program;
      return store.listWafers(filter);
    },
  );

  app.get<{ Params: { waferSequence: number } }>(
    '/api/wafers/:waferSequence',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Wafers'],
        summary: 'Get a wafer with its die-level results',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['waferSequence'],
          properties: { waferSequence: { type: 'integer', minimum: 1 } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'waferSequence',
              'lot',
              'waferNumber',
              'device',
              'testProgram',
              'partCount',
              'passCount',
              'yield',
              'finishTime',
              'uploadId',
              'dies',
            ],
            properties: {
              ...waferSummarySchema.properties,
              uploadId: { type: 'string' },
              dies: { type: 'array', items: dieSchema },
            },
          },
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
      return wafer;
    },
  );
}
