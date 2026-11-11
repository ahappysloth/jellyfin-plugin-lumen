import { expect, test } from '@playwright/test';
import { ADMIN, KID, loadState } from '../support/api';
import { login } from '../support/login';
import { navLink, openSettingsMenu } from '../support/nav';
import { expectPresentButHidden } from '../support/stock';

test('search finds library titles as you type and keeps the query for Back', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await navLink(page, 'Search').click();

  const box = page.getByRole('searchbox', { name: 'Search' });
  await expect(box).toBeFocused();
  await expectPresentButHidden(page.locator('#reactRoot .skinBody'));
  await box.fill('alpha');

  const movies = page.getByRole('list', { name: 'Movies' });
  await expect(movies.getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(page).toHaveURL(/#\/search\?query=alpha$/);

  await movies.getByRole('link', { name: 'Lumen Alpha' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('alpha');
});

test('the settings menu links to the stock settings pages; admin links only for admins', async ({ page }) => {
  await login(page, KID);
  await openSettingsMenu(page);

  await expect(page.getByRole('heading', { name: 'kid', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Dashboard/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await page.getByRole('link', { name: /Playback/ }).click();
  await expect(page).toHaveURL(/#\/mypreferencesplayback\?userId=/);
  await expect(page.locator('#lmn-root .lmn-profile')).toBeHidden();
});

test('the sign-in page wears Lumen’s look', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/web/#/login');

  await expect(page.locator('#txtManualName')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\blmn-signin\b/);
  await expectPresentButHidden(page.locator('.skinHeader'));
  // The Sign In button uses Lumen's accent instead of jellyfin-web's blue.
  const background = await page
    .locator('.manualLoginForm .button-submit')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe('rgb(227, 11, 23)');
});

test('settings pages keep working inside Lumen’s frame', async ({ page }) => {
  await login(page, ADMIN);
  await openSettingsMenu(page);
  await page.getByRole('link', { name: /Playback/ }).click();

  await expect(page.getByRole('heading', { name: 'Playback', level: 1 })).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-nav')).toBeVisible();
  await expectPresentButHidden(page.locator('.MuiAppBar-root, .skinHeader'));
  // The stock form is still there and usable.
  await expect(page.locator('.page:not(.hide) .button-submit').first()).toBeVisible();

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/#\/mypreferencesmenu$/);
  await expect(page.locator('html')).not.toHaveClass(/lmn-skin-settings/);
});

test('settings pages match the settings menu’s width, and an open menu doesn’t take the scrollbar away', async ({ page }) => {
  await login(page, ADMIN);
  await openSettingsMenu(page);
  const menuLeft = (await page.locator('.lmn-profile__list').first().boundingBox())!.x;
  await page.getByRole('link', { name: /Display/ }).click();

  const select = page.locator('.page:not(.hide) .MuiSelect-select').first();
  await expect(select).toBeVisible();
  // The settings form lines up with the menu's content and the page title.
  const field = (await page.locator('.page:not(.hide) .MuiFilledInput-root').first().boundingBox())!;
  expect(Math.abs(field.x - menuLeft)).toBeLessThan(2);
  expect(Math.abs(field.x - (await page.locator('.lmn-settings-frame__title').boundingBox())!.x)).toBeLessThan(2);

  // MUI's scroll lock hides <body>'s overflow (and the viewport's scrollbar with it) while a menu is open; not here.
  await select.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('body')).toHaveCSS('padding-right', '0px');
});

test('installing to a home screen uses Lumen’s icon and the server’s name', async ({ page }) => {
  await page.goto('/web/#/login');

  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /lumen-icon-180\.png/);
  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((l) => (l as HTMLLinkElement).href);
  const manifest = (await (await page.request.get(manifestUrl)).json()) as {
    name: string;
    icons: { src: string }[];
  };
  expect(manifest.name).toBe((await (await page.request.get('/System/Info/Public')).json()).ServerName);
  for (const icon of manifest.icons) {
    expect((await page.request.get(new URL(icon.src, manifestUrl).href)).headers()['content-type']).toBe('image/png');
  }
});

test('jellyfin-web’s toasts, menus and dialogs wear Lumen’s look on the pages Lumen doesn’t take over', async ({ page, isMobile }) => {
  // A wrong password: jellyfin-web's toast, as Lumen's pill (styles/stock-skin.css).
  await page.goto('/web/#/login');
  await page.locator('#txtManualName').fill(ADMIN.name);
  await page.locator('#txtManualPassword').fill('not-the-password');
  await page.locator('.manualLoginForm button[type="submit"]').click();
  await expect(page.locator('.toastContainer .toast').first()).toHaveCSS('border-top-left-radius', '999px');

  // A library folder's ⋯ menu: jellyfin-web's action sheet, on Lumen's raised surface (styles/stock-components.css).
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${loadState().libraries.movies}`);
  await page.locator('#itemDetailPage:not(.hide) .btnMoreCommands').first().click();
  const sheet = page.locator('.actionSheet');
  await expect(sheet).toHaveCSS('background-color', 'rgba(28, 28, 28, 0.97)');
  await expect(sheet).toHaveCSS('border-top-left-radius', '14px');
  // A click beside it closes it (jellyfin-web's legacy dialogs ignore Escape outside the TV layout).
  await page.locator('.dialogContainer').click({ position: { x: 5, y: 5 } });
  await expect(sheet).toHaveCount(0);

  // A library's stock item list: its header menu and the legacy Sort dialog.
  await page.goto(`/web/#/list?parentId=${loadState().libraries.movies}`);
  await page.getByRole('button', { name: 'User Menu' }).click();
  const menu = page.locator('.MuiMenu-paper', { hasText: 'Sign Out' });
  await expect(menu).toHaveCSS('border-top-left-radius', '14px');
  await expect(menu).toHaveCSS('background-color', 'rgba(28, 28, 28, 0.97)');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // The Sort button hides its label on phones; the dialog is the same one.
  if (isMobile) return;
  await page.locator('.page:not(.hide) .btnSort').first().click();
  const dialog = page.locator('.dialogContainer .formDialog');
  await expect(dialog).toHaveCSS('background-color', 'rgb(24, 24, 24)');
  await expect(dialog).toHaveCSS('border-top-left-radius', '20px');
  // Its fields are Lumen's, like the settings pages'.
  await expect(dialog.locator('.selectSortBy')).toHaveCSS('border-top-left-radius', '12px');
  await dialog.locator('.btnCancel').click();
  await expect(dialog).toHaveCount(0);
});
