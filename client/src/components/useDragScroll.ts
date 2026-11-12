import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** Pixels of mouse travel before a press becomes a drag (so a click on a card still opens it). */
const SLOP = 6;
/** The glide after a release: the pointer's speed over this last stretch of the drag (ms) carries the row on... */
const FLICK_WINDOW_MS = 80;
/** ...when it's at least this fast (px per ms; a slow drag and release just stops)... */
const FLICK_MIN_SPEED = 0.3;
/** ...losing this share of its speed every 16 ms, until it's crawling. */
const GLIDE_DECAY = 0.95;
const GLIDE_STOP_SPEED = 0.02;

/**
 * Click-and-drag to scroll a horizontal scroller with the mouse. Touch and pens already scroll natively. Rows don't
 * snap: a row stays wherever it's let go, with a short glide after a quick flick, as a touch swipe has (none with
 * reduced motion). The click that ends a drag is swallowed so it doesn't open the card under the pointer.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; left: number; id: number } | null = null;
    let dragging = false;
    let suppress = false;
    /** The drag's recent positions (time, clientX), for the speed at release. */
    let samples: [number, number][] = [];
    let glide = 0;

    const stopGlide = (): void => {
      cancelAnimationFrame(glide);
      glide = 0;
    };
    const startGlide = (speed: number): void => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      let last = performance.now();
      const step = (now: number): void => {
        const dt = Math.max(0, now - last);
        last = now;
        const before = el.scrollLeft;
        el.scrollLeft = before - speed * dt;
        speed *= Math.pow(GLIDE_DECAY, dt / 16);
        // Stops when it's slowed right down, or run into either end.
        glide =
          Math.abs(speed) > GLIDE_STOP_SPEED && el.scrollLeft !== before ? requestAnimationFrame(step) : 0;
      };
      glide = requestAnimationFrame(step);
    };

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      start = { x: e.clientX, left: el.scrollLeft, id: e.pointerId };
      dragging = false;
      samples = [];
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
      const now = performance.now();
      samples.push([now, e.clientX]);
      while (samples.length > 2 && now - samples[0]![0] > FLICK_WINDOW_MS) samples.shift();
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
      // Only a pointer still moving as it's let go throws the row; one that stopped first leaves it there.
      const now = performance.now();
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (e.type === 'pointerup' && first && last && last !== first && now - last[0] < 50) {
        const speed = (last[1] - first[1]) / Math.max(1, last[0] - first[0]);
        if (Math.abs(speed) >= FLICK_MIN_SPEED) startGlide(speed);
      }
      samples = [];
    };
    const onClick = (e: MouseEvent): void => {
      if (!suppress) return;
      e.preventDefault();
      e.stopPropagation();
      suppress = false;
    };
    // Stop the browser dragging images/links out of the row.
    const onDragStart = (e: DragEvent): void => e.preventDefault();
    // A press anywhere (on the row, or its arrows), a key (focus moving along it) or the wheel takes over from a glide.
    const onWheel = (): void => stopGlide();

    // A release anywhere ends a pending press (capture only starts once the drag does).
    const onWindowUp = (e: PointerEvent): void => {
      if (start && e.pointerId === start.id && !dragging) start = null;
    };
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointerdown', stopGlide, true);
    window.addEventListener('keydown', stopGlide, true);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      stopGlide();
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointerdown', stopGlide, true);
      window.removeEventListener('keydown', stopGlide, true);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, [ref]);
}
