import type { JellyfinApiClient } from '../compat/jellyfin';
import { withTimeout } from '../util/withTimeout';

/**
 * Restarting Jellyfin and waiting for it to come back. Shared by Lumen's settings page (UpdatesSettings.tsx, in the
 * admin bundle) and the restart banner on jellyfin-web's admin pages (takeover/RestartBanner.tsx, its own chunk), so
 * it imports nothing else of either.
 */

/** Where a restart has got to: down while Jellyfin doesn't answer; up, with whether a restart is still pending. */
export type ServerState = { up: false } | { up: true; restartPending: boolean };

/** POST /System/Restart (admins only). */
export async function restartServer(client: JellyfinApiClient): Promise<void> {
  await client.ajax({ type: 'POST', url: client.getUrl('System/Restart') });
}

export async function serverState(client: JellyfinApiClient): Promise<ServerState> {
  try {
    const info = (await client.ajax({
      type: 'GET',
      url: client.getUrl('System/Info'),
      dataType: 'json',
    })) as { HasPendingRestart?: boolean };
    return { up: true, restartPending: !!info.HasPendingRestart };
  } catch {
    return { up: false };
  }
}

/** How often a restart is checked on, and how long before giving up on it coming back. */
export const RESTART_POLL_MS = 2000;
export const RESTART_TIMEOUT_MS = 180_000;

/** A status check that hasn't answered after this long is given up on; it says nothing either way. */
const STATE_TIMEOUT_MS = 10_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves true once Jellyfin is back from a restart: it stopped answering and answers again, or it answers and no
 * longer has a restart pending (a restart quicker than one poll). False after `timeoutMs`, measured on the clock so a
 * status check that hangs mid-restart can't stretch it.
 */
export async function waitForRestart(
  api: { serverState(): Promise<ServerState> },
  pollMs = RESTART_POLL_MS,
  timeoutMs = RESTART_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let wentDown = false;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // A busy Jellyfin can be slow just before it restarts, so a check that times out doesn't count as it going down.
    const state = await withTimeout(api.serverState(), Math.min(STATE_TIMEOUT_MS, remaining)).catch(
      () => null,
    );
    if (!state) continue;
    if (!state.up) wentDown = true;
    else if (wentDown || !state.restartPending) return true;
  }
  return false;
}
