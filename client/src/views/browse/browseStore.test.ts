import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrowseState,
  getChoice,
  hasSnapshot,
  removeFromSnapshots,
  replaceInSnapshots,
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

  it('takes a deleted title out of every saved grid, which then pages on from one earlier', () => {
    const a = { Id: 'a', Name: 'A', Type: 'Movie' };
    const b = { Id: 'b', Name: 'B', Type: 'Movie' };
    saveSnapshot('k1', { items: [a, b], total: 90, scrollY: 400, offset: 60, selectedId: 'a' });
    saveSnapshot('k2', { items: [b], total: 1, scrollY: 0 });
    removeFromSnapshots('a');
    expect(takeSnapshot('k1')).toEqual({
      items: [b],
      total: 89,
      scrollY: 400,
      offset: 59,
      // The card after it, for the TV layout to focus on Back.
      selectedId: 'b',
    });
    expect(takeSnapshot('k2')).toEqual({ items: [b], total: 1, scrollY: 0 });
  });

  it('selects the card before a deleted one that was the last, and none when the grid is left empty', () => {
    const a = { Id: 'a', Name: 'A', Type: 'Movie' };
    const b = { Id: 'b', Name: 'B', Type: 'Movie' };
    saveSnapshot('k1', { items: [a, b], total: 2, scrollY: 0, selectedId: 'b' });
    saveSnapshot('k2', { items: [b], total: 1, scrollY: 0, selectedId: 'b' });
    removeFromSnapshots('b');
    expect(takeSnapshot('k1')!.selectedId).toBe('a');
    expect(takeSnapshot('k2')!.selectedId).toBeUndefined();
  });

  it('shows an edited title as the server now has it, keeping what the grid had', () => {
    const a = { Id: 'a', Name: 'A', Type: 'Movie', UserData: { Played: true } };
    saveSnapshot('k', { items: [a], total: 1, scrollY: 0 });
    replaceInSnapshots({ Id: 'a', Name: 'A, renamed', Type: 'Movie' });
    expect(takeSnapshot('k')!.items).toEqual([{ ...a, Name: 'A, renamed' }]);
  });
});
