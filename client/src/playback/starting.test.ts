import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/preact';
import { clearStarting, showStarting, startingFor, startingInfo, useStartingButton } from './starting';

describe('starting playback', () => {
  afterEach(() => {
    clearStarting();
    vi.useRealTimers();
  });

  it("uses the show's name and art for an episode", () => {
    const client = { getUrl: (path: string) => `/${path}` };
    expect(
      startingFor(client, {
        Id: 'e1',
        Name: 'Pilot',
        Type: 'Episode',
        SeriesName: 'Lumen Show',
        ParentBackdropItemId: 's1',
        ParentBackdropImageTags: ['t'],
      }),
    ).toEqual({ title: 'Lumen Show', backdrop: '/Items/s1/Images/Backdrop' });
  });

  it('clears itself if the player never opens', () => {
    vi.useFakeTimers();
    showStarting({ title: 'Lumen Alpha', backdrop: null });
    expect(startingInfo()?.title).toBe('Lumen Alpha');
    vi.advanceTimersByTime(30_000);
    expect(startingInfo()).toBeNull();
  });

  it('frees a Play button whose play request never answers', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStartingButton<string>());
    act(() => result.current[1]('a', () => new Promise(() => undefined)));
    expect(result.current[0]).toBe('a');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current[0]).toBeNull();
  });

  it('a slow earlier click does not end a later one', async () => {
    let finishFirst!: () => void;
    const { result } = renderHook(() => useStartingButton<string>());
    act(() => result.current[1]('a', () => new Promise<void>((r) => (finishFirst = r))));
    act(() => result.current[1]('b', () => new Promise(() => undefined)));
    await act(async () => finishFirst());
    expect(result.current[0]).toBe('b');
  });
});
