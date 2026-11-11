import { useLayoutEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../api/types';
import { confirmDialog } from '../components/ConfirmDialog';
import { registerSessionCache } from '../util/sessionCaches';
import { strings } from '../strings';
import { updateSnapshots } from './browse/browseStore';
import type { ViewContext } from './context';

/**
 * Favorite / watched changes made in this session, shared by every surface (details buttons, card menus, the
 * player), so they never disagree. Changes to one item and field are sent to the server one at a time, in order.
 * A failed change rolls back only if nothing newer has replaced it, and then to the last value the server confirmed
 * (not to the previous optimistic one, which may itself have failed).
 */
export type UserDataField = 'IsFavorite' | 'Played';

const overrides = new Map<string, boolean>();
/** The server's value while changes are in flight: what a failure rolls back to. */
const confirmed = new Map<string, boolean>();
const queues = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
const pending = new Map<string, number>();
/**
 * Titles marked unwatched this session (optimistically, until a refusal rolls it back): Jellyfin forgets when they were
 * played, so History leaves them out at once rather than on the next visit.
 */
const unwatched = new Set<string>();
const listeners = new Set<() => void>();

const keyOf = (itemId: string, field: UserDataField): string => `${itemId}:${field}`;
const notify = (): void => listeners.forEach((l) => l());

/** The item's current value: a change made this session, else what the server sent with the item. */
export function userDataValue(item: BaseItem, field: UserDataField): boolean {
  return overrides.get(keyOf(item.Id, field)) ?? !!item.UserData?.[field];
}

/** Re-renders when any value changes. */
export function useUserDataChanges(): void {
  const [, bump] = useState(0);
  // Layout effect: subscribed before the user can click, unlike useEffect (which Preact runs after paint).
  useLayoutEffect(() => {
    const listener = (): void => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

/** Re-renders when any value changes; returns the item's value. */
export function useUserData(item: BaseItem, field: UserDataField): boolean {
  useUserDataChanges();
  return userDataValue(item, field);
}

/** The title was marked unwatched this session (see `unwatched`). */
export function markedUnwatched(itemId: string): boolean {
  return unwatched.has(itemId);
}

/**
 * Sets a value optimistically and sends it. Resolves false if the server refused it and it was rolled back; a failure
 * that a newer change has already replaced resolves true (the newer change reports for itself).
 */
export function setUserData(
  ctx: ViewContext,
  item: BaseItem,
  field: UserDataField,
  value: boolean,
): Promise<boolean> {
  const key = keyOf(item.Id, field);
  // Nothing in flight: the current value is the server's (as sent with the item, or as it last confirmed).
  if (!pending.get(key)) confirmed.set(key, userDataValue(item, field));
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  if (field === 'Played') markUnwatched(item.Id, !value);
  apply(item.Id, key, field, value);

  const send = (): Promise<void> =>
    field === 'IsFavorite' ? ctx.api.setFavorite(item.Id, value) : ctx.api.setPlayed(item.Id, value);
  const result = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(send)
    .then(
      () => {
        confirmed.set(key, value);
        return true;
      },
      () => {
        if (versions.get(key) !== version) return true;
        if (field === 'Played' && !value) markUnwatched(item.Id, false);
        apply(item.Id, key, field, confirmed.get(key) ?? !value);
        return false;
      },
    )
    .finally(() => pending.set(key, (pending.get(key) ?? 1) - 1));
  queues.set(key, result);
  return result;
}

/** setUserData for a button: a refused change rolls back and says so (the shared toast by default). */
export function toggleUserData(
  ctx: ViewContext,
  item: BaseItem,
  field: UserDataField,
  value: boolean,
  onError: (message: string) => void,
): void {
  void setUserData(ctx, item, field, value).then(
    (ok) => ok || onError(field === 'IsFavorite' ? strings.favoriteFailed : strings.watchedFailed),
  );
}

/**
 * Marking a title unwatched makes Jellyfin forget how far the user got and when they watched it, so it also leaves
 * History: Lumen asks first, in its own dialog (focus starts on Cancel and returns to `returnFocus`, by default the
 * control that had it). Resolves true to go ahead. For any surface that offers Mark as unwatched.
 */
export function confirmUnwatched(returnFocus?: HTMLElement | null): Promise<boolean> {
  return confirmDialog({
    title: strings.markUnwatchedTitle,
    body: strings.markUnwatchedBody,
    confirmLabel: strings.markUnwatchedShort,
    returnFocus,
  });
}

/** toggleUserData for Played: marking watched happens at once, marking unwatched asks first (confirmUnwatched). */
export function togglePlayed(
  ctx: ViewContext,
  item: BaseItem,
  played: boolean,
  onError: (message: string) => void,
  returnFocus?: HTMLElement | null,
): void {
  if (played) return toggleUserData(ctx, item, 'Played', true, onError);
  void confirmUnwatched(returnFocus).then((ok) => ok && toggleUserData(ctx, item, 'Played', false, onError));
}

function markUnwatched(itemId: string, on: boolean): void {
  if (on) unwatched.add(itemId);
  else unwatched.delete(itemId);
}

function apply(itemId: string, key: string, field: UserDataField, value: boolean): void {
  overrides.set(key, value);
  updateSnapshots(itemId, field, value); // saved grids show the new value, or are dropped if they filter on it
  notify();
}

/**
 * The server just sent this item fresh (e.g. its details page): its values win over older session changes, unless
 * a change is still on its way.
 */
export function reconcileUserData(item: BaseItem): void {
  let changed = false;
  for (const field of ['IsFavorite', 'Played'] as const) {
    const key = keyOf(item.Id, field);
    if (pending.get(key)) continue;
    confirmed.delete(key);
    if (overrides.delete(key)) changed = true;
  }
  if (changed) notify();
}

export function clearUserData(): void {
  overrides.clear();
  confirmed.clear();
  queues.clear();
  versions.clear();
  pending.clear();
  unwatched.clear();
}

registerSessionCache(clearUserData);
