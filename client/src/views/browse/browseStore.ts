import type { BaseItem } from '../../api/types';

/**
 * What a grid had loaded and where it was scrolled, so Back from a details page lands on the same card instead of
 * the top of page one. Per user and per exact query; in memory only (a reload starts fresh).
 */
export interface GridSnapshot {
  items: BaseItem[];
  total: number;
  scrollY: number;
}

const MAX_SNAPSHOTS = 12;
const snapshots = new Map<string, GridSnapshot>();

export function getSnapshot(key: string): GridSnapshot | undefined {
  return snapshots.get(key);
}

export function saveSnapshot(key: string, snapshot: GridSnapshot): void {
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
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
