import { expect, type Page, test } from '@playwright/test';
import { ADMIN, api, KID, loadState } from '../support/api';
import { login } from '../support/login';
import { accountButton, accountMenu } from '../support/nav';

/** Titles a test played: put back to never played afterwards (marking played, then unplayed, clears the date too). */
let played: string[] = [];

test.afterEach(async () => {
  const { admin } = loadState();
  for (const id of played)
    for (const method of ['POST', 'DELETE'] as const)
      await api(`/UserPlayedItems/${id}`, { method, token: admin.token, query: { userId: admin.userId } });
  played = [];
});

const menuItems = (page: Page) => accountMenu(page).getByRole('menuitem');

test.describe('wide screens', () => {
  // The account menu hangs from the nav pill; phones have the tab bar's Me tab instead (below).
  test.skip(({ isMobile }) => isMobile, 'phones have no nav pill');

  test('the account button opens its menu on hover, and it closes when the mouse leaves', async ({ page }) => {
    await login(page, ADMIN);
    const button = accountButton(page);
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    // Hover once Lumen's page is up: a nav mounted afresh under a still mouse gets no pointerenter.
    await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
    await expect(async () => {
      await page.mouse.move(20, 600);
      await button.hover();
      await expect(accountMenu(page)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.lmn-account__header')).toContainText('admin');
    await expect(page.locator('.lmn-account__header')).toContainText('Administrator');
    await expect(menuItems(page)).toContainText([
      'History',
      'Settings',
      'Profile',
      'Dashboard',
      'Metadata manager',
      'Sign out',
    ]);
    await expect(accountMenu(page).getByRole('menuitem', { name: 'Dashboard' })).toHaveAttribute('href', '#/dashboard');

    // Moving down into the menu keeps it open, even pausing in the gap between button and menu for longer than the
    // close delay (300 ms).
    const from = (await button.boundingBox())!;
    const panel = (await page.locator('.lmn-account__panel').boundingBox())!;
    const x = from.x + from.width / 2;
    const gapY = (from.y + from.height + panel.y) / 2;
    expect(panel.y - (from.y + from.height)).toBeGreaterThan(2);
    await page.mouse.move(x, gapY, { steps: 8 });
    await page.waitForTimeout(600);
    await expect(accountMenu(page)).toBeVisible();
    const settings = (await accountMenu(page).getByRole('menuitem', { name: 'Settings' }).boundingBox())!;
    await page.mouse.move(x, settings.y + settings.height / 2, { steps: 8 });
    await page.waitForTimeout(500);
    await expect(accountMenu(page)).toBeVisible();

    await page.mouse.move(20, 600);
    await expect(accountMenu(page)).toBeHidden();
  });

  test('keyboard: Enter opens it on its first item, arrows move, Escape closes it; no admin pages for others', async ({
    page,
  }) => {
    await login(page, KID);
    const button = accountButton(page);
    await button.focus();
    await page.keyboard.press('Enter');

    await expect(accountMenu(page).getByRole('menuitem', { name: 'History' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    // On to the next item (not by nth(): Watch together joins the items once SyncPlay's state has loaded).
    const focused = accountMenu(page).locator('[role="menuitem"]:focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).not.toHaveAccessibleName('History');
    await expect(accountMenu(page).getByRole('menuitem', { name: 'Dashboard' })).toHaveCount(0);
    await expect(page.locator('.lmn-account__header')).not.toContainText('Administrator');

    await page.keyboard.press('Escape');
    await expect(accountMenu(page)).toBeHidden();
    await expect(button).toBeFocused();
    // Escape only closed the menu: still on home.
    await expect(page).toHaveURL(/#\/home$/);
  });

  test('History lists what the user watched, newest first, by day; Mark as unwatched takes a title off', async ({
    page,
  }) => {
    const { admin, items } = loadState();
    // Part of Lumen Beta, then a whole episode of Lumen Show: the episode is the newer.
    await api(`/UserItems/${items['Lumen Beta']}/UserData`, {
      method: 'POST',
      token: admin.token,
      query: { userId: admin.userId },
      body: { PlaybackPositionTicks: 50_000_000, LastPlayedDate: new Date(Date.now() - 60_000).toISOString() },
    });
    const episodes = await api<{ Items: { Id: string; Name: string }[] }>(`/Shows/${items['Lumen Show']}/Episodes`, {
      token: admin.token,
      query: { userId: admin.userId },
    });
    const episode = episodes.Items[0]!;
    played = [items['Lumen Beta']!, episode.Id];
    await api(`/UserPlayedItems/${episode.Id}`, { method: 'POST', token: admin.token, query: { userId: admin.userId } });

    await login(page, ADMIN);
    await accountButton(page).click();
    await accountMenu(page).getByRole('menuitem', { name: 'History' }).click();

    await expect(page).toHaveURL(/#\/home\?lumen=history$/);
    await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
    const today = page.getByRole('list', { name: 'Today' });
    const cards = today.getByRole('link');
    // Episodes show under their show's name.
    await expect(cards.first()).toHaveAccessibleName(new RegExp(`^Lumen Show S\\d+:E\\d+ · ${episode.Name}$`));
    await expect(cards.nth(1)).toHaveAccessibleName('Lumen Beta');
    await expect(cards).toHaveCount(2);
    // The account button is lit on its pages.
    await expect(accountButton(page)).toHaveClass(/is-active/);

    // Jellyfin forgets when an unwatched title was played: it leaves History (on the next visit).
    await cards.first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark as unwatched' }).click();
    await page.reload();
    await expect(page.getByRole('list', { name: 'Today' }).getByRole('link')).toHaveCount(1);
  });

  test('TV layout: OK on the account button opens the menu, and Back closes it', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
    await login(page, ADMIN);
    // Home focuses its hero once it has loaded (a remote needs something focused); the user goes on from there.
    await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeFocused();
    const button = accountButton(page);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(accountMenu(page).getByRole('menuitem', { name: 'History' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    // Down moved on from History. Pinned by name, not nth(): Watch together joins the items once SyncPlay's state has
    // loaded, which would shift the others.
    const focused = accountMenu(page).locator('[role="menuitem"]:focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).not.toHaveAccessibleName('History');
    const name = /menuitem "([^"]+)"/.exec(await focused.ariaSnapshot())![1]!;
    const second = accountMenu(page).getByRole('menuitem', { name, exact: true });
    await expect(second).toBeFocused();
    // Nothing is beside the items: Left and Right don't take focus out to the nav's links behind the open menu.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(second).toBeFocused();
    await expect(accountMenu(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(accountMenu(page)).toBeHidden();
    await expect(button).toBeFocused();
    await expect(page).toHaveURL(/#\/home$/);
  });

  test("History: a show marked watched is one card for its episodes, which opens the show", async ({ page }) => {
    const { admin, items } = loadState();
    const show = items['Lumen Show']!;
    played = [show];
    await api(`/UserPlayedItems/${show}`, { method: 'POST', token: admin.token, query: { userId: admin.userId } });

    await login(page, ADMIN);
    await page.goto('/web/#/home?lumen=history');
    const today = page.getByRole('list', { name: 'Today' });
    const card = today.getByRole('link', { name: /^Lumen Show \d+ episodes$/ });
    await expect(card).toBeVisible();
    await expect(today.getByRole('link')).toHaveCount(1);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`#/details\\?id=${show}`));
  });
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Me tab opens the profile page, which has History too', { tag: '@smoke' }, async ({ page }) => {
    await login(page, ADMIN);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await page.locator('#lmn-root .lmn-tabbar').getByRole('link', { name: 'Me', exact: true }).click();

    await expect(page).toHaveURL(/#\/mypreferencesmenu$/);
    await expect(page.getByRole('link', { name: /Dashboard/ })).toBeVisible();
    await page.getByRole('link', { name: /History/ }).click();
    await expect(page).toHaveURL(/#\/home\?lumen=history$/);
    await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
    // The Me tab stays lit on History.
    await expect(page.locator('#lmn-root .lmn-tabbar').getByRole('link', { name: 'Me', exact: true })).toHaveClass(/is-active/);
  });
});
