import { describe, expect, it, vi } from 'vitest';
import type { LumenApi } from '../../api/lumenApi';
import { clearCachedHome, fetchHome, getCachedHome, isEmptyHome, setCachedHome } from './homeStore';

const home = { ConfigVersion: 1, Hero: [], Rows: [] };

describe('homeStore', () => {
  it('keeps only the current user', () => {
    setCachedHome('a', home);
    setCachedHome('b', home);

    expect(getCachedHome('a')).toBeUndefined();
    expect(getCachedHome('b')).toBe(home);
  });

  it('clears the cached home for that user only', () => {
    setCachedHome('a', home);
    clearCachedHome('b');
    expect(getCachedHome('a')).toBe(home);
    clearCachedHome('a');
    expect(getCachedHome('a')).toBeUndefined();
  });

  it('retries once', async () => {
    const getHome = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(home);

    await expect(fetchHome({ getHome } as unknown as LumenApi, 0)).resolves.toBe(home);
    expect(getHome).toHaveBeenCalledTimes(2);
  });

  it('detects empty homes', () => {
    expect(isEmptyHome(home)).toBe(true);
  });
});
