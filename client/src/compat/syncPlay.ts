/**
 * jellyfin-web's SyncPlay manager, found inside its webpack bundle like the playback manager (./playbackManager.ts).
 * The core module's default export is `{ Helper, Manager, PlayerFactory, Players }` (registry.ts SYNCPLAY_CORE_KEYS);
 * those keys survive minification, so Lumen looks for a module whose code names all of them and an export with a
 * Manager that has every method in SYNCPLAY_MANAGER_METHODS. Nothing found: Lumen shows no Watch together button.
 */
import { webpackRequire } from './playbackManager';
import { SYNCPLAY_CORE_KEYS, SYNCPLAY_MANAGER_METHODS } from './registry';
import type { JellyfinApiClient } from './jellyfin';

export interface SyncPlayGroupInfo {
  GroupId: string;
  GroupName: string;
  Participants: string[];
}

export interface SyncPlayManager {
  isSyncPlayEnabled(): boolean;
  getGroupInfo(): SyncPlayGroupInfo | null;
  isPlaylistEmpty(): boolean;
  isPlaybackActive(): boolean;
  resumeGroupPlayback(apiClient: JellyfinApiClient): void;
  haltGroupPlayback(apiClient: JellyfinApiClient): void;
}

let cached: SyncPlayManager | null = null;

const isManager = (value: unknown): value is SyncPlayManager =>
  !!value &&
  typeof value === 'object' &&
  SYNCPLAY_MANAGER_METHODS.every((m) => typeof (value as Record<string, unknown>)[m] === 'function');

function managerIn(exports: unknown): SyncPlayManager | null {
  for (const value of Object.values((exports ?? {}) as Record<string, unknown>)) {
    const manager = (value as { Manager?: unknown } | null)?.Manager;
    if (isManager(manager)) return manager;
  }
  return null;
}

/**
 * The SyncPlay manager, or null. Like the playback manager, only a module that has already run is read (the SyncPlay
 * plugin loads before jellyfin-web renders), and with no module cache only a single matching module is required.
 */
export function findSyncPlay(win: Window = window): SyncPlayManager | null {
  if (cached) return cached;
  try {
    const require = webpackRequire(win);
    if (!require?.m) return null;
    const candidates = Object.keys(require.m).filter((id) => {
      const source = String(require.m![id]);
      return SYNCPLAY_CORE_KEYS.every((key) => source.includes(key)) && source.includes('GenericPlayer');
    });
    if (require.c) {
      for (const id of candidates) {
        const found = managerIn(require.c[id]?.exports);
        if (found) return (cached = found);
      }
      return null;
    }
    if (candidates.length !== 1) return null;
    return (cached = managerIn(require(candidates[0]!)));
  } catch {
    return null;
  }
}

export function resetSyncPlayCache(): void {
  cached = null;
}
