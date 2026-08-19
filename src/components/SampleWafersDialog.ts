import { type Locator, type Page } from '@playwright/test';

import { BaseComponent } from './BaseComponent';

/**
 * SampleWafersDialog — the admin "Sample wafers" popup. A component, not a
 * page, because it is a dialog opened from the header on top of whatever screen
 * is showing. Bound to the dialog role as its root, so its lookups never stray
 * into the page behind it.
 */
export class SampleWafersDialog extends BaseComponent {
  constructor(page: Page) {
    super(page, page.getByRole('dialog'));
  }

  /** Open the dialog from the header (admin only). */
  async open(): Promise<void> {
    await this.page
      .getByRole('banner')
      .getByRole('button', { name: 'Sample wafers', exact: true })
      .click();
    await this.root.waitFor();
  }

  async close(): Promise<void> {
    await this.root.getByRole('button', { name: 'Close' }).click();
  }

  /** The "N of M loaded" summary text a step asserts on. */
  get summary(): Locator {
    return this.root.getByText(/of \d+ loaded/);
  }

  get loadButton(): Locator {
    return this.root.getByRole('button', { name: /^Load/ });
  }
  get removeButton(): Locator {
    return this.root.getByRole('button', { name: /^Remove/ });
  }

  async loadAll(): Promise<void> {
    await this.loadButton.click();
  }
  async removeAll(): Promise<void> {
    await this.removeButton.click();
  }
}
