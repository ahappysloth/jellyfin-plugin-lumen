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

/**
 * Starts playback in jellyfin-web's own player, which keeps resume, subtitles, device profiles, native players and
 * next-episode autoplay.
 *
 * The player is called directly in this tab. Asking the server to send PlayNow to "this browser's session" is only a
 * fallback (no playback manager or server id): every tab of a browser shares one device id, so the server delivers
 * the command to whichever tab owns the session's websocket, which may not be the one the user clicked in.
 */
export async function playItem(
  api: LumenApi,
  client: JellyfinApiClient,
  itemId: string,
  startPositionTicks?: number,
  manager: PlaybackManager | null = getPlaybackManager(),
): Promise<void> {
  const ticks = startPositionTicks && startPositionTicks > 0 ? startPositionTicks : undefined;
  const serverId = client.serverId?.();
  if (manager?.play && serverId) {
    try {
      await manager.play({ ids: [itemId], startPositionTicks: ticks, serverId });
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
