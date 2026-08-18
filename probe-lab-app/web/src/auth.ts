import { createContext, useContext } from 'react';
import { z } from 'zod';

import { userRoles, type AuthenticatedUser } from '../../shared/contracts.js';
import type { WaferIntelligenceApi } from './api.js';

export const SESSION_KEY = 'yw-probe-lab-session';

const sessionSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    username: z.string().min(1),
    role: z.enum(userRoles),
  }),
});

export interface Session {
  token: string;
  user: AuthenticatedUser;
}

export interface AuthContextValue {
  api: WaferIntelligenceApi;
  session: Session | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue);

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function clearStoredSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be disabled; the in-memory session still remains usable.
  }
}

export function storeSession(session: Session): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // A private or quota-limited context can continue with an in-memory session.
  }
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    clearStoredSession();
    return null;
  } catch {
    clearStoredSession();
    return null;
  }
}
