import { fireEvent, render, screen } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDragScroll } from './useDragScroll';

function Scroller({ onClick }: { onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDragScroll(ref);
  return (
    <div ref={ref} data-testid="scroller">
      <button type="button" onClick={onClick}>
        Card
      </button>
    </div>
  );
}

const mouse = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };

describe('useDragScroll', () => {
  it('scrolls with a mouse drag and swallows the click that ends it', () => {
    const onClick = vi.fn();
    render(<Scroller onClick={onClick} />);
    const scroller = screen.getByTestId('scroller');
    scroller.scrollLeft = 300;

    fireEvent.pointerDown(scroller, { ...mouse, clientX: 500 });
    fireEvent.pointerMove(scroller, { ...mouse, clientX: 400 });
    expect(scroller.scrollLeft).toBe(400);
    expect(scroller.classList.contains('is-dragging')).toBe(true);
    fireEvent.pointerUp(scroller, { ...mouse, clientX: 400 });
    fireEvent.click(screen.getByRole('button'));

    expect(onClick).not.toHaveBeenCalled();
    expect(scroller.classList.contains('is-dragging')).toBe(false);
  });

  it('forgets a press released outside the row', () => {
    render(<Scroller onClick={vi.fn()} />);
    const scroller = screen.getByTestId('scroller');
    scroller.scrollLeft = 300;

    fireEvent.pointerDown(scroller, { ...mouse, clientX: 500 });
    fireEvent.pointerUp(window, { ...mouse, buttons: 0 });
    fireEvent.pointerMove(scroller, { ...mouse, buttons: 0, clientX: 300 });

    expect(scroller.scrollLeft).toBe(300);
    expect(scroller.classList.contains('is-dragging')).toBe(false);
  });

  it('leaves plain clicks and touch alone', () => {
    const onClick = vi.fn();
    render(<Scroller onClick={onClick} />);
    const scroller = screen.getByTestId('scroller');

    fireEvent.pointerDown(scroller, { ...mouse, clientX: 500 });
    fireEvent.pointerMove(scroller, { ...mouse, clientX: 503 });
    fireEvent.pointerUp(scroller, { ...mouse, clientX: 503 });
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(scroller, { pointerId: 2, pointerType: 'touch', clientX: 500 });
    fireEvent.pointerMove(scroller, { pointerId: 2, pointerType: 'touch', clientX: 300 });
    expect(scroller.classList.contains('is-dragging')).toBe(false);
  });

  describe('after the release', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    /** Drags 150px left over 32 ms, then waits `pause` ms before letting go; returns where the row was let go. */
    function flick(scroller: HTMLElement, pause: number): number {
      fireEvent.pointerDown(scroller, { ...mouse, clientX: 500 });
      for (const x of [450, 400, 350]) {
        fireEvent.pointerMove(scroller, { ...mouse, clientX: x });
        vi.advanceTimersByTime(16);
      }
      vi.advanceTimersByTime(pause);
      fireEvent.pointerUp(scroller, { ...mouse, clientX: 350 });
      return scroller.scrollLeft;
    }

    it('glides on after a quick flick, slowing to a stop wherever that is (no snapping back)', () => {
      vi.useFakeTimers();
      render(<Scroller onClick={vi.fn()} />);
      const scroller = screen.getByTestId('scroller');
      scroller.scrollLeft = 300;
      const released = flick(scroller, 0);
      expect(released).toBe(450);

      vi.advanceTimersByTime(100);
      const gliding = scroller.scrollLeft;
      expect(gliding).toBeGreaterThan(released);
      vi.advanceTimersByTime(3000);
      const stopped = scroller.scrollLeft;
      expect(stopped).toBeGreaterThan(gliding);
      // Stopped for good: about 3 px/ms decaying to nothing goes about a screen's width, not on and on.
      expect(stopped - released).toBeLessThan(1500);
      vi.advanceTimersByTime(1000);
      expect(scroller.scrollLeft).toBe(stopped);
    });

    it('stays where it was let go after a drag that stopped first, and a press catches a glide', () => {
      vi.useFakeTimers();
      render(<Scroller onClick={vi.fn()} />);
      const scroller = screen.getByTestId('scroller');
      scroller.scrollLeft = 300;
      expect(flick(scroller, 200)).toBe(450);
      vi.advanceTimersByTime(500);
      expect(scroller.scrollLeft).toBe(450);

      scroller.scrollLeft = 300;
      flick(scroller, 0);
      vi.advanceTimersByTime(50);
      fireEvent.pointerDown(window, { ...mouse, clientX: 10 });
      const caught = scroller.scrollLeft;
      vi.advanceTimersByTime(500);
      expect(scroller.scrollLeft).toBe(caught);
    });

    it('stops where it was let go with reduced motion', () => {
      vi.useFakeTimers();
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
      render(<Scroller onClick={vi.fn()} />);
      const scroller = screen.getByTestId('scroller');
      scroller.scrollLeft = 300;
      expect(flick(scroller, 0)).toBe(450);
      vi.advanceTimersByTime(500);
      expect(scroller.scrollLeft).toBe(450);
    });
  });
});
