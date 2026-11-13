import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';
import { loadTrailer } from './lazyTrailer';
import { YOUTUBE_CHROME_MS, YOUTUBE_DWELL_MS } from './YouTubePreview';

// The hero with a title whose trailer is on YouTube, down to the player's frame: the real LazyTrailer and
// YouTubePreview, and a player that says what the tests have it say (jsdom loads nothing into the frame). The hero's
// own handling of a trailer it waits for is Hero.trailer.test's; the player's messages are youTubePlayer.test's.
const ORIGIN = 'https://www.youtube-nocookie.com';

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
  TrailerDelaySeconds: 4,
  HeroWaitForTrailer: false,
  YouTubeTrailers: true,
  BuildHash: 'h',
};

const items: HeroItem[] = [
  {
    Item: { Id: 'a', Name: 'Alpha', Type: 'Movie', BackdropImageTags: ['b'] },
    TrailerItemId: null,
    TrailerYouTubeId: 'dQw4w9WgXcQ',
  },
  { Item: { Id: 'b', Name: 'Beta', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: null },
];

/** Long enough for a slide animation to settle. */
const SLIDE = 800;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const showing = (name: string) => screen.getByRole('heading', { level: 2, name });
const fill = (container: Element) => container.querySelector<HTMLElement>('.lmn-hero__fill')!;
const scale = (container: Element) => Number(/scaleX\(([^)]+)\)/.exec(fill(container).style.transform)?.[1]);
const frameOf = (container: Element) => container.querySelector('iframe');

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

/** The player in the current slide's frame: what it's sent, and its side of the conversation. */
const playerIn = (container: Element) => {
  const frame = frameOf(container)!;
  const commands: string[] = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((data: string) => {
    const message = JSON.parse(data) as { event: string; func?: string };
    if (message.event === 'command') commands.push(message.func!);
  }) as Window['postMessage']);
  const say = (event: string, info?: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event, info, id: 'lumen', channel: 'widget' }),
          origin: ORIGIN,
          source: frame.contentWindow,
        }),
      );
    });
  let time = 0;
  return {
    frame,
    commands,
    say,
    /** Loaded, and playing from the start of a `duration` s trailer. */
    start: (duration = 60) => {
      fireEvent.load(frame);
      say('initialDelivery', { playerState: 3, currentTime: 0, duration });
      say('infoDelivery', { playerState: 1, currentTime: 0 });
    },
    /** Plays on for `seconds`, saying where it is as the real one does. */
    play: (seconds: number) => {
      for (let i = 0; i < seconds * 4; i++) {
        advance(250);
        time += 0.25;
        say('infoDelivery', { currentTime: time });
      }
    },
  };
};

describe('Hero: a trailer from YouTube', () => {
  // The preview's code is in before the hero asks (lazyTrailer.test covers the wait for it).
  beforeAll(() => loadTrailer());
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.documentElement.classList.remove('layout-tv');
    Reflect.deleteProperty(window, 'matchMedia');
    vi.unstubAllGlobals();
  });

  it("frames the slide's video, over a backdrop that stays until the player has played its interface away", () => {
    const { container } = renderHero();
    advance(YOUTUBE_DWELL_MS);
    const slide = container.querySelector('.lmn-hero__slide.is-current')!;
    expect(slide.querySelector('.lmn-hero__backdrop')).not.toBeNull();
    expect(frameOf(slide)!.getAttribute('src')).toContain(`${ORIGIN}/embed/dQw4w9WgXcQ?autoplay=1&mute=1`);
    // Only the current slide has one.
    expect(container.querySelectorAll('iframe')).toHaveLength(1);

    const player = playerIn(container);
    expect(player.frame).not.toHaveClass('is-shown');
    player.start();
    advance(YOUTUBE_CHROME_MS - 1);
    expect(player.frame).not.toHaveClass('is-shown');
    advance(1);
    expect(player.frame).toHaveClass('is-shown');
    expect(slide.querySelector('.lmn-hero__backdrop')).not.toBeNull(); // still under it, for when it ends
  });

  it('plays nothing from YouTube while the setting is off, though the slide has an id', () => {
    const { container } = renderHero({ YouTubeTrailers: false });
    advance(8000 - 1);
    expect(frameOf(container)).toBeNull();
    // No Pause for a trailer that won't play: one title would show no controls at all.
    cleanup();
    renderHero({ YouTubeTrailers: false }, [items[0]!]);
    expect(screen.queryByRole('button', { name: 'Pause trailer' })).toBeNull();
  });

  it('plays nothing with trailer previews off, or for a user who asked for less motion', () => {
    const off = renderHero({ TrailerPreview: false });
    advance(4000);
    expect(frameOf(off.container)).toBeNull();
    cleanup();

    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    const reduced = renderHero();
    advance(4000);
    expect(frameOf(reduced.container)).toBeNull();
  });

  it('leaves YouTube out of the TV layout: the backdrop only', () => {
    document.documentElement.classList.add('layout-tv');
    const { container } = renderHero();
    advance(8000 - 1);
    expect(frameOf(container)).toBeNull();
  });

  it('prefers the local trailer of a slide that has both', () => {
    const both = [{ ...items[0]!, TrailerItemId: 't1' }, items[1]!];
    const { container } = renderHero({}, both);
    advance(YOUTUBE_DWELL_MS);
    expect(frameOf(container)).toBeNull();
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull(); // the local preview's
  });

  it('Pause stops it where it is and holds the slide; Play carries on', () => {
    const { container } = renderHero();
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.start();
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');

    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
    expect(player.commands).toContain('pauseVideo');
    player.say('infoDelivery', { playerState: 2, currentTime: 4.5 });
    expect(frameOf(container)).toBe(player.frame);
    expect(player.frame).not.toHaveClass('is-shown');
    advance(60_000);
    expect(showing('Alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play slideshow' }));
    expect(player.commands.slice(-2)).toEqual(['seekTo', 'playVideo']);
  });

  it('asks YouTube for nothing on slides only passed through', () => {
    const many: HeroItem[] = ['a', 'b', 'c', 'd'].map((id) => ({
      Item: { Id: id, Name: id.toUpperCase(), Type: 'Movie', BackdropImageTags: ['b'] },
      TrailerItemId: null,
      TrailerYouTubeId: `dQw4w9WgXc${id.toUpperCase()}`,
    }));
    const { container } = renderHero({ TrailerDelaySeconds: 0 }, many);
    for (let i = 0; i < 3; i++) {
      advance(YOUTUBE_DWELL_MS - 200);
      expect(frameOf(container)).toBeNull();
      fireEvent.keyDown(screen.getAllByRole('tab')[i]!, { key: 'ArrowRight' });
    }
    expect(showing('D')).toBeInTheDocument();
    advance(YOUTUBE_DWELL_MS);
    expect(frameOf(container)!.getAttribute('src')).toContain('/embed/dQw4w9WgXcD?');
  });

  it('takes the frame off as a swipe starts, and with the slide it leaves', () => {
    const { container } = renderHero();
    advance(YOUTUBE_DWELL_MS);
    playerIn(container).start();
    advance(YOUTUBE_CHROME_MS);
    const hero = container.querySelector<HTMLElement>('.lmn-hero')!;

    fireEvent.pointerDown(hero, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100 });
    fireEvent.pointerMove(hero, { pointerId: 1, pointerType: 'touch', clientX: 280, clientY: 100 });
    fireEvent.pointerMove(hero, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    expect(frameOf(container)).toBeNull(); // nothing plays on under the finger
    fireEvent.pointerUp(hero, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    advance(SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
    expect(frameOf(container)).toBeNull();
  });

  it('moves on at its interval when the video cannot be embedded, with the backdrop and no message', () => {
    const { container } = renderHero();
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    fireEvent.load(player.frame);
    player.say('initialDelivery', { playerState: -1, currentTime: 0, duration: 0 });
    player.say('onError', 150);
    expect(frameOf(container)).toBeNull();
    expect(container.querySelector('.lmn-hero__slide.is-current .lmn-hero__backdrop')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(showing('Alpha')).toBeInTheDocument();

    advance(8000 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  describe('held for (with or without HeroWaitForTrailer)', () => {
    it('keeps its slide from when it plays until it ends, the pager following it, then a beat', () => {
      // The default 8 s a slide: the trailer shows from about 5.5 s in, and plays on well past that.
      const { container } = renderHero();
      advance(YOUTUBE_DWELL_MS);
      const player = playerIn(container);
      player.start(30);
      player.play(20);
      expect(showing('Alpha')).toBeInTheDocument();
      expect(player.frame).toHaveClass('is-shown');
      expect(fill(container)).toHaveClass('is-trailer');
      // The fill follows the trailer, not the slide's 8 s: two thirds in.
      expect(scale(container)).toBeGreaterThan(0.6);
      expect(scale(container)).toBeLessThan(0.75);

      player.play(8);
      player.say('infoDelivery', { playerState: 0, currentTime: 30 });
      advance(1500 - 1);
      expect(showing('Alpha')).toBeInTheDocument();
      advance(1 + SLIDE);
      expect(showing('Beta')).toBeInTheDocument();
    });

    it("doesn't hold a slide whose trailer hasn't started playing by the end of its interval", () => {
      const { container } = renderHero();
      advance(YOUTUBE_DWELL_MS);
      fireEvent.load(playerIn(container).frame); // loading still
      advance(8000 - YOUTUBE_DWELL_MS + SLIDE);
      expect(showing('Beta')).toBeInTheDocument();
    });

    it('scrolled away before it shows, waits to be seen rather than being given up', () => {
      const observers: IntersectionObserverCallback[] = [];
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(private callback: IntersectionObserverCallback) {
            observers.push(callback);
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
        act(() =>
          observers.forEach((callback) =>
            callback(
              [{ isIntersecting: on, intersectionRatio: on ? 1 : 0 } as IntersectionObserverEntry],
              {} as never,
            ),
          ),
        );
      const { container } = renderHero();
      advance(YOUTUBE_DWELL_MS);
      const player = playerIn(container);
      player.start(60);
      player.play(2);
      expect(player.frame).not.toHaveClass('is-shown');

      // Paused where it is, the same player.
      inView(false);
      expect(frameOf(container)).toBe(player.frame);
      expect(player.commands).toContain('pauseVideo');
      advance(30_000);
      expect(showing('Alpha')).toBeInTheDocument();

      // Back, it plays on at once (nothing had shown: nothing to go back for).
      inView(true);
      expect(frameOf(container)).toBe(player.frame);
      expect(player.commands.slice(-1)).toEqual(['playVideo']);
      player.play(3);
      advance(YOUTUBE_CHROME_MS);
      expect(player.frame).toHaveClass('is-shown');
      expect(showing('Alpha')).toBeInTheDocument();

      // Away for long, it's let go; back, it's put back where it was, less what plays unseen, at once.
      inView(false);
      advance(60_000);
      expect(frameOf(container)).toBeNull();
      expect(showing('Alpha')).toBeInTheDocument();
      inView(true);
      advance(0);
      const back = playerIn(container);
      expect(back.frame).not.toBe(player.frame);
      back.start(60);
      advance(YOUTUBE_CHROME_MS);
      expect(back.frame).toHaveClass('is-shown');
      expect(showing('Alpha')).toBeInTheDocument();
    });
  });

  describe('with trailers let finish (HeroWaitForTrailer)', () => {
    it('holds the slide from when the trailer plays, shown yet or not, and moves on a beat after it ends', () => {
      // 3 s a slide: less than YouTube's player takes to put its interface away.
      const { container } = renderHero({ HeroWaitForTrailer: true, HeroIntervalSeconds: 3 });
      advance(YOUTUBE_DWELL_MS);
      const player = playerIn(container);
      player.start(30);
      player.play(4);
      expect(showing('Alpha')).toBeInTheDocument();
      expect(player.frame).not.toHaveClass('is-shown');
      player.play(16); // shown from 4.5 s in
      expect(showing('Alpha')).toBeInTheDocument();
      expect(player.frame).toHaveClass('is-shown');
      expect(container.querySelector('.lmn-hero__fill')).toHaveClass('is-trailer');

      // The fade starts ahead of the player's end screen; the player's own "ended" follows.
      player.play(8);
      expect(player.frame).not.toHaveClass('is-shown');
      player.say('infoDelivery', { playerState: 0, currentTime: 30 });
      expect(showing('Alpha')).toBeInTheDocument();
      advance(1500 + SLIDE);
      expect(showing('Beta')).toBeInTheDocument();
      expect(frameOf(container)).toBeNull();
    });

    it('Pause stops the trailer where it is and holds the slide; Play carries on', () => {
      const { container } = renderHero({ HeroWaitForTrailer: true });
      advance(YOUTUBE_DWELL_MS);
      const player = playerIn(container);
      player.start(60);
      player.play(10);
      player.commands.length = 0;

      fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
      expect(player.commands).toEqual(['pauseVideo']);
      player.say('infoDelivery', { playerState: 2, currentTime: 10 });
      expect(frameOf(container)).toBe(player.frame); // not removed: it goes on from here
      expect(player.frame).not.toHaveClass('is-shown');
      advance(60_000);
      expect(showing('Alpha')).toBeInTheDocument();

      player.commands.length = 0;
      fireEvent.click(screen.getByRole('button', { name: 'Play slideshow' }));
      expect(player.commands).toEqual(['seekTo', 'playVideo']);
      player.say('infoDelivery', { playerState: 1, currentTime: 5.5 });
      advance(YOUTUBE_CHROME_MS);
      expect(player.frame).toHaveClass('is-shown');
      expect(showing('Alpha')).toBeInTheDocument();
    });

    it("doesn't hold the slide for a video that cannot be embedded", () => {
      const { container } = renderHero({ HeroWaitForTrailer: true });
      advance(YOUTUBE_DWELL_MS);
      const player = playerIn(container);
      fireEvent.load(player.frame);
      player.say('onError', 101);
      expect(frameOf(container)).toBeNull();
      advance(8000 + SLIDE);
      expect(showing('Beta')).toBeInTheDocument();
    });

    it('gives up on a trailer that stops getting anywhere, as on a local one', () => {
      const { container } = renderHero({ HeroWaitForTrailer: true });
      advance(YOUTUBE_DWELL_MS);
      const player = playerIn(container);
      player.start(120);
      player.play(10);
      expect(showing('Alpha')).toBeInTheDocument();

      // Says it's playing, and says nothing more: the hero's stall watchdog ends the wait.
      advance(12_000);
      advance(1500);
      advance(SLIDE);
      expect(showing('Beta')).toBeInTheDocument();
    });
  });
});
