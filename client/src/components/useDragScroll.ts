import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** Pixels of mouse travel before a press becomes a drag (so a click on a card still opens it). */
const SLOP = 6;

/**
 * Click-and-drag to scroll a horizontal scroller with the mouse. Touch and pens already scroll natively. While
 * dragging, scroll snapping is paused (it fights the pointer); on release it resumes and settles on a card. The click
 * that ends a drag is swallowed so it doesn't open the card under the pointer.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; left: number; id: number } | null = null;
    let dragging = false;
    let suppress = false;

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      start = { x: e.clientX, left: el.scrollLeft, id: e.pointerId };
      dragging = false;
    };
    const onMove = (e: PointerEvent): void => {
      if (!start || e.pointerId !== start.id) return;
      // The button was released somewhere we didn't hear about (outside the row, before capture): forget the press.
      if (!dragging && (e.buttons & 1) === 0) {
        start = null;
        return;
      }
      const dx = e.clientX - start.x;
      if (!dragging) {
        if (Math.abs(dx) < SLOP) return;
        dragging = true;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('is-dragging');
      }
      el.scrollLeft = start.left - dx;
      e.preventDefault();
    };
    const onUp = (e: PointerEvent): void => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!dragging) return;
      dragging = false;
      suppress = true;
      el.classList.remove('is-dragging');
      setTimeout(() => (suppress = false), 0);
    };
    const onClick = (e: MouseEvent): void => {
      if (!suppress) return;
      e.preventDefault();
      e.stopPropagation();
      suppress = false;
    };
    // Stop the browser dragging images/links out of the row.
    const onDragStart = (e: DragEvent): void => e.preventDefault();

    // A release anywhere ends a pending press (capture only starts once the drag does).
    const onWindowUp = (e: PointerEvent): void => {
      if (start && e.pointerId === start.id && !dragging) start = null;
    };
    window.addEventListener('pointerup', onWindowUp);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', onDragStart);
    return () => {
      window.removeEventListener('pointerup', onWindowUp);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, [ref]);
}
