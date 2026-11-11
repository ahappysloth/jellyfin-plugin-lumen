import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSourceInfo } from '../../api/types';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { resetSessionCaches } from '../../util/sessionCaches';
import { TRAILER_FADE_MS, TRAILER_START_TIMEOUT_MS, TrailerPreview } from './TrailerPreview';

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

  it('stops when the page becomes hidden', async () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    await startAfter(0);
    expect(container.querySelector('video')).not.toBeNull();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(container.querySelector('video')).toBeNull();
  });
});
