import type { RefObject } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { ladderWidth } from './images';

type Listener = (width: number) => void;

// One observer for every image box on the page (a long grid observes hundreds), each box's listener looked up by
// element. Created on first use: Safari 13.0 has no ResizeObserver (13.1 does; Chromium from 64).
let observer: ResizeObserver | undefined;
const listeners = new Map<Element, Listener>();

function sharedObserver(): ResizeObserver | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined;
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.contentRect.width);
    });
  }
  return observer;
}

/**
 * The IMAGE_WIDTHS step for the box `ref` points at, measured as it renders (a card in a `minmax(272px, 1fr)` grid,
 * an episode still that is full width on a phone): pass it to imageUrl as the box's width. 0 until the box has been
 * measured; render the image without a `src` until then, so it isn't fetched at the wrong size first. Where
 * ResizeObserver is missing it is `fallback`'s step straight away.
 *
 * Only ever grows: a box that shrinks keeps the larger image it already has instead of downloading a smaller one.
 * Steps are shared, so boxes of one shape that round to the same step still ask for one URL.
 */
export function useImageWidth(ref: RefObject<Element | null>, fallback: number): number {
  const [step, setStep] = useState(() => (typeof ResizeObserver === 'undefined' ? ladderWidth(fallback) : 0));
  useLayoutEffect(() => {
    const element = ref.current;
    const resize = sharedObserver();
    if (!element || !resize) return;
    // A hidden box (display: none) measures 0: wait until it shows.
    listeners.set(element, (width) => {
      if (width > 0) setStep((current) => Math.max(current, ladderWidth(width)));
    });
    resize.observe(element);
    return () => {
      resize.unobserve(element);
      listeners.delete(element);
    };
  }, []);
  return step;
}

/** `box` (a nominal width × height) scaled to `width`, keeping its shape: what imageUrl takes for a measured box. */
export function boxAt(
  box: { width: number; height?: number },
  width: number,
): { width: number; height?: number } {
  return { width, height: box.height ? (width * box.height) / box.width : undefined };
}
