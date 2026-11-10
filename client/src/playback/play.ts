import type { LumenApi } from '../api/lumenApi';
import type { BaseItem, SessionInfo } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { getPlaybackManager, type PlaybackManager } from '../compat/playbackManager';
import { strings } from '../strings';

export class PlaybackError extends Error {}

const normalizeId = (id: string | null | undefined): string => (id ?? '').replace(/-/g, '').toLowerCase();

/**
 * This browser's own session. ApiClient.deviceId() is URL-encoded but the server stores the decoded form, so try
 * the decoded value first, then the raw one. More than one match (e.g. ambiguous tabs) fails closed.
 */
export async function findOwnSession(api: LumenApi, client: JellyfinApiClient): Promise<SessionInfo | null> {
  const raw = client.deviceId();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep the raw value
  }
  const userId = normalizeId(client.getCurrentUserId());
  for (const deviceId of new Set([decoded, raw])) {
    const sessions = await api.getSessions(deviceId);
    const mine = sessions.filter(
      (s) => s.DeviceId === deviceId && (!s.UserId || normalizeId(s.UserId) === userId),
    );
    if (mine.length === 1) return mine[0] ?? null;
    if (mine.length > 1) return null;
  }
  return null;
}

/** Types jellyfin-web plays as they are. It expands a Series, Season, BoxSet or folder into its episodes or children. */
const PLAYABLE_AS_IS = new Set(['Movie', 'Episode', 'Video']);

/**
 * Whether jellyfin-web can be handed this item instead of its id, which saves the GET /Users/{u}/Items/{id} it
 * otherwise makes before anything else (playbackmanager.js getItemsForPlayback). Only a single-item fetch
 * (LumenApi.getItem) qualifies: it has every field the player reads. Chapters, MediaSources and Trickplay are left
 * out of list queries unless asked for (an empty list or map when asked for and there are none), and everything else
 * it reads (Type, MediaType, ServerId, PartCount, LocationType, IsPlaceHolder, SeriesId, RunTimeTicks, image tags) is
 * always sent. A card's item from a row or grid query goes by id.
 */
export function canPlayAsIs(item: BaseItem, serverId: string): boolean {
  return (
    PLAYABLE_AS_IS.has(item.Type) &&
    item.MediaType === 'Video' &&
    !item.IsFolder &&
    item.ServerId === serverId &&
    Array.isArray(item.Chapters) &&
    Array.isArray(item.MediaSources) &&
    item.MediaSources.length > 0 &&
    item.Trickplay != null &&
    typeof item.Trickplay === 'object'
  );
}

/**
 * Starts playback in jellyfin-web's own player, which keeps resume, subtitles, device profiles, native players and
 * next-episode autoplay.
 *
 * The player is called directly in this tab. Asking the server to send PlayNow to "this browser's session" is only a
 * fallback (no playback manager or server id): every tab of a browser shares one device id, so the server delivers
 * the command to whichever tab owns the session's websocket, which may not be the one the user clicked in.
 *
 * `target` is the item, when the caller has it, or its id. A fully loaded movie, episode or video is handed to the
 * player as it is (canPlayAsIs), anything else by id.
 */
export async function playItem(
  api: LumenApi,
  client: JellyfinApiClient,
  target: BaseItem | string,
  startPositionTicks?: number,
  manager: PlaybackManager | null = getPlaybackManager(),
): Promise<void> {
  const itemId = typeof target === 'string' ? target : target.Id;
  const ticks = startPositionTicks && startPositionTicks > 0 ? startPositionTicks : undefined;
  const serverId = client.serverId?.();
  if (manager?.play && serverId) {
    // A copy: jellyfin-web writes its queue state (PlaylistItemId, playOptions) onto the items it's given.
    const what =
      typeof target !== 'string' && canPlayAsIs(target, serverId)
        ? { items: [{ ...target }] }
        : { ids: [itemId] };
    try {
      await manager.play({ ...what, startPositionTicks: ticks, serverId });
    } catch {
      throw new PlaybackError(strings.playbackFailed);
    }
    return;
  }

  const userId = client.getCurrentUserId();
  const session = await findOwnSession(api, client);
  if (!session) throw new PlaybackError(strings.playbackFailed);
  // Signed out (or switched user) while looking up the session: don't start anything in the new session.
  if (!userId || client.getCurrentUserId() !== userId) throw new PlaybackError(strings.playbackFailed);
  await api.playNow(session.Id, [itemId], ticks);
}

export function resumeTicks(item: BaseItem): number | undefined {
  const ticks = item.UserData?.PlaybackPositionTicks ?? 0;
  return ticks > 0 ? ticks : undefined;
}
