import { type Locator } from '@playwright/test';

import { BasePage } from './BasePage';

/**
 * WafersPage — the landed-wafers list. `goto` is a full navigation, which
 * remounts the cached query, so a wafer created moments earlier actually shows.
 */
export class WafersPage extends BasePage {
  readonly path = '/wafers';

  /** The row for a lot, if it is present. Steps assert on visibility/count. */
  rowForLot(lot: string): Locator {
    return this.page.getByRole('row').filter({ hasText: lot }).first();
  }

  /**
   * The wafer sequence in a lot's row — the first cell. Returns a number a step
   * can carry to a report; throws if the row is not a sequence, which is a real
   * failure, not a silent zero.
   */
  async sequenceForLot(lot: string): Promise<number> {
    const text = await this.rowForLot(lot).getByRole('cell').first().textContent();
    const sequence = Number(text);
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new Error(`No wafer sequence found for lot ${lot} (read "${text ?? ''}")`);
    }
    return sequence;
  }

  /** Open a lot's wafer detail by clicking its row. */
  async openLot(lot: string): Promise<void> {
    await this.rowForLot(lot).click();
    await this.page.waitForURL('**/wafers/*');
  }
}
