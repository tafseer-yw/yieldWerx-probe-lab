import { type Locator } from '@playwright/test';

import { BasePage } from './BasePage';

/**
 * WaferDetailPage — one wafer's map and details. The map is a canvas, so it
 * exposes two handles: the visual container to pixel-pin, and the hidden data
 * layer with one element per die for attribute assertions.
 */
export class WaferDetailPage extends BasePage {
  /* No fixed path — reached by opening a wafer from the list. */
  readonly path = '/wafers';

  /** The canvas map container — the visual-regression handle. */
  get map(): Locator {
    return this.byTestId('wafer-map-chart');
  }

  /** The hidden per-die data layer (data-x / data-passfail / …). */
  get dataLayer(): Locator {
    return this.byTestId('wafer-map-data');
  }

  /** How many dies the data layer holds — a step waits on this before pinning pixels. */
  async dieCount(): Promise<number> {
    return this.dataLayer.evaluate((element) => element.children.length);
  }
}
