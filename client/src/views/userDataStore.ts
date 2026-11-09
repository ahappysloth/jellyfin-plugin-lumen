import { useLayoutEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../api/types';
import { registerSessionCache } from '../util/sessionCaches';
import { clearSnapshots } from './browse/browseStore';
import type { ViewContext } from './context';

/**
 * Favorite / watched changes made in this session, shared by every surface (details buttons, card menus, the
 * player), so they never disagree. Changes to one item and field are sent to the server one at a time, in order;
 * a failed change rolls back only if nothing newer has replaced it.
 */
export type UserDataField = 'IsFavorite' | 'Played';

const overrides = new Map<string, boolean>();
const queues = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
const pending = new Map<string, number>();
const listeners = new Set<() => void>();

const keyOf = (itemId: string, field: UserDataField): string => `${itemId}:${field}`;
const notify = (): void => listeners.forEach((l) => l());

/** The item's current value: a change made this session, else what the server sent with the item. */
export function userDataValue(item: BaseItem, field: UserDataField): boolean {
  return overrides.get(keyOf(item.Id, field)) ?? !!item.UserData?.[field];
}

/** Re-renders when any value changes; returns the item's value. */
export function useUserData(item: BaseItem, field: UserDataField): boolean {
  const [, bump] = useState(0);
  // Layout effect: subscribed before the user can click, unlike useEffect (which Preact runs after paint).
  useLayoutEffect(() => {
    const listener = (): void => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return userDataValue(item, field);
}

/** Sets a value optimistically and sends it; resolves false if the server refused it (and it was rolled back). */
export function setUserData(
  ctx: ViewContext,
  item: BaseItem,
  field: UserDataField,
  value: boolean,
): Promise<boolean> {
  const key = keyOf(item.Id, field);
  const before = userDataValue(item, field);
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  overrides.set(key, value);
  clearSnapshots(); // saved grids (Favorites, Unwatched) may no longer match
  notify();

  const send = (): Promise<void> =>
    field === 'IsFavorite' ? ctx.api.setFavorite(item.Id, value) : ctx.api.setPlayed(item.Id, value);
  const result = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(send)
    .then(
      () => true,
      () => {
        if (versions.get(key) === version) {
          overrides.set(key, before);
          notify();
        }
        return false;
      },
    )
    .finally(() => pending.set(key, (pending.get(key) ?? 1) - 1));
  queues.set(key, result);
  return result;
}

/**
 * The server just sent this item fresh (e.g. its details page): its values win over older session changes, unless
 * a change is still on its way.
 */
export function reconcileUserData(item: BaseItem): void {
  let changed = false;
  for (const field of ['IsFavorite', 'Played'] as const) {
    const key = keyOf(item.Id, field);
    if (!pending.get(key) && overrides.delete(key)) changed = true;
  }
  if (changed) notify();
}

export function clearUserData(): void {
  overrides.clear();
  queues.clear();
  versions.clear();
  pending.clear();
}

registerSessionCache(clearUserData);
