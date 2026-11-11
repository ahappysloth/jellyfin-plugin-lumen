import { act, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { BaseItem, ItemsResult } from '../../api/types';
import { clearBrowseState, saveSnapshot } from './browseStore';
import { PAGE_SIZE, useBrowseItems } from './useBrowseItems';

const item = (id: string): BaseItem => ({ Id: id, Name: id, Type: 'Movie' });
const page = (prefix: string, n: number, total: number): ItemsResult => ({
  Items: Array.from({ length: n }, (_, i) => item(`${prefix}${i}`)),
  TotalRecordCount: total,
});

/** A fetch whose answers the test hands out by hand. */
function deferredFetch() {
  const calls: {
    startIndex?: number;
    count?: boolean;
    resolve: (r: ItemsResult) => void;
    reject: () => void;
  }[] = [];
  const fetch = (q: { startIndex?: number; count?: boolean }) =>
    new Promise<ItemsResult>((resolve, reject) =>
      calls.push({
        startIndex: q.startIndex,
        count: q.count,
        resolve,
        reject: () => reject(new Error('down')),
      }),
    );
  return { calls, fetch };
}

/** Answers a request and lets the hook take the answer in. */
const settle = (answer: () => void) =>
  act(async () => {
    answer();
    await new Promise((r) => setTimeout(r, 0));
  });

describe('useBrowseItems', () => {
  afterEach(() => clearBrowseState());

  it('restores a saved grid at mount without fetching, and resumes paging from its offset', async () => {
    saveSnapshot('k', {
      items: [item('a'), item('b')],
      total: 200,
      scrollY: 900,
      offset: PAGE_SIZE,
      selectedId: 'b',
    });
    const { calls, fetch } = deferredFetch();
    const { result } = renderHook(() => useBrowseItems('k', fetch));

    expect(result.current.items.map((i) => i.Id)).toEqual(['a', 'b']);
    expect(result.current.restoredScrollY).toBe(900);
    expect(result.current.restoredSelectedId).toBe('b');
    expect(result.current.hasMore).toBe(true);
    expect(calls).toHaveLength(0);

    act(() => result.current.loadMore());
    expect(calls[0]!.startIndex).toBe(PAGE_SIZE);
  });

  it('a snapshot is used once: the next mount loads fresh', async () => {
    saveSnapshot('k', { items: [item('old')], total: 1, scrollY: 50 });
    const first = renderHook(() => useBrowseItems('k', deferredFetch().fetch));
    expect(first.result.current.items).toHaveLength(1);
    first.unmount();

    const { calls, fetch } = deferredFetch();
    const second = renderHook(() => useBrowseItems('k', fetch));
    expect(second.result.current.items).toHaveLength(0);
    expect(second.result.current.restoredScrollY).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('restarts on a key change, restoring that key’s snapshot if there is one', async () => {
    const { calls, fetch } = deferredFetch();
    const { result, rerender } = renderHook(({ k }) => useBrowseItems(k, fetch), {
      initialProps: { k: 'a' },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(() => calls[0]!.resolve(page('a', 3, 3)));
    expect(result.current.total).toBe(3);

    saveSnapshot('b', { items: [item('b0')], total: 1, scrollY: 300 });
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.items.map((i) => i.Id)).toEqual(['b0']));
    expect(result.current.restoredScrollY).toBe(300);
    expect(result.current.hasMore).toBe(false);
    expect(calls).toHaveLength(1);

    rerender({ k: 'c' });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBeNull();
    expect(result.current.restoredScrollY).toBeNull();
  });

  it('drops a late answer for a query that has since changed', async () => {
    const { calls, fetch } = deferredFetch();
    const { result, rerender } = renderHook(({ k }) => useBrowseItems(k, fetch), {
      initialProps: { k: 'old' },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ k: 'new' });
    await waitFor(() => expect(calls).toHaveLength(2));

    await settle(() => calls[1]!.resolve(page('new', 2, 2)));
    await settle(() => calls[0]!.resolve(page('old', 5, 5)));
    expect(result.current.items.map((i) => i.Id)).toEqual(['new0', 'new1']);
    expect(result.current.total).toBe(2);
  });

  it('loads one page at a time, and retries the page that failed', async () => {
    const { calls, fetch } = deferredFetch();
    const { result } = renderHook(() => useBrowseItems('k', fetch));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(() => calls[0]!.resolve(page('p', PAGE_SIZE, PAGE_SIZE * 2)));

    act(() => result.current.loadMore());
    act(() => result.current.loadMore()); // ignored: a page is already on its way
    expect(calls).toHaveLength(2);
    await settle(() => calls[1]!.reject());
    expect(result.current.error).toBe(true);
    expect(result.current.items).toHaveLength(PAGE_SIZE); // what was loaded stays

    act(() => result.current.retry());
    expect(calls[2]!.startIndex).toBe(PAGE_SIZE);
    await settle(() => calls[2]!.resolve(page('q', PAGE_SIZE, PAGE_SIZE * 2)));
    expect(result.current.error).toBe(false);
    expect(result.current.items).toHaveLength(PAGE_SIZE * 2);
    expect(result.current.hasMore).toBe(false);
  });

  it("keeps the first page's count: later pages aren't counted (their TotalRecordCount is just the page)", async () => {
    const { calls, fetch } = deferredFetch();
    const { result } = renderHook(() => useBrowseItems('k', fetch));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(() => calls[0]!.resolve(page('p', PAGE_SIZE, PAGE_SIZE * 3)));
    act(() => result.current.loadMore());
    await settle(() => calls[1]!.resolve(page('q', PAGE_SIZE, PAGE_SIZE)));
    expect(result.current.total).toBe(PAGE_SIZE * 3);
    expect(result.current.hasMore).toBe(true);
  });

  it('uncounted: never asks for a count, and pages on until a short page', async () => {
    const { calls, fetch } = deferredFetch();
    const { result } = renderHook(() => useBrowseItems('k', fetch, { uncounted: true }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.count).toBe(false);
    // An uncounted answer's TotalRecordCount means nothing.
    await settle(() => calls[0]!.resolve(page('p', PAGE_SIZE, 0)));
    expect(result.current.total).toBe(PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    expect(calls[1]).toMatchObject({ startIndex: PAGE_SIZE, count: false });
    await settle(() => calls[1]!.resolve(page('q', 3, 0)));
    expect(result.current.total).toBe(PAGE_SIZE + 3);
    expect(result.current.hasMore).toBe(false);
  });

  it('a restored uncounted grid keeps paging if it had more (its total is only what was loaded)', async () => {
    const items = Array.from({ length: PAGE_SIZE }, (_, i) => item(`p${i}`));
    saveSnapshot('k', { items, total: PAGE_SIZE, scrollY: 0, offset: PAGE_SIZE, more: true });
    const { calls, fetch } = deferredFetch();
    const { result } = renderHook(() => useBrowseItems('k', fetch, { uncounted: true }));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    expect(calls[0]!.startIndex).toBe(PAGE_SIZE);
  });

  it('retries from the start when the first page failed', async () => {
    const { calls, fetch } = deferredFetch();
    const { result } = renderHook(() => useBrowseItems('k', fetch));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(() => calls[0]!.reject());
    expect(result.current.error).toBe(true);

    act(() => result.current.retry());
    expect(calls[1]!.startIndex).toBe(0);
    await settle(() => calls[1]!.resolve(page('p', 2, 2)));
    expect(result.current.total).toBe(2);
  });
});
