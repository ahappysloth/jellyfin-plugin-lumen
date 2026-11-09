import { useEffect, useRef, useState } from 'preact/hooks';
import type { BrowseQuery } from '../../api/lumenApi';
import type { BaseItem, ItemsResult } from '../../api/types';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { getSnapshot } from './browseStore';

export const PAGE_SIZE = 60;

export interface BrowseState {
  items: BaseItem[];
  /** null until the first page answers. */
  total: number | null;
  loading: boolean;
  error: boolean;
  /** Restored from a snapshot: the caller should scroll back to where the user was. */
  restoredScrollY: number | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

type Fetch = (query: Pick<BrowseQuery, 'startIndex' | 'limit'>) => Promise<ItemsResult>;

/**
 * Pages through a query. `key` identifies the query: when it changes the list restarts (or restores its snapshot).
 * Pages load one at a time; a stale answer for an old key is dropped.
 */
export function useBrowseItems(key: string, fetchPage: Fetch): BrowseState {
  const initial = getSnapshot(key);
  const [items, setItems] = useState<BaseItem[]>(initial?.items ?? []);
  const [total, setTotal] = useState<number | null>(initial?.total ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [restoredScrollY, setRestoredScrollY] = useState<number | null>(initial?.scrollY ?? null);
  const generation = useRef(0);
  const state = useRef({ items, total, loading });
  state.current = { items, total, loading };
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const load = (reset: boolean): void => {
    const current = state.current;
    if (!reset && (current.loading || (current.total !== null && current.items.length >= current.total)))
      return;
    const gen = reset ? ++generation.current : generation.current;
    const startIndex = reset ? 0 : current.items.length;
    setLoading(true);
    setError(false);
    state.current = { ...current, loading: true };
    withTimeout(fetchRef.current({ startIndex, limit: PAGE_SIZE }), VIEW_TIMEOUT_MS)
      .then((page) => {
        if (gen !== generation.current) return;
        const base = reset ? [] : state.current.items;
        // Drop repeats: the library can change between pages.
        const seen = new Set(base.map((i) => i.Id));
        const next = [...base, ...page.Items.filter((i) => !seen.has(i.Id))];
        setItems(next);
        setTotal(page.Items.length < PAGE_SIZE ? next.length : (page.TotalRecordCount ?? next.length));
        setLoading(false);
      })
      .catch(() => {
        if (gen !== generation.current) return;
        setLoading(false);
        setError(true);
      });
  };

  // Restart when the query changes; a snapshot for the new key stands in for the first page.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      if (initial) return;
    } else {
      const snapshot = getSnapshot(key);
      if (snapshot) {
        generation.current++;
        setItems(snapshot.items);
        setTotal(snapshot.total);
        setLoading(false);
        setError(false);
        setRestoredScrollY(snapshot.scrollY);
        return;
      }
      setItems([]);
      setTotal(null);
      setRestoredScrollY(null);
    }
    load(true);
  }, [key]);

  return {
    items,
    total,
    loading,
    error,
    restoredScrollY,
    hasMore: total === null || items.length < total,
    loadMore: () => load(false),
    retry: () => load(state.current.items.length === 0),
  };
}
