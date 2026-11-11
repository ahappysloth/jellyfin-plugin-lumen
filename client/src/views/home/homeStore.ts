import type { LumenApi } from '../../api/lumenApi';
import type { HomeResponse } from '../../api/types';

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

/** Home without a title deleted from its card's menu: out of the hero and the rows (a row left empty goes too). */
export function withoutItem(home: HomeResponse, itemId: string): HomeResponse {
  return {
    ...home,
    Hero: home.Hero.filter((h) => h.Item.Id !== itemId),
    Rows: home.Rows.map((row) => ({
      ...row,
      Items: row.Items.filter((i) => i.Id !== itemId),
      Entries: row.Entries?.filter((e) => e.Item?.Id !== itemId),
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
