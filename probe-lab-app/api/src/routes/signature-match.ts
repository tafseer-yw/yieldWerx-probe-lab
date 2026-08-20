import type { FastifyInstance } from 'fastify';

import { signatureMatchStatuses, type SignatureMatchResponse } from '../../../shared/contracts.js';
import { matchWaferSignature } from '../signature-match.js';
import { apiError, requireRole } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { errorResponseSchema } from './schemas.js';

const matchCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['referenceKey', 'label', 'summary', 'matchScore'],
  properties: {
    referenceKey: { type: 'string' },
    label: { type: 'string' },
    summary: { type: 'string' },
    matchScore: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

const signatureMatchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'waferSequence',
    'status',
    'threshold',
    'totalDies',
    'failureDies',
    'bestMatch',
    'alternatives',
    'evidence',
    'analytics',
    'matcher',
    'disclaimer',
  ],
  properties: {
    waferSequence: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: signatureMatchStatuses },
    threshold: { type: 'number', minimum: 0, maximum: 1 },
    totalDies: { type: 'integer', minimum: 0 },
    failureDies: { type: 'integer', minimum: 0 },
    bestMatch: { anyOf: [matchCandidateSchema, { type: 'null' }] },
    alternatives: { type: 'array', items: matchCandidateSchema },
    evidence: { type: 'array', items: { type: 'string' } },
    analytics: {
      type: 'object',
      additionalProperties: false,
      required: [
        'failureRate',
        'radialFailureRates',
        'spatialLinearity',
        'clusteredFailureShare',
        'largestClusterShare',
        'dominantFailBinShare',
      ],
      properties: {
        failureRate: { type: 'number', minimum: 0, maximum: 1 },
        radialFailureRates: {
          type: 'object',
          additionalProperties: false,
          required: ['center', 'middle', 'edge'],
          properties: {
            center: { type: 'number', minimum: 0, maximum: 1 },
            middle: { type: 'number', minimum: 0, maximum: 1 },
            edge: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        spatialLinearity: { type: 'number', minimum: 0, maximum: 1 },
        clusteredFailureShare: { type: 'number', minimum: 0, maximum: 1 },
        largestClusterShare: { type: 'number', minimum: 0, maximum: 1 },
        dominantFailBinShare: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    matcher: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'version', 'referenceCount'],
      properties: {
        algorithm: { type: 'string', enum: ['weighted-pattern-distance'] },
        version: { type: 'string', enum: ['1.0'] },
        referenceCount: { type: 'integer', minimum: 1 },
      },
    },
    disclaimer: { type: 'string' },
  },
} as const;

export async function registerSignatureMatchRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.get<{ Params: { waferSequence: number }; Reply: SignatureMatchResponse }>(
    '/api/wafers/:waferSequence/signature-match',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Wafer triage'],
        summary: 'Generate the lightweight signature analytics used by Wafer triage',
        description:
          'Compares normalized spatial, bin, and cluster features with three deterministic practice references. The match score is not a confidence or root-cause diagnosis.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['waferSequence'],
          properties: { waferSequence: { type: 'integer', minimum: 1 } },
        },
        response: {
          200: signatureMatchResponseSchema,
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
      return matchWaferSignature(wafer.waferSequence, wafer.dies, {
        positiveX: wafer.positiveX,
        positiveY: wafer.positiveY,
      });
    },
  );
}
