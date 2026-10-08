import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** True while the element is at least `threshold` in view and the page is visible. */
export function useVisible(ref: RefObject<Element | null>, threshold = 0.5): boolean {
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const [pageVisible, setPageVisible] = useState(!document.hidden);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(!!entry && entry.isIntersecting && entry.intersectionRatio >= threshold),
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);

  useEffect(() => {
    const onChange = (): void => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return inView && pageVisible;
}
