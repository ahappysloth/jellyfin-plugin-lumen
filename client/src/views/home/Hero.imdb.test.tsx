import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';
import { loadTrailer } from './lazyTrailer';

// The hero with a title whose trailer is on IMDb: an MP4 the real LazyTrailer plays in TrailerPreview's <video>, as a
// local trailer, straight from IMDb's CDN. Hero.trailer.test covers the hero's handling of a <video> trailer.
const URL_720 = 'https://imdb-video.media-imdb.com/vi1/a.mp4?Expires=1&Signature=s';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  LibraryTakeover: true,
  StyleStockPages: true,
  StyleVideoPlayer: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 2,
  HeroWaitForTrailer: false,
  YouTubeTrailers: true,
  BuildHash: 'h',
};

const items: HeroItem[] = [
  {
    Item: { Id: 'a', Name: 'Alpha', Type: 'Movie', BackdropImageTags: ['b'] },
    TrailerItemId: null,
    TrailerImdbUrl: URL_720,
  },
  { Item: { Id: 'b', Name: 'Beta', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: null },
];

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const showing = (name: string) => screen.getByRole('heading', { level: 2, name });

const renderHero = (overrides: Partial<ClientConfig> = {}, hero = items) =>
  render(
    <Hero
      items={hero}
      client={createFakeClient()}
      config={{ ...config, ...overrides }}
      onPlay={vi.fn()}
      onInfo={vi.fn()}
    />,
  );

describe('Hero: a trailer from IMDb', () => {
  beforeAll(() => loadTrailer());
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); // jsdom has no media playback
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.documentElement.classList.remove('layout-tv');
  });

  it("plays the slide's MP4 from IMDb after the delay, from a <video> that loads meanwhile", () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const { container } = renderHero();
    advance(0);
    // Put in place to load as the slide is up (the delay is under 3 s), the current slide's only.
    const video = container.querySelector('.lmn-hero__slide.is-current video')!;
    expect(video.getAttribute('src')).toBe(URL_720);
    expect(video.getAttribute('preload')).toBe('auto');
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('iframe')).toBeNull();

    // Played as it's due, less the moment it takes to get under way.
    advance(1750 - 1);
    expect(play).not.toHaveBeenCalled();
    advance(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
  });

  it("loads nothing for a slide until 3 s before its trailer's delay is up", () => {
    const { container } = renderHero({ TrailerDelaySeconds: 5 });
    advance(2000 - 1);
    expect(container.querySelector('video')).toBeNull();
    advance(1);
    expect(container.querySelector('video')!.getAttribute('preload')).toBe('auto');
  });

  it('plays the 1080p file where the banner needs it', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(660);
    vi.stubGlobal('devicePixelRatio', 3);
    const hd = 'https://imdb-video.media-imdb.com/vi1/a_1080p.mp4';
    const { container } = renderHero({}, [{ ...items[0]!, TrailerImdbUrlHd: hd }, items[1]!]);
    advance(2000);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(hd);
  });

  it('plays it in the TV layout too: a plain MP4, unlike YouTube', () => {
    document.documentElement.classList.add('layout-tv');
    const { container } = renderHero();
    advance(2000);

    expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_720);
  });

  it("is IMDb's, not YouTube's, when a slide names both, and a local trailer's before either", async () => {
    const both: HeroItem[] = [{ ...items[0]!, TrailerYouTubeId: 'dQw4w9WgXcQ' }, items[1]!];
    const { container, unmount } = renderHero({}, both);
    advance(2000);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_720);
    expect(container.querySelector('iframe')).toBeNull();
    unmount();

    const local: HeroItem[] = [{ ...items[0]!, TrailerItemId: 't1' }, items[1]!];
    const view = renderHero({}, local);
    // The local trailer's item is looked up first (an await), then the delay runs.
    for (const step of [0, 2000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step);
      });
    }
    expect(view.container.querySelector('video')!.getAttribute('src')).toContain('/Videos/t1/stream');
  });

  it('plays nothing while online trailers or previews are off', () => {
    for (const off of [{ YouTubeTrailers: false }, { TrailerPreview: false }]) {
      const { container, unmount } = renderHero(off);
      advance(8000 - 1);
      expect(container.querySelector('video')).toBeNull();
      unmount();
    }
  });

  it('scrolled away and back, its trailer carries on: the same video, paused meanwhile, holding the slide', () => {
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
    const inView = (on: boolean) =>
      act(() => {
        for (const callback of callbacks)
          callback(
            [{ isIntersecting: on, intersectionRatio: on ? 1 : 0 } as IntersectionObserverEntry],
            {} as never,
          );
      });
    let time = 0;
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => time);
    const seek = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set');
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(120);
    const { container } = renderHero({ HeroWaitForTrailer: true });
    advance(2000);
    const video = container.querySelector('video')!;
    const pause = (video.pause = vi.fn());
    const play = (video.play = vi.fn(async () => undefined));
    const tick = (seconds: number) => {
      for (let i = 0; i < seconds * 4; i++) {
        time += 0.25;
        advance(250);
        act(() => {
          video.dispatchEvent(new Event('timeupdate'));
        });
      }
    };
    tick(10);
    expect(video).toHaveClass('is-shown');

    inView(false);
    expect(pause).toHaveBeenCalledTimes(1);
    // Paused well past the interval and the hero's stall check: the slide holds, the video stays.
    advance(30_000);
    expect(showing('Alpha')).toBeInTheDocument();
    expect(container.querySelector('video')).toBe(video);

    inView(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBe(video);
    expect(video).toHaveClass('is-shown');
    expect(seek).not.toHaveBeenCalled();
    tick(5);
    expect(showing('Alpha')).toBeInTheDocument();
  });

  it('keeps to the slide interval like a local trailer, without "Let trailers finish"', () => {
    const { container } = renderHero();
    advance(2000);
    expect(container.querySelector('video')).not.toBeNull();
    expect(showing('Alpha')).toBeInTheDocument();
    advance(6000 + 800);
    expect(showing('Beta')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });
});
