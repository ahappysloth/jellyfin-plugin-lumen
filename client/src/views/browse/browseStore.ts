import { registerSessionCache } from '../../util/sessionCaches';
import type { BaseItem } from '../../api/types';
import type { UserDataField } from '../userDataStore';

/**
 * What a grid had loaded and where it was scrolled, so Back from a details page lands on the same card instead of
 * the top of page one. Per user and per exact query; in memory only (a reload starts fresh).
 */
export interface GridSnapshot {
  items: BaseItem[];
  total: number;
  scrollY: number;
  /** The server offset the next page starts at (de-duplicated items can be fewer). */
  offset?: number;
  /** More pages to load (an uncounted grid can't tell from its total). */
  more?: boolean;
  /** The card the user opened, so the TV layout can focus it again. */
  selectedId?: string;
}

export interface SnapshotOptions {
  /** User-data fields the query filters on (Favorites, Unwatched): a change to one makes the snapshot stale. */
  dependsOn?: readonly UserDataField[];
}

interface Stored {
  snapshot: GridSnapshot;
  dependsOn: readonly UserDataField[];
  /** The history entry the grid was saved from (Navigation API), or null where the browser lacks it. */
  entry: string | null;
  savedAt: number;
}

const MAX_SNAPSHOTS = 12;
/** Without the Navigation API we can't tell Back from a fresh visit; an old snapshot is then treated as a visit. */
export const SNAPSHOT_TTL_MS = 10 * 60_000;
const snapshots = new Map<string, Stored>();

type NavigationLike = { currentEntry?: { key?: string } | null };
function historyEntry(): string | null {
  const navigation = (window as { navigation?: NavigationLike }).navigation;
  return navigation?.currentEntry?.key ?? null;
}

/**
 * The policy: a snapshot is used at most once, and only when the user comes back to the same history entry (Back,
 * or Back from the player). Opening the page afresh (the nav, a link) starts from page one with fresh data.
 */
export function takeSnapshot(key: string): GridSnapshot | undefined {
  const stored = snapshots.get(key);
  if (!stored) return undefined;
  snapshots.delete(key);
  const current = historyEntry();
  if (stored.entry !== null && current !== null)
    return stored.entry === current ? stored.snapshot : undefined;
  return Date.now() - stored.savedAt <= SNAPSHOT_TTL_MS ? stored.snapshot : undefined;
}

export function saveSnapshot(key: string, snapshot: GridSnapshot, options: SnapshotOptions = {}): void {
  snapshots.delete(key);
  snapshots.set(key, {
    snapshot,
    dependsOn: options.dependsOn ?? [],
    entry: historyEntry(),
    savedAt: Date.now(),
  });
  while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
}

/** For tests and diagnostics: whether a snapshot is stored for this key (without using it). */
export function hasSnapshot(key: string): boolean {
  return snapshots.has(key);
}

/**
 * A favorite/watched change: drop the snapshots whose query filters on that field (the item may no longer belong),
 * and update the item in place everywhere else.
 */
export function updateSnapshots(itemId: string, field: UserDataField, value: boolean): void {
  for (const [key, stored] of snapshots) {
    // Any change can add a title to such a grid or remove one from it.
    if (stored.dependsOn.includes(field)) snapshots.delete(key);
    else
      stored.snapshot.items = stored.snapshot.items.map((i) =>
        i.Id === itemId ? { ...i, UserData: { ...i.UserData, [field]: value } } : i,
      );
  }
}

/**
 * A title was deleted: take its card out of every saved grid, so Back doesn't bring back a card that leads nowhere. The
 * server's list is one shorter now, so the next page starts one earlier. A grid it was opened from selects the card
 * after it (the one before, if it was the last), for the TV layout to focus.
 */
export function removeFromSnapshots(itemId: string): void {
  for (const { snapshot } of snapshots.values()) {
    const i = snapshot.items.findIndex((item) => item.Id === itemId);
    if (i < 0) continue;
    const items = snapshot.items.filter((item) => item.Id !== itemId);
    snapshot.items = items;
    snapshot.total = Math.max(0, snapshot.total - 1);
    if (snapshot.offset !== undefined) snapshot.offset = Math.max(0, snapshot.offset - 1);
    if (snapshot.selectedId === itemId) snapshot.selectedId = (items[i] ?? items[i - 1])?.Id;
  }
}

/** A title was edited (renamed, new images…): saved grids show it as the server now has it. */
export function replaceInSnapshots(fresh: BaseItem): void {
  for (const { snapshot } of snapshots.values())
    snapshot.items = snapshot.items.map((i) => (i.Id === fresh.Id ? { ...i, ...fresh } : i));
}

/** The sort/filter a user last chose for a page, so revisiting Movies keeps "Rating · Unwatched". */
const choices = new Map<string, unknown>();

export function getChoice<T>(key: string, fallback: T): T {
  return (choices.get(key) as T | undefined) ?? fallback;
}

export function saveChoice<T>(key: string, value: T): void {
  choices.set(key, value);
}

export function clearBrowseState(): void {
  snapshots.clear();
  choices.clear();
}

registerSessionCache(clearBrowseState);
