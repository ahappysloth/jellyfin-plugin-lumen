import type { LumenApi } from '../../api/lumenApi';
import type { BaseItem, HomeResponse } from '../../api/types';

/** The last home response for the current user only. Gives instant back-navigation and is never shown to another user. */
let cached: { userId: string; home: HomeResponse } | null = null;

export function getCachedHome(userId: string): HomeResponse | undefined {
  return cached?.userId === userId ? cached.home : undefined;
}

export function setCachedHome(userId: string, home: HomeResponse): void {
  cached = { userId, home };
}

export function clearCachedHome(userId: string): void {
  if (cached?.userId === userId) cached = null;
}

export async function fetchHome(api: LumenApi, retryDelayMs = 500): Promise<HomeResponse> {
  try {
    return await api.getHome();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return api.getHome();
  }
}

/**
 * Home with each title as `change` has it: null takes it out of the hero and the rows (and a row it leaves empty).
 * The catalog's titles the server doesn't have stay as they are.
 */
export function mapHomeItems(home: HomeResponse, change: (item: BaseItem) => BaseItem | null): HomeResponse {
  const kept = <T>(
    list: T[],
    get: (t: T) => BaseItem | null | undefined,
    put: (t: T, item: BaseItem) => T,
  ): T[] =>
    list
      .map((t) => {
        const was = get(t);
        const now = was && change(was);
        return !was ? t : now && (now === was ? t : put(t, now));
      })
      .filter((t): t is T => !!t);
  return {
    ...home,
    Hero: kept(
      home.Hero,
      (h) => h.Item,
      (h, Item) => ({ ...h, Item }),
    ),
    Rows: home.Rows.map((row) => ({
      ...row,
      Items: kept(
        row.Items,
        (i) => i,
        (_, i) => i,
      ),
      Entries:
        row.Entries &&
        kept(
          row.Entries,
          (e) => e.Item,
          (e, Item) => ({ ...e, Item }),
        ),
    })).filter((row) => row.Items.length > 0 || !!row.Entries?.length),
  };
}

export const isEmptyHome = (home: HomeResponse): boolean => home.Hero.length === 0 && home.Rows.length === 0;

/** The cached home, unless it is empty (an empty home means "use stock", so it is never worth showing). */
export function usableCachedHome(userId: string): HomeResponse | undefined {
  const home = getCachedHome(userId);
  return home && !isEmptyHome(home) ? home : undefined;
}

/** The card the user last opened from home, and where it was on screen, so Back can put it back in the same place. */
export interface Selection {
  itemId: string;
  scrollY: number;
  rowId?: string;
  /** The card's distance from the top of the viewport when it was selected. */
  top?: number;
}

let selection: (Selection & { userId: string }) | null = null;

export function rememberSelection(userId: string, item: Selection): void {
  selection = { userId, ...item };
}

export function getSelection(userId: string): Selection | undefined {
  if (selection?.userId !== userId) return undefined;
  const { itemId, scrollY, rowId, top } = selection;
  return { itemId, scrollY, rowId, top };
}

/**
 * A title was deleted: a selection on it moves to the card after it in its row (the one before, if it was the last), so
 * Back focuses a card next to where it was rather than nothing. Before the cached home leaves it out.
 */
export function selectNextTo(userId: string, itemId: string): void {
  const row = selection?.userId === userId && selection.itemId === itemId && getCachedHome(userId)?.Rows;
  const items = row ? (row.find((r) => r.Id === selection!.rowId)?.Items ?? []) : [];
  const i = items.findIndex((item) => item.Id === itemId);
  const next = i < 0 ? undefined : (items[i + 1] ?? items[i - 1]);
  if (next) selection!.itemId = next.Id;
}

const SAFE_ID = /^[\w-]+$/;

/**
 * Where to scroll so the selected card sits where it was, even if rows above it changed while the user was away
 * (e.g. a new "Because you watched" row). Falls back to the old scroll offset when the card is gone.
 */
export function restoreScrollTop(root: ParentNode, sel: Selection, scrollY: number): number {
  if (sel.top !== undefined && SAFE_ID.test(sel.itemId) && (!sel.rowId || SAFE_ID.test(sel.rowId))) {
    const scope = sel.rowId ? `[data-row-id="${sel.rowId}"] ` : '';
    const card = root.querySelector(`${scope}[data-item-id="${sel.itemId}"]`);
    if (card) return Math.max(0, Math.round(card.getBoundingClientRect().top + scrollY - sel.top));
  }
  return sel.scrollY;
}
