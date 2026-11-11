import { expect, test } from '@playwright/test';
import { ADMIN, resetLumen } from '../support/api';
import { login } from '../support/login';

test('the Lumen dashboard page loads its settings', async ({ page }) => {
  await login(page, ADMIN);

  await page.goto('/web/#/configurationpage?name=Lumen');

  await expect(page.getByRole('group', { name: 'Home sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move Continue Watching down/ })).toBeVisible();
});

test('the save bar comes up with a change, wherever the page is scrolled, and goes after saving', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const bar = root.locator('.lmna-savebar');
  await expect(root.getByRole('group', { name: 'Home sections' })).toBeVisible();
  // Nothing to save: the bar is in the page but down, and Reset to defaults is still there.
  await expect(bar).toHaveCount(1);
  await expect(bar).toBeHidden();
  await expect(root.getByRole('button', { name: 'Reset to defaults' })).toBeVisible();

  try {
    await root.getByRole('button', { name: /Move Continue Watching down/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const save = bar.getByRole('button', { name: 'Save' });
    await expect(bar).toContainText('Unsaved changes');
    await expect(save).toBeInViewport();
    // Lined up with the settings column, not over the dashboard's drawer.
    const form = (await root.locator('form').boundingBox())!;
    const box = (await bar.boundingBox())!;
    expect(Math.abs(box.x - form.x)).toBeLessThan(1);
    expect(Math.abs(box.width - form.width)).toBeLessThan(1);

    await save.click();
    await expect(bar.getByText('Settings saved.')).toBeVisible();
    await expect(bar).toBeHidden();
  } finally {
    await resetLumen();
  }
});

test('the Dashboard wears Lumen’s look, and only on admin pages', async ({ page, isMobile }) => {
  await login(page, ADMIN);
  const html = page.locator('html');
  await expect(page.locator('link[href*="lumen-dashboard.css"]')).toHaveCount(1);
  // The server's accent comes with the page, so the admin pages have it at first paint.
  expect(await page.locator('style').allTextContents()).toContain('html.lmn-skin-dashboard{--lmn-accent:#e30b17}');

  await page.goto('/web/#/dashboard');
  await expect(html).toHaveClass(/\blmn-skin-dashboard\b/);
  const restart = page.locator('.MuiButton-containedError').first();
  await expect(restart).toBeVisible();
  // Lumen's background on the drawer; destructive buttons outlined in Lumen's red rather than filled.
  await expect(page.locator('.MuiDrawer-paper').first()).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await expect(restart).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(restart).toHaveCSS('border-top-color', 'rgb(227, 11, 23)'); // Lumen's red, like the primary buttons
  // The Scan button carries the accent.
  await expect(page.locator('.MuiButton-containedPrimary').first()).toHaveCSS('background-color', 'rgb(227, 11, 23)');

  // jellyfin-web navigates with pushState; the look comes off on Lumen's own pages.
  // On phones the drawer is closed until its menu button opens it.
  if (isMobile) await page.getByRole('button', { name: 'Open Menu' }).click();
  await page.locator('.MuiDrawer-paper a[href="#/"]').first().click();
  await expect(html).not.toHaveClass(/lmn-skin-dashboard/);

  await page.goto('/web/#/metadata');
  await expect(html).toHaveClass(/\blmn-skin-dashboard\b/);
  await expect(page.locator('.editPageSidebar')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
});

test('Check for Lumen updates on the Plugins page opens Lumen’s settings and checks', async ({ page }) => {
  await login(page, ADMIN);
  // Lumen's page opened once first: jellyfin-web keeps that copy, and the button's URL opens a second one beside it.
  await page.goto('/web/#/configurationpage?name=Lumen');
  await expect(page.getByRole('group', { name: 'Home sections' })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/dashboard/plugins';
  });

  const check = page.getByRole('link', { name: 'Check for Lumen updates' });
  await expect(check).toBeVisible();
  // It sits in front of Manage Repositories and looks like it.
  const repositories = page.getByRole('link', { name: 'Manage Repositories' });
  expect(await check.getAttribute('class')).toBe(await repositories.getAttribute('class'));
  await check.click();

  await expect(page).toHaveURL(/configurationpage\?name=Lumen&check=updates/);
  // The copy on screen is mounted (not stuck on "Loading Lumen settings…").
  const updates = page.locator('[id="lmn-admin-root"]:visible').getByRole('group', { name: 'Updates' });
  // The server checks GitHub and Jellyfin's repositories; whichever way it comes out, it's an answer, not an error.
  await expect(updates.getByText(/is the latest version|is available|No Lumen release was found/)).toBeVisible({ timeout: 30_000 });
  await expect(updates.getByRole('alert')).toHaveCount(0);
  await expect(updates.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

test('admin pages sit in one centred column, with Lumen’s cards and tab strip', { tag: '@smoke' }, async ({ page, isMobile }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/dashboard/settings');
  const form = page.locator('#dashboardGeneralPage .content-primary form');
  await expect(form).toBeVisible();
  const area = (await page.locator('#dashboardGeneralPage').boundingBox())!;
  const box = (await form.boundingBox())!;
  if (isMobile) {
    // Phones: the column is the screen, less a 16px gutter each side.
    expect(Math.round(box.x - area.x)).toBe(16);
  } else {
    // As wide as Lumen's settings page and centred in the space beside the drawer, not pinned to its left edge.
    expect(Math.round(box.width)).toBe(920);
    expect(Math.abs(box.x - area.x - (area.x + area.width - box.x - box.width))).toBeLessThanOrEqual(2);
  }
  // Each section is a card: its heading opens one (Lumen's surface, rounded top) and sits inside the card's padding.
  const heading = form.locator('h2').first();
  const card = await heading.evaluate((h) => {
    const before = getComputedStyle(h, '::before');
    return { background: before.backgroundColor, radius: before.borderTopLeftRadius, x: h.getBoundingClientRect().x };
  });
  expect(card).toMatchObject({ background: 'rgb(24, 24, 24)', radius: '12px' });
  expect(Math.round(card.x - box.x)).toBe(isMobile ? 16 : 24);

  // Card grids use the whole width beside the drawer (jellyfin-web picks cards per row from the window's width).
  if (!isMobile) {
    await page.goto('/web/#/dashboard/plugins');
    const plugins = page.locator('#pluginsPage .content-primary');
    await expect(plugins).toBeVisible();
    const pluginsArea = (await page.locator('#pluginsPage').boundingBox())!;
    expect(Math.round((await plugins.boundingBox())!.width)).toBe(Math.round(pluginsArea.width));
  }

  // A user's tabs: a framed strip as wide as its tabs, the current tab filled; no underline.
  await page.goto('/web/#/dashboard/users');
  await page.locator('a[href*="/profile"]').first().click();
  const tabs = page.locator('#usersEditPage .MuiTabs-root');
  await expect(tabs).toHaveCSS('border-top-left-radius', '12px');
  await expect(tabs.locator('.MuiTab-root.Mui-selected')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.12)');
  await expect(tabs.locator('.MuiTabs-indicator')).toBeHidden();
  expect((await tabs.boundingBox())!.width).toBeLessThan(isMobile ? 390 : 600);
  if (!isMobile) {
    // Keyboard (and a TV remote's D-pad) focus: a ring inside the tab, where the scrolling strip doesn't clip it.
    await tabs.locator('.MuiTab-root.Mui-selected').focus();
    await page.keyboard.press('ArrowRight');
    const focused = tabs.locator('.MuiTab-root.Mui-focusVisible');
    await expect(focused).toHaveCSS('outline-style', 'solid');
    await expect(focused).toHaveCSS('outline-offset', '-2px');
  }
});

test('a form’s “Settings saved.” alert stays outside the section cards', async ({ page }) => {
  await login(page, ADMIN);
  // Networking puts the alert first in the form's stack, above the title: it must not take a slice of card.
  await page.goto('/web/#/dashboard/networking');
  await page.getByRole('button', { name: /^save$/i }).last().click();
  const alert = page.locator('.content-primary form > .MuiStack-root > .MuiAlert-root');
  await expect(alert).toBeVisible();
  expect(await alert.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
});

test('the Dashboard’s dialogs use Lumen’s fields', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/dashboard/keys');
  await page.getByRole('button', { name: 'New API Key' }).click();
  const dialog = page.locator('.MuiDialog-paper');
  await expect(dialog).toHaveCSS('border-top-left-radius', '20px');
  // jellyfin-web's underlined field becomes Lumen's boxed one (styles/stock-components.css), and still takes input.
  const field = dialog.locator('.MuiInput-root');
  await expect(field).toHaveCSS('border-top-left-radius', '12px');
  await field.locator('input').fill('lumen-e2e');
  await expect(field.locator('input')).toHaveValue('lumen-e2e');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
