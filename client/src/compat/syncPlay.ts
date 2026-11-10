/**
 * jellyfin-web's SyncPlay manager. First the way jellyfin-web's own UI gets it, from the SyncPlay plugin's instance
 * (pluginManager.firstOfType('syncplay').instance.Manager), when Lumen's jellyfin-web plugin has caught pluginManager
 * (./webPlugin.ts). Else from inside its webpack bundle, like the playback manager (./playbackManager.ts):
 * the core module's default export is `{ Helper, Manager, PlayerFactory, Players }` (registry.ts SYNCPLAY_CORE_KEYS);
 * those keys survive minification, so Lumen looks for a module whose code names all of them and an export with a
 * Manager that has every method in SYNCPLAY_MANAGER_METHODS. Nothing found: Lumen shows no Watch together button.
 */
import { webpackRequire } from './playbackManager';
import { SYNCPLAY_CORE_KEYS, SYNCPLAY_MANAGER_METHODS, SYNCPLAY_PLUGIN_TYPE } from './registry';
import { webPluginSlot } from './webPlugin';
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
/**
 * The modules whose code looks like SyncPlay's core, and how many modules there were when they were looked for.
 * Reading every module's code is the expensive part, so it's only done again once more modules have loaded.
 */
let scanned: { count: number; ids: string[] } | null = null;

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

/** The Manager of the SyncPlay plugin jellyfin-web registered, via the pluginManager Lumen's plugin caught. */
function fromPluginManager(win: Window): SyncPlayManager | null {
  const plugins = webPluginSlot(win)?.pluginManager as { firstOfType?: unknown } | null | undefined;
  if (!plugins || typeof plugins.firstOfType !== 'function') return null;
  const plugin = plugins.firstOfType(SYNCPLAY_PLUGIN_TYPE) as
    { instance?: { Manager?: unknown } } | undefined;
  const manager = plugin?.instance?.Manager;
  return isManager(manager) ? manager : null;
}

/**
 * The SyncPlay manager, or null: from the SyncPlay plugin when jellyfin-web has registered it, else from the bundle.
 * In the bundle, like the playback manager, only a module that has already run is read (the SyncPlay
 * plugin loads before jellyfin-web renders), and with no module cache only a single matching module is required.
 */
export function findSyncPlay(win: Window = window): SyncPlayManager | null {
  if (cached) return cached;
  try {
    const fromPlugin = fromPluginManager(win);
    if (fromPlugin) return (cached = fromPlugin);
    const require = webpackRequire(win);
    if (!require?.m) return null;
    const ids = Object.keys(require.m);
    if (scanned?.count !== ids.length) {
      scanned = {
        count: ids.length,
        ids: ids.filter((id) => {
          const source = String(require.m![id]);
          return SYNCPLAY_CORE_KEYS.every((key) => source.includes(key)) && source.includes('GenericPlayer');
        }),
      };
    }
    const candidates = scanned.ids;
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
  scanned = null;
}
