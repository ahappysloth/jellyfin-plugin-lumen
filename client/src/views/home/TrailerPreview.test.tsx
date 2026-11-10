import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSourceInfo } from '../../api/types';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { resetSessionCaches } from '../../util/sessionCaches';
import { TrailerPreview } from './TrailerPreview';

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

/** Have the <video> answer canPlayType like a browser that plays the types matching these patterns. */
const browserPlays = (...supported: RegExp[]) =>
  vi
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockImplementation((type) => (supported.some((pattern) => pattern.test(type)) ? 'probably' : ''));
const SAFARI = [/^video\/mp4; codecs="avc1\.64/, /^application\/vnd\.apple\.mpegurl$/];
const FIREFOX = [/^video\/mp4; codecs="avc1\.64/];

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
  beforeEach(() => vi.useFakeTimers());
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
    const canPlayType = browserPlays(...SAFARI);
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

  it('transcodes HEVC in Matroska to HLS where the browser plays HLS itself (Safari)', async () => {
    browserPlays(...SAFARI);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MKV_HEVC)} />,
    );
    await startAfter(0);

    const src = new URL(container.querySelector('video')!.getAttribute('src')!);
    expect(src.pathname).toBe('/Videos/t1/master.m3u8');
    expect(Object.fromEntries(src.searchParams)).toMatchObject({
      MediaSourceId: 'ms1',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      MaxWidth: '1280',
      ApiKey: 'token1',
    });
  });

  it('transcodes to a progressive MP4 where the browser has no HLS of its own (Firefox)', async () => {
    browserPlays(...FIREFOX);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MKV_HEVC)} />,
    );
    await startAfter(0);

    const src = new URL(container.querySelector('video')!.getAttribute('src')!);
    expect(src.pathname).toBe('/Videos/t1/stream.mp4');
    expect(src.searchParams.get('VideoCodec')).toBe('h264');
  });

  it('stops the transcode on the server when the preview goes', async () => {
    browserPlays(...SAFARI);
    const client = clientFor(MKV_HEVC);
    const { container, unmount } = render(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
    await startAfter(0);
    const session = new URL(container.querySelector('video')!.getAttribute('src')!).searchParams;

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

  it('falls back to a transcode when the browser fails to play the file after all', async () => {
    browserPlays(/^video\/mp4/, /^application\/vnd\.apple\.mpegurl$/);
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={clientFor(MP4_H264)} />,
    );
    await startAfter(0);
    expect(container.querySelector('video')!.getAttribute('src')).toContain('/stream?static=true');

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('video')!.getAttribute('src')).toContain('/master.m3u8?');
  });

  it('shows no preview when the browser can play neither the file nor a transcode', async () => {
    const client = clientFor(MKV_HEVC);
    const { container } = render(<TrailerPreview trailerId="t1" delaySeconds={0} client={client} />);
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
