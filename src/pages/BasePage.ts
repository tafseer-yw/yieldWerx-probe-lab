import { type Locator, type Page } from '@playwright/test';

import { createLogger, type Logger } from '@core/logger';

/**
 * BasePage — the thin foundation every page object extends.
 *
 * The model, ported from test-ops/e2e: page objects hold LOCATORS and ACTIONS
 * only, and all judgement lives in steps. This base carries the shared plumbing
 * — the Page handle, a named logger, navigation, and a testId lookup — and
 * nothing else, so a subclass cannot quietly grow into a god object.
 *
 * Layering (enforced by eslint import rules): src/pages sits below steps and
 * above src/core. A page never imports a step, a component that imports a page,
 * or anything above itself, and it never asserts — steps assert on what a page
 * returns.
 */
export abstract class BasePage {
  /** Playwright page handle; protected so subclasses compose locators off it. */
  protected readonly page: Page;
  /** Logger named after the concrete subclass (e.g. "WafersPage"). */
  protected readonly log: Logger;

  /** Route relative to baseURL, e.g. "/wafers". */
  abstract readonly path: string;

  constructor(page: Page) {
    this.page = page;
    /* The context is the concrete class name, so every subclass logs under its
       own name with no extra wiring. */
    this.log = createLogger(this.constructor.name);
  }

  /**
   * Navigate to this page and wait for it to be ready. Combined so no step can
   * forget the wait — a page object is only ever handed back ready. A full
   * `goto` (not a client-side click) is deliberate: it remounts cached queries,
   * which is what makes list pages show freshly-created rows.
   */
  async goto(): Promise<void> {
    this.log.debug(`goto ${this.path}`);
    await this.page.goto(this.path);
    await this.waitForReady();
  }

  /**
   * Readiness after navigation. The base waits for DOM content only — never
   * `networkidle`, which the coding conventions ban as inherently flaky.
   * Override for a page whose readiness is a rendered heading or a drawn chart.
   */
  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * The sanctioned locator entry point: a page-scoped testId lookup. Raw
   * CSS/XPath in a page object is an eslint error, exactly as in a step.
   */
  protected byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /** Current URL — exposed so a step can assert on it without the page asserting. */
  url(): string {
    return this.page.url();
  }
}
