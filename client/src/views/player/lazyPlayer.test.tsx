import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { clearStarting } from '../../playback/starting';
import { loadPlayer } from './lazyPlayer';

describe('LazyPlayer', () => {
  afterEach(() => {
    clearStarting();
    vi.restoreAllMocks();
  });

  it("shows the loading screen until the player's code is in, then the player", async () => {
    // A module that hasn't loaded the player yet, whatever ran before (its own copies of what it imports).
    vi.resetModules();
    const fresh = await import('./lazyPlayer');
    const starting = await import('../../playback/starting');
    starting.showStarting({ title: 'Lumen Alpha', backdrop: null });
    const ctx = makeContext(createFakeClient());
    const onFallback = vi.spyOn(ctx, 'onFallback');

    render(<fresh.LazyPlayer ctx={ctx} />);
    expect(screen.getByRole('status', { name: /starting/i })).toHaveTextContent('Lumen Alpha');

    // No playback manager in tests: the player hands the page back once it runs, which shows it has loaded.
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
    starting.clearStarting();
  });

  it('hands the page to the stock player if the code takes too long', async () => {
    vi.resetModules();
    vi.doMock('./PlayerView', () => new Promise(() => undefined)); // a download that never finishes
    vi.useFakeTimers();
    try {
      const fresh = await import('./lazyPlayer');
      const ctx = makeContext(createFakeClient());
      const onFallback = vi.spyOn(ctx, 'onFallback');
      render(<fresh.LazyPlayer ctx={ctx} />);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(onFallback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(onFallback).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.doUnmock('./PlayerView');
      vi.resetModules();
    }
  });

  it('loads the code once, however often it is asked for', async () => {
    expect(loadPlayer()).toBe(loadPlayer());
    expect(typeof (await loadPlayer()).PlayerView).toBe('function');
  });
});
