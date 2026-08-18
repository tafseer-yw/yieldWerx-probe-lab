/**
 * Typed Playwright fixtures — the dependency-injection backbone.
 *
 * Minimal repoint: provides `config`, `log`, and per-scenario `scenarioState`
 * to BDD steps that drive the yieldWerx Playground app (probe-lab-app/). The
 * original page objects, API clients, DB layer, and Plotly chart objects were
 * removed together with the real app; steps interact with the lightweight app
 * directly through Playwright's `page` using getByRole/getByTestId.
 */
import { test as base } from 'playwright-bdd';

import { loadConfig, type EnvironmentConfig } from './config';

export const test = base.extend<{ config: EnvironmentConfig; scenarioState: Map<string, unknown> }>(
  {
    config: async ({}, use) => {
      await use(loadConfig());
    },
    scenarioState: async ({}, use) => {
      await use(new Map<string, unknown>());
    },
  },
);
