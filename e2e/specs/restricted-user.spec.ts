import { expect, test } from '@playwright/test';
import { KID, api, loadState } from '../support/api';
import { login } from '../support/login';

const MOVIES = /^Lumen (Alpha|Beta|Gamma)$/;

test('a user without access to the Movies library never sees movies', async ({ page }) => {
  const { kid } = loadState();
  const home = await api<{ Hero: { Item: { Name: string } }[]; Rows: { Items: { Name: string }[] }[] }>('/Lumen/Home', { token: kid.token });
  const names = [...home.Hero.map((h) => h.Item.Name), ...home.Rows.flatMap((r) => r.Items.map((i) => i.Name))];

  expect(names).toContain('Lumen Show');
  expect(names.filter((n) => MOVIES.test(n))).toEqual([]);

  await login(page, KID);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.locator('#lmn-root').getByRole('button', { name: MOVIES })).toHaveCount(0);
});
