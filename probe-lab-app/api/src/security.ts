import type { FastifyRequest } from 'fastify';

import { userRoles, type UserRole } from '../../shared/contracts.js';

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  // dev and qa are peers: both contribute data, neither outranks the other.
  dev: 2,
  qa: 2,
  admin: 3,
};

export interface ApiError extends Error {
  statusCode: number;
  code: string;
}

export function apiError(statusCode: number, code: string, message: string): ApiError {
  return Object.assign(new Error(message), { statusCode, code });
}

/** True for an error this application raised deliberately, with a status to send. */
export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    typeof (error as Partial<ApiError>).statusCode === 'number' &&
    typeof (error as Partial<ApiError>).code === 'string'
  );
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export function requireRole(minimumRole: UserRole) {
  return async function authorize(request: FastifyRequest): Promise<void> {
    let payload: JwtPayload;
    try {
      payload = (await request.jwtVerify()) as JwtPayload;
    } catch {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    const role = payload.role;
    // Derived from userRoles so a new role can never silently bypass this check.
    if (!(userRoles as readonly string[]).includes(role)) {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    if (roleRank[role] < roleRank[minimumRole]) {
      throw apiError(403, 'FORBIDDEN', 'Your role does not permit this operation.');
    }
  };
}
