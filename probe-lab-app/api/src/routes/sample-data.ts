import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { SampleDataStatus, SampleWaferState } from '../../../shared/contracts.js';
import { sampleCatalogue, sampleWafers } from '../sample-data.js';
import { apiError, requireRole, type JwtPayload } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { parseWaferCsv } from '../wafer-csv.js';
import { errorResponseSchema } from './schemas.js';

/*
 * Sample wafers — an optional demo set an admin loads and removes, one wafer at
 * a time or all together.
 *
 * Loading pushes generated CSVs through the ordinary upload path, so a sample
 * wafer is built by the same parser and validation as any real file. Removal is
 * scoped to rows this loader created; it can never delete a user's own upload.
 */

const SAMPLE_DEVICE = 'PROBE-DEV-1';
const SAMPLE_PROGRAM = 'PROBE-PGM-1';

/** Counts what a file would land, without touching the database. */
function countRows(csv: string): { accepted: number; rejected: number } {
  const parsed = parseWaferCsv(Buffer.from(csv, 'utf8'));
  return parsed.kind === 'ready'
    ? { accepted: parsed.acceptedDies.length, rejected: parsed.errors.length }
    : { accepted: 0, rejected: parsed.errors.length };
}

const waferStateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'key',
    'lot',
    'waferNumber',
    'title',
    'summary',
    'dieCount',
    'rejectedRows',
    'loaded',
    'waferSequence',
  ],
  properties: {
    key: { type: 'string' },
    lot: { type: 'string' },
    waferNumber: { type: 'integer', minimum: 1 },
    title: { type: 'string' },
    summary: { type: 'string' },
    dieCount: { type: 'integer', minimum: 0 },
    rejectedRows: { type: 'integer', minimum: 0 },
    loaded: { type: 'boolean' },
    waferSequence: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  },
} as const;

const statusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wafers', 'loadedCount'],
  properties: {
    wafers: { type: 'array', items: waferStateSchema },
    loadedCount: { type: 'integer', minimum: 0 },
  },
} as const;

const keysSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keys: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 },
  },
} as const;

async function readStatus(store: ApplicationStore): Promise<SampleDataStatus> {
  const loaded = await store.listSampleUploads();
  const wafers: SampleWaferState[] = sampleCatalogue(countRows).map((entry) => {
    const match = loaded.find((row) => row.lot === entry.lot);
    return {
      ...entry,
      loaded: match !== undefined,
      waferSequence: match?.waferSequence ?? null,
    };
  });
  return { wafers, loadedCount: wafers.filter((wafer) => wafer.loaded).length };
}

/** Resolves the requested keys, refusing an unknown one rather than ignoring it. */
function selected(keys: string[] | undefined): string[] {
  const known = sampleWafers().map((wafer) => wafer.key);
  if (!keys || keys.length === 0) return known;
  const unknown = keys.filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw apiError(400, 'UNKNOWN_SAMPLE_WAFER', `No sample wafer is named '${unknown[0]}'.`);
  }
  return keys;
}

export async function registerSampleDataRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.get<{ Reply: SampleDataStatus }>(
    '/api/sample-data',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Sample Data'],
        summary: 'List the sample wafers and which of them are loaded',
        security: [{ bearerAuth: [] }],
        response: { 200: statusSchema, 401: errorResponseSchema, 403: errorResponseSchema },
      },
    },
    async () => readStatus(store),
  );

  app.post<{ Body: { keys?: string[] }; Reply: SampleDataStatus }>(
    '/api/sample-data',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['Sample Data'],
        summary: 'Load the named sample wafers, or all of them',
        security: [{ bearerAuth: [] }],
        body: keysSchema,
        response: {
          201: statusSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const keys = selected(request.body?.keys);
      const status = await readStatus(store);
      const already = status.wafers.filter((wafer) => wafer.loaded && keys.includes(wafer.key));
      if (already.length > 0) {
        throw apiError(
          409,
          'SAMPLE_DATA_EXISTS',
          `${already[0]?.lot} is already loaded. Remove it before loading it again.`,
        );
      }
      const payload = request.user as JwtPayload;
      const uploads = sampleWafers()
        .filter((entry) => keys.includes(entry.key))
        .map((wafer) => {
          const data = Buffer.from(wafer.csv, 'utf8');
          return {
            sourceType: 'file',
            fileName: wafer.fileName,
            contentType: 'text/csv',
            sourceData: data,
            sourceSha256: createHash('sha256').update(data).digest('hex'),
            deviceCode: SAMPLE_DEVICE,
            testProgramCode: SAMPLE_PROGRAM,
            submittedByUserId: payload.sub,
            parsed: parseWaferCsv(data),
            isSample: true,
          } as const;
        });
      await store.saveUploadsAtomically(uploads);
      return reply.code(201).send(await readStatus(store));
    },
  );

  app.delete<{ Querystring: { keys?: string }; Reply: SampleDataStatus }>(
    '/api/sample-data',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['Sample Data'],
        summary: 'Remove the named sample wafers, or all of them',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { keys: { type: 'string', maxLength: 255 } },
        },
        response: {
          200: statusSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const requested = request.query.keys
        ? request.query.keys
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)
        : undefined;
      const keys = selected(requested);
      const lots = sampleWafers()
        .filter((wafer) => keys.includes(wafer.key))
        .map((wafer) => wafer.lot);
      await store.removeSampleUploads(lots);
      return readStatus(store);
    },
  );
}
