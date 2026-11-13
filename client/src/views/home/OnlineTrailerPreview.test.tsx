import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { OnlineTrailerPreview } from './OnlineTrailerPreview';
import { YOUTUBE_DWELL_MS } from './YouTubePreview';

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
    answer({ ImdbUrl: URL_720 });
    rerender(<OnlineTrailerPreview lookup={lookup} delaySeconds={1.5} client={createFakeClient()} paused />);

    // A second after it was asked, the answer: half a second of the delay is left.
    await run(499);
    expect(container.querySelector('video')).toBeNull();
    await run(1);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_720);
    expect(lookup).toHaveBeenCalledTimes(1);
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
});
