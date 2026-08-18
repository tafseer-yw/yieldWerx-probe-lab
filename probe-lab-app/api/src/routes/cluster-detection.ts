import type { FastifyInstance } from 'fastify';

import {
  signatureAdjacencies,
  type ClusterDetectionResult,
  type ClusterDetectionSummary,
  type ClusterDetectionWaferSummary,
} from '../../../shared/contracts.js';
import { detectClusters } from '../cluster-detection.js';
import { apiError, requireRole } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { errorResponseSchema } from './schemas.js';

interface ClusterQuery {
  adjacency?: string;
  minimumConnectedDies?: number;
}

interface ClusterSummaryQuery extends ClusterQuery {
  waferCount?: number;
}

const coordinateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: { type: 'integer' }, y: { type: 'integer' } },
} as const;

const clusterDetectionResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['waferSequence', 'adjacency', 'minimumConnectedDies', 'clustersFound', 'clusters'],
  properties: {
    waferSequence: { type: 'integer', minimum: 1 },
    adjacency: { type: 'string', enum: signatureAdjacencies },
    minimumConnectedDies: { type: 'integer', minimum: 1 },
    clustersFound: { type: 'integer', minimum: 0 },
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ordinal', 'dieCount', 'coordinates'],
        properties: {
          ordinal: { type: 'integer', minimum: 1 },
          dieCount: { type: 'integer', minimum: 1 },
          coordinates: { type: 'array', items: coordinateSchema },
        },
      },
    },
  },
} as const;

const clusterWaferSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['waferSequence', 'lot', 'waferNumber', 'yield', 'clustersFound', 'largestClusterDies'],
  properties: {
    waferSequence: { type: 'integer', minimum: 1 },
    lot: { type: 'string' },
    waferNumber: { type: 'integer', minimum: 1, maximum: 25 },
    yield: { type: 'number', minimum: 0, maximum: 100 },
    clustersFound: { type: 'integer', minimum: 0 },
    largestClusterDies: { type: 'integer', minimum: 0 },
  },
} as const;

const clusterDetectionSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'adjacency',
    'minimumConnectedDies',
    'wafersAnalyzed',
    'wafersWithClusters',
    'totalClusters',
    'largestClusterDies',
    'wafers',
  ],
  properties: {
    adjacency: { type: 'string', enum: signatureAdjacencies },
    minimumConnectedDies: { type: 'integer', minimum: 1 },
    wafersAnalyzed: { type: 'integer', minimum: 0 },
    wafersWithClusters: { type: 'integer', minimum: 0 },
    totalClusters: { type: 'integer', minimum: 0 },
    largestClusterDies: { type: 'integer', minimum: 0 },
    wafers: { type: 'array', items: clusterWaferSummarySchema },
  },
} as const;

function parseAdjacency(raw: string | undefined): '4-way' | '8-way' {
  const adjacency = (raw ?? '4-way') as '4-way' | '8-way';
  if (adjacency !== '4-way' && adjacency !== '8-way') {
    throw apiError(400, 'INVALID_ADJACENCY', 'adjacency must be 4-way or 8-way.');
  }
  return adjacency;
}

export async function registerClusterDetectionRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  /*
   * Detection runs are not persisted — the detector is a pure function over a
   * wafer's dies. This aggregate re-runs it over the most recently finished
   * wafers so the dashboard can show cluster analytics without a runs table.
   */
  app.get<{ Querystring: ClusterSummaryQuery; Reply: ClusterDetectionSummary }>(
    '/api/cd/summary',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Cluster Detection'],
        summary: 'Aggregate cluster detection over the latest wafers',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            adjacency: { type: 'string', enum: signatureAdjacencies, default: '4-way' },
            minimumConnectedDies: { type: 'integer', minimum: 1, maximum: 100, default: 2 },
            waferCount: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
          },
        },
        response: {
          200: clusterDetectionSummarySchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const adjacency = parseAdjacency(request.query.adjacency);
      const minimumConnectedDies = request.query.minimumConnectedDies ?? 2;
      const waferCount = request.query.waferCount ?? 10;

      const page = await store.listWafers({ page: 1, pageSize: waferCount });
      const details = await Promise.all(
        page.items.map((item) => store.getWafer(item.waferSequence)),
      );

      const wafers: ClusterDetectionWaferSummary[] = [];
      for (const detail of details) {
        if (!detail) continue;
        const result = detectClusters(detail.waferSequence, detail.dies, {
          adjacency,
          minimumConnectedDies,
        });
        wafers.push({
          waferSequence: detail.waferSequence,
          lot: detail.lot,
          waferNumber: detail.waferNumber,
          yield: detail.yield,
          clustersFound: result.clustersFound,
          largestClusterDies: result.clusters[0]?.dieCount ?? 0,
        });
      }

      return {
        adjacency,
        minimumConnectedDies,
        wafersAnalyzed: wafers.length,
        wafersWithClusters: wafers.filter((wafer) => wafer.clustersFound > 0).length,
        totalClusters: wafers.reduce((sum, wafer) => sum + wafer.clustersFound, 0),
        largestClusterDies: wafers.reduce(
          (max, wafer) => Math.max(max, wafer.largestClusterDies),
          0,
        ),
        wafers,
      };
    },
  );

  app.get<{
    Params: { waferSequence: number };
    Querystring: ClusterQuery;
    Reply: ClusterDetectionResult;
  }>(
    '/api/cd/wafers/:waferSequence/clusters',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Cluster Detection'],
        summary: 'Detect contiguous fail-die clusters on a wafer',
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
            adjacency: { type: 'string', enum: signatureAdjacencies, default: '4-way' },
            minimumConnectedDies: { type: 'integer', minimum: 1, maximum: 100, default: 2 },
          },
        },
        response: {
          200: clusterDetectionResultSchema,
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
      const adjacency = parseAdjacency(request.query.adjacency);
      const minimumConnectedDies = request.query.minimumConnectedDies ?? 2;
      return detectClusters(request.params.waferSequence, wafer.dies, {
        adjacency,
        minimumConnectedDies,
      });
    },
  );
}
