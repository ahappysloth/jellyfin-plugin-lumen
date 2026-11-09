import { fireEvent, render, screen } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
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
});
