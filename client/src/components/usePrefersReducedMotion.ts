import { useEffect, useState } from 'preact/hooks';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const supported = typeof window.matchMedia === 'function';
  const [reduced, setReduced] = useState(() => supported && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (!supported) return;
    const media = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [supported]);
  return reduced;
}
