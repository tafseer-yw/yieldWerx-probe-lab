import { z } from 'zod';

export const DEFAULT_LOCAL_AUTH_SECRET = 'probe-lab-local-secret-change-before-sharing';

const environmentSchema = z.object({
  YW_API_HOST: z.string().min(1).default('127.0.0.1'),
  YW_API_PORT: z.coerce.number().int().min(1).max(65_535).default(5000),
  YW_AUTH_SECRET: z.string().min(32).default(DEFAULT_LOCAL_AUTH_SECRET),
  YW_AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
  YW_DB_PATH: z.string().min(1).default('./data/practice-probe-db.sqlite'),
});

export interface ApplicationConfig {
  api: { host: string; port: number };
  auth: { secret: string; tokenTtlSeconds: number };
  database: { path: string };
}

export function resolveDatabasePath(environment: NodeJS.ProcessEnv): string {
  return environmentSchema.pick({ YW_DB_PATH: true }).parse(environment).YW_DB_PATH;
}

export function loadApplicationConfig(environment: NodeJS.ProcessEnv): ApplicationConfig {
  const values = environmentSchema.parse(environment);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (
    !loopbackHosts.has(values.YW_API_HOST) &&
    values.YW_AUTH_SECRET === DEFAULT_LOCAL_AUTH_SECRET
  ) {
    throw new Error(
      'YW_AUTH_SECRET must be changed before binding the API beyond the loopback interface.',
    );
  }
  return {
    api: { host: values.YW_API_HOST, port: values.YW_API_PORT },
    auth: { secret: values.YW_AUTH_SECRET, tokenTtlSeconds: values.YW_AUTH_TOKEN_TTL_SECONDS },
    database: { path: values.YW_DB_PATH },
  };
}
