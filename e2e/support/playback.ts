import type { Page } from '@playwright/test';
import { api, loadState } from './api';

/**
 * Ends playback in `page`, if it's in the player, by leaving it: jellyfin-web sends its "stopped" report. A page closed
 * mid-play leaves the server to report it stopped itself, minutes later, in the middle of another spec; and one left
 * playing reports its position again after forgetPlayback() has reset it.
 */
export async function endPlayback(page: Page): Promise<void> {
  if (!/#\/video/.test(page.url())) return;
  const stopped = page
    .waitForResponse((r) => r.url().includes('/Sessions/Playing/Stopped'), { timeout: 10_000 })
    .catch(() => undefined);
  await page.goto('/web/#/home');
  await stopped;
}

/**
 * Undoes what playing `ids` in `page` left on the admin's account, so later specs (History, Continue watching) don't see
 * it: playback ends first, then each title is put back to never played (marking played, then unplayed, clears its
 * last-played date and resume point too).
 */
export async function forgetPlayback(page: Page, ids: string[]): Promise<void> {
  await endPlayback(page);
  const { admin } = loadState();
  for (const id of ids)
    for (const method of ['POST', 'DELETE'] as const)
      await api(`/UserPlayedItems/${id}`, { method, token: admin.token, query: { userId: admin.userId } });
}
