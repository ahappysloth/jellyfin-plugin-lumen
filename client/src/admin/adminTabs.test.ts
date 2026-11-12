import { describe, expect, it, vi } from 'vitest';
import { hashWithTab, rememberTab, tabFromHash } from './adminTabs';

describe('admin tabs in the URL', () => {
  it('reads the tab from the hash’s query, Settings when there is none', () => {
    expect(tabFromHash('#/configurationpage?name=Lumen&tab=storage')).toBe('storage');
    expect(tabFromHash('#/configurationpage?name=Lumen')).toBe('settings');
    expect(tabFromHash('#/configurationpage?name=Lumen&tab=nonsense')).toBe('settings');
    expect(tabFromHash('')).toBe('settings');
  });

  it('writes the tab beside the rest of the query, and leaves it out for Settings', () => {
    expect(hashWithTab('#/configurationpage?name=Lumen', 'storage')).toBe(
      '#/configurationpage?name=Lumen&tab=storage',
    );
    expect(hashWithTab('#/configurationpage?name=Lumen&tab=storage', 'settings')).toBe(
      '#/configurationpage?name=Lumen',
    );
    // The updates check keeps working with the tab in the URL.
    expect(hashWithTab('#/configurationpage?name=Lumen&check=updates', 'storage')).toBe(
      '#/configurationpage?name=Lumen&check=updates&tab=storage',
    );
  });

  it('remembers the tab with replaceState, keeping the router’s history state, and no navigation', () => {
    const replaceState = vi.fn();
    const state = { idx: 3, key: 'abc' };
    const win = {
      location: { hash: '#/configurationpage?name=Lumen' },
      history: { state, replaceState },
    } as unknown as Window;

    rememberTab('storage', win);
    expect(replaceState).toHaveBeenCalledWith(state, '', '#/configurationpage?name=Lumen&tab=storage');

    replaceState.mockClear();
    rememberTab('settings', win);
    expect(replaceState).not.toHaveBeenCalled(); // already the URL
  });
});
