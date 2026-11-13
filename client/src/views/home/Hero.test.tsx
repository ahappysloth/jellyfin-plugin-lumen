import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';
import { loadTrailer } from './lazyTrailer';

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
  // The trailer preview's code is in from the start here: these tests are about when the hero shows one
  // (lazyTrailer.test is about the wait for the code).
  beforeAll(() => loadTrailer());
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

  it("names the slide's heading after its title when the title is a logo", () => {
    render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Alpha' });
    expect(heading).toContainElement(screen.getByRole('img', { name: 'Alpha' }));
  });

  it('offers Pause for the trailer when there is a single title (no slideshow to pause)', () => {
    const { container, rerender } = render(
      <Hero
        items={[items[0]!]}
        client={createFakeClient()}
        config={config}
        onPlay={vi.fn()}
        onInfo={vi.fn()}
      />,
    );
    expect(screen.queryByRole('tablist')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pause trailer' }));
    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play trailer' }));
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull();

    // Nothing moves without a trailer: no control.
    rerender(
      <Hero
        items={[items[1]!]}
        client={createFakeClient()}
        config={config}
        onPlay={vi.fn()}
        onInfo={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^(Pause|Play) / })).toBeNull();
  });

  it('names its toggle after the slideshow either way', () => {
    render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play slideshow' }));
    expect(screen.getByRole('button', { name: 'Pause slideshow' })).toBeInTheDocument();
  });

  it('stops the trailer while the slideshow is paused (WCAG 2.2.2)', () => {
    const { container } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Play slideshow' }));
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull();
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

  // `inert` alone leaves them reachable on browsers without it (webOS TVs before Chrome 102, Safari before 15.5).
  it("keeps the off-screen slides' buttons out of Tab and D-pad reach, without relying on inert", () => {
    const { container } = renderHero();
    const offscreen = () => [
      ...container.querySelectorAll<HTMLButtonElement>('.lmn-hero__slide:not(.is-current) button'),
    ];
    const onscreen = () => [
      ...container.querySelectorAll<HTMLButtonElement>('.lmn-hero__slide.is-current button'),
    ];

    expect(offscreen()).toHaveLength(4); // Play and More info on the previous and next slides
    for (const button of offscreen()) {
      expect(button.tabIndex).toBe(-1);
      expect(button.getAttribute('tabindex')).toBe('-1'); // jellyfin-web's focusable query skips [tabindex="-1"]
      expect(button).toBeDisabled();
    }
    expect(onscreen()).toHaveLength(2);
    for (const button of onscreen()) {
      expect(button.hasAttribute('tabindex')).toBe(false);
      expect(button).toBeEnabled();
    }

    // The next slide's buttons come back when it slides in.
    advance(8000 + SLIDE);
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    for (const button of onscreen()) {
      expect(button.hasAttribute('tabindex')).toBe(false);
      expect(button).toBeEnabled();
    }
    for (const button of offscreen()) expect(button).toBeDisabled();
  });

  it.each(['Play', 'More info'])(
    'moves focus on %s to the same button of the next slide when it rotates (a TV remote is never left on nothing)',
    (name) => {
      renderHero();
      screen.getByRole('button', { name }).focus();

      advance(8000 + SLIDE);
      expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
      const next = screen.getByRole('button', { name });
      expect(next).toHaveFocus();
      expect(next).toBeEnabled();
      expect(next.closest('.lmn-hero__slide')).toHaveClass('is-current');
    },
  );

  it('pauses while the user navigates inside it with the keyboard', () => {
    const { container } = renderHero();
    fireEvent.keyDown(container.querySelector('.lmn-hero')!, { key: 'Tab' });

    advance(20000);
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
  });

  describe('pager', () => {
    const tabs = () => screen.getAllByRole('tab');
    const fills = (container: Element) => [...container.querySelectorAll<HTMLElement>('.lmn-hero__fill')];
    const pager = (container: Element) => container.querySelector('.lmn-hero__pager')!;

    it("widens the current slide's bar and fills it over the slide's interval", () => {
      const { container } = renderHero();

      expect(tabs()[0]).toHaveClass('is-active');
      expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs()[1]).not.toHaveClass('is-active');
      expect(tabs()[1]).toHaveAttribute('aria-selected', 'false');
      // One fill, in the current bar, running for as long as the timer.
      expect(fills(container)).toHaveLength(1);
      expect(tabs()[0]).toContainElement(fills(container)[0]!);
      expect(fills(container)[0]!.style.animationDuration).toBe('8s');
      expect(pager(container)).not.toHaveClass('is-paused');

      advance(8000 + SLIDE);
      expect(tabs()[1]).toHaveClass('is-active');
      expect(fills(container)).toHaveLength(1);
      expect(tabs()[1]).toContainElement(fills(container)[0]!);
    });

    it('holds the fill still while the next slide slides in', () => {
      const { container } = renderHero();

      advance(8000);
      expect(tabs()[1]).toHaveClass('is-active'); // the bar moves on as the slide starts to
      expect(pager(container)).toHaveClass('is-paused');
      advance(SLIDE);
      expect(pager(container)).not.toHaveClass('is-paused');
    });

    it('pauses the fill and the timer together, and resumes both where they were', () => {
      const { container } = renderHero();

      advance(5000);
      fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
      expect(pager(container)).toHaveClass('is-paused');
      advance(30000);
      expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Play slideshow' }));
      expect(pager(container)).not.toHaveClass('is-paused');
      advance(2900);
      expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
      advance(100 + SLIDE); // the 3 s the fill had left, not a fresh 8
      expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    });

    it('pauses while the user navigates inside the hero with the keyboard', () => {
      const { container } = renderHero();
      fireEvent.keyDown(container.querySelector('.lmn-hero')!, { key: 'Tab' });
      expect(pager(container)).toHaveClass('is-paused');
    });

    it('pauses while the page is in the background', () => {
      const { container } = renderHero();
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(pager(container)).toHaveClass('is-paused');
      advance(20000);
      expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();

      hidden.mockReturnValue(false);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(pager(container)).not.toHaveClass('is-paused');
      advance(8000 + SLIDE);
      expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
      hidden.mockRestore();
    });

    it('goes to the slide whose bar is clicked, and starts its fill and timer over', () => {
      const { container } = renderHero();

      advance(6000);
      fireEvent.click(tabs()[1]!);
      expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
      expect(tabs()[1]).toHaveClass('is-active');
      expect(tabs()[1]).toContainElement(fills(container)[0]!);

      advance(6000); // the old timer would have flipped at 8 s
      expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
      advance(2000 + SLIDE);
      expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
    });

    it('restarts the fill on a slide that comes round again', () => {
      const { container } = renderHero();
      const first = fills(container)[0];

      advance(8000 + SLIDE);
      advance(8000 + SLIDE);
      expect(tabs()[0]).toHaveClass('is-active');
      expect(fills(container)[0]).not.toBe(first); // a new element: its animation runs from empty
    });

    it('puts Pause after the bars, in Tab order as on screen, along a row the D-pad keeps Left and Right in', () => {
      const { container } = renderHero();
      const pause = screen.getByRole('button', { name: 'Pause slideshow' });

      expect(container.querySelector('.lmn-hero')).toHaveClass('focuscontainer-x');
      expect(pause.compareDocumentPosition(pager(container)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      expect(pause.parentElement!.lastElementChild).toBe(pause);
    });

    it('puts Pause first on a TV, so the D-pad reaches it from the slide before the bars', () => {
      document.documentElement.classList.add('layout-tv');
      try {
        const { container } = renderHero();
        const pause = screen.getByRole('button', { name: 'Pause slideshow' });

        expect(
          pause.compareDocumentPosition(pager(container)) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(pause.compareDocumentPosition(screen.getByRole('button', { name: 'More info' }))).toBe(
          Node.DOCUMENT_POSITION_PRECEDING,
        );
      } finally {
        document.documentElement.classList.remove('layout-tv');
      }
    });

    it('wraps round with the arrow keys, but on a TV lets the D-pad move on past either end', () => {
      renderHero();
      // Not consumed: jellyfin-web's D-pad (on window, skipping defaultPrevented) gets the key.
      const press = (tab: number, key: string) => fireEvent.keyDown(tabs()[tab]!, { key });

      expect(press(0, 'ArrowLeft')).toBe(false); // wraps to the last title
      expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
      expect(press(1, 'ArrowRight')).toBe(false); // and back round to the first
      expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');

      document.documentElement.classList.add('layout-tv');
      try {
        expect(press(0, 'ArrowLeft')).toBe(true); // on to Pause
        expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
        expect(press(0, 'ArrowRight')).toBe(false); // the next title, as anywhere
        expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
        expect(press(1, 'ArrowRight')).toBe(true); // past the last: the D-pad's
        expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
      } finally {
        document.documentElement.classList.remove('layout-tv');
      }
    });

    it('names each bar after its title and follows the arrow keys', () => {
      renderHero();
      expect(tabs().map((tab) => tab.getAttribute('aria-label'))).toEqual(['Show Alpha', 'Show Beta']);

      fireEvent.keyDown(tabs()[0]!, { key: 'ArrowRight' });
      expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
      expect(tabs()[1]).toHaveAttribute('tabindex', '0');
      expect(tabs()[0]).toHaveAttribute('tabindex', '-1');
    });
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
    // 120px left of the slide. jsdom 31, like browsers, serializes `calc(0% + -120px)` as `calc(0% - 120px)`.
    expect(track.style.transform).toMatch(/^translateX\(calc\(0% (?:\+ -|- )120px\)\)$/);
  });

  // iOS Safari drops what's painted on the track while its compositor runs a CSS transition: the glide is drawn per frame.
  it('glides to the next slide frame by frame once let go', () => {
    const { container } = renderHero();
    const hero = container.querySelector('.lmn-hero')!;
    const track = container.querySelector<HTMLElement>('.lmn-hero__track')!;
    const shift = (): number => Number(/calc\((-?[\d.e-]+)%/.exec(track.style.transform)?.[1]);

    swipe(hero, -200);
    advance(100);
    expect(shift()).toBeLessThan(0);
    expect(shift()).toBeGreaterThan(-100);
    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();

    advance(SLIDE);
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    expect(track.style.transform).toBe('translateX(calc(0% + 0px))');
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
