import { describe, expect, it } from 'vitest';
import { END_MARGIN_MS, SKIP_KEYS, SKIP_MS, skipTarget } from './skip';

describe('skipTarget', () => {
  it('goes 10 s back or on', () => {
    expect(SKIP_MS).toBe(10_000);
    expect(skipTarget(60_000, 600_000, 'back')).toBe(50_000);
    expect(skipTarget(60_000, 600_000, 'forward')).toBe(70_000);
  });

  it('stops at the start going back', () => {
    expect(skipTarget(4_000, 600_000, 'back')).toBe(0);
  });

  it('stops short of the end going forward, and never goes back doing so', () => {
    expect(skipTarget(595_000, 600_000, 'forward')).toBe(600_000 - END_MARGIN_MS);
    expect(skipTarget(599_500, 600_000, 'forward')).toBe(599_500);
  });

  it('goes on 10 s when the length is unknown', () => {
    expect(skipTarget(60_000, 0, 'forward')).toBe(70_000);
  });
});

describe('SKIP_KEYS', () => {
  it("are jellyfin-web's seek shortcuts: the arrows, and J and L", () => {
    expect(SKIP_KEYS).toEqual({
      ArrowLeft: 'back',
      Left: 'back',
      j: 'back',
      ArrowRight: 'forward',
      Right: 'forward',
      l: 'forward',
    });
  });
});
