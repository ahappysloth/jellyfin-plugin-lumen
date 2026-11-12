import { describe, expect, it } from 'vitest';
import { initialTab, rememberTab } from './adminTabs';

function memoryStore(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

describe('admin tabs across a reload', () => {
  it('opens the tab a link names, else the one last open in this browser tab, else Settings', () => {
    const store = memoryStore();
    expect(initialTab('#/configurationpage?name=Lumen', store)).toBe('settings');
    expect(initialTab('#/configurationpage?name=Lumen&tab=storage', store)).toBe('storage');
    expect(initialTab('#/configurationpage?name=Lumen&tab=nonsense', store)).toBe('settings');

    rememberTab('storage', store);
    expect(initialTab('#/configurationpage?name=Lumen', store)).toBe('storage');
    expect(initialTab('#/configurationpage?name=Lumen&tab=settings', store)).toBe('settings');
    rememberTab('settings', store);
    expect(initialTab('#/configurationpage?name=Lumen', store)).toBe('settings');
  });

  it('works without storage, or with storage that refuses', () => {
    expect(initialTab('#/configurationpage?name=Lumen', null)).toBe('settings');
    const refusing = {
      ...memoryStore(),
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as Storage;
    expect(() => rememberTab('storage', refusing)).not.toThrow();
    expect(initialTab('', refusing)).toBe('settings');
  });
});
