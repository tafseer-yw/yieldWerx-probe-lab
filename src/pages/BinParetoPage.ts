import { type Locator } from '@playwright/test';

import { BasePage } from './BasePage';

/**
 * BinParetoPage — the bin pareto report screen and its options.
 */
export class BinParetoPage extends BasePage {
  readonly path = '/reports/bin-pareto';

  /** The canvas chart container — the visual-regression handle. */
  get chart(): Locator {
    return this.byTestId('bin-pareto-chart');
  }

  /** The rows of the data table beside the chart (the chart's readable twin). */
  get tableRows(): Locator {
    return this.byTestId('bin-pareto-rows').getByRole('row');
  }

  /**
   * Run the report for one wafer sequence, optionally choosing which bins to
   * show. Waits for the result heading so the caller gets a rendered report.
   */
  async run(waferSequence: number, options: { binsToShow?: string } = {}): Promise<void> {
    await this.page.getByLabel('Wafer sequence').fill(String(waferSequence));
    if (options.binsToShow) {
      await this.page
        .getByRole('combobox', { name: 'Bins to show' })
        .selectOption(options.binsToShow);
    }
    await this.page.getByRole('button', { name: 'Run report' }).click();
    await this.page.getByRole('heading', { name: 'Bin loss', level: 2 }).waitFor();
  }

  /** The Download CSV button — absent until a report has been run. */
  get downloadButton(): Locator {
    return this.byTestId('bin-pareto-download-csv');
  }
}
