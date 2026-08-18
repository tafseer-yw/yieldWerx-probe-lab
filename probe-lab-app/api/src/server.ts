import 'dotenv/config';

import { buildApplication } from './app.js';
import { loadApplicationConfig } from './config.js';
import { productBrand } from '../../shared/contracts.js';

async function start(): Promise<void> {
  const config = loadApplicationConfig(process.env);
  const app = await buildApplication({
    authSecret: config.auth.secret,
    tokenTtlSeconds: config.auth.tokenTtlSeconds,
    databasePath: config.database.path,
    logging: true,
  });

  await app.listen({ host: config.api.host, port: config.api.port });
  process.stdout.write(
    `${productBrand.name} API listening on http://${config.api.host}:${config.api.port}\n`,
  );
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start ${productBrand.name} API: ${message}\n`);
  process.exitCode = 1;
});
