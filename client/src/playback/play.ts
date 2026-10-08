import type { LumenApi } from '../api/lumenApi';
import type { BaseItem, SessionInfo } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
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

/** Starts playback in jellyfin-web's own player, which keeps resume, subtitles, device profiles, and native players. */
export async function playItem(
  api: LumenApi,
  client: JellyfinApiClient,
  itemId: string,
  startPositionTicks?: number,
): Promise<void> {
  const session = await findOwnSession(api, client);
  if (!session) throw new PlaybackError(strings.playbackFailed);
  await api.playNow(
    session.Id,
    [itemId],
    startPositionTicks && startPositionTicks > 0 ? startPositionTicks : undefined,
  );
}

export function resumeTicks(item: BaseItem): number | undefined {
  const ticks = item.UserData?.PlaybackPositionTicks ?? 0;
  return ticks > 0 ? ticks : undefined;
}
