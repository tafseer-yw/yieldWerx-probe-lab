import { type Buffer } from 'node:buffer';

import { BasePage } from './BasePage';

/**
 * UploadPage — the wafer-upload form. The Device / Test program controls are
 * <select> (role combobox); targeting them by role disambiguates from the
 * field help-dot, which shares the accessible name.
 */
export class UploadPage extends BasePage {
  readonly path = '/upload';

  /**
   * Fill the form and drop a CSV, leaving the file staged. The caller submits,
   * so a step can assert on the staged filename first.
   */
  async stageCsv(bytes: Buffer, device = 'PROBE-DEV-1', program = 'PROBE-PGM-1'): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Device' }).selectOption(device);
    await this.page
      .getByRole('option', { name: 'PROBE-PGM-1 · Probe Practice Program 1' })
      .waitFor({ state: 'attached' });
    await this.page.getByRole('combobox', { name: 'Test program' }).selectOption(program);

    const dataTransfer = await this.page.evaluateHandle(
      (raw: number[]) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(raw)], 'wafer.csv', { type: 'text/csv' }));
        return transfer;
      },
      [...bytes],
    );
    await this.byTestId('upload-dropzone').dispatchEvent('drop', { dataTransfer });
  }

  /** Submit the staged upload. */
  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Upload' }).click();
  }
}
