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

/*
 * The odiff visual matcher lives on the SAME expect every step imports, so
 * `expect(locator).toHaveScreenshotOdiff(...)` is available and typed wherever
 * assertions happen. Importing from the package root also pulls in its global
 * Matchers augmentation. Authority: docs/visual-regression.md (test-ops) and
 * src/core/visual.ts here.
 */
import { expect as baseExpect } from '@playwright/test';
import { toHaveScreenshotOdiff } from 'playwright-odiff';

export const expect = baseExpect.extend({ toHaveScreenshotOdiff });
