import { afterEach, describe, expect, it, vi } from 'vitest';
import { newUuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when it is available', () => {
    const randomUUID = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(newUuid()).toBe('11111111-1111-4111-8111-111111111111');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('builds a v4 UUID from getRandomValues in insecure contexts', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    const a = newUuid();
    expect(a).toMatch(V4);
    expect(newUuid()).not.toBe(a);
  });

  it('sets the version and variant bits regardless of the random bytes', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
    });
    expect(newUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});
