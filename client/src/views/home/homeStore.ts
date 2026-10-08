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

export const isEmptyHome = (home: HomeResponse): boolean => home.Hero.length === 0 && home.Rows.length === 0;

/** The cached home, unless it is empty (an empty home means "use stock", so it is never worth showing). */
export function usableCachedHome(userId: string): HomeResponse | undefined {
  const home = getCachedHome(userId);
  return home && !isEmptyHome(home) ? home : undefined;
}

let selection: { userId: string; itemId: string; scrollY: number } | null = null;

export function rememberSelection(userId: string, itemId: string, scrollY: number): void {
  selection = { userId, itemId, scrollY };
}

export function getSelection(userId: string): { itemId: string; scrollY: number } | undefined {
  return selection?.userId === userId ? { itemId: selection.itemId, scrollY: selection.scrollY } : undefined;
}
