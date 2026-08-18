import type { FastifyRequest } from 'fastify';

import type { UserRole } from '../../shared/contracts.js';

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  engineer: 2,
  admin: 3,
};

export interface ApiError extends Error {
  statusCode: number;
  code: string;
}

export function apiError(statusCode: number, code: string, message: string): ApiError {
  return Object.assign(new Error(message), { statusCode, code });
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
    if (role !== 'viewer' && role !== 'engineer' && role !== 'admin') {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    if (roleRank[role] < roleRank[minimumRole]) {
      throw apiError(403, 'FORBIDDEN', 'Your role does not permit this operation.');
    }
  };
}
