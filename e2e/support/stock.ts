import { expect, type Locator } from '@playwright/test';

/**
 * Asserts a stock jellyfin-web element is in the page but hidden (by Lumen's CSS). `toBeHidden()` alone also passes
 * when nothing matches, so a renamed selector would go unnoticed while jellyfin-web's own UI shows through Lumen's.
 */
export async function expectPresentButHidden(locator: Locator): Promise<void> {
  await expect(locator, 'the stock element should exist (has jellyfin-web renamed it?)').not.toHaveCount(0);
  for (const element of await locator.all()) await expect(element).toBeHidden();
}

/**
 * Asserts jellyfin-web's D-pad can't move focus to any button in a stock element Lumen hides without `display: none`
 * (its focusManager.js): `nav()` goes to the nearest candidate that has a box, visible or not, and `autoFocus()`, with
 * nothing focused, to the first that has an offsetParent. Focus doesn't land on a button nobody can see, so the press
 * would do nothing.
 */
export async function expectOutOfDpadReach(locator: Locator): Promise<void> {
  const buttons = locator.locator('button');
  await expect(buttons, 'the stock element should have its buttons (has jellyfin-web changed it?)').not.toHaveCount(0);
  const reachable = await buttons.evaluateAll((all) =>
    (all as HTMLElement[])
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 || box.height > 0 || el.offsetParent !== null;
      })
      .map((el) => el.className),
  );
  expect(reachable, "stock buttons jellyfin-web's D-pad would try to focus").toEqual([]);
}
