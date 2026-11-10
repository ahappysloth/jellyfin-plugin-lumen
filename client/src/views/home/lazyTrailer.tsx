import type { ComponentProps } from 'preact';
import { useEffect, useState } from 'preact/hooks';

type TrailerModule = typeof import('./TrailerPreview');

let loading: Promise<TrailerModule> | null = null;
let loaded: TrailerModule | null = null;

/**
 * The trailer preview's code is a separate file, loaded the first time a preview is about to play (as the hero or the
 * details header shows a title with a trailer, which then waits a few seconds before playing anyway), so pages
 * without one, and users who turned previews off or prefer reduced motion, never download or parse it. A failed load
 * is asked for again next time; the backdrop stays meanwhile.
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

/** TrailerPreview once its code is in; until then, or if it can't load, nothing (the backdrop shows). */
export function LazyTrailer(props: ComponentProps<TrailerModule['TrailerPreview']>) {
  const [module, setModule] = useState<TrailerModule | null>(loaded);
  useEffect(() => {
    if (module) return;
    let live = true;
    loadTrailer().then(
      (m) => live && setModule(m),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return module ? <module.TrailerPreview {...props} /> : null;
}
