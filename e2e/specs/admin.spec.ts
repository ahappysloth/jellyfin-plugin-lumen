import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, BASE_URL, loadState, resetLumen } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';

/** Moves a home section one place down from the keyboard: Enter on its handle picks it up, ↓ moves it, Enter puts it down. */
async function moveDown(page: Page, root: Locator, name: string): Promise<void> {
  const handle = root.getByRole('button', { name: `Move ${name}`, exact: true });
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(handle).toHaveAttribute('aria-pressed', 'false');
}

test('the Lumen dashboard page loads its settings, its script addressed by Lumen’s version', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  const scripts: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/Lumen/Assets/lumen-admin.js')) scripts.push(r.url());
  });

  await page.goto('/web/#/configurationpage?name=Lumen');

  await expect(page.getByRole('group', { name: 'Home sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Continue Watching', exact: true })).toBeVisible();
  // With the version in its address, a cache in front of Jellyfin can't keep an old settings page past an update; the
  // version is the one lumen.js is loaded with.
  const version = await page.locator('meta[name="lumen-version"]').getAttribute('content');
  expect(version).toBeTruthy();
  expect(scripts).toContain(new URL(`/Lumen/Assets/lumen-admin.js?v=${version}`, BASE_URL).toString());
  await expect(page.locator('[id="lmn-admin-root"]')).toHaveCount(1);
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
    await moveDown(page, root, 'Continue Watching');
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

test('Discard in the save bar drops unsaved changes, and nothing reaches the server', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const bar = root.locator('.lmna-savebar');
  const address = root.getByLabel('Seerr address');
  const sections = () =>
    root.locator('.lmna-section__name').evaluateAll((els) => els.map((el) => el.firstChild?.textContent));
  await expect(root.getByRole('group', { name: 'Home sections' })).toBeVisible();
  const loadedAddress = await address.inputValue();
  const loadedSections = await sections();

  try {
    await address.fill('http://discard-me:5055');
    await moveDown(page, root, 'Continue Watching');
    expect(await sections()).not.toEqual(loadedSections);
    await expect(bar).toContainText('Unsaved changes');
    // From the keyboard: Safari doesn't focus a tapped or clicked button, so there'd be no focus to look after.
    await bar.getByRole('button', { name: 'Discard' }).focus();
    await page.keyboard.press('Enter');

    await expect(address).toHaveValue(loadedAddress);
    expect(await sections()).toEqual(loadedSections);
    await expect(bar).toBeHidden();
    // The bar went from under the focus: it's on the page's heading, not lost.
    await expect(root.getByRole('heading', { level: 1, name: 'Lumen' })).toBeFocused();

    await page.reload();
    await expect(root.getByRole('group', { name: 'Home sections' })).toBeVisible();
    await expect(address).toHaveValue(loadedAddress);
    expect(await sections()).toEqual(loadedSections);
    await expect(bar).toBeHidden();
  } finally {
    await resetLumen();
  }
});

test('a change undone by hand takes the save bar away again', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const bar = root.locator('.lmna-savebar');
  const toggle = root.getByRole('switch', { name: 'Replace the home screen' });
  await expect(toggle).toBeVisible();
  const loaded = await toggle.isChecked();

  await toggle.click();
  await expect(toggle).toBeChecked({ checked: !loaded });
  await expect(bar).toContainText('Unsaved changes');
  await expect(bar).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: loaded });
  await expect(bar).toBeHidden();
  await expect(root.getByRole('status')).toHaveText('');
});

/** The settings page's Home sections card, its rows' names in order, and its announcements. */
async function openSections(page: Page) {
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const card = root.getByRole('group', { name: 'Home sections' });
  await expect(card).toBeVisible();
  return {
    root,
    card,
    bar: root.locator('.lmna-savebar'),
    names: () => card.locator('.lmna-section__label').allTextContents(),
    announced: card.locator('[aria-live="assertive"]'),
    handle: (name: string) => card.getByRole('button', { name: `Move ${name}`, exact: true }),
    row: (name: string) => card.locator('.lmna-section').filter({ has: page.getByRole('button', { name: `Move ${name}`, exact: true }) }),
  };
}

/** Where to point to drop a dragged row before (`at` 0.25) or after (0.75) another row. */
async function pointOver(row: Locator, at: number): Promise<number> {
  const box = (await row.boundingBox())!;
  return box.y + box.height * at;
}

test('Home sections are dragged into a new order by their handles, and dragged back is no change', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  const { card, bar, names, announced, handle, row } = await openSections(page);
  const loaded = await names();
  expect(loaded.indexOf('Continue Watching')).toBeLessThan(loaded.indexOf('Next Up'));
  // The list in view, under the header.
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
  const drop = card.locator('.lmna-sections__drop');

  const drag = async (name: string, to: () => Promise<number>, finish: 'drop' | 'escape' = 'drop') => {
    const box = (await handle(name).boundingBox())!;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, await to(), { steps: 10 });
    // The row follows the pointer, a line shows where it would land.
    await expect(row(name)).toHaveClass(/\bis-dragging\b/);
    await expect(drop).toBeVisible();
    // Once the others have slid apart: between two rows, never across one.
    await expect
      .poll(async () => {
        const line = (await drop.boundingBox())!;
        const middle = line.y + line.height / 2;
        const across = [];
        for (const other of await card.locator('.lmna-section:not(.is-dragging)').all()) {
          const box = (await other.boundingBox())!;
          if (middle > box.y + 1 && middle < box.y + box.height - 1) across.push(await other.textContent());
        }
        return across;
      })
      .toEqual([]);
    if (finish === 'escape') await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(row(name)).not.toHaveClass(/\bis-dragging\b/);
    await expect(drop).toHaveCount(0);
  };

  try {
    // Below Next Up's middle: after it.
    await drag('Continue Watching', () => pointOver(row('Next Up'), 0.75));
    const moved = await names();
    expect(moved.indexOf('Continue Watching')).toBe(moved.indexOf('Next Up') + 1);
    await expect(announced).toHaveText(`Continue Watching moved to position ${moved.indexOf('Continue Watching') + 1} of ${moved.length}.`);
    await expect(bar).toContainText('Unsaved changes');

    // Escape mid-drag leaves it where it was.
    await drag('Continue Watching', () => pointOver(card.locator('.lmna-section').first(), 0.25), 'escape');
    expect(await names()).toEqual(moved);
    await expect(announced).toHaveText(/^Move cancelled\./);

    // Above Next Up's middle: back before it, which is no change at all.
    await drag('Continue Watching', () => pointOver(row('Next Up'), 0.25));
    expect(await names()).toEqual(loaded);
    await expect(bar).toBeHidden();
  } finally {
    await resetLumen();
  }
});

test('a finger drags a Home section by its handle, and the page doesn’t scroll under it', async ({ page, browserName }) => {
  // Touch is sent through Chromium's DevTools protocol, as a phone's would be (WebKit's iPhone in Playwright has taps only).
  test.skip(browserName !== 'chromium', 'touch input through the DevTools protocol');
  await login(page, ADMIN);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const { card, names, handle, row, bar } = await openSections(page);
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
  const loaded = await names();
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

  try {
    const box = (await handle('My Requests').boundingBox())!;
    const x = box.x + box.width / 2;
    const from = box.y + box.height / 2;
    const to = await pointOver(row('Next Up'), 0.75);
    const scrolled = await page.evaluate(() => window.scrollY);
    await touch('touchStart', x, from);
    for (let i = 1; i <= 10; i++) await touch('touchMove', x, from + ((to - from) * i) / 10);
    await expect(row('My Requests')).toHaveClass(/\bis-dragging\b/);
    // Not by the swipe's 150-odd pixels (touch-action: none on the handle); a pixel of layout is neither here nor there.
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled)).toBeLessThan(4);
    await touch('touchEnd', x, to);

    const moved = await names();
    expect(moved.indexOf('My Requests')).toBe(moved.indexOf('Next Up') + 1);
    expect(moved).not.toEqual(loaded);
    await expect(bar).toContainText('Unsaved changes');
  } finally {
    await resetLumen();
  }
});

test('a mouse drag the window loses (alt-tab) is cancelled, and one cancelled with Escape picks nothing up when let go', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'a mouse drag');
  await login(page, ADMIN);
  const { card, names, announced, handle, row } = await openSections(page);
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
  const loaded = await names();
  const name = loaded[2]!;
  const box = (await handle(name).boundingBox())!;
  const x = box.x + box.width / 2;
  const start = async () => {
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, await pointOver(card.locator('.lmna-section').first(), 0.25), { steps: 8 });
    await expect(row(name)).toHaveClass(/\bis-dragging\b/);
  };

  // The window loses focus mid-drag (alt-tab, the release then lands elsewhere): back where it was, and moving the
  // mouse after drags nothing.
  await start();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(row(name)).not.toHaveClass(/\bis-dragging\b/);
  await expect(announced).toHaveText(`Move cancelled. ${name} is back at position 3 of ${loaded.length}.`);
  await page.mouse.move(x, box.y - 60, { steps: 4 });
  await expect(card.locator('.lmna-sections__drop')).toHaveCount(0);
  await page.mouse.up();
  expect(await names()).toEqual(loaded);

  // Escape, then back over its own handle and let go: the click that ends it doesn't pick the row up.
  await start();
  await page.keyboard.press('Escape');
  await page.mouse.move(x, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(handle(name)).toHaveAttribute('aria-pressed', 'false');
  expect(await names()).toEqual(loaded);
  // A click of its own does.
  await handle(name).click();
  await expect(handle(name)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
});

test('dragging a Home section near the window’s bottom edge scrolls the page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a mouse drag');
  await page.setViewportSize({ width: 1280, height: 560 });
  await login(page, ADMIN);
  const { card, names, handle } = await openSections(page);
  const loaded = await names();
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
  const box = (await handle(loaded[0]!).boundingBox())!;
  const x = box.x + box.width / 2;
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, 560 - 8, { steps: 8 });
  // Held there, the page keeps scrolling.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await names()).toEqual(loaded);
});

test('Home sections: picked up from the keyboard, moved with the arrows and announced; renamed in place; described in a tooltip', { tag: '@smoke' }, async ({
  page,
  isMobile,
}) => {
  await login(page, ADMIN);
  const { card, bar, names, announced, handle, row } = await openSections(page);
  const loaded = await names();
  const at = loaded.indexOf('Next Up');

  try {
    // The keyboard: Enter picks it up, the arrows move it, Escape puts it back.
    await handle('Next Up').focus();
    await page.keyboard.press('Enter');
    await expect(handle('Next Up')).toHaveAttribute('aria-pressed', 'true');
    await expect(announced).toContainText(`Next Up picked up, position ${at + 1} of ${loaded.length}.`);
    await page.keyboard.press('ArrowDown');
    await expect(announced).toHaveText(`Next Up moved to position ${at + 2} of ${loaded.length}.`);
    await expect(handle('Next Up')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(announced).toHaveText(`Next Up moved to position ${at + 3} of ${loaded.length}.`);
    expect((await names()).indexOf('Next Up')).toBe(at + 2);
    await page.keyboard.press('Escape');
    await expect(announced).toHaveText(`Move cancelled. Next Up is back at position ${at + 1} of ${loaded.length}.`);
    expect(await names()).toEqual(loaded);
    await expect(bar).toBeHidden();

    // Renamed in place: the pencil shows on hover (or, on a phone, once the name is tapped).
    const pencil = card.getByRole('button', { name: 'Rename Next Up' });
    if (isMobile) await row('Next Up').locator('.lmna-section__label').tap();
    else await row('Next Up').locator('.lmna-section__label').hover();
    await expect(pencil).toHaveCSS('opacity', '1');
    await pencil.click();
    const field = card.getByRole('textbox', { name: 'Name for Next Up' });
    await expect(field).toBeFocused();
    await field.fill('Up next');
    await field.press('Enter');
    await expect(row('Up next').locator('.lmna-section__label')).toHaveText('Up next');
    await expect(row('Up next').locator('small')).toHaveText('Next Up');
    await expect(bar).toContainText('Unsaved changes');
    // Emptied, it's the type's name again: no change left.
    if (isMobile) await row('Up next').locator('.lmna-section__label').tap();
    await card.getByRole('button', { name: 'Rename Up next' }).click();
    await card.getByRole('textbox', { name: 'Name for Next Up' }).fill('');
    await card.getByRole('textbox', { name: 'Name for Next Up' }).press('Enter');
    await expect(row('Next Up').locator('.lmna-section__label')).toHaveText('Next Up');
    await expect(bar).toBeHidden();

    // What it shows, in a tooltip: pointed at, or tapped. Inside the window.
    const info = card.getByRole('button', { name: 'About Next Up' });
    const tip = card.getByRole('tooltip');
    await expect(tip).toHaveCount(0);
    if (isMobile) await info.tap();
    else await info.hover();
    await expect(tip).toBeVisible();
    await expect(tip).not.toBeEmpty();
    await expect(info).toHaveAccessibleDescription(await tip.innerText());
    const box = (await tip.boundingBox())!;
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    if (isMobile) await card.locator('.lmna-card__intro').tap();
    else await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);

    // Settings open under the row with its chevron; closed to begin with.
    const chevron = card.getByRole('button', { name: 'Recently Added in Movies settings' });
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await chevron.click();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(row('Recently Added in Movies').locator('.lmna-section__body')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Next Up settings' })).toHaveCount(0);
  } finally {
    await resetLumen();
  }
});

test('TV layout: the D-pad reaches every control of the Home sections card, and moves a section with OK and the arrows', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  const { card, bar, names, handle, row } = await openSections(page);
  const loaded = await names();
  // One row's settings open, so its fields are part of the walk.
  await card.getByRole('button', { name: 'Recently Added in Movies settings' }).click();
  await card.evaluate((el) => el.setAttribute('data-walk', ''));
  // Not the tab strip: Right there opens the Storage tab, which would hide the card halfway through the walk (the tabs'
  // own D-pad test is above).
  await page.locator('[id="lmn-admin-root"]:visible [role="tab"]').evaluateAll((tabs) =>
    tabs.forEach((tab) => ((tab as HTMLButtonElement).disabled = true)),
  );

  const { controls, unreachable } = await walkDpad(page, handle(loaded[0]!), '[data-walk]');
  // Each row's handle, rename, ⓘ, switch and remove at least.
  expect(controls.length).toBeGreaterThan(loaded.length * 5);
  expect(unreachable.map((c) => c.name)).toEqual([]);

  try {
    // OK picks Continue Watching up, Down moves it (focus stays on it), OK puts it down.
    const at = loaded.indexOf('Continue Watching');
    await handle('Continue Watching').focus();
    await expect(handle('Continue Watching')).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');
    await expect(handle('Continue Watching')).toHaveAttribute('aria-pressed', 'true');
    await expect(row('Continue Watching')).toHaveClass(/\bis-moving\b/);
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await names()).indexOf('Continue Watching')).toBe(at + 1);
    await expect(handle('Continue Watching')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(handle('Continue Watching')).toHaveAttribute('aria-pressed', 'false');
    await expect(bar).toContainText('Unsaved changes');
    // Put down, Down is the D-pad's again: on to the row below, which stays where it is.
    await page.keyboard.press('ArrowDown');
    await expect(handle('Continue Watching')).not.toBeFocused();
    expect((await names()).indexOf('Continue Watching')).toBe(at + 1);
  } finally {
    await resetLumen();
  }
});

test('Settings and Storage are tabs: Storage loads when first opened, and the tab is kept across a reload', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  const storageCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/Lumen\/Admin\/Storage/.test(r.url())) storageCalls.push(r.url());
  });
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const tabs = root.getByRole('tablist', { name: 'Lumen' });
  const settings = tabs.getByRole('tab', { name: 'Settings' });
  const storage = tabs.getByRole('tab', { name: 'Storage' });
  await expect(settings).toHaveAttribute('aria-selected', 'true');
  await expect(root.getByRole('group', { name: 'Home sections' })).toBeVisible();
  // The strip Lumen gives the Dashboard's tabs: framed, the open tab filled.
  await expect(tabs).toHaveCSS('border-top-left-radius', '12px');
  await expect(settings).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(storage).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // Opening the page for a setting doesn't measure storage.
  await expect(root.getByRole('group', { name: 'Storage' })).toHaveCount(0);
  expect(storageCalls).toEqual([]);

  try {
    // A change made first is kept, with the bar, on the Storage tab.
    await moveDown(page, root, 'Continue Watching');
    await storage.click();
    await expect(storage).toHaveAttribute('aria-selected', 'true');
    // Not in the URL: jellyfin-web keeps a page it has left by its exact URL (see the Back check below).
    await expect(page).toHaveURL(/configurationpage\?name=Lumen$/);
    await expect(root.getByRole('group', { name: 'Storage' })).toBeVisible();
    await expect.poll(() => storageCalls.length).toBeGreaterThan(0);
    await expect(root.getByRole('group', { name: 'Home sections' })).toBeHidden();
    await expect(root.getByRole('button', { name: 'Reset to defaults' })).toBeHidden();
    const bar = root.locator('.lmna-savebar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Unsaved changes on the Settings tab');

    // From the keyboard: arrows move between the tabs.
    await storage.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(settings).toBeFocused();
    await expect(settings).toHaveAttribute('aria-selected', 'true');
    await expect(root.getByRole('button', { name: 'Move Continue Watching', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(storage).toBeFocused();

    // Leaving for another page and coming Back finds the page as it was: the change, the bar and the tab.
    await page.evaluate(() => (window.location.hash = '#/dashboard'));
    await expect(page).toHaveURL(/#\/dashboard$/);
    await page.goBack();
    await expect(page).toHaveURL(/configurationpage\?name=Lumen$/);
    await expect(root.getByRole('tab', { name: 'Storage' })).toHaveAttribute('aria-selected', 'true');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Unsaved changes on the Settings tab');
    await bar.getByRole('button', { name: 'Discard' }).click();
    await expect(bar).toBeHidden();

    // One copy of the page, and a reload comes back to the tab.
    await expect(page.locator('[id="lmn-admin-root"]')).toHaveCount(1);
    await page.reload();
    await expect(root.getByRole('tab', { name: 'Storage' })).toHaveAttribute('aria-selected', 'true');
    await expect(root.getByRole('group', { name: 'Storage' })).toBeVisible();
    await root.getByRole('tab', { name: 'Settings' }).click();
    await expect(root.getByRole('group', { name: 'Home sections' })).toBeVisible();
  } finally {
    await resetLumen();
  }
});

test('TV layout: the D-pad reaches Lumen’s settings tabs and moves between them', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const settings = root.getByRole('tab', { name: 'Settings' });
  const storage = root.getByRole('tab', { name: 'Storage' });
  await expect(settings).toBeVisible();

  // Down from the header's Back button, to the open tab.
  await page.getByRole('button', { name: 'Back', exact: true }).first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(settings).toBeFocused();
  await expect(settings).toHaveCSS('outline-style', 'solid');
  // The strip holds Left and Right (a focuscontainer-x): Left from the first tab stays, rather than going to the drawer.
  await page.keyboard.press('ArrowLeft');
  await expect(settings).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(storage).toBeFocused();
  await expect(storage).toHaveAttribute('aria-selected', 'true');
  // Not round from the end: Right again stays on Storage.
  await page.keyboard.press('ArrowRight');
  await expect(storage).toBeFocused();
  await expect(storage).toHaveAttribute('aria-selected', 'true');
  // Down into the tab, and Up back to it.
  const card = root.getByRole('group', { name: 'Storage' });
  await expect(card.getByText(/^Computed /)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => card.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('ArrowUp');
  await expect(storage).toBeFocused();
});

test('the Dashboard wears Lumen’s look, and only on admin pages', async ({ page, isMobile }) => {
  await login(page, ADMIN);
  const html = page.locator('html');
  // Lumen's own pages carry jellyfin-web's dialogs' and menus' look, not the admin pages' (lazy-loading.spec.ts).
  await expect(page.locator('link[href*="lumen-stock.css"]')).toHaveCount(1);
  await expect(page.locator('link[href*="lumen-dashboard.css"]')).toHaveCount(0);
  // The server's accent comes with the page, so the admin pages have it at first paint.
  expect(await page.locator('style').allTextContents()).toContain('html[data-lmn-skin]{--lmn-accent:#e30b17}');

  await page.goto('/web/#/dashboard');
  await expect(html).toHaveClass(/\blmn-skin-dashboard\b/);
  await expect(page.locator('link[href*="lumen-dashboard.css"]')).toHaveCount(1);
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

/** Lumen's Storage tab with a fresh storage report: the cached one may be from before this run's library scan. */
async function openStorage(page: Page): Promise<Locator> {
  await page.goto('/web/#/configurationpage?name=Lumen&tab=storage');
  const card = page.locator('[id="lmn-admin-root"]:visible').getByRole('group', { name: 'Storage' });
  const refresh = card.getByRole('button', { name: 'Refresh' });
  await expect(refresh).toBeEnabled({ timeout: 30_000 });
  await refresh.click();
  await expect(refresh).toBeEnabled({ timeout: 30_000 });
  await expect(card.getByText(/^Computed /)).toBeVisible();
  return card;
}

test('the Storage card shows space by library, codec and resolution, and links the biggest titles', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  const card = await openStorage(page);
  const { items } = loadState();

  // The fixtures (scripts/gen-test-media.sh): 8 movies and 6 episodes, all VP9 at 640×360. Their trailers aren't counted.
  await expect(card.locator('.lmna-storage__total')).toContainText('in 14 files');
  const codecs = card.getByRole('table', { name: 'By codec' });
  await expect(codecs.getByRole('row', { name: /^Other/ })).toContainText(/14\s*100%/);
  await expect(codecs.getByRole('row', { name: /^H\.264/ })).toContainText(/0 B\s*0\s*0%/);
  const resolutions = card.getByRole('table', { name: 'By resolution' });
  await expect(resolutions.getByRole('row', { name: /^SD/ })).toContainText(/14\s*100%/);
  await expect(resolutions.getByRole('row', { name: /^1080p/ })).toContainText(/0 B\s*0\s*0%/);
  // No H.264 to re-encode, and no HDR.
  await expect(card.locator('.lmna-storage__tile--pool')).toContainText('0 B in 0 files');
  // Outside the TV layout the numbers aren't Tab stops of their own.
  await expect(codecs).not.toHaveAttribute('tabindex');
  await expect(card.locator('.lmna-storage .focusable')).toHaveCount(0);

  // Per library, with the same split.
  await expect(card.getByRole('img', { name: /^Movies by codec: Other [\d.]+ [KM]B, 8 files$/ })).toBeVisible();
  await expect(card.getByRole('img', { name: /^Movies by resolution: SD [\d.]+ [KM]B, 8 files$/ })).toBeVisible();
  await expect(card.getByRole('img', { name: /^Shows by codec: Other [\d.]+ [KM]B, 6 files$/ })).toBeVisible();

  // The biggest titles link to their details pages.
  const movies = card.getByRole('region', { name: 'Biggest movies' }).getByRole('link');
  await expect(movies).toHaveCount(8);
  const alpha = card.getByRole('link', { name: 'Lumen Alpha (2001)' });
  await expect(alpha).toHaveAttribute('href', `#/details?id=${items['Lumen Alpha']}`);
  await expect(alpha.locator('xpath=ancestor::li')).toContainText('VP9 · SD');
  const show = card.getByRole('region', { name: 'Biggest shows' }).getByRole('link', { name: 'Lumen Show' });
  await expect(show).toHaveAttribute('href', `#/details?id=${items['Lumen Show']}`);
  // An uncommon codec goes by its name, not "Other".
  await expect(show.locator('xpath=ancestor::li')).toContainText('6 episodes · VP9');

  // Nothing wider than the screen, phones included.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await alpha.click();
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${items['Lumen Alpha']}`));
  await expect(page.locator('#lmn-root')).toContainText('Lumen Alpha');
});

test('a storage bar’s part shows its numbers in a tooltip, inside the window', { tag: '@smoke' }, async ({ page, isMobile }) => {
  await login(page, ADMIN);
  const card = await openStorage(page);
  const bar = card.getByRole('img', { name: /^Movies by codec: Other [\d.]+ [KM]B, 8 files$/ });
  const tip = card.locator('.lmna-tip');
  await expect(tip).toHaveCount(0);

  // A mouse points at it; a finger taps it.
  if (isMobile) await bar.tap();
  else await bar.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(/^Other · [\d.]+ [KM]B · 8 files · 100% of Movies$/);
  // For the eye only: the bar's name already reads it out.
  await expect(tip).toHaveAttribute('aria-hidden', 'true');
  const box = (await tip.boundingBox())!;
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);

  // Gone with the pointer, or with a tap elsewhere.
  if (isMobile) await card.getByRole('heading', { name: 'Libraries' }).tap();
  else await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);

  if (!isMobile) {
    // From the keyboard, the bar is a Tab stop and shows its first part.
    await bar.focus();
    await expect(tip).toHaveText(/^Other · /);
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
  }
});

test('TV layout: the Storage card’s Refresh and titles are reached with the D-pad, and OK opens a title', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  const card = await openStorage(page);
  const { items } = loadState();

  await card.getByRole('button', { name: 'Refresh' }).focus();
  // Down through the card: the numbers between Refresh and the titles are stops of their own (a remote's D-pad only
  // moves between focusable things), each library with its bars, then the biggest movies.
  await page.keyboard.press('ArrowDown');
  const table = card.locator('table:focus');
  await expect(table).toHaveCount(1); // the one under Refresh: By resolution beside By codec, or By codec on a phone
  await expect(table).toHaveCSS('outline-style', 'solid');
  const first = card.getByRole('region', { name: 'Biggest movies' }).getByRole('link').first();
  const visited: string[] = [];
  for (let i = 0; i < 12 && !(await first.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowDown');
    visited.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
  }
  expect(visited).toEqual(expect.arrayContaining(['Movies', 'Shows']));
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS('outline-style', 'solid');

  const id = (await first.getAttribute('href'))!.split('id=')[1]!;
  expect(Object.values(items)).toContain(id);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${id}`));
});

const CLIENT_HEADER = 'MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e-kid", Version="1.0.0"';

test('the Storage report is for admins only: a user (kid) and a visitor get nothing from it', async () => {
  const { kid } = loadState();
  const call = (method: string, path: string, token?: string) =>
    fetch(new URL(path, `${BASE_URL.replace(/\/$/, '')}/`), {
      method,
      headers: { Authorization: token ? `${CLIENT_HEADER}, Token="${token}"` : CLIENT_HEADER },
    });

  // The kid's token works, so a 403 below is the endpoint refusing a signed-in user, not an expired session.
  expect((await call('GET', 'Users/Me', kid.token)).status).toBe(200);

  for (const [method, path] of [
    ['GET', 'Lumen/Admin/Storage'],
    ['POST', 'Lumen/Admin/Storage/Refresh'],
  ] as const) {
    for (const [who, token, status] of [
      ['kid', kid.token, 403],
      ['nobody', undefined, 401],
    ] as const) {
      const response = await call(method, path, token);
      expect(response.status, `${method} ${path} as ${who}`).toBe(status);
      const body = await response.text();
      // No titles, sizes or paths in an error body either.
      expect(body).not.toMatch(/Lumen Alpha|\/media|BiggestMovies|Totals/);
    }
  }
});
