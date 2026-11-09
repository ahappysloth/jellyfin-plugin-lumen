import { type Browser, expect, type Page, test } from '@playwright/test';
import { ADMIN, api, KID, loadState } from '../support/api';
import { login } from '../support/login';

/** A second viewer: its own browser context, so its own device id and Jellyfin session. */
async function viewer(browser: Browser, user: { name: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  opened.push(page);
  await login(page, user);
  await expect(page.locator('#lmn-root')).toBeVisible();
  return page;
}

const watchTogether = (page: Page) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Watch together/ });

const opened: Page[] = [];
let played: string | undefined;

test.afterEach(async () => {
  for (const page of opened.splice(0)) await page.context().close();
  // Leave any group either viewer is still in (Leave is harmless when not in one), and undo the playback's resume
  // point and play state so other specs see a fresh home (marking played, then unplayed, clears both).
  const { admin, kid } = loadState();
  for (const user of [admin, kid]) {
    await api('/SyncPlay/Leave', { method: 'POST', token: user.token }).catch(() => undefined);
    if (!played) continue;
    for (const method of ['POST', 'DELETE'] as const)
      await api(`/UserPlayedItems/${played}`, { method, token: user.token, query: { userId: user.userId } });
  }
  played = undefined;
});

test('two viewers watch together: create, join, play for both, leave', async ({ browser }) => {
  const { admin, items } = loadState();
  const episodes = await api<{ Items: { Id: string }[] }>(`/Shows/${items['Lumen Show']}/Episodes`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  played = episodes.Items[0]!.Id;
  const a = await viewer(browser, ADMIN);
  const b = await viewer(browser, KID);

  // A creates a group; the button lights up.
  await watchTogether(a).click();
  await expect(a.getByRole('menu', { name: 'Watch together' })).toBeVisible();
  await a.getByRole('menuitem', { name: 'New group' }).click();
  await expect(watchTogether(a)).toHaveAccessibleName("Watch together: In admin's group", { timeout: 15_000 });

  // B sees A's group, with who's in it, and joins.
  await watchTogether(b).click();
  const join = b.getByRole('menuitem', { name: /admin's group/ });
  await expect(join).toContainText('admin');
  await join.click();
  await expect(watchTogether(b)).toHaveAccessibleName("Watch together: In admin's group", { timeout: 15_000 });

  // A sees both members.
  await expect(async () => {
    await watchTogether(a).click();
    await expect(a.getByRole('menu').getByText('admin, kid')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await a.keyboard.press('Escape');

  // Play in A starts for both, and A's player says who it's with.
  await a.goto(`/web/#/details?id=${episodes.Items[0]!.Id}`);
  await a.locator('#lmn-root .lmn-details--episode').getByRole('button', { name: 'Play' }).click();
  await expect(a).toHaveURL(/#\/video/, { timeout: 20_000 });
  await expect(b).toHaveURL(/#\/video/, { timeout: 30_000 });
  await expect(a.getByText('Watching with kid')).toBeVisible({ timeout: 15_000 });

  // Leaving clears the button.
  await a.goto('/web/#/home');
  await expect(watchTogether(a)).toBeVisible();
  await watchTogether(a).click();
  await a.getByRole('menuitem', { name: 'Leave group' }).click();
  await expect(watchTogether(a)).toHaveAccessibleName('Watch together', { timeout: 15_000 });
});
