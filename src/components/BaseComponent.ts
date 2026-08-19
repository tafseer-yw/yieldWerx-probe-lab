import { type Locator, type Page } from '@playwright/test';

import { createLogger, type Logger } from '@core/logger';

/**
 * BaseComponent — the foundation for reusable component objects.
 *
 * Page objects model whole screens, but some widgets recur — a data table, a
 * dialog, the side nav. A component object captures one widget's interaction
 * contract ONCE, scoped to a root Locator, so the same class serves any screen
 * that hosts it (and multiple instances on one screen, each bound to a
 * different root).
 *
 * Same rules as a page: locators and actions only, no assertions, testId-first.
 * Components live beside src/pages — below steps, above core — and are composed
 * inside page objects or handed to steps by fixtures.
 */
export abstract class BaseComponent {
  /** Owning page — needed for lookups that escape the root (e.g. a portal). */
  protected readonly page: Page;
  /** Root locator scoping every lookup, so multiple instances coexist. */
  protected readonly root: Locator;
  /** Logger named after the concrete subclass. */
  protected readonly log: Logger;

  constructor(page: Page, root: Locator) {
    this.page = page;
    this.root = root;
    this.log = createLogger(this.constructor.name);
  }

  /** Root-scoped testId lookup — the sanctioned locator entry point. */
  protected byTestId(testId: string): Locator {
    return this.root.getByTestId(testId);
  }
}
