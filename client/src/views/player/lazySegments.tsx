import { useEffect, useState } from 'preact/hooks';
import { loadStyles } from '../../util/loadStyles';
import type { SegmentsProps } from './SegmentPrompts';

type SegmentsModule = typeof import('./SegmentPrompts');

let loading: Promise<SegmentsModule> | null = null;
let loaded: SegmentsModule | null = null;

/**
 * The Skip button and the next-episode card are a file of their own (./SegmentPrompts.tsx) with its own stylesheet,
 * fetched as the player opens: the player's file stays the size it was, and nothing waits for this one (the first
 * intro is seconds away at the earliest). Until both are in, and for good if they can't load, jellyfin-web's own
 * prompts show: the stylesheet is what hides them.
 */
export function loadSegments(): Promise<SegmentsModule> {
  loading ??= Promise.all([import('./SegmentPrompts'), loadStyles('lumen-segments.css')]).then(
    ([module]) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

export function LazySegments(props: SegmentsProps) {
  const [module, setModule] = useState<SegmentsModule | null>(loaded);
  useEffect(() => {
    if (module) return;
    let cancelled = false;
    loadSegments().then(
      (m) => !cancelled && setModule(m),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return module && <module.SegmentPrompts {...props} />;
}
