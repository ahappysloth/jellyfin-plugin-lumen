import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';
import type { TrailerPreview } from './TrailerPreview';

// The trailer itself is TrailerPreview's business (TrailerPreview.test): here it is a stand-in whose callbacks the tests
// call as a playing video would. Like TrailerPreview, it says it isn't playing as it mounts.
type TrailerProps = ComponentProps<typeof TrailerPreview>;
let trailer: TrailerProps | null = null;
let owner: object | null = null;
let mounts = 0;
vi.mock('./lazyTrailer', () => ({
  LazyTrailer: (props: TrailerProps) => {
    const me = useRef({}).current;
    trailer = props;
    owner = me;
    useEffect(() => {
      mounts++;
      props.onPlayingChange?.(false);
      return () => {
        if (owner === me) trailer = null; // not a later one's (an earlier test's can clean up late)
      };
    }, []);
    return <div class="lmn-hero__trailer" data-paused={String(!!props.paused)} />;
  },
}));

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
  HeroWaitForTrailer: true,
  BuildHash: 'h',
};

const items: HeroItem[] = [
  { Item: { Id: 'a', Name: 'Alpha', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: 't1' },
  { Item: { Id: 'b', Name: 'Beta', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: null },
];

/** Long enough for a slide animation to settle. */
const SLIDE = 800;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const showing = (name: string) => screen.getByRole('heading', { level: 2, name });

/** A trailer's <video>, as far as the hero reads it. */
const video = (duration = 100, currentTime = 0.5) =>
  ({ currentTime, duration, isConnected: true }) as unknown as HTMLVideoElement;
/** The trailer plays on: its clock moves and it says so, as timeupdate does. */
const play = (v: HTMLVideoElement, seconds: number) => {
  for (let s = 0; s < seconds; s++) {
    (v as { currentTime: number }).currentTime += 1;
    advance(1000);
    act(() => trailer!.onProgress?.(v));
  }
};
/** Under way: playing and shown. */
const start = (v: HTMLVideoElement) =>
  act(() => {
    trailer!.onPlayingChange?.(true);
    trailer!.onProgress!(v);
  });
/** The trailer's <video> is taken off: removed (no longer connected) and reset, as TrailerPreview does. */
const takeOff = (v: HTMLVideoElement) => {
  Object.assign(v, { isConnected: false, currentTime: 0 });
};
const end = () => act(() => trailer!.onFinish?.());
const setHidden = (hidden: boolean) =>
  act(() => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
    document.dispatchEvent(new Event('visibilitychange'));
  });
/** A short drag that springs back: the slide stays. */
const springBack = (hero: HTMLElement) => {
  fireEvent.pointerDown(hero, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100 });
  fireEvent.pointerMove(hero, { pointerId: 1, pointerType: 'touch', clientX: 312, clientY: 100 });
  fireEvent.pointerMove(hero, { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 100 });
  return () => fireEvent.pointerUp(hero, { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 100 });
};
const fill = (container: Element) => container.querySelector<HTMLElement>('.lmn-hero__fill')!;
const scale = (container: Element) => Number(/scaleX\(([^)]+)\)/.exec(fill(container).style.transform)?.[1]);

const renderHero = (overrides: Partial<ClientConfig> = {}) =>
  render(
    <Hero
      items={items}
      client={createFakeClient()}
      config={{ ...config, ...overrides }}
      onPlay={vi.fn()}
      onInfo={vi.fn()}
    />,
  );

describe('Hero: letting trailers finish (HeroWaitForTrailer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    trailer = null;
    mounts = 0;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('off: the slide moves on at its interval and cuts the trailer short', () => {
    renderHero({ HeroWaitForTrailer: false });
    expect(trailer!.onProgress).toBeUndefined();

    advance(8000 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('holds the slide while its trailer plays, and moves on a beat after it ends', () => {
    const { container } = renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 60);
    expect(showing('Alpha')).toBeInTheDocument();
    expect(fill(container)).toHaveClass('is-trailer');

    end();
    advance(1400);
    expect(showing('Alpha')).toBeInTheDocument();
    advance(100 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
    expect(fill(container)).not.toHaveClass('is-trailer'); // the next slide's pill runs on its own clock
  });

  it('still gives the slide its interval when the trailer ends sooner', () => {
    renderHero();
    advance(4000);
    const v = video(3);
    start(v);
    play(v, 2);
    end();

    advance(1900); // 8 s in all
    expect(showing('Alpha')).toBeInTheDocument();
    advance(100 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('fills the pill with the clock or the trailer, whichever is behind, from where it was when the trailer began', () => {
    const { container } = renderHero();
    advance(4000); // half the interval
    const v = video(100.5); // 100 s to play from 0.5
    start(v);
    expect(scale(container)).toBeCloseTo(0.5, 2);

    play(v, 2); // the clock is at 6 of 8 s, the trailer 2 % through: the trailer's behind
    expect(scale(container)).toBeCloseTo(0.5 + 0.5 * 0.02, 2);

    (v as { currentTime: number }).currentTime = 50.5;
    start(v);
    advance(16);
    expect(scale(container)).toBeCloseTo(0.75, 2);

    (v as { currentTime: number }).currentTime = 100.5; // the trailer's at its end, but the clock isn't
    advance(16);
    expect(scale(container)).toBeCloseTo(0.75, 2);
    advance(2000);
    expect(scale(container)).toBe(1);
  });

  it('pauses the trailer in place on Pause, and holds the slide until it plays on and ends', () => {
    const { container } = renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 10);

    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
    expect(container.querySelector('.lmn-hero__trailer')).toHaveAttribute('data-paused', 'true');
    const paused = scale(container);
    advance(60_000); // no progress while paused: not a stall either
    expect(scale(container)).toBe(paused);
    expect(showing('Alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play slideshow' }));
    expect(container.querySelector('.lmn-hero__trailer')).toHaveAttribute('data-paused', 'false');
    play(v, 5);
    expect(showing('Alpha')).toBeInTheDocument();
    end();
    advance(1500 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('gives up on a trailer that stops getting anywhere without an error (a stall)', () => {
    renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 10);

    advance(9000);
    expect(showing('Alpha')).toBeInTheDocument();
    advance(2000); // given up 10 s after its last progress (act renders the change as it ends)
    advance(1500 + SLIDE); // then the usual beat

    expect(showing('Beta')).toBeInTheDocument();
  });

  it('does not wait for a trailer that never got going', () => {
    renderHero();
    advance(8000 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('holds through a tab in the background, and puts the trailer back where it was', () => {
    const { container } = renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 20); // past the interval: the trailer leads the fill
    const before = scale(container);
    expect(before).toBeLessThan(0.7);

    setHidden(true);
    takeOff(v); // TrailerPreview stops a video that's out of sight
    act(() => trailer!.onPlayingChange?.(false));
    advance(60_000);
    setHidden(false);
    advance(5000); // the trailer loads again: nothing moves meanwhile, and it isn't a stall
    expect(showing('Alpha')).toBeInTheDocument();
    expect(scale(container)).toBeCloseTo(before, 3);
    expect(trailer!.delaySeconds).toBe(0);
    expect(trailer!.startAt!()).toBeCloseTo(20.5, 1);

    const w = video(100, 20.5); // put back where it was
    start(w);
    expect(scale(container)).toBeCloseTo(before, 3);
    play(w, 5);
    expect(scale(container)).toBeCloseTo(before + 0.5 * (5 / 100), 2); // carries on: neither full nor started over
    end();
    advance(1500 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('carries the fill on from where it was when a trailer put back starts from the beginning', () => {
    const { container } = renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 20);
    const before = scale(container);
    setHidden(true);
    takeOff(v);
    setHidden(false);
    const w = video(100, 0.5); // the file couldn't seek
    start(w);
    play(w, 10);
    expect(scale(container)).toBeGreaterThan(before);
    expect(scale(container)).toBeCloseTo(before + (1 - before) * (10 / 99.5), 2);
  });

  it('holds through a swipe that springs back, and puts the trailer back where it was', () => {
    const { container } = renderHero();
    const hero = container.querySelector<HTMLElement>('.lmn-hero')!;
    advance(4000);
    const v = video();
    start(v);
    play(v, 10);
    const before = scale(container);

    const release = springBack(hero);
    expect(trailer).toBeNull(); // off while the track moves
    takeOff(v);
    release();
    advance(16);
    expect(mounts).toBe(2);
    expect(trailer!.delaySeconds).toBe(0);
    expect(trailer!.startAt!()).toBeCloseTo(10.5, 1);
    advance(3000); // a fresh trailer says it isn't playing yet: that ends nothing
    expect(showing('Alpha')).toBeInTheDocument();
    expect(scale(container)).toBeCloseTo(before, 3);

    const w = video(100, 10.5);
    start(w);
    play(w, 5);
    expect(scale(container)).toBeGreaterThan(before);
    expect(showing('Alpha')).toBeInTheDocument();
    end();
    advance(1500 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('holds on when a trailer that stalled gets going again', () => {
    renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 5);
    advance(8000); // stuck, but not for long enough
    play(v, 20);
    advance(9000);
    expect(showing('Alpha')).toBeInTheDocument();
    play(v, 1);
    end();
    advance(1500 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('eases the fill to full over the beat after giving up on a stall, and does not put the trailer back', () => {
    const { container } = renderHero();
    const hero = container.querySelector<HTMLElement>('.lmn-hero')!;
    advance(4000);
    const v = video();
    start(v);
    play(v, 10);
    const stalled = scale(container);
    advance(9000);
    expect(scale(container)).toBe(stalled); // stuck: the fill waits with it
    let waited = 0;
    while (scale(container) === stalled && waited < 3000) {
      advance(50);
      waited += 50;
    }
    const from = scale(container); // given up, 10 s after its last progress
    expect(from - stalled).toBeLessThan(0.05); // from where it was, not jumping to the clock (full by now)
    advance(700);
    expect(scale(container)).toBeCloseTo(from + (1 - from) * (750 / 1500), 1);
    expect(scale(container)).toBeLessThan(1);

    const release = springBack(hero); // the slide is on its way out: the trailer isn't put back
    release();
    advance(16);
    expect(trailer).toBeNull();
    advance(800 + SLIDE);
    expect(showing('Beta')).toBeInTheDocument();
  });

  it('starts over on a slide picked again after another was picked mid-trailer', () => {
    const { container } = renderHero();
    advance(4000);
    const v = video();
    start(v);
    play(v, 10);

    fireEvent.click(screen.getAllByRole('tab')[1]!);
    advance(16);
    expect(showing('Beta')).toBeInTheDocument();
    expect(fill(container)).not.toHaveClass('is-trailer');

    fireEvent.click(screen.getAllByRole('tab')[0]!);
    advance(16);
    expect(showing('Alpha')).toBeInTheDocument();
    expect(trailer!.delaySeconds).toBe(4);
    expect(trailer!.startAt!()).toBe(0);
    expect(fill(container)).not.toHaveClass('is-trailer');
    advance(8000 + SLIDE); // its trailer hasn't got going this time: nothing to wait for
    expect(showing('Beta')).toBeInTheDocument();
  });
});
