import { expect, type Locator, type Page } from '@playwright/test';

/** Below this width Lumen shows the phone layout: a tab bar instead of the nav pill (styles/nav.css). */
const PHONE_MAX_WIDTH = 910;

/**
 * A destination in Lumen's nav, whichever layout is showing: the "Main" pill on wide screens, or on phones (below
 * 910px) the tab bar and the search button above it. The other layout's copies are display:none, so out of reach.
 */
export function navLink(page: Page, name: 'Movies' | 'Favorites' | 'Search'): Locator {
  return page.locator('#lmn-root .lmn-nav').getByRole('link', { name: new RegExp(`^${name}$`) });
}

/** The account button in the wide layout's nav pill (it opens the account menu). */
export function accountButton(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Account/ });
}

/** The open account menu. */
export function accountMenu(page: Page): Locator {
  return page.getByRole('menu', { name: 'Account' });
}

/**
 * Opens Lumen's settings menu (#/mypreferencesmenu): the account menu's Settings on wide screens, the Me tab on
 * phones.
 */
export async function openSettingsMenu(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1280) < PHONE_MAX_WIDTH) {
    await page.locator('#lmn-root .lmn-tabbar').getByRole('link', { name: 'Me', exact: true }).click();
    return;
  }
  await accountButton(page).click();
  await accountMenu(page).getByRole('menuitem', { name: 'Settings', exact: true }).click();
}

const NAVS = /^(Main|Tabs)$/;

/** Lumen's nav, whichever layout is showing: the "Main" pill on wide screens, or the "Tabs" bar on phones. */
export function lumenNav(page: Page): Locator {
  return page.locator('#lmn-root').getByRole('navigation', { name: NAVS }).filter({ visible: true });
}

/**
 * Lumen's nav isn't on the page in either layout. (Checking only the "Main" pill would pass on a phone for the wrong
 * reason: there it's in the DOM but display:none.)
 */
export async function expectNoLumenNav(page: Page): Promise<void> {
  await expect(page.locator('#lmn-root').getByRole('navigation', { name: NAVS, includeHidden: true })).toHaveCount(0);
}
