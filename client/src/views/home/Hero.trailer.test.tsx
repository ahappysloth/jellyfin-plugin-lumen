import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';
import type { TrailerPreview } from './TrailerPreview';

// The trailer itself is TrailerPreview's business (TrailerPreview.test): here it is a stand-in whose callbacks the tests
// call as a playing video would.
type TrailerProps = ComponentProps<typeof TrailerPreview>;
let trailer: TrailerProps | null = null;
vi.mock('./lazyTrailer', () => ({
  LazyTrailer: (props: TrailerProps) => {
    trailer = props;
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
const video = (duration = 100) => ({ currentTime: 0.5, duration }) as HTMLVideoElement;
/** The trailer plays on: its clock moves and it says so, as timeupdate does. */
const play = (v: HTMLVideoElement, seconds: number) => {
  for (let s = 0; s < seconds; s++) {
    (v as { currentTime: number }).currentTime += 1;
    advance(1000);
    act(() => trailer!.onProgress?.(v));
  }
};
const end = () => act(() => trailer!.onPlayingChange?.(false));
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
  });
  afterEach(() => {
    cleanup();
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
    act(() => trailer!.onProgress!(v));
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
    act(() => trailer!.onProgress!(v));
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
    act(() => trailer!.onProgress!(v));
    expect(scale(container)).toBeCloseTo(0.5, 2);

    play(v, 2); // the clock is at 6 of 8 s, the trailer 2 % through: the trailer's behind
    expect(scale(container)).toBeCloseTo(0.5 + 0.5 * 0.02, 2);

    (v as { currentTime: number }).currentTime = 50.5;
    act(() => trailer!.onProgress!(v));
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
    act(() => trailer!.onProgress!(v));
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
    act(() => trailer!.onProgress!(v));
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
});
