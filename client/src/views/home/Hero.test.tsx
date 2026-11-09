import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  LibraryTakeover: true,
  StyleStockPages: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

const items: HeroItem[] = [
  {
    Item: {
      Id: 'a',
      Name: 'Alpha',
      Type: 'Movie',
      Overview: 'First',
      BackdropImageTags: ['b'],
      ImageTags: { Logo: 'l' },
    },
    TrailerItemId: 't1',
  },
  { Item: { Id: 'b', Name: 'Beta', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: null },
];

describe('Hero', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // Unmount under fake timers so no Preact effect flush lands after jsdom is torn down (see TrailerPreview.test).
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('shows the first item with logo, overview, and actions', () => {
    const onPlay = vi.fn();
    const onInfo = vi.fn();
    render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={onPlay} onInfo={onInfo} />,
    );

    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'More info' }));
    expect(onPlay).toHaveBeenCalledWith(items[0]!.Item);
    expect(onInfo).toHaveBeenCalledWith(items[0]!.Item);
  });

  const renderHero = () =>
    render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );
  /** Long enough for a slide animation to settle. */
  const SLIDE = 800;
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('rotates on the configured interval, even while hovered or after autofocus', () => {
    const { container } = renderHero();
    const hero = container.querySelector('.lmn-hero')!;
    fireEvent.mouseEnter(hero);
    screen.getByRole('button', { name: 'Play' }).focus();

    advance(8000 + SLIDE);
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    advance(8000 + SLIDE);
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('pauses while the user navigates inside it with the keyboard', () => {
    const { container } = renderHero();
    fireEvent.keyDown(container.querySelector('.lmn-hero')!, { key: 'Tab' });

    advance(20000);
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
  });

  const swipe = (el: Element, dx: number) => {
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 300 + dx / 2, clientY: 102 });
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 300 + dx, clientY: 104 });
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: 300 + dx, clientY: 104 });
  };

  it('swipes to the next and previous slide, and restarts the timer', () => {
    const { container } = renderHero();
    const hero = container.querySelector('.lmn-hero')!;

    advance(6000);
    swipe(hero, -200);
    advance(SLIDE);
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    advance(6000); // would have flipped at 8s on the old timer
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();

    swipe(hero, 200);
    advance(SLIDE);
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('moves the track with the pointer one-to-one while dragging', () => {
    const { container } = renderHero();
    const hero = container.querySelector('.lmn-hero')!;
    fireEvent.pointerDown(hero, {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerMove(hero, { pointerId: 3, pointerType: 'mouse', clientX: 380, clientY: 100 });

    const track = container.querySelector<HTMLElement>('.lmn-hero__track')!;
    expect(track.style.transform).toBe('translateX(calc(0% + -120px))');
    expect(track.classList.contains('is-animated')).toBe(false);
  });

  it('ignores short drags and vertical scrolls, and does not click through after a swipe', () => {
    const onPlay = vi.fn();
    const { container } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={onPlay} onInfo={vi.fn()} />,
    );
    const hero = container.querySelector('.lmn-hero')!;

    swipe(hero, -20);
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();

    fireEvent.pointerDown(hero, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });
    fireEvent.pointerMove(hero, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 400 });
    fireEvent.pointerUp(hero, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 400 });
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();

    const play = screen.getByRole('button', { name: 'Play' });
    swipe(play, -200);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('renders a trailer slot only when enabled and the item has a trailer', () => {
    const { container, rerender } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull();

    rerender(
      <Hero
        items={items}
        client={createFakeClient()}
        config={{ ...config, TrailerPreview: false }}
        onPlay={vi.fn()}
        onInfo={vi.fn()}
      />,
    );
    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
  });

  it('respects reduced motion', () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { container } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );

    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
  });
});
