import type { ComponentProps } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

type TrailerModule = typeof import('./TrailerPreview');

let loading: Promise<TrailerModule> | null = null;
let loaded: TrailerModule | null = null;

/**
 * The trailer preview's code is a separate file, loaded the first time a preview is about to play (as the hero or the
 * details header shows a title with a trailer, which then waits a few seconds before playing anyway), so pages
 * without one, and users who turned previews off or prefer reduced motion, never download or parse it. A failed load
 * is asked for again next time, though a browser may remember the failure until the page reloads (as it will for a
 * page left open across a Lumen update, whose old trailer file is gone); either way the backdrop stays meanwhile.
 */
export function loadTrailer(): Promise<TrailerModule> {
  loading ??= import('./TrailerPreview').then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * TrailerPreview once its code is in; until then, or if it can't load, nothing (the backdrop shows). The delay counts
 * from here, not from when the code arrived: the download is part of the wait, not added to it.
 */
export function LazyTrailer(props: ComponentProps<TrailerModule['TrailerPreview']>) {
  const [module, setModule] = useState<TrailerModule | null>(loaded);
  const mountedAt = useRef(Date.now());
  /** Seconds spent waiting for the code. */
  const [loadSeconds, setLoadSeconds] = useState(0);
  useEffect(() => {
    if (module) return;
    let live = true;
    loadTrailer().then(
      (m) => {
        if (!live) return;
        setLoadSeconds((Date.now() - mountedAt.current) / 1000);
        setModule(m);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return module ? (
    <module.TrailerPreview {...props} delaySeconds={Math.max(0, props.delaySeconds - loadSeconds)} />
  ) : null;
}
