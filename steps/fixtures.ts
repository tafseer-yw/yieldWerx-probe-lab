/**
 * BDD bindings — the single import point for every step definition file.
 *
 * `createBdd` is bound to the framework's typed `test` (from src/core/fixtures.ts)
 * so steps receive `page`, `config`, `log`, and `scenarioState` by destructuring.
 * Steps MUST import `expect` from here (the assertion vocabulary point).
 */
import { createBdd } from 'playwright-bdd';

import { test } from '@core/fixtures';

export const { Given, When, Then, Before } = createBdd(test);
export { test };
export { expect } from '@playwright/test';
