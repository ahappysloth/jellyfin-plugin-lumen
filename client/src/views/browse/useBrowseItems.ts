import { useEffect, useRef, useState } from 'preact/hooks';
import type { BrowseQuery } from '../../api/lumenApi';
import type { BaseItem, ItemsResult } from '../../api/types';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { type GridSnapshot, takeSnapshot } from './browseStore';

export const PAGE_SIZE = 60;

export interface BrowseState {
  items: BaseItem[];
  /** null until the first page answers. Uncounted (BrowseOptions): the titles loaded so far. */
  total: number | null;
  loading: boolean;
  error: boolean;
  /** Restored from a snapshot: the caller should scroll back to where the user was. */
  restoredScrollY: number | null;
  /** Restored from a snapshot: the card the user had opened. */
  restoredSelectedId: string | null;
  hasMore: boolean;
  /** Server offset for the next page, for snapshots. */
  offset: number;
  loadMore: () => void;
  retry: () => void;
  /** A title was deleted: its card goes, and the next page starts one earlier on the server. */
  remove: (itemId: string) => void;
  /** A title was edited: its card shows it as the server now has it. */
  replace: (fresh: BaseItem) => void;
}

export type Fetch = (query: Pick<BrowseQuery, 'startIndex' | 'limit' | 'count'>) => Promise<ItemsResult>;

export interface BrowseOptions {
  /**
   * Don't have the server count the matches (a second query over the whole library): page on until a short page.
   * For a page that never shows a count (History).
   */
  uncounted?: boolean;
}

/**
 * Pages through a query. `key` identifies the query: when it changes the list restarts, or restores its snapshot
 * when browseStore's policy allows (Back to this page). Pages load one at a time; a stale answer for an old key is
 * dropped.
 */
export function useBrowseItems(
  key: string,
  fetchPage: Fetch,
  { uncounted = false }: BrowseOptions = {},
): BrowseState {
  // Taken once, on mount: a snapshot is used at most once.
  const [initial] = useState<GridSnapshot | undefined>(() => takeSnapshot(key));
  const [items, setItems] = useState<BaseItem[]>(initial?.items ?? []);
  const [total, setTotal] = useState<number | null>(initial?.total ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [restoredScrollY, setRestoredScrollY] = useState<number | null>(initial?.scrollY ?? null);
  const [restoredSelectedId, setRestoredSelectedId] = useState<string | null>(initial?.selectedId ?? null);
  const generation = useRef(0);
  /** Where the next page starts on the server. Not items.length: de-duplication can make that stall. */
  const offset = useRef(initial?.offset ?? initial?.items.length ?? 0);
  const [done, setDone] = useState(initial ? snapshotDone(initial) : false);
  const state = useRef({ items, total, loading, done });
  state.current = { items, total, loading, done };
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const load = (reset: boolean): void => {
    const current = state.current;
    if (!reset && (current.loading || current.done)) return;
    const gen = reset ? ++generation.current : generation.current;
    const startIndex = reset ? 0 : offset.current;
    setLoading(true);
    setError(false);
    state.current = { ...current, loading: true };
    const query = uncounted
      ? { startIndex, limit: PAGE_SIZE, count: false }
      : { startIndex, limit: PAGE_SIZE };
    withTimeout(fetchRef.current(query), VIEW_TIMEOUT_MS)
      .then((page) => {
        if (gen !== generation.current) return;
        const base = reset ? [] : state.current.items;
        // Drop repeats: the library can change between pages.
        const seen = new Set(base.map((i) => i.Id));
        const next = [...base, ...page.Items.filter((i) => !seen.has(i.Id))];
        offset.current = startIndex + page.Items.length;
        setItems(next);
        // The end: a short page, or the server's offset reaching its count (shown as "N titles"). Only the first page
        // is counted (getBrowseItems' count): later pages keep its total. Uncounted, only a short page ends it.
        const short = page.Items.length < PAGE_SIZE;
        if (uncounted) {
          setDone(short);
          setTotal(next.length);
        } else {
          const counted = reset ? page.TotalRecordCount : (state.current.total ?? undefined);
          const count = short ? next.length : (counted ?? next.length);
          setDone(short || offset.current >= count);
          setTotal(count);
        }
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
      const snapshot = takeSnapshot(key);
      if (snapshot) {
        generation.current++;
        setItems(snapshot.items);
        setTotal(snapshot.total);
        offset.current = snapshot.offset ?? snapshot.items.length;
        setDone(snapshotDone(snapshot));
        setLoading(false);
        setError(false);
        setRestoredScrollY(snapshot.scrollY);
        setRestoredSelectedId(snapshot.selectedId ?? null);
        return;
      }
      setItems([]);
      setTotal(null);
      setDone(false);
      offset.current = 0;
      setRestoredScrollY(null);
      setRestoredSelectedId(null);
    }
    load(true);
  }, [key]);

  return {
    items,
    total,
    loading,
    error,
    restoredScrollY,
    restoredSelectedId,
    hasMore: !done,
    offset: offset.current,
    loadMore: () => load(false),
    retry: () => load(state.current.items.length === 0),
    remove: (itemId) => {
      const current = state.current;
      const next = current.items.filter((i) => i.Id !== itemId);
      if (next.length === current.items.length) return;
      offset.current = Math.max(0, offset.current - 1);
      state.current = { ...current, items: next };
      setItems(next);
      setTotal((t) => (t === null ? t : Math.max(0, t - 1)));
    },
    replace: (fresh) => setItems((list) => list.map((i) => (i.Id === fresh.Id ? { ...i, ...fresh } : i))),
  };
}

/** Whether a restored grid had loaded everything: as saved, or (older snapshots) its offset reached its count. */
function snapshotDone(snapshot: GridSnapshot): boolean {
  return snapshot.more !== undefined
    ? !snapshot.more
    : (snapshot.offset ?? snapshot.items.length) >= snapshot.total;
}
