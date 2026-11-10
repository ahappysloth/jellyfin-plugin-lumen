import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import * as compat from '../../compat/playbackManager';
import { clearStarting, showStarting } from '../../playback/starting';
import { LazyPlayer, loadPlayer } from './lazyPlayer';

describe('LazyPlayer', () => {
  afterEach(() => {
    clearStarting();
    vi.restoreAllMocks();
  });

  it("shows the loading screen until the player's code is in, then the player", async () => {
    // No playback manager: the player hands the page back once it runs, which shows it has loaded.
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(null);
    showStarting({ title: 'Lumen Alpha', backdrop: null });
    const ctx = makeContext(createFakeClient());
    const onFallback = vi.spyOn(ctx, 'onFallback');

    render(<LazyPlayer ctx={ctx} />);
    expect(screen.getByRole('status', { name: /starting/i })).toHaveTextContent('Lumen Alpha');

    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
  });

  it('loads the code once, however often it is asked for', async () => {
    expect(loadPlayer()).toBe(loadPlayer());
    expect(typeof (await loadPlayer()).PlayerView).toBe('function');
  });
});
