import { type Browser, expect, type Page, test } from '@playwright/test';
import { ADMIN, api, KID, loadState } from '../support/api';
import { CANNOT_PLAY, cannotPlay } from '../support/browsers';
import { signIn } from '../support/login';
import { accountButton, accountMenu } from '../support/nav';

/** A viewer: its own browser context and sign-in, so its own device id and Jellyfin session. */
async function viewer(browser: Browser, user: { name: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  opened.push(page);
  await signIn(page, user);
  await expect(page.locator('#lmn-root')).toBeVisible();
  return page;
}

/** The account button: it says whether the user is in a group ("Account: In admin's group"). */
const account = (page: Page) => accountButton(page);

/** Opens Watch together from the account menu. */
async function watchTogether(page: Page): Promise<void> {
  await accountButton(page).click();
  await accountMenu(page).getByRole('menuitem', { name: /^Watch together/ }).click();
  await expect(page.getByRole('menu', { name: 'Watch together' })).toBeVisible();
}

// (Phones have Watch together on the profile page instead of the account menu this spec drives.)
test.skip(cannotPlay, CANNOT_PLAY);

const opened: Page[] = [];
let played: string[] = [];

// Two browsers, a group handshake and playback starting on both: slower than the default timeout on CI runners.
test.setTimeout(120_000);

test.afterEach(async () => {
  for (const page of opened.splice(0)) await page.context().close();
  // Leave any group either viewer is still in (Leave is harmless when not in one), and undo the playback's resume
  // point and play state so other specs see a fresh home (marking played, then unplayed, clears both).
  const { admin, kid } = loadState();
  for (const user of [admin, kid]) {
    await api('/SyncPlay/Leave', { method: 'POST', token: user.token }).catch(() => undefined);
    // Every episode: a group's queue can move on to the next one before the test ends.
    for (const id of played)
      for (const method of ['POST', 'DELETE'] as const)
        await api(`/UserPlayedItems/${id}`, { method, token: user.token, query: { userId: user.userId } });
  }
  played = [];
});

test('two viewers watch together: create, join, leave and rejoin, play for both', async ({ browser }) => {
  const { admin, items } = loadState();
  const episodes = await api<{ Items: { Id: string }[] }>(`/Shows/${items['Lumen Show']}/Episodes`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  played = episodes.Items.map((e) => e.Id);
  const a = await viewer(browser, ADMIN);
  const b = await viewer(browser, KID);

  // A creates a group; the account button says so.
  await watchTogether(a);
  await a.getByRole('menuitem', { name: 'New group' }).click();
  await expect(account(a)).toHaveAccessibleName("Account: In admin's group", { timeout: 15_000 });
  // jellyfin-web's "SyncPlay enabled" toast drops in below the nav, never over its tabs.
  const toast = a.locator('.toastContainer .toast.toastVisible').first();
  await expect(toast).toBeVisible();
  // Where it lands: once its drop-in transition has finished.
  await toast.evaluate(async (el) => {
    const transitions = el.getAnimations({ subtree: true });
    await Promise.all(transitions.map((transition) => transition.finished.catch(() => undefined)));
  });
  const pill = (await a.locator('#lmn-root .lmn-nav__pill').boundingBox())!;
  expect((await toast.boundingBox())!.y).toBeGreaterThanOrEqual(pill.y + pill.height);

  // B sees A's group, with who's in it, and joins.
  await watchTogether(b);
  const join = b.getByRole('menuitem', { name: /admin's group/ });
  await expect(join).toContainText('admin');
  await join.click();
  await expect(account(b)).toHaveAccessibleName("Account: In admin's group", { timeout: 15_000 });

  // A sees both members.
  await expect(async () => {
    await watchTogether(a);
    await expect(a.getByRole('menu').getByText('admin, kid')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await a.keyboard.press('Escape');

  // B leaves (the button goes back to normal), then rejoins.
  await watchTogether(b);
  await b.getByRole('menuitem', { name: 'Leave group' }).click();
  await expect(account(b)).toHaveAccessibleName('Account', { timeout: 15_000 });
  await watchTogether(b);
  await b.getByRole('menuitem', { name: /admin's group/ }).click();
  await expect(account(b)).toHaveAccessibleName("Account: In admin's group", { timeout: 15_000 });

  // Play in A starts for both, and A's player says who it's with. (While the group plays, leaving the player pulls
  // a member back in: that's jellyfin-web's SyncPlay, so the test ends here and cleanup leaves the group.)
  await a.goto(`/web/#/details?id=${episodes.Items[0]!.Id}`);
  await a.locator('#lmn-root .lmn-details--episode').getByRole('button', { name: 'Play' }).click();
  await expect(a).toHaveURL(/#\/video/, { timeout: 20_000 });
  await expect(b).toHaveURL(/#\/video/, { timeout: 30_000 });
  await expect(a.getByText('Watching with kid')).toBeVisible({ timeout: 15_000 });
});
