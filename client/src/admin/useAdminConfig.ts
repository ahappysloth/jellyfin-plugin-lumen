import { useEffect, useState } from 'preact/hooks';
import type { AdminApi, LumenConfig, Option, SectionTypeDef } from './adminApi';
import { normalizeConfig, sameConfig } from './configModel';

export type PickerKind = 'Library' | 'Collection' | 'Playlist';
export type Lookups = Record<PickerKind, Option[]>;
export type AdminStatus = 'loading' | 'ready' | 'saving' | 'resetting' | 'saved' | 'failed';

/** A save or reset is in flight: the form is read-only and its buttons are disabled. */
export const isBusy = (status: AdminStatus): boolean => status === 'saving' || status === 'resetting';

const PICKER_NAMES: Record<PickerKind, string> = {
  Library: 'libraries',
  Collection: 'collections',
  Playlist: 'playlists',
};

export const LOAD_FAILED = "Couldn't load Lumen settings. Reload the page to try again.";
export const SAVE_FAILED = 'Saving failed. Check the server log.';
export const RESET_FAILED = "Couldn't reset the settings. Check the server log.";
export const RELOAD_AFTER_SAVE_FAILED =
  "Settings saved, but they couldn't be reloaded from the server. Reload the page before making more changes.";
export const RELOAD_AFTER_RESET_FAILED =
  "Lumen settings were reset to their defaults, but they couldn't be reloaded. Reload the page to see them.";

/** "libraries", "libraries and playlists", "libraries, collections and playlists". */
function listNames(names: string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Promise.allSettled for one promise: Chromium 68 has no Promise.allSettled (76). */
const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
  promise.then(
    (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
  );
/** A settled promise's value, or the fallback when it failed. */
const valueOr = <T>(result: PromiseSettledResult<T>, fallback: T): T =>
  result.status === 'fulfilled' ? result.value : fallback;

export interface AdminConfigState {
  config: LumenConfig | null;
  /** The Seerr address as last saved (the stored key belongs to it). */
  savedUrl: string | null | undefined;
  types: SectionTypeDef[];
  lookups: Lookups;
  /** Problems that stop a save or reset: server validation errors or a failed request. */
  errors: string[];
  /** Non-blocking problems: a picker list that didn't load, or a save that worked but couldn't be reloaded. */
  warnings: string[];
  status: AdminStatus;
  /** Shown instead of the form when status is 'failed'. */
  failure: string;
  dirty: boolean;
  /** The configuration as last loaded or saved: what Discard puts back. */
  saved: LumenConfig | null;
  /** Goes up on every Discard, so the form's sections remount and drop local state (a test result, a pending choice). */
  revision: number;
}

/**
 * Loads, edits, saves and resets the plugin configuration. Only the configuration and the section types are needed
 * to show the form; the picker lists are optional, so one failing lookup leaves the rest usable.
 */
export function useAdminConfig(api: AdminApi) {
  const [state, setState] = useState<AdminConfigState>({
    config: null,
    savedUrl: null,
    types: [],
    lookups: { Library: [], Collection: [], Playlist: [] },
    errors: [],
    warnings: [],
    status: 'loading',
    failure: LOAD_FAILED,
    dirty: false,
    saved: null,
    revision: 0,
  });
  const patch = (next: Partial<AdminConfigState>): void => setState((s) => ({ ...s, ...next }));

  /** Resolves false (and shows the failure page with `failure`) when the essentials couldn't be loaded. */
  const load = async (failure = LOAD_FAILED): Promise<boolean> => {
    const [config, types, libraries, collections, playlists] = await Promise.all([
      settle(api.getConfig()),
      settle(api.getSectionTypes()),
      settle(api.getLibraries()),
      settle(api.getCollections()),
      settle(api.getPlaylists()),
    ]);
    if (config.status === 'rejected' || types.status === 'rejected') {
      patch({ status: 'failed', failure });
      return false;
    }
    const lists: Record<PickerKind, PromiseSettledResult<Option[]>> = {
      Library: libraries,
      Collection: collections,
      Playlist: playlists,
    };
    const missing = (Object.keys(lists) as PickerKind[]).filter((k) => lists[k].status === 'rejected');
    const loaded = normalizeConfig(config.value);
    patch({
      config: loaded,
      saved: loaded,
      savedUrl: config.value.SeerrUrl,
      types: types.value,
      lookups: {
        Library: valueOr(lists.Library, []),
        Collection: valueOr(lists.Collection, []),
        Playlist: valueOr(lists.Playlist, []),
      },
      warnings:
        missing.length > 0
          ? [
              `Couldn't load the ${listNames(missing.map((k) => PICKER_NAMES[k]))} to choose from. ` +
                'Saved choices are kept; reload the page to try again.',
            ]
          : [],
      dirty: false,
      status: 'ready',
    });
    return true;
  };

  useEffect(() => {
    void load();
  }, []);

  const update = (changes: Partial<LumenConfig>): void =>
    setState((s) => {
      // While a save is in flight its result replaces the form; edits made meanwhile would be silently lost.
      if (!s.config || isBusy(s.status)) return s;
      const config = { ...s.config, ...changes };
      // Unsaved means different from what was last loaded or saved, not merely edited: undoing a change by hand
      // takes the save bar away again, as Discard would.
      const dirty = !s.saved || !sameConfig(config, s.saved);
      return {
        ...s,
        config,
        dirty,
        // Back where it was saved, a failed save's problems are about changes that are gone (as after Discard). A
        // failed reset's isn't: it stands whatever the form holds.
        errors: dirty ? s.errors : s.errors.filter((e) => e === RESET_FAILED),
        status: s.status === 'saved' ? 'ready' : s.status,
      };
    });

  const save = async (): Promise<void> => {
    const { config } = state;
    if (!config) return;
    patch({ status: 'saving' });
    let result;
    try {
      result = await api.saveConfig(config);
    } catch {
      patch({ errors: [SAVE_FAILED], status: 'ready' });
      return;
    }
    if (!result.ok) {
      patch({ errors: result.errors, status: 'ready' });
      return;
    }
    try {
      const fresh = normalizeConfig(await api.getConfig());
      patch({
        config: fresh,
        saved: fresh,
        savedUrl: fresh.SeerrUrl,
        errors: [],
        warnings: state.warnings.filter((w) => w !== RELOAD_AFTER_SAVE_FAILED),
        dirty: false,
        status: 'saved',
      });
    } catch {
      // The save went through; only the refresh failed. Say so rather than "Saving failed". What was sent is what's
      // saved now, less the keys, which the server keeps and never sends back: the form shows it as the server would,
      // so the key fields are blank and a change after it compares with what's really saved.
      const sent: LumenConfig = {
        ...config,
        SeerrApiKey: null,
        SeerrApiKeySet: config.SeerrApiKeySet || !!config.SeerrApiKey,
        TraktClientId: null,
        TraktClientIdSet: config.ClearTraktClientId
          ? false
          : config.TraktClientIdSet || !!config.TraktClientId,
        ClearTraktClientId: false,
      };
      patch({
        config: sent,
        saved: sent,
        savedUrl: config.SeerrUrl,
        errors: [],
        warnings: [...state.warnings.filter((w) => w !== RELOAD_AFTER_SAVE_FAILED), RELOAD_AFTER_SAVE_FAILED],
        dirty: false,
        status: 'saved',
      });
    }
  };

  /**
   * Drops the unsaved changes: the configuration goes back to what was last loaded or saved, and a failed save's errors
   * go with them. Nothing is sent to the server, so it needs no confirmation.
   */
  const discard = (): void =>
    setState((s) =>
      !s.saved || isBusy(s.status)
        ? s
        : {
            ...s,
            config: s.saved,
            dirty: false,
            errors: [],
            status: s.status === 'saved' ? 'ready' : s.status,
            revision: s.revision + 1,
          },
    );

  /** Resets everything to the defaults and reloads. The caller asks for confirmation first. */
  const reset = async (): Promise<void> => {
    const before = state.status;
    patch({ status: 'resetting' });
    try {
      await api.reset();
    } catch {
      patch({ errors: [RESET_FAILED], status: before });
      return;
    }
    patch({ errors: [] });
    await load(RELOAD_AFTER_RESET_FAILED);
  };

  return { ...state, update, save, discard, reset };
}
