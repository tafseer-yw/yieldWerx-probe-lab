import { createHash } from 'node:crypto';
import path from 'node:path';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  uploadStatuses,
  type UploadErrorPage,
  type UploadHistoryPage,
  type UploadStatus,
  type UploadSubmissionResponse,
  type UploadSummary,
} from '../../../shared/contracts.js';
import { apiError, isApiError, requireRole, type JwtPayload } from '../security.js';
import type { ApplicationStore, UploadHistoryFilter } from '../store.js';
import { parseWaferAtdf } from '../wafer-atdf.js';
import { parseWaferCsv } from '../wafer-csv.js';
import { errorResponseSchema } from './schemas.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_UPLOAD_BYTES = 100 * 1024 * 1024;

interface UploadQuery {
  device: string;
  program: string;
}
interface HistoryQuery {
  status?: UploadStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}
interface PageQuery {
  page?: number;
  pageSize?: number;
}

const uploadSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'fileName',
    'device',
    'testProgram',
    'lot',
    'wafer',
    'waferSequence',
    'status',
    'rowsRead',
    'rowsAccepted',
    'rowsRejected',
    'submittedBy',
    'submittedAt',
    'terminalMessage',
  ],
  properties: {
    id: { type: 'string' },
    fileName: { type: 'string' },
    device: { type: 'string' },
    testProgram: { type: 'string' },
    lot: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    wafer: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    waferSequence: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    status: { type: 'string', enum: uploadStatuses },
    rowsRead: { type: 'integer', minimum: 0 },
    rowsAccepted: { type: 'integer', minimum: 0 },
    rowsRejected: { type: 'integer', minimum: 0 },
    submittedBy: { type: 'string' },
    submittedAt: { type: 'string', format: 'date-time' },
    terminalMessage: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

/** ATDF has no registered media type, so the format is carried separately. */
type UploadFormat = 'csv' | 'atdf';

const uploadFormats = new Map<string, { format: UploadFormat; contentType: string }>([
  ['.csv', { format: 'csv', contentType: 'text/csv' }],
  ['.atdf', { format: 'atdf', contentType: 'text/plain' }],
]);

interface UploadBody {
  sourceType: 'file' | 'paste';
  fileName: string;
  contentType: string;
  format: UploadFormat;
  data: Buffer;
}

async function readUploadBody(
  request: FastifyRequest<{ Querystring: UploadQuery }>,
): Promise<UploadBody> {
  if (request.isMultipart()) {
    try {
      const file = await request.file({ limits: { files: 1, fileSize: MAX_FILE_UPLOAD_BYTES } });
      if (!file) throw apiError(400, 'FILE_REQUIRED', 'Choose a CSV or ATDF file to upload.');
      const extension = path.extname(file.filename).toLowerCase();
      const chosen = uploadFormats.get(extension);
      if (!chosen) {
        file.file.resume();
        throw apiError(400, 'BAD_FILE_TYPE', 'Only .csv and .atdf files are accepted.');
      }
      const data = await file.toBuffer();
      if (data.byteLength > MAX_FILE_UPLOAD_BYTES || file.file.truncated) {
        throw apiError(413, 'FILE_TOO_LARGE', 'File is larger than the 100 MB file limit.');
      }
      return {
        sourceType: 'file',
        fileName: file.filename,
        contentType: chosen.contentType,
        format: chosen.format,
        data,
      };
    } catch (error: unknown) {
      if (isApiError(error)) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw apiError(413, 'FILE_TOO_LARGE', 'File is larger than the 100 MB file limit.');
      }
      // Busboy rejects a truncated or malformed body with a plain Error, which would
      // otherwise surface as a 500. The body belongs to the caller, so this is a
      // client error — an upload cut short by a dropped connection is the usual way
      // to reach it. The cause is logged because the reply cannot carry it.
      request.log.warn({ err: error }, 'multipart body could not be read');
      throw apiError(
        400,
        'MALFORMED_UPLOAD',
        'The upload could not be read. It may have been interrupted — send the file again.',
      );
    }
  }

  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'text/csv') {
    throw apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data or text/csv.');
  }
  const data = request.body;
  if (!Buffer.isBuffer(data)) {
    throw apiError(400, 'CSV_REQUIRED', 'Paste wafer CSV rows to upload.');
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    throw apiError(413, 'FILE_TOO_LARGE', 'File is larger than the 5 MB limit.');
  }
  // Pasting stays CSV-only: ATDF arrives as a tester file, not as typed rows.
  return {
    sourceType: 'paste',
    fileName: 'pasted-wafer.csv',
    contentType: 'text/csv',
    format: 'csv',
    data,
  };
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.post<{ Querystring: UploadQuery; Body: Buffer; Reply: UploadSubmissionResponse }>(
    '/api/uploads',
    {
      // dev and qa share rank 2, so this admits both; only viewer is refused.
      onRequest: requireRole('dev'),
      bodyLimit: MAX_FILE_UPLOAD_BYTES,
      schema: {
        tags: ['Wafer Upload'],
        summary: 'Submit wafer CSV or ATDF data for parsing',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['device', 'program'],
          properties: {
            device: { type: 'string', minLength: 1, maxLength: 32 },
            program: { type: 'string', minLength: 1, maxLength: 32 },
          },
        },
        response: {
          202: {
            type: 'object',
            additionalProperties: false,
            required: ['uploadId', 'status'],
            properties: {
              uploadId: { type: 'string' },
              status: { type: 'string', enum: ['Queued'] },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
          413: errorResponseSchema,
          415: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = await readUploadBody(request);
      const payload = request.user as JwtPayload;
      const uploadId = await store.saveUpload({
        sourceType: body.sourceType,
        fileName: body.fileName,
        contentType: body.contentType,
        sourceData: body.data,
        sourceSha256: createHash('sha256').update(body.data).digest('hex'),
        deviceCode: request.query.device,
        testProgramCode: request.query.program,
        submittedByUserId: payload.sub,
        parsed: body.format === 'atdf' ? parseWaferAtdf(body.data) : parseWaferCsv(body.data),
      });
      return reply.code(202).send({ uploadId, status: 'Queued' });
    },
  );

  app.get<{ Querystring: HistoryQuery; Reply: UploadHistoryPage }>(
    '/api/uploads',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Wafer Upload'],
        summary: 'List upload history',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: uploadStatuses },
            search: { type: 'string', maxLength: 255 },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['items', 'page', 'pageSize', 'total'],
            properties: {
              items: { type: 'array', items: uploadSummarySchema },
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
      const filter: UploadHistoryFilter = {
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 25,
      };
      if (request.query.status) filter.status = request.query.status;
      if (request.query.search) filter.search = request.query.search;
      return store.listUploads(filter);
    },
  );

  app.get<{ Params: { id: string }; Reply: UploadSummary }>(
    '/api/uploads/:id',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Wafer Upload'],
        summary: 'Get upload status and counts',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: {
          200: uploadSummarySchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const upload = await store.getUpload(request.params.id);
      if (!upload) throw apiError(404, 'UPLOAD_NOT_FOUND', 'Upload was not found.');
      return upload;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/uploads/:id',
    {
      onRequest: requireRole('admin'),
      schema: {
        tags: ['Wafer Upload'],
        summary: 'Delete an upload and everything it created',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: {
          204: { type: 'null' },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const deleted = await store.deleteUpload(request.params.id);
      if (!deleted) throw apiError(404, 'UPLOAD_NOT_FOUND', 'Upload was not found.');
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string }; Querystring: PageQuery; Reply: UploadErrorPage }>(
    '/api/uploads/:id/errors',
    {
      onRequest: requireRole('viewer'),
      schema: {
        tags: ['Wafer Upload'],
        summary: 'Get the paged validation report for an upload',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'page', 'pageSize', 'total'],
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'rowNumber', 'column', 'code', 'message', 'rawText'],
                  properties: {
                    id: { type: 'integer' },
                    rowNumber: { type: 'integer', minimum: 1 },
                    column: { type: 'string' },
                    code: { type: 'string' },
                    message: { type: 'string' },
                    rawText: { type: 'string' },
                  },
                },
              },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
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
      const result = await store.listUploadErrors(
        request.params.id,
        request.query.page ?? 1,
        request.query.pageSize ?? 50,
      );
      if (!result) throw apiError(404, 'UPLOAD_NOT_FOUND', 'Upload was not found.');
      return result;
    },
  );
}
