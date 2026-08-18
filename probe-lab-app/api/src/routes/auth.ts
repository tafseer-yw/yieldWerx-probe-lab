import type { FastifyInstance } from 'fastify';

import type { LoginResponse } from '../../../shared/contracts.js';
import { verifyPassword } from '../password.js';
import { apiError } from '../security.js';
import type { ApplicationStore } from '../store.js';
import { errorResponseSchema } from './schemas.js';

interface LoginBody {
  username: string;
  password: string;
}

export interface AuthRouteOptions {
  store: ApplicationStore;
  tokenTtlSeconds: number;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  app.post<{ Body: LoginBody; Reply: LoginResponse }>(
    '/api/auth/login',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Exchange local credentials for a bearer token',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 128 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['accessToken', 'tokenType', 'user'],
            properties: {
              accessToken: { type: 'string' },
              tokenType: { type: 'string', enum: ['Bearer'] },
              user: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'username', 'role'],
                properties: {
                  id: { type: 'string' },
                  username: { type: 'string' },
                  role: { type: 'string', enum: ['viewer', 'engineer', 'admin'] },
                },
              },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await options.store.findUserByUsername(request.body.username);
      if (!user || !(await verifyPassword(request.body.password, user.passwordHash))) {
        throw apiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
      }

      return {
        accessToken: app.jwt.sign(
          { sub: user.id, username: user.username, role: user.role },
          { expiresIn: options.tokenTtlSeconds },
        ),
        tokenType: 'Bearer',
        user: { id: user.id, username: user.username, role: user.role },
      };
    },
  );
}
