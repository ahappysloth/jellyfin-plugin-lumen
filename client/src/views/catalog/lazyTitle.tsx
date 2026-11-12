import { useEffect, useRef, useState } from 'preact/hooks';
import type { CatalogMediaType } from '../../api/types';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { reloadIfReachable } from '../../util/reloadPage';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { liftVeil } from '../../veil/veil';
import type { ViewContext } from '../context';
import { goBack } from '../details/useItemActions';

type TitleModule = typeof import('./TitleView');

let loading: Promise<TitleModule> | null = null;
let loaded: TitleModule | null = null;

/**
 * A catalog title's page (and its Request dialog) is a separate file, loaded the first time it's needed, so servers
 * without Seerr, which never show one, don't download or parse it. A failed load is asked for again next time, though a
 * browser may remember the failure until the page reloads (as it will for a page left open across a Lumen update, whose
 * old file is gone): so a Try again that fails too reloads the page.
 */
export function loadTitle(): Promise<TitleModule> {
  loading ??= import('./TitleView').then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

let prefetched = false;

/**
 * Fetches the title page's code once the browser is idle: called as catalog cards show (only for users with Seerr), so
 * opening one doesn't wait for it. A failed fetch is left for the click to retry.
 */
export function prefetchTitle(): void {
  if (prefetched || loaded) return;
  prefetched = true;
  const load = (): void => void loadTitle().catch(() => undefined);
  // Not in Safari 13 (vite.target.ts).
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 1000);
}

interface Props {
  mediaType: CatalogMediaType;
  tmdbId: number;
  ctx: ViewContext;
}

/**
 * TitleView once its code is in; until then the same empty page it shows while its data loads, so nothing jumps. If the
 * code can't load, the page's own "couldn't load" block, whose Try again asks for the code again (and reloads the page
 * if that fails too).
 */
export function LazyTitleView(props: Props) {
  const [module, setModule] = useState<TitleModule | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, failed, props.ctx.layout);
  useEffect(() => {
    if (module) return;
    let cancelled = false;
    setFailed(false);
    withTimeout(loadTitle(), VIEW_TIMEOUT_MS).then(
      (m) => !cancelled && setModule(m),
      () => {
        if (cancelled) return;
        // A Try again that failed too: the browser may be holding on to the first failure (see loadTitle).
        const fail = (): void => {
          setFailed(true);
          liftVeil();
        };
        // Only if the server answers: offline, a reload would strand a home-screen app on the browser's error page.
        if (attempt) void reloadIfReachable().then((reloaded) => !reloaded && !cancelled && fail());
        else fail();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (module) return <module.TitleView {...props} />;
  if (failed) {
    return (
      <article ref={rootRef} class="lmn-details lmn-title">
        <LoadError
          class="lmn-title__failed"
          // Lumen's own code didn't arrive (network, or an update since the tab opened): not Seerr's fault.
          message={strings.loadFailed}
          onRetry={() => setAttempt((n) => n + 1)}
        >
          <button type="button" class="lmn-button lmn-button--secondary" onClick={() => goBack(props.ctx)}>
            {strings.back}
          </button>
        </LoadError>
      </article>
    );
  }
  return <div class="lmn-details lmn-details--loading" aria-busy="true" />;
}
