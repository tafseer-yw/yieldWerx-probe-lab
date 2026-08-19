/**
 * Typed Playwright fixtures — the dependency-injection backbone.
 *
 * Provides `config`, `scenarioState`, and the page/component objects to BDD
 * steps. Steps receive a ready page object by destructuring rather than
 * constructing one — construction (and the strict layering it enforces) lives
 * here, the one wiring point. Page objects hold locators and actions; steps
 * assert. Steps may still drop to raw `page` for one-off interactions the POM
 * does not model.
 */
import { test as base } from 'playwright-bdd';

import { SampleWafersDialog } from '@components/index';
import { BinParetoPage, LoginPage, UploadPage, WaferDetailPage, WafersPage } from '@pages/index';
import { loadConfig, type EnvironmentConfig } from './config';

interface ProbeLabFixtures {
  config: EnvironmentConfig;
  scenarioState: Map<string, unknown>;
  loginPage: LoginPage;
  wafersPage: WafersPage;
  uploadPage: UploadPage;
  binParetoPage: BinParetoPage;
  waferDetailPage: WaferDetailPage;
  sampleWafersDialog: SampleWafersDialog;
}

export const test = base.extend<ProbeLabFixtures>({
  config: async ({}, use) => {
    await use(loadConfig());
  },
  scenarioState: async ({}, use) => {
    await use(new Map<string, unknown>());
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  wafersPage: async ({ page }, use) => {
    await use(new WafersPage(page));
  },
  uploadPage: async ({ page }, use) => {
    await use(new UploadPage(page));
  },
  binParetoPage: async ({ page }, use) => {
    await use(new BinParetoPage(page));
  },
  waferDetailPage: async ({ page }, use) => {
    await use(new WaferDetailPage(page));
  },
  sampleWafersDialog: async ({ page }, use) => {
    await use(new SampleWafersDialog(page));
  },
});
