import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

test('the Lumen dashboard page loads its settings', async ({ page }) => {
  await login(page, ADMIN);

  await page.goto('/web/#/configurationpage?name=Lumen');

  await expect(page.getByRole('group', { name: 'Home sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move Continue Watching down/ })).toBeVisible();
});
