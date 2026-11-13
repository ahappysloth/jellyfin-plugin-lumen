import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { OnlineTrailerPreview } from './OnlineTrailerPreview';
import { YOUTUBE_DWELL_MS } from './YouTubePreview';
import { lastAttempt } from '../trailerInfo/deviceLog';

const URL_720 = 'https://imdb-video.media-imdb.com/vi1/a.mp4?Expires=1&Signature=s';

/** Runs the clock `ms` on, in steps: effects that an act() schedules run as it ends. */
const run = async (ms: number) => {
  for (const step of [0, ms]) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
  }
};

describe('OnlineTrailerPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); // jsdom has no media playback
  });
  afterEach(() => {
    cleanup(); // while timers are still fake (see TrailerPreview.test)
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.classList.remove('layout-tv');
  });

  it("plays IMDb's MP4 in a <video>, not YouTube's player, when it has both", async () => {
    const { container } = render(
      <OnlineTrailerPreview
        imdbUrl={URL_720}
        youTubeId="dQw4w9WgXcQ"
        delaySeconds={0}
        client={createFakeClient()}
      />,
    );
    await run(0);

    expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_720);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it("falls back to YouTube's when IMDb's file won't play here, and only then says it's over", async () => {
    const onFinish = vi.fn();
    const { container } = render(
      <OnlineTrailerPreview
        imdbUrl={URL_720}
        youTubeId="dQw4w9WgXcQ"
        delaySeconds={0}
        client={createFakeClient()}
        onFinish={onFinish}
      />,
    );
    await run(0);
    // Refused (a proxy's policy, an ad blocker, IMDb): the <video> errors before it ever played.
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    await run(YOUTUBE_DWELL_MS);

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('iframe')!.getAttribute('src')).toContain('/embed/dQw4w9WgXcQ?');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("without YouTube's to fall back on, a file that won't play is simply over", async () => {
    const onFinish = vi.fn();
    const { container } = render(
      <OnlineTrailerPreview
        imdbUrl={URL_720}
        delaySeconds={0}
        client={createFakeClient()}
        onFinish={onFinish}
      />,
    );
    await run(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    await run(YOUTUBE_DWELL_MS);

    expect(container.querySelector('iframe')).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("plays YouTube's when that's all there is, but not on a TV", async () => {
    const { container, unmount } = render(
      <OnlineTrailerPreview youTubeId="dQw4w9WgXcQ" delaySeconds={0} client={createFakeClient()} />,
    );
    await run(YOUTUBE_DWELL_MS);
    expect(container.querySelector('iframe')).not.toBeNull();
    unmount();

    document.documentElement.classList.add('layout-tv');
    const tv = render(
      <OnlineTrailerPreview youTubeId="dQw4w9WgXcQ" delaySeconds={0} client={createFakeClient()} />,
    );
    await run(5000);
    expect(tv.container).toBeEmptyDOMElement();
  });

  it('looks the trailer up once, the wait for the answer counting towards the delay', async () => {
    let answer: (value: { ImdbUrl: string }) => void = () => {};
    const lookup = vi.fn(() => new Promise<{ ImdbUrl: string }>((resolve) => (answer = resolve)));
    const { container, rerender } = render(
      <OnlineTrailerPreview lookup={lookup} delaySeconds={1.5} client={createFakeClient()} />,
    );
    await run(1000);
    expect(container).toBeEmptyDOMElement();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    answer({ ImdbUrl: URL_720 });
    rerender(<OnlineTrailerPreview lookup={lookup} delaySeconds={1.5} client={createFakeClient()} />);

    // A second after it was asked, the answer: the video loads at once, and plays as half a second of the delay is up
    // (less the moment it takes to get under way).
    await run(0);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_720);
    await run(249);
    expect(play).not.toHaveBeenCalled();
    await run(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("a title page's lookup brings IMDb's 1080p file, played where the box needs it; then 720p, then YouTube's", async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(660);
    vi.stubGlobal('devicePixelRatio', 3);
    const hd = 'https://imdb-video.media-imdb.com/vi1/a_1080p.mp4';
    const lookup = () => Promise.resolve({ ImdbUrl: URL_720, ImdbUrlHd: hd, YouTubeId: 'dQw4w9WgXcQ' });
    try {
      const { container } = render(
        <OnlineTrailerPreview lookup={lookup} delaySeconds={1} client={createFakeClient()} />,
      );
      await run(0);
      expect(container.querySelector('video')!.getAttribute('src')).toBe(hd);

      act(() => {
        container.querySelector('video')!.dispatchEvent(new Event('error'));
      });
      expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_720);

      act(() => {
        container.querySelector('video')!.dispatchEvent(new Event('error'));
      });
      await run(YOUTUBE_DWELL_MS);
      expect(container.querySelector('video')).toBeNull();
      expect(container.querySelector('iframe')).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows nothing when the server knows of no trailer, or the lookup fails', async () => {
    for (const lookup of [() => Promise.resolve({}), () => Promise.reject(new Error('502'))]) {
      const { container, unmount } = render(
        <OnlineTrailerPreview lookup={lookup} delaySeconds={0} client={createFakeClient()} />,
      );
      await run(1000);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('notes on a TV that YouTube’s was skipped, and a lookup that failed or found nothing', async () => {
    document.documentElement.classList.add('layout-tv');
    render(
      <OnlineTrailerPreview
        youTubeId="dQw4w9WgXcQ"
        delaySeconds={0}
        client={createFakeClient()}
        logKey="m1"
      />,
    );
    await run(0);
    expect(lastAttempt('m1')).toMatchObject({
      tv: true,
      steps: [{ source: 'youtube', outcome: 'skipped', message: 'tv' }],
    });
    cleanup();
    document.documentElement.classList.remove('layout-tv');

    render(
      <OnlineTrailerPreview
        lookup={() => Promise.reject({ status: 502 })}
        delaySeconds={0}
        client={createFakeClient()}
        logKey="m2"
      />,
    );
    await run(0);
    expect(lastAttempt('m2')!.steps).toEqual([{ source: 'lookup', outcome: 'error', code: 502 }]);

    render(
      <OnlineTrailerPreview
        lookup={() => Promise.resolve({})}
        delaySeconds={0}
        client={createFakeClient()}
        logKey="m3"
      />,
    );
    await run(0);
    expect(lastAttempt('m3')!.steps).toEqual([{ source: 'lookup', outcome: 'none' }]);
    sessionStorage.clear();
  });

  it("notes IMDb's file failing, then YouTube's tried, as one attempt", async () => {
    const { container } = render(
      <OnlineTrailerPreview
        imdbUrl={URL_720}
        youTubeId="dQw4w9WgXcQ"
        delaySeconds={0}
        client={createFakeClient()}
        logKey="m1"
      />,
    );
    await run(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    await run(YOUTUBE_DWELL_MS);
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(lastAttempt('m1')!.steps).toEqual([
      { source: 'imdb', quality: 'main', outcome: 'error' },
      { source: 'youtube', outcome: 'pending' },
    ]);
    sessionStorage.clear();
  });
});
