import { type Locator } from '@playwright/test';

import { type Credentials } from '@core/config';
import { BasePage } from './BasePage';

/**
 * LoginPage — the sign-in screen. The reference for the login-with-response-wait
 * pattern: arm the wait for the auth POST BEFORE clicking, so the action is
 * deterministic on a slow environment rather than relying on a sleep.
 */
export class LoginPage extends BasePage {
  readonly path = '/login';

  get username(): Locator {
    return this.page.getByLabel('Username');
  }
  get password(): Locator {
    return this.page.getByLabel('Password');
  }
  get submit(): Locator {
    return this.page.getByRole('button', { name: 'Sign in' });
  }

  /**
   * Fill credentials and submit, resolving once the auth response returns
   * (whatever its status — the step decides whether that is a pass). The
   * listener is armed before the click so a fast server cannot beat it.
   */
  async signIn(credentials: Credentials): Promise<void> {
    await this.goto();
    await this.username.fill(credentials.username);
    await this.password.fill(credentials.password);
    const authResponse = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/login') && response.request().method() === 'POST',
    );
    await this.submit.click();
    await authResponse;
  }
}
