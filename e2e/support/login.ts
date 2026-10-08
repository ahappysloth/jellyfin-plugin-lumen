import type { Page } from '@playwright/test';

/** Signs in through jellyfin-web's manual login form (users are hidden, so the form is shown directly). */
export async function login(page: Page, user: { name: string; password: string }): Promise<void> {
  await page.goto('/web/#/login');
  await page.locator('#txtManualName').fill(user.name);
  await page.locator('#txtManualPassword').fill(user.password);
  await page.locator('.manualLoginForm button[type="submit"]').click();
  await page.waitForURL(/#\/home/);
}
