import { useEffect, useState } from 'preact/hooks';
import type { SettingsPage } from '../../takeover/routes';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';

type ProfileModule = typeof import('./ProfilePages');

let loading: Promise<ProfileModule> | null = null;
let loaded: ProfileModule | null = null;

/**
 * The profile page and the frame over the stock settings pages (with its dropdowns) are a separate file, loaded the
 * first time either shows, so the other pages don't download or parse them. A failed load is asked for again next time,
 * though a browser may remember the failure until the page reloads (as it will for a page left open across a Lumen
 * update, whose old file is gone).
 */
export function loadProfile(): Promise<ProfileModule> {
  loading ??= import('./ProfilePages').then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The module once it's in (null until then); `onError` runs if it can't load. */
function useProfileModule(onError: () => void): ProfileModule | null {
  const [module, setModule] = useState<ProfileModule | null>(loaded);
  useEffect(() => {
    if (module) return;
    let cancelled = false;
    withTimeout(loadProfile(), VIEW_TIMEOUT_MS).then(
      (m) => !cancelled && setModule(m),
      () => !cancelled && onError(),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

/** The profile page once its code is in; until then the empty page it shows while it loads. If the code can't load, stock. */
export function LazyProfileView({ ctx }: { ctx: ViewContext }) {
  const module = useProfileModule(ctx.onFallback);
  return module ? (
    <module.ProfileView ctx={ctx} />
  ) : (
    <div class="lmn-browse lmn-browse__pending" aria-busy="true" />
  );
}

/** The settings frame once its code is in. Until then, or if it can't load, the stock page shows on its own. */
export function LazySettingsFrame({ page }: { page: SettingsPage }) {
  const module = useProfileModule(() => undefined);
  return module ? <module.SettingsFrame page={page} /> : null;
}
