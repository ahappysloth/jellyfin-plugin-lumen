/**
 * jellyfin-web's own item dialogs (metadata editor, identify, image and subtitle editors, media info, the collection
 * and playlist pickers, refresh, delete), opened from Lumen's menus.
 *
 * jellyfin-web opens them from its item menu (registry.ts ITEM_MENU_MARKERS): `show(options)` lists the item's
 * commands, asks its action sheet which one to run, then runs it and resolves once the dialog closes, with whether the
 * item changed or was deleted. Lumen calls that same `show`, and answers the action sheet's question itself with the
 * command picked in Lumen's menu (registry.ts ACTION_SHEET_MARKERS), so no stock sheet appears and the dialog,
 * its permission checks and what it does all stay jellyfin-web's. If jellyfin-web wouldn't offer that command (its
 * `getCommands` disagrees with Lumen's), the answer is a refusal and nothing opens.
 *
 * Both modules come from the webpack bundle the way the playback manager does (./playbackManager.ts): by strings in
 * their code, never by module id or minified name; exactly one match each, checked for the methods Lumen calls. Only
 * modules whose chunk has loaded are looked at. Nothing found: `openItemDialog` throws ItemDialogUnavailable and the
 * caller falls back to a stock page.
 */
import type { BaseItem } from '../api/types';
import { ACTION_SHEET_MARKERS, ITEM_MENU_MARKERS, ITEM_MENU_METHODS } from './registry';
import { webpackRequire } from './playbackManager';

/** What jellyfin-web's item menu reports once the dialog closes. */
export interface ItemDialogResult {
  /** The item changed (metadata saved, added to a collection or playlist, subtitles changed). */
  updated: boolean;
  deleted: boolean;
}

interface SheetOptions {
  items?: { id?: string }[];
  positionTo?: unknown;
}
interface ActionSheet {
  show(options: SheetOptions): Promise<string>;
}
interface ItemMenuModule {
  show(options: Record<string, unknown>): Promise<{ updated?: boolean; deleted?: boolean } | undefined>;
}
interface Found {
  menu: ItemMenuModule;
  sheet: ActionSheet;
}

export class ItemDialogUnavailable extends Error {
  constructor(reason: string) {
    super(`jellyfin-web's item dialog is unavailable: ${reason}`);
    this.name = 'ItemDialogUnavailable';
  }
}

const found = new WeakMap<Window, Found>();
/** Module counts already searched without success, so a miss is only searched again once more code has loaded. */
const missed = new WeakMap<Window, number>();

const hasAll = (value: unknown, methods: readonly string[]): boolean =>
  !!value &&
  (typeof value === 'object' || typeof value === 'function') &&
  methods.every((m) => typeof (value as Record<string, unknown>)[m] === 'function');

/** The one module whose code has every marker, required; null when none or several match. */
function requireOnly(
  require: NonNullable<ReturnType<typeof webpackRequire>>,
  markers: readonly string[],
): unknown {
  const ids = Object.keys(require.m ?? {}).filter((id) => {
    const source = String(require.m![id]);
    return markers.every((marker) => source.includes(marker));
  });
  return ids.length === 1 ? require(ids[0]!) : null;
}

/** jellyfin-web's item menu and action sheet, or null when this page hasn't loaded them (or they've changed). */
export function findItemMenu(win: Window = window): Found | null {
  const known = found.get(win);
  if (known) return known;
  try {
    const require = webpackRequire(win);
    if (!require?.m) return null;
    const count = Object.keys(require.m).length;
    if (missed.get(win) === count) return null;
    missed.set(win, count);

    const menuExports = requireOnly(require, ITEM_MENU_MARKERS) as Record<string, unknown> | null;
    const menu = [menuExports, menuExports?.default].find((value) => hasAll(value, ITEM_MENU_METHODS));
    if (!menu) return null;
    const sheetExports = requireOnly(require, ACTION_SHEET_MARKERS) as {
      show?: unknown;
      default?: { show?: unknown };
    } | null;
    // The menu calls `default.show`, looked up as it calls; the named export is the same function.
    const sheet = sheetExports?.default;
    if (!sheet || typeof sheet.show !== 'function' || sheetExports.show !== sheet.show) return null;

    const result = { menu: menu as ItemMenuModule, sheet: sheet as ActionSheet };
    found.set(win, result);
    missed.delete(win);
    return result;
  } catch {
    return null;
  }
}

/** True when Lumen can open jellyfin-web's item dialogs on this page. */
export function canOpenItemDialogs(win: Window = window): boolean {
  return findItemMenu(win) !== null;
}

/**
 * Opens jellyfin-web's dialog for one of its item commands (`edit`, `identify`, `editimages`, `editsubtitles`,
 * `moremediainfo`, `addtocollection`, `addtoplaylist`, `refresh`, `delete`, `downloadall`) and resolves once it
 * closes. `item` must be the full item (as `GET /Items/{id}` returns it) and `user` the signed-in user with its Policy:
 * jellyfin-web checks both again. Throws ItemDialogUnavailable when it can't be opened.
 */
export async function openItemDialog(
  item: BaseItem,
  user: unknown,
  command: string,
  win: Window = window,
): Promise<ItemDialogResult> {
  const modules = findItemMenu(win);
  if (!modules) throw new ItemDialogUnavailable('not found');
  const { menu, sheet } = modules;
  // Identifies Lumen's own call to the sheet: anything else that shows one meanwhile gets jellyfin-web's sheet.
  // Detached, so the menu's "Select" (multi-select starts from a card it sits in) is never offered.
  const marker = win.document.createElement('span');
  const original = sheet.show;
  // Whether jellyfin-web got as far as asking, and listed the command: until then, a failure means it won't open.
  let offered = false;
  const answer = function (this: unknown, options: SheetOptions): Promise<string> {
    if (options?.positionTo !== marker) return original.call(this, options);
    restore();
    offered = !!options.items?.some((entry) => entry.id === command);
    return offered ? Promise.resolve(command) : Promise.reject(new Error('not offered'));
  };
  const restore = (): void => {
    if (sheet.show === answer) sheet.show = original;
  };
  sheet.show = answer;
  try {
    const result = await menu.show({ item, user, positionTo: marker });
    return { updated: !!result?.updated, deleted: !!result?.deleted };
  } catch (error) {
    if (!offered) throw new ItemDialogUnavailable(`jellyfin-web doesn't offer ${command} here`);
    throw error;
  } finally {
    restore();
  }
}

/** For tests. */
export function resetItemMenuCache(win: Window = window): void {
  found.delete(win);
  missed.delete(win);
}
