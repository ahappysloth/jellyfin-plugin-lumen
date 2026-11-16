import type { BaseItem } from '../../api/types';
import { detailsHash, HOME_HASH, navigateTo, replaceWith } from '../../compat/jellyfin';
import type { PlaybackManager } from '../../compat/playbackManager';
import { STOCK_ROUTES } from '../../compat/registry';
import { showToast } from '../../components/Toast';
import { startPlayback } from '../../playback/startPlayback';
import { strings } from '../../strings';
import { parseRoute } from '../../takeover/routes';
import type { ViewContext } from '../context';
import { playerStrings } from './playerStrings';

/**
 * The address while a title plays: its details URL with /video added, #/details/video?id=…&serverId=…. jellyfin-web's
 * player is its #/video route, and stays it: Lumen swaps the address bar's URL with history.replaceState, which
 * jellyfin-web's router doesn't follow (it reads the URL on popstate only, and compares its own location when it opens
 * the player again for the next episode). jellyfin-web has no page at /details/video, so a reload there is a page
 * of its own (routes.ts takes it for the player) that Lumen starts again (restorePlayback), and that a reload on #/video
 * never was: jellyfin-web sends that one home. The id stays a query parameter of its own, read as the details page's
 * is; `#/details?id=…/video` would hand jellyfin-web's details page an id it can't find.
 */
export function playerHash(itemId: string, serverId?: string | null): string {
  return detailsHash(itemId, serverId ?? undefined).replace('?', `${STOCK_ROUTES.video}?`);
}

const PLAYER_URL = new RegExp(`^#!?${STOCK_ROUTES.details}${STOCK_ROUTES.video}\\?`, 'i');
const ITEM_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;

/** The item a title's player URL names; null for #/video or any other address. */
export function playerUrlItem(hash: string): string | null {
  if (!PLAYER_URL.test(hash)) return null;
  const id = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('id');
  return id && ITEM_ID.test(id) ? id : null;
}

/** sessionStorage: where the video was as the page went, `[itemId, ticks]`, for this tab's reload. */
const POSITION_KEY = 'lmnPosition';

/**
 * Where the video is as the page goes (PlayerView). The server keeps a resume point too, but not in a title's first 5%,
 * nor in one under 5 minutes, and not if the report doesn't arrive: a reload in this tab starts from here instead.
 */
export function rememberPosition(itemId: string, ticks: number): void {
  try {
    sessionStorage.setItem(POSITION_KEY, JSON.stringify([itemId, ticks]));
  } catch {
    // storage blocked: the server's resume point
  }
}

/** The position rememberPosition kept for `itemId` (taken: it's for one reload), else undefined. */
function rememberedPosition(itemId: string): number | undefined {
  try {
    const [id, ticks] = JSON.parse(sessionStorage.getItem(POSITION_KEY) ?? '[]') as [string?, number?];
    sessionStorage.removeItem(POSITION_KEY);
    return id === itemId && typeof ticks === 'number' ? ticks : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The player was opened at a title's player URL with nothing playing: a reload, or the URL pasted into a new tab.
 * Plays it again from where it was left (where this tab's player was as the page went, else its resume point on the
 * server, which the player also saved then: PlayerView), as the Resume button on its page does, by the same path
 * (startPlayback): the same audio and subtitle choices, intro
 * skipping and next-episode card. Its details page takes this entry's place first, so Back from the player goes there,
 * not out of the app; jellyfin-web adds the player's entry after it as playback starts, which the player names again.
 *
 * Where the browser won't start it without a click, the player opens paused at that point, Play to go on (below).
 *
 * A title that can't be found (removed, or not this user's to see) goes home with a toast. One that can't play stays
 * on its page with a toast. In Watch together the group decides what plays (starting this would change it for everyone
 * in the group): its page, and the group's playback brings the player back if it's playing.
 */
export async function restorePlayback(
  ctx: ViewContext,
  itemId: string,
  manager: PlaybackManager | null,
): Promise<void> {
  let item: BaseItem;
  try {
    item = await ctx.api.getItem(itemId);
  } catch {
    replaceWith(HOME_HASH);
    showToast(playerStrings.restoreFailed);
    return;
  }
  replaceWith(detailsHash(item.Id, item.ServerId));
  if (manager?.syncPlayEnabled) return;
  const ticks = rememberedPosition(item.Id);
  try {
    await startPlayback(
      ctx,
      ticks === undefined ? item : { ...item, UserData: { ...item.UserData, PlaybackPositionTicks: ticks } },
    );
  } catch {
    showToast(strings.playbackFailed);
    return;
  }
  // A browser that won't start a video with sound before a click (after a reload, most may not): jellyfin-web's player
  // waits, paused where it was to start, and opens its page only once the video plays, leaving nothing on screen. Open
  // it: Lumen's player shows the video paused there, with its controls up and Play.
  const video = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  if (video?.paused && parseRoute(location.hash).kind !== 'player') navigateTo(`#${STOCK_ROUTES.video}`);
}
