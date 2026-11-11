import { expect, type Locator, type Page } from '@playwright/test';

/** Where the phone layout puts what the wide layout's nav pill calls `name` (the rest keep their names). */
const PHONE_NAMES: Record<string, string> = { 'Settings and profile': 'Me' };

/**
 * A destination in Lumen's nav, whichever layout is showing: the "Main" pill on wide screens, or on phones (below
 * 910px) the tab bar and the search button above it. The other layout's copies are display:none, so out of reach.
 */
export function navLink(page: Page, name: 'Movies' | 'Favorites' | 'Search' | 'Settings and profile'): Locator {
  const names = new Set([name, PHONE_NAMES[name] ?? name]);
  return page
    .locator('#lmn-root .lmn-nav')
    .getByRole('link', { name: new RegExp(`^(${[...names].join('|')})$`) });
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
