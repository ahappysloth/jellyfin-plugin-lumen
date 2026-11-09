import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrowseState,
  getChoice,
  hasSnapshot,
  saveChoice,
  saveSnapshot,
  SNAPSHOT_TTL_MS,
  takeSnapshot,
} from './browseStore';

const snap = (scrollY: number) => ({ items: [], total: 0, scrollY });

/** Stands in for the Navigation API: the current history entry's key. */
function stubNavigation(key: string) {
  const navigation = { currentEntry: { key } };
  vi.stubGlobal('navigation', navigation);
  return (next: string) => (navigation.currentEntry = { key: next });
}

describe('browseStore', () => {
  afterEach(() => {
    clearBrowseState();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the 12 most recently saved grids, evicting the oldest first', () => {
    for (let i = 0; i < 13; i++) saveSnapshot(`k${i}`, snap(i));
    expect(hasSnapshot('k0')).toBe(false);
    expect(hasSnapshot('k1')).toBe(true);
    expect(hasSnapshot('k12')).toBe(true);

    // Saving again refreshes a key's place: k1 survives the next eviction, k2 doesn't.
    saveSnapshot('k1', snap(100));
    saveSnapshot('k13', snap(13));
    expect(hasSnapshot('k1')).toBe(true);
    expect(hasSnapshot('k2')).toBe(false);
    expect(takeSnapshot('k1')?.scrollY).toBe(100);
  });

  it('uses a snapshot once', () => {
    saveSnapshot('k', snap(5));
    expect(takeSnapshot('k')?.scrollY).toBe(5);
    expect(takeSnapshot('k')).toBeUndefined();
  });

  it('with the Navigation API, restores only on a return to the same history entry', () => {
    const goTo = stubNavigation('grid-entry');
    saveSnapshot('k', snap(5));
    goTo('details-entry');
    goTo('grid-entry'); // Back
    expect(takeSnapshot('k')?.scrollY).toBe(5);

    saveSnapshot('k', snap(6));
    goTo('another-visit'); // the nav link: a new entry
    expect(takeSnapshot('k')).toBeUndefined();
    expect(hasSnapshot('k')).toBe(false); // and it's gone for good
  });

  it('without it, restores only within a short time', () => {
    vi.useFakeTimers();
    saveSnapshot('a', snap(1));
    saveSnapshot('b', snap(2));
    vi.advanceTimersByTime(SNAPSHOT_TTL_MS - 1);
    expect(takeSnapshot('a')?.scrollY).toBe(1);
    vi.advanceTimersByTime(2);
    expect(takeSnapshot('b')).toBeUndefined();
  });

  it('remembers choices separately from grids', () => {
    saveChoice('c', { sort: 'title' });
    saveSnapshot('k', snap(1));
    takeSnapshot('k');
    expect(getChoice('c', null)).toEqual({ sort: 'title' });
    clearBrowseState();
    expect(getChoice('c', 'fallback')).toBe('fallback');
  });
});
