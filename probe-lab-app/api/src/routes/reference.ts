import type { FastifyInstance } from 'fastify';

import type { ReferenceValue } from '../../../shared/contracts.js';
import { requireRole } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { errorResponseSchema } from './schemas.js';

const referenceListSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'code', 'name'],
    properties: {
      id: { type: 'string' },
      code: { type: 'string' },
      name: { type: 'string' },
    },
  },
} as const;

export async function registerReferenceRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.get<{ Reply: ReferenceValue[] }>(
    '/api/reference/devices',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Reference Data'],
        summary: 'List devices available for wafer upload',
        security: [{ bearerAuth: [] }],
        response: {
          200: referenceListSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async () => store.listDevices(),
  );

  app.get<{ Querystring: { device: string }; Reply: ReferenceValue[] }>(
    '/api/reference/test-programs',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Reference Data'],
        summary: 'List test programs for a device',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['device'],
          properties: { device: { type: 'string', minLength: 1, maxLength: 32 } },
        },
        response: {
          200: referenceListSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => store.listTestPrograms(request.query.device),
  );
}
