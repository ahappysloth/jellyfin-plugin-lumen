import type { BaseItem, HomeResponse } from '../api/types';
import { registerSessionCache } from '../util/sessionCaches';
import { removeFromSnapshots, replaceInSnapshots } from './browse/browseStore';
import { getCachedHome, mapHomeItems, selectNextTo, setCachedHome } from './home/homeStore';

/**
 * How long a change made here outranks /Lumen/Home. The server's home cache catches up with a library change within
 * 30 s (HomeCache.LibraryDebounce: a change soon after another waits for the trailing refresh), so until then it can
 * still list a deleted title or an old name. After that, the server's answer is the fresher one (a title added back,
 * a rename made elsewhere).
 */
export const OUTRANKS_MS = 2 * 60_000;

/** This user's deletes and edits from the ⋯ menus, with when they were made. */
let changes: {
  userId: string;
  deleted: Map<string, number>;
  edited: Map<string, [BaseItem, number]>;
} | null = null;
registerSessionCache(() => (changes = null));

function changesFor(userId: string): NonNullable<typeof changes> {
  if (changes?.userId !== userId) changes = { userId, deleted: new Map(), edited: new Map() };
  return changes;
}

/**
 * Home as this user's recent deletes and edits left it: without the deleted titles (and episodes of a deleted series
 * or season), and with edited titles as they are now. Every home shown goes through this, cached or fetched.
 */
export function withLocalChanges(userId: string, home: HomeResponse, now = Date.now()): HomeResponse {
  if (changes?.userId !== userId) return home;
  const recent = (at: number): boolean => now - at < OUTRANKS_MS;
  const gone = (id: string | undefined): boolean => !!id && recent(changes!.deleted.get(id) ?? -Infinity);
  return mapHomeItems(home, (item) => {
    if (gone(item.Id) || gone(item.SeriesId) || gone(item.SeasonId)) return null;
    const edit = changes!.edited.get(item.Id);
    return edit && recent(edit[1]) ? { ...item, ...edit[0] } : item;
  });
}

function updateCachedHome(userId: string): void {
  const home = getCachedHome(userId);
  if (home) setCachedHome(userId, withLocalChanges(userId, home));
}

/**
 * A title deleted from its ⋯ menu. Saved grids (browseStore) and home are what Back shows first: neither may bring its
 * card back, since opening it would leave jellyfin-web's details page loading forever.
 */
export function forgetItem(userId: string, itemId: string): void {
  changesFor(userId).deleted.set(itemId, Date.now());
  removeFromSnapshots(itemId);
  selectNextTo(userId, itemId);
  updateCachedHome(userId);
}

/** A title edited from its ⋯ menu, as the server now has it: Back shows it so too, and so does home. */
export function rememberEdit(userId: string, fresh: BaseItem): void {
  // Its metadata only: watching it meanwhile changes its user data, which home then has afresh.
  const metadata = { ...fresh };
  delete metadata.UserData;
  changesFor(userId).edited.set(fresh.Id, [metadata, Date.now()]);
  replaceInSnapshots(fresh);
  updateCachedHome(userId);
}
