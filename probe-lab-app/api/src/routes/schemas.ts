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
