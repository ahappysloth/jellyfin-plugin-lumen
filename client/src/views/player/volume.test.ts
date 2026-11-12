import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_ICONS } from './playerIcons';
import { throttle, volumeIcon } from './volume';

describe('volumeIcon', () => {
  it('strikes the speaker through when muted or at 0', () => {
    expect(volumeIcon(0, false)).toBe('volumeOff');
    expect(volumeIcon(80, true)).toBe('volumeOff');
  });

  it('shows one wave up to a third, two up to two thirds, three above', () => {
    expect(volumeIcon(1, false)).toBe(PLAYER_ICONS.volumeLow);
    expect(volumeIcon(33, false)).toBe(PLAYER_ICONS.volumeLow);
    expect(volumeIcon(34, false)).toBe(PLAYER_ICONS.volumeMid);
    expect(volumeIcon(66, false)).toBe(PLAYER_ICONS.volumeMid);
    expect(volumeIcon(67, false)).toBe('volumeHigh');
    expect(volumeIcon(100, false)).toBe('volumeHigh');
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls at once, then at most every interval with the latest value', () => {
    const fn = vi.fn();
    const t = throttle(fn, 50);
    t.call(1);
    t.call(2);
    t.call(3);
    expect(fn.mock.calls).toEqual([[1]]);
    expect(t.pending()).toBe(true);
    vi.advanceTimersByTime(50);
    expect(fn.mock.calls).toEqual([[1], [3]]);
    expect(t.pending()).toBe(false);
    vi.advanceTimersByTime(100);
    t.call(4); // a while since the last: at once again
    expect(fn.mock.calls).toEqual([[1], [3], [4]]);
  });

  it('sends what is waiting on flush, and nothing twice', () => {
    const fn = vi.fn();
    const t = throttle(fn, 50);
    t.call(1);
    t.call(2);
    t.flush();
    expect(fn.mock.calls).toEqual([[1], [2]]);
    vi.advanceTimersByTime(100);
    t.flush();
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });
});
