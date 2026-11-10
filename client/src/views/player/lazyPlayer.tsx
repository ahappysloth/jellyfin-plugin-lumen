import { useEffect, useState } from 'preact/hooks';
import { useStarting } from '../../playback/starting';
import type { ViewContext } from '../context';
import { LoadingScreen } from './LoadingScreen';

type PlayerModule = typeof import('./PlayerView');

let loading: Promise<PlayerModule> | null = null;
let loaded: PlayerModule | null = null;

/**
 * The player's code is a separate file, loaded the first time it's needed (or as Play is clicked), so pages that never
 * play anything don't download or parse it. A failed load is tried again next time.
 */
export function loadPlayer(): Promise<PlayerModule> {
  loading ??= import('./PlayerView').then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The player once its code is in; until then the loading screen. If the code can't load, the stock player. */
export function LazyPlayer({ ctx }: { ctx: ViewContext }) {
  const [module, setModule] = useState<PlayerModule | null>(loaded);
  const starting = useStarting();
  useEffect(() => {
    if (module) return;
    let cancelled = false;
    loadPlayer().then(
      (m) => !cancelled && setModule(m),
      () => !cancelled && ctx.onFallback(),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return module ? (
    <module.PlayerView ctx={ctx} />
  ) : (
    <LoadingScreen ctx={ctx} snap={null} starting={starting} />
  );
}
