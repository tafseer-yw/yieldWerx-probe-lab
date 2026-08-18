import { randomUUID } from 'node:crypto';

import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

import {
  productBrand,
  productVersions,
  type HealthResponse,
  type ReadinessResponse,
} from '../../shared/contracts.js';
import { registerAuthRoutes } from './routes/auth.js';
import { MAX_FILE_UPLOAD_BYTES, MAX_UPLOAD_BYTES, registerUploadRoutes } from './routes/uploads.js';
import { registerReferenceRoutes } from './routes/reference.js';
import { registerWaferRoutes } from './routes/wafers.js';
import { registerClusterDetectionRoutes } from './routes/cluster-detection.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerSampleDataRoutes } from './routes/sample-data.js';
import { registerSignatureMatchRoutes } from './routes/signature-match.js';
import { SqliteApplicationStore } from './store.js';

export interface BuildApplicationOptions {
  authSecret: string;
  tokenTtlSeconds: number;
  databasePath: string;
  logging?: boolean;
}

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'status', 'timestamp', 'version'],
  properties: {
    service: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'degraded'] },
    timestamp: { type: 'string', format: 'date-time' },
    version: { type: 'string' },
  },
} as const;

const readinessResponseSchema = {
  ...healthResponseSchema,
  required: [...healthResponseSchema.required, 'dependencies'],
  properties: {
    ...healthResponseSchema.properties,
    dependencies: {
      type: 'object',
      additionalProperties: false,
      required: ['database'],
      properties: { database: { type: 'string', enum: ['available', 'unavailable'] } },
    },
  },
} as const;

const documentedResponseDescriptions: Record<string, string> = {
  '200': 'Request completed successfully.',
  '201': 'Resource created successfully.',
  '204': 'Request completed successfully with no response body.',
  '400': 'The request is invalid.',
  '401': 'Authentication is required or the supplied credentials are invalid.',
  '403': 'The authenticated user is not permitted to perform this action.',
  '404': 'The requested resource was not found.',
  '409': 'The request conflicts with the current state of the resource.',
  '413': 'The uploaded file exceeds the allowed size.',
  '415': 'The request content type is not supported.',
  '422': 'The uploaded data could not be processed.',
  '500': 'The server encountered an unexpected error.',
  '503': 'A required dependency is unavailable.',
};

function operationIdFor(method: string, url: string): string {
  const pathWords = url
    .replace(/^\/api\//, '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((part) =>
      part.startsWith(':') ? `by-${part.slice(1)}` : part.replace(/[^a-zA-Z0-9]+/g, '-'),
    )
    .join('-');
  const words = `${method.toLowerCase()}-${pathWords}`.split('-').filter(Boolean);
  return words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('');
}

function polishOpenApiDocument(
  openapiObject: Partial<OpenAPIV3.Document | OpenAPIV3_1.Document>,
): Partial<OpenAPIV3.Document | OpenAPIV3_1.Document> {
  for (const pathItem of Object.values(openapiObject.paths ?? {})) {
    if (!pathItem || '$ref' in pathItem) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      for (const [statusCode, response] of Object.entries(operation.responses ?? {})) {
        if ('$ref' in response) continue;
        if (!response.description || response.description === 'Default Response') {
          response.description = documentedResponseDescriptions[statusCode] ?? 'API response.';
        }
      }
    }
  }

  const uploadOperation = openapiObject.paths?.['/api/uploads']?.post;
  if (uploadOperation) {
    uploadOperation.requestBody = {
      required: true,
      description: 'A wafer CSV file supplied as multipart form data or as a raw CSV body.',
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
          },
        },
        'text/csv': { schema: { type: 'string', format: 'binary' } },
      },
    };
  }

  return openapiObject;
}

export async function buildApplication(options: BuildApplicationOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logging ? { level: process.env.LOG_LEVEL ?? 'info' } : false,
    genReqId: (request) =>
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : randomUUID(),
  });

  const store = new SqliteApplicationStore(options.databasePath);
  const readiness = async (): Promise<boolean> => store.isReady();

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: `${productBrand.name} API`,
        description: productBrand.subtitle,
        version: productVersions.api,
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: ({ schema, url, route }) => {
      const method = (Array.isArray(route.method) ? route.method[0] : route.method) ?? 'get';
      return {
        schema: schema.hide
          ? schema
          : { ...schema, operationId: schema.operationId ?? operationIdFor(method, url) },
        url,
      };
    },
    transformObject: (documentObject) =>
      'openapiObject' in documentObject
        ? polishOpenApiDocument(documentObject.openapiObject)
        : documentObject.swaggerObject,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(jwt, { secret: options.authSecret });
  await app.register(multipart, { limits: { files: 1, fileSize: MAX_FILE_UPLOAD_BYTES } });
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    const candidate = error instanceof Error ? error : new Error(String(error));
    const metadata = candidate as Error & { statusCode?: unknown; code?: unknown };
    const statusCode =
      typeof metadata.statusCode === 'number' && metadata.statusCode >= 400
        ? metadata.statusCode
        : 500;
    const code = typeof metadata.code === 'string' ? metadata.code : 'INTERNAL_ERROR';
    const message = statusCode >= 500 ? 'An unexpected error occurred.' : candidate.message;
    if (statusCode >= 500 && options.logging)
      request.log.error({ err: candidate }, 'request failed');
    return reply.code(statusCode).send({ statusCode, code, message });
  });

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  app.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'API process health',
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      service: productBrand.slug,
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: productVersions.api,
    }),
  );

  app.get<{ Reply: ReadinessResponse }>(
    '/ready',
    {
      schema: {
        tags: ['System'],
        summary: 'API dependency readiness',
        response: { 200: readinessResponseSchema, 503: readinessResponseSchema },
      },
    },
    async (_request, reply) => {
      const databaseReady = await readiness();
      const response: ReadinessResponse = {
        service: productBrand.slug,
        status: databaseReady ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: productVersions.api,
        dependencies: { database: databaseReady ? 'available' : 'unavailable' },
      };
      return databaseReady ? response : reply.code(503).send(response);
    },
  );

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await registerAuthRoutes(app, { store, tokenTtlSeconds: options.tokenTtlSeconds });
  await registerReferenceRoutes(app, store);
  await registerUploadRoutes(app, store);
  await registerWaferRoutes(app, store);
  await registerReportRoutes(app, store);
  await registerClusterDetectionRoutes(app, store);
  await registerSignatureMatchRoutes(app, store);
  await registerSampleDataRoutes(app, store);

  app.addHook('onClose', async () => {
    store.close();
  });

  return app;
}
