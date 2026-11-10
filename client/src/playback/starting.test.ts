import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearStarting, showStarting, startingFor, startingInfo } from './starting';

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
});
