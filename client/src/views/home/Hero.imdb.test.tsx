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
    vi.clearAllTimers();
    vi.useRealTimers();
    document.documentElement.classList.remove('layout-tv');
  });

  it("plays the slide's MP4 from IMDb after the delay, in a <video> that loads nothing before then", () => {
    const { container } = renderHero();
    advance(2000 - 1);
    expect(container.querySelector('video')).toBeNull();
    advance(1);

    const video = container.querySelector('.lmn-hero__slide.is-current video')!;
    expect(video.getAttribute('src')).toBe(URL_720);
    expect(video.getAttribute('preload')).toBe('none');
    expect(container.querySelectorAll('video')).toHaveLength(1); // the current slide's only
    expect(container.querySelector('iframe')).toBeNull();
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
