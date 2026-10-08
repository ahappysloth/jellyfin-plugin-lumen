import { describe, expect, it, vi } from 'vitest';
import { once } from './once';

describe('once', () => {
  it('calls the function only the first time and caches the result', () => {
    const fn = vi.fn(() => 42);
    const cached = once(fn);
    expect(cached()).toBe(42);
    expect(cached()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
