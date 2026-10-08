import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes through a result that arrives in time and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes through a rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 100)).rejects.toThrow('nope');
  });

  it('rejects when nothing arrives in time and ignores a late result', async () => {
    let resolve: (value: number) => void = () => undefined;
    const result = withTimeout(new Promise<number>((r) => (resolve = r)), 100);
    const settled = expect(result).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);
    await settled;
    resolve(1);
  });
});
