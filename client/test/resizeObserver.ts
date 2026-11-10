import { act } from '@testing-library/preact';

/** Every FakeResizeObserver made, with the elements it observes. */
export const resizeObservers: FakeResizeObserver[] = [];

/** A ResizeObserver test double (jsdom has none): `resize` reports a new content width for observed elements. */
export class FakeResizeObserver {
  readonly observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }
  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
  }
  report(elements: Element[], width: number): void {
    const entries = elements.map(
      (target) => ({ target, contentRect: { width, height: 0 } }) as unknown as ResizeObserverEntry,
    );
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

/** Reports `width` CSS px for each observed element in `elements` (all of them if none are given). */
export function resize(width: number, elements?: Element[]): void {
  act(() => {
    for (const observer of resizeObservers) {
      const targets = [...observer.observed].filter((el) => !elements || elements.includes(el));
      if (targets.length) observer.report(targets, width);
    }
  });
}
