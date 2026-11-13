import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSourceInfo } from '../../api/types';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { resetSessionCaches } from '../../util/sessionCaches';
import { TRAILER_FADE_MS, TRAILER_START_TIMEOUT_MS, TrailerPreview } from './TrailerPreview';
import { TRAILER_HOLD_MS } from './trailerTiming';
import { lastAttempt } from '../trailerInfo/deviceLog';

const MKV_HEVC: MediaSourceInfo = {
  Id: 'ms1',
  Container: 'mkv',
  MediaStreams: [
    { Type: 'Video', Index: 0, Codec: 'hevc', Profile: 'Main 10', Level: 150, BitDepth: 10 },
    { Type: 'Audio', Index: 1, Codec: 'aac', Profile: 'LC', Channels: 2 },
  ],
};
const MP4_H264: MediaSourceInfo = {
  Id: 'ms1',
  Container: 'mov,mp4,m4a,3gp,3g2,mj2',
  MediaStreams: [
    { Type: 'Video', Index: 0, Codec: 'h264', Profile: 'High', Level: 40, BitDepth: 8 },
    { Type: 'Audio', Index: 1, Codec: 'aac', Profile: 'LC', Channels: 2 },
  ],
};

/** jellyfin-web's ApiClient serving the trailer item, and accepting a transcode stop. */
const clientFor = (source: MediaSourceInfo) =>
  createFakeClient(
    routes({
      'Items/t1': { Id: 't1', Name: 'Trailer', Type: 'Trailer', MediaSources: [source] },
      'Videos/ActiveEncodings': undefined,
    }),
  );

interface FakeBrowser {
  userAgent: string;
  plays: RegExp[];
}
const SAFARI: FakeBrowser = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  plays: [/^video\/mp4; codecs="avc1\.64/, /^application\/vnd\.apple\.mpegurl$/],
};
// Chrome answers "maybe" for HLS as well.
const CHROME: FakeBrowser = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  plays: [/^video\/mp4; codecs="avc1\.64/, /^application\/vnd\.apple\.mpegurl$/],
};

/** Run as this browser: its user agent, and canPlayType saying yes to the types it plays. */
const runAs = (browser: FakeBrowser) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(browser.userAgent);
  return vi
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockImplementation((type) => (browser.plays.some((pattern) => pattern.test(type)) ? 'probably' : ''));
};

const srcOf = (container: Element) => new URL(container.querySelector('video')!.getAttribute('src')!);

/**
 * Lets the trailer's item load, then `ms` pass. Effects an act() schedules run as it ends, so this takes rounds: the
 * first resolves the item fetch, whose plan starts the delay's timer; the second runs out the delay.
 */
const startAfter = async (ms: number) => {
  for (const step of [0, ms]) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
  }
};

/** Lets `ms` pass, in one act(). */
const run = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** An IntersectionObserver whose entries the test sets: in view to begin with. */
const observeViewport = () => {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe() {
        this.callback(
          [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
          this as never,
        );
      }
      disconnect() {}
    },
  );
  return (on: boolean) =>
    act(() => {
      for (const callback of callbacks)
        callback(
          [{ isIntersecting: on, intersectionRatio: on ? 1 : 0 } as IntersectionObserverEntry],
          {} as never,
        );
    });
};

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

describe('TrailerPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no media playback.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    // Unmount while timers are still fake: Preact flushes effects on a timer, and one scheduled on a real timer can
    // fire after Vitest tears down jsdom ("document is not defined").
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetSessionCaches();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('starts a muted, authenticated, static trailer after the delay', async () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={4} client={createFakeClient()} />,
    );
    await startAfter(0);
    expect(container.querySelector('video')).toBeNull();

    await startAfter(4000);

    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.getAttribute('src')).toBe('http://jf/Videos/t1/stream?static=true&ApiKey=token1');
  });

  it("plays a trailer online (IMDb's MP4) from its own address, asking the server nothing, after the delay", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const client = createFakeClient();
    const url = 'https://imdb-video.media-imdb.com/vi1/a.mp4?Expires=1&Signature=s';
    const { container } = render(<TrailerPreview src={url} delaySeconds={5} client={client} />);
    // Nothing is fetched until 3 s before the delay is up: no <video> at all yet.
    await run(2000 - 1);
    expect(container.querySelector('video')).toBeNull();

    // Then it's put in place to load, paused, ...
    await run(1);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(url);
    expect(video.muted).toBe(true);
    expect(video.getAttribute('preload')).toBe('auto');
    expect(play).not.toHaveBeenCalled();

    // ... and played a quarter of a second before the delay is up, as long as it takes to get under way: it shows as
    // the delay ends.
    await run(2750 - 1);
    expect(play).not.toHaveBeenCalled();
    await run(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
    expect(client.requests).toHaveLength(0);
  });

  it('shows as soon as it is under way, not a timeupdate later', async () => {
    const time = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0);
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={1}
        client={createFakeClient()}
      />,
    );
    await run(750);
    const video = container.querySelector('video')!;
    act(() => {
      video.dispatchEvent(new Event('playing'));
    });
    time.mockReturnValue(0.26);
    // No timeupdate: it looks again itself, as it should be under way.
    await run(300);
    expect(video).toHaveClass('is-shown');
  });

  it('releases a video still loading for the delay when it goes, download included', async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const { container, unmount } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={4}
        client={createFakeClient()}
      />,
    );
    await run(1000);
    const video = container.querySelector('video')!;
    const load = (video.load = vi.fn());
    expect(play).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute('src')).toBe(false);
  });

  it('plays the 1080p file where the box needs more than 720p, the 720p one where it does not', async () => {
    const sd = 'https://imdb-video.media-imdb.com/vi1/a_720p.mp4';
    const hd = 'https://imdb-video.media-imdb.com/vi1/a_1080p.mp4';
    const size = (width: number, height: number) => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
    };
    const fileFor = async (ratio: number) => {
      vi.stubGlobal('devicePixelRatio', ratio);
      const { container, unmount } = render(
        <TrailerPreview src={sd} srcHd={hd} delaySeconds={0} client={createFakeClient()} />,
      );
      await run(0);
      const file = container.querySelector('video')!.getAttribute('src');
      unmount();
      return file;
    };

    // An iPhone in portrait: a third of the picture's width over 660 px at 3x.
    size(390, 660);
    expect(await fileFor(3)).toBe(hd);
    // A desktop's banner.
    size(1440, 890);
    expect(await fileFor(1)).toBe(hd);
    // A small one.
    size(1024, 560);
    expect(await fileFor(1)).toBe(sd);
    // Without a 1080p file, the one there is.
    const { container } = render(<TrailerPreview src={sd} delaySeconds={0} client={createFakeClient()} />);
    size(390, 660);
    await run(0);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(sd);
  });

  it('falls back to the 720p file when the 1080p one fails or stalls', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1080);
    const sd = 'https://imdb-video.media-imdb.com/vi1/a_720p.mp4';
    const hd = 'https://imdb-video.media-imdb.com/vi1/a_1080p.mp4';
    const onFinish = vi.fn();
    const { container } = render(
      <TrailerPreview src={sd} srcHd={hd} delaySeconds={0} client={createFakeClient()} onFinish={onFinish} />,
    );
    await run(0);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(hd);

    await run(TRAILER_START_TIMEOUT_MS);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(sd);
    expect(onFinish).not.toHaveBeenCalled();

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    await run(0);
    expect(container.querySelector('video')).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('shows a trailer online only once it is under way, as a local one, and gives up on it after an error', async () => {
    const time = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0);
    const onPlayingChange = vi.fn();
    const onFinish = vi.fn();
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={0}
        client={createFakeClient()}
        onPlayingChange={onPlayingChange}
        onFinish={onFinish}
      />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    expect(video).not.toHaveClass('is-shown');
    time.mockReturnValue(0.3);
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(video).toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);

    // A lapsed address or a blocked CDN: no other way to play it, so the backdrop comes back.
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('video')).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('plays the file as it is when the browser can play its container and codecs', async () => {
    const canPlayType = runAs(SAFARI);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} />,
    );
    await startAfter(0);

    expect(canPlayType).toHaveBeenCalledWith('video/mp4; codecs="avc1.640028, mp4a.40.2"');
    expect(container.querySelector('video')!.getAttribute('src')).toBe(
      'http://jf/Videos/t1/stream?static=true&ApiKey=token1',
    );
  });

  it('looks the trailer up once per session', async () => {
    const client = clientFor(MP4_H264);
    render(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    await startAfter(0);
    cleanup();
    render(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    await startAfter(0);

    expect(client.requests.filter((r) => r.url.includes('/Items/t1'))).toHaveLength(1);
  });

  it('transcodes HEVC in Matroska to HLS on Apple WebKit, where the caller allows it (details)', async () => {
    runAs(SAFARI);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MKV_HEVC)} allowTranscode />,
    );
    await startAfter(0);

    const src = srcOf(container);
    expect(src.pathname).toBe('/Videos/t1/master.m3u8');
    expect(Object.fromEntries(src.searchParams)).toMatchObject({
      MediaSourceId: 'ms1',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      MaxWidth: '1280',
      ApiKey: 'token1',
    });
  });

  it('transcodes to a progressive MP4 elsewhere, though Chrome answers "maybe" for HLS', async () => {
    runAs(CHROME);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MKV_HEVC)} allowTranscode />,
    );
    await startAfter(0);

    expect(srcOf(container).pathname).toBe('/Videos/t1/stream.mp4');
  });

  it('does not transcode by default (hero slides): no preview of a file the browser cannot play', async () => {
    runAs(SAFARI);
    const client = clientFor(MKV_HEVC);
    const { container } = render(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    await startAfter(1000);

    expect(container.querySelector('video')).toBeNull();
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Items/t1']);
  });

  it('does not transcode for a user the server will not transcode for', async () => {
    runAs(SAFARI);
    const client = clientFor({ ...MKV_HEVC, SupportsTranscoding: false });
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} allowTranscode />,
    );
    await startAfter(1000);

    expect(container.querySelector('video')).toBeNull();
  });

  it('stops the transcode on the server when the preview goes', async () => {
    runAs(SAFARI);
    const client = clientFor(MKV_HEVC);
    const { container, unmount } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} allowTranscode />,
    );
    await startAfter(0);
    const session = srcOf(container).searchParams;

    act(() => {
      unmount();
    });

    const stop = client.requests.find((r) => r.type === 'DELETE')!;
    const query = new URL(stop.url).searchParams;
    expect(new URL(stop.url).pathname).toBe('/Videos/ActiveEncodings');
    expect(query.get('playSessionId')).toBe(session.get('PlaySessionId'));
    expect(query.get('deviceId')).toBe('dev+ice');
    expect(session.get('DeviceId')).toBe('dev+ice');
  });

  it('stops the transcode with a keepalive request when the page goes (reload, tab closed)', async () => {
    runAs(SAFARI);
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response()),
    );
    vi.stubGlobal('fetch', fetch);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MKV_HEVC)} allowTranscode />,
    );
    await startAfter(0);
    const session = srcOf(container).searchParams.get('PlaySessionId');

    window.dispatchEvent(new Event('pagehide'));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toContain(`playSessionId=${session}`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'DELETE', keepalive: true });
    vi.unstubAllGlobals();
  });

  it('falls back to a remux when the browser fails to play the file after all (details)', async () => {
    runAs({ ...SAFARI, plays: [/^video\/mp4/, /^application\/vnd\.apple\.mpegurl$/] });
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} allowTranscode />,
    );
    await startAfter(0);
    expect(container.querySelector('video')!.getAttribute('src')).toContain('/stream?static=true');

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('video')!.getAttribute('src')).toContain('/master.m3u8?');
  });

  it('plays only the file on the hero: no remux of H.264 in Matroska', async () => {
    runAs(SAFARI);
    const client = clientFor({ ...MP4_H264, Container: 'mkv' });
    const { container } = render(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    await startAfter(1000);

    expect(container.querySelector('video')).toBeNull();
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Items/t1']);
  });

  it('moves on when nothing has played after a while, error or not (a stall)', async () => {
    runAs(SAFARI);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} allowTranscode />,
    );
    await startAfter(0);
    expect(container.querySelector('video')!.getAttribute('src')).toContain('/stream?static=true');

    await startAfter(TRAILER_START_TIMEOUT_MS);

    expect(container.querySelector('video')!.getAttribute('src')).toContain('/master.m3u8?');
  });

  it("moves on from WebKit's stall too: unpaused, all data, its clock a hair past zero", async () => {
    runAs(SAFARI);
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0.000002);
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      HTMLMediaElement.HAVE_ENOUGH_DATA,
    );
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} allowTranscode />,
    );
    await startAfter(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('playing'));
      container.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
    });

    await startAfter(TRAILER_START_TIMEOUT_MS);

    expect(container.querySelector('video')!.getAttribute('src')).toContain('/master.m3u8?');
  });

  it('keeps playing once the video is under way', async () => {
    runAs(SAFARI);
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0.5);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} allowTranscode />,
    );
    await startAfter(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
    });

    await startAfter(TRAILER_START_TIMEOUT_MS);

    expect(container.querySelector('video')!.getAttribute('src')).toContain('/stream?static=true');
  });

  it('shows the video over the backdrop only once it is under way, and says so then (no empty or black box)', async () => {
    const time = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0);
    const onPlayingChange = vi.fn();
    const { container } = render(
      <TrailerPreview
        trailerId="t1"
        delaySeconds={0}
        client={createFakeClient()}
        onPlayingChange={onPlayingChange}
      />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    // Loading, or its first frame: still see-through, and no controls yet.
    act(() => {
      video.dispatchEvent(new Event('playing'));
    });
    expect(video).not.toHaveClass('is-shown');
    expect(onPlayingChange).not.toHaveBeenCalledWith(true);

    time.mockReturnValue(0.3);
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });

    expect(video).toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  });

  it('fades back to the backdrop when it ends, then goes', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(1);
    const onPlayingChange = vi.fn();
    const { container } = render(
      <TrailerPreview
        trailerId="t1"
        delaySeconds={0}
        client={createFakeClient()}
        onPlayingChange={onPlayingChange}
      />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(video).toHaveClass('is-shown');

    act(() => {
      video.dispatchEvent(new Event('ended'));
    });
    expect(video).not.toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('video')).toBe(video);

    await startAfter(TRAILER_FADE_MS);
    expect(container.querySelector('video')).toBeNull();
  });

  it('keeps its controls for a video that restarts paused (scrolled back into view), hidden until played', async () => {
    const onPlayingChange = vi.fn();
    const client = createFakeClient();
    const { container } = render(
      <TrailerPreview
        trailerId="t1"
        delaySeconds={0}
        client={client}
        paused
        onPlayingChange={onPlayingChange}
      />,
    );
    await startAfter(0);

    expect(container.querySelector('video')).not.toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps its controls when such a video is played and has not shown yet (focus stays on them)', async () => {
    const onPlayingChange = vi.fn();
    const client = createFakeClient();
    const { container, rerender } = render(
      <TrailerPreview
        trailerId="t1"
        delaySeconds={0}
        client={client}
        paused
        onPlayingChange={onPlayingChange}
      />,
    );
    await startAfter(0);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);

    rerender(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} onPlayingChange={onPlayingChange} />,
    );
    await act(async () => undefined);
    expect(container.querySelector('video')).not.toHaveClass('is-shown');
    // Off before it started, then on, and never off again in between.
    expect(onPlayingChange.mock.calls.map(([on]) => on)).toEqual([false, true]);
  });

  it('reports its progress once under way, not before (the hero waits for it)', async () => {
    runAs(CHROME);
    const time = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0.1);
    const onProgress = vi.fn();
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} onProgress={onProgress} />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(onProgress).not.toHaveBeenCalled();

    time.mockReturnValue(0.5);
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(onProgress).toHaveBeenCalledWith(video);
  });

  it('starts the video itself, and keeps the backdrop when the browser refuses (iOS Low Power Mode)', async () => {
    runAs(SAFARI);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('The request is not allowed', 'NotAllowedError'));
    const client = clientFor(MP4_H264);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} allowTranscode />,
    );
    await startAfter(0);

    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBeNull();
    // Not on to the next stream: it would be refused too, after the server started it.
    await startAfter(TRAILER_START_TIMEOUT_MS);
    expect(container.querySelector('video')).toBeNull();
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Items/t1']);
  });

  it('shows no preview when the browser can play neither the file nor a transcode', async () => {
    const client = clientFor(MKV_HEVC);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} allowTranscode />,
    );
    await startAfter(1000);

    expect(container.querySelector('video')).toBeNull();
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Items/t1']);
  });

  it('removes the video on error so the backdrop shows', async () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    await startAfter(0);

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('video')).toBeNull();
  });

  it("pauses in place on the details page's Pause, and plays on from there", async () => {
    const client = createFakeClient();
    const { container, rerender, unmount } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    // On this element only: the prototype's spies are shared with the other tests.
    const pause = (video.pause = vi.fn());
    const play = (video.play = vi.fn(async () => undefined));

    rerender(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} paused />);
    expect(pause).toHaveBeenCalledTimes(1);
    // Paused before it got going is not a stall: it isn't given up on.
    await startAfter(TRAILER_START_TIMEOUT_MS);
    expect(container.querySelector('video')).toBe(video);

    rerender(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
    act(() => {
      unmount();
    });
  });

  it('waits to play a video that starts while paused, then gives it the usual time to get going', async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const client = createFakeClient();
    const { container, rerender, unmount } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} paused />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    expect(play).not.toHaveBeenCalled();
    // However long it stays paused, it isn't taken for a stall.
    await startAfter(2 * TRAILER_START_TIMEOUT_MS);
    expect(container.querySelector('video')).toBe(video);

    rerender(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    expect(play).toHaveBeenCalledTimes(1);
    // Played but never under way: a stall after all, so it moves on (here, to the backdrop).
    await startAfter(TRAILER_START_TIMEOUT_MS);
    expect(container.querySelector('video')).toBeNull();
    act(() => {
      unmount();
    });
  });

  it('pauses, unloads, and releases the video when it stops or unmounts', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const { container, unmount } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;

    act(() => {
      unmount();
    });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute('src')).toBe(false);
  });

  it('scrolled out of view, pauses where it is, and carries on at once when back: the same video, no delay', async () => {
    const inView = observeViewport();
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(1);
    const onPlayingChange = vi.fn();
    const onFinish = vi.fn();
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={4}
        client={createFakeClient()}
        onPlayingChange={onPlayingChange}
        onFinish={onFinish}
      />,
    );
    await run(4000);
    const video = container.querySelector('video')!;
    const pause = (video.pause = vi.fn());
    const play = (video.play = vi.fn(async () => undefined));
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(video).toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);

    inView(false);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
    // Not playing as far as the page knows (the hero doesn't take it for a stall), and not over either.
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    // However long it's away short of the hold, it isn't taken for a stall or let go.
    await run(TRAILER_HOLD_MS - 1);
    expect(container.querySelector('video')).toBe(video);

    inView(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
    expect(video).toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('does the same when the page goes to the background and comes back', async () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    await startAfter(0);
    const video = container.querySelector('video')!;
    const pause = (video.pause = vi.fn());
    const play = (video.play = vi.fn(async () => undefined));

    setHidden(true);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);

    setHidden(false);
    await run(0);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
  });

  it('lets a video go that stays out of view for long, and starts after the delay when back', async () => {
    const inView = observeViewport();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={1}
        client={createFakeClient()}
      />,
    );
    await run(1000);
    const video = container.querySelector('video')!;
    const load = (video.load = vi.fn());

    inView(false);
    await run(TRAILER_HOLD_MS);
    expect(container.querySelector('video')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute('src')).toBe(false);

    play.mockClear();
    inView(true);
    await run(0);
    const again = container.querySelector('video')!;
    expect(again).not.toBe(video);
    expect(play).not.toHaveBeenCalled();
    await run(750);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('lets a transcode go as soon as it is out of view, which stops it on the server', async () => {
    runAs(SAFARI);
    const inView = observeViewport();
    const client = clientFor(MKV_HEVC);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={client} allowTranscode />,
    );
    await startAfter(0);
    expect(srcOf(container).pathname).toBe('/Videos/t1/master.m3u8');

    inView(false);
    await run(0);

    expect(container.querySelector('video')).toBeNull();
    expect(client.requests.some((r) => r.type === 'DELETE')).toBe(true);
  });

  it('out of view during the delay, keeps the video loading and runs the delay again when back', async () => {
    const inView = observeViewport();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={1}
        client={createFakeClient()}
      />,
    );
    await run(500);
    const video = container.querySelector('video')!;
    inView(false);
    await run(5000);
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector('video')).toBe(video);

    inView(true);
    await run(750);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
  });

  it('says it is over once it ends or fails for good, not when it stops out of sight (the hero waits for it)', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(1);
    const onFinish = vi.fn();
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} onFinish={onFinish} />,
    );
    await startAfter(0);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await startAfter(0);
    expect(onFinish).not.toHaveBeenCalled();

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('ended'));
    });
    await startAfter(0);
    expect(onFinish).toHaveBeenCalledTimes(1); // as it starts fading out
    await startAfter(TRAILER_FADE_MS);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('says it is over when no way to play it works', async () => {
    const onFinish = vi.fn();
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} onFinish={onFinish} />,
    );
    await startAfter(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    await startAfter(0);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('starts each video where it is asked to (the hero puts a trailer back where it was)', async () => {
    const duration = vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(100);
    const seek = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set');
    let at = 0;
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} startAt={() => at} />,
    );
    await startAfter(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(seek).not.toHaveBeenCalled(); // from the start

    // Out of sight for long (it's let go) and back: the new video starts where the last got to.
    at = 42;
    setHidden(true);
    await run(TRAILER_HOLD_MS);
    expect(container.querySelector('video')).toBeNull();
    setHidden(false);
    await startAfter(0);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(seek).toHaveBeenCalledWith(42);

    // Not within a second of the end: it would only end again.
    seek.mockClear();
    duration.mockReturnValue(42.5);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(seek).not.toHaveBeenCalled();
  });
});

describe('TrailerPreview notes how it went on this device (its Media info)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetSessionCaches();
    sessionStorage.clear();
  });

  it('each file it tried: 1080p timed out, 720p failed with the media error', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1080);
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a_720p.mp4"
        srcHd="https://imdb-video.media-imdb.com/vi1/a_1080p.mp4"
        delaySeconds={0}
        client={createFakeClient()}
        logKey="m1"
      />,
    );
    await run(0);
    expect(lastAttempt('m1')!.steps).toEqual([{ source: 'imdb', quality: 'hd', outcome: 'pending' }]);

    await run(TRAILER_START_TIMEOUT_MS);
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code: 4, message: 'Format error' } });
    act(() => {
      video.dispatchEvent(new Event('error'));
    });

    expect(lastAttempt('m1')!.steps).toEqual([
      { source: 'imdb', quality: 'hd', outcome: 'timeout' },
      { source: 'imdb', quality: 'main', outcome: 'error', code: 4, message: 'Format error' },
    ]);
  });

  it('when it got under way, and how long after it was asked to play', async () => {
    const time = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0);
    const { container } = render(
      <TrailerPreview
        src="https://imdb-video.media-imdb.com/vi1/a.mp4"
        delaySeconds={0}
        client={createFakeClient()}
        logKey="m1"
      />,
    );
    await run(0);
    await run(800);
    time.mockReturnValue(0.3);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
    });

    expect(lastAttempt('m1')!.steps).toEqual([
      { source: 'imdb', quality: 'main', outcome: 'played', ms: 800 },
    ]);
  });

  it('a browser that refused to start it, and a local trailer it can’t play', async () => {
    runAs(SAFARI);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    render(<TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} logKey="m1" />);
    await startAfter(0);
    expect(lastAttempt('m1')!.steps).toEqual([{ source: 'local', quality: 'direct', outcome: 'blocked' }]);

    cleanup();
    resetSessionCaches(); // the trailer's media source, looked up above
    render(<TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MKV_HEVC)} logKey="m2" />);
    await startAfter(0);
    expect(lastAttempt('m2')!.steps).toEqual([{ source: 'local', outcome: 'unsupported' }]);
  });
});
