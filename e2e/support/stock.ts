import { expect, type Locator } from '@playwright/test';

/**
 * Asserts a stock jellyfin-web element is in the page but hidden (by Lumen's CSS). `toBeHidden()` alone also passes
 * when nothing matches, so a renamed selector would go unnoticed while jellyfin-web's own UI shows through Lumen's.
 */
export async function expectPresentButHidden(locator: Locator): Promise<void> {
  await expect(locator, 'the stock element should exist (has jellyfin-web renamed it?)').not.toHaveCount(0);
  for (const element of await locator.all()) await expect(element).toBeHidden();
}
