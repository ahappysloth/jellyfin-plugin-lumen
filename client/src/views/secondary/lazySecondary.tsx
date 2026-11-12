import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { showToast } from '../../components/Toast';
import { strings } from '../../strings';
import { loadStyles } from '../../util/loadStyles';
import { reloadPage } from '../../util/reloadPage';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { liftVeil } from '../../veil/veil';
import type { ViewContext } from '../context';
import { PageError } from '../pageError';
import type { SyncPlayState } from '../syncplay/syncPlayState';

type SecondaryModule = typeof import('./SecondaryViews');

let loading: Promise<SecondaryModule> | null = null;
let loaded: SecondaryModule | null = null;

/**
 * Search, a person's and a collection's page, a library's Suggestions and Upcoming tabs, the watch history and the Watch
 * together menu are one file (./SecondaryViews.ts) with its own stylesheet, loaded the first time one is needed and
 * fetched anyway once the first page is up (prefetchSecondary), so opening one from Lumen doesn't wait. A failed load is
 * asked for again next time, though a browser may remember the failure until the page reloads (as it will for a page
 * left open across a Lumen update, whose old file is gone): so a Try again that fails too reloads the page.
 */
export function loadSecondary(): Promise<SecondaryModule> {
  loading ??= Promise.all([import('./SecondaryViews'), loadStyles('lumen-secondary.css')]).then(
    ([module]) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

let prefetched = false;

/**
 * Fetches the file once the browser is idle (App calls it as the first page mounts), so a click on Search or a person
 * finds it there. A failed fetch is left for the click to retry.
 */
export function prefetchSecondary(): void {
  if (prefetched || loaded) return;
  prefetched = true;
  const load = (): void => void loadSecondary().catch(() => undefined);
  // Not in Safari 13 (vite.target.ts).
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 1000);
}

/** The Watch together menu (see ./SecondaryViews.ts); a toast says so if its file can't load. */
export function openWatchTogether(
  ctx: ViewContext,
  state: SyncPlayState,
  from: HTMLElement,
  returnFocus: HTMLElement | null = from,
): Promise<void> {
  return loadSecondary().then(
    (module) => module.openWatchTogether(ctx, state, from, returnFocus),
    () => showToast(strings.watchTogetherFailed),
  );
}

/**
 * One of the file's pages: `view` once the file is in. Until then `pending` (the empty page the view shows while its data
 * loads), under the loading veil on a cold load; `liftOnLoad` lifts the veil as the file arrives, for a page that draws
 * its header at once (the others lift it themselves, as before). If the file can't load, `failed` (by default Lumen's
 * error page), whose Try again asks for it again, and reloads the page if that fails too.
 */
export function LazySecondary({
  ctx,
  view,
  pending = <div class="lmn-browse lmn-browse__pending" aria-busy="true" />,
  failed,
  liftOnLoad = false,
  onBack,
}: {
  ctx: ViewContext;
  view: (module: SecondaryModule) => JSX.Element;
  pending?: ComponentChildren;
  failed?: (retry: () => void, retrying: boolean) => JSX.Element;
  liftOnLoad?: boolean;
  /** The error page's way out (Back), as the page's own errors have it; without it, Home. */
  onBack?: () => void;
}) {
  const [module, setModule] = useState<SecondaryModule | null>(loaded);
  const [failedLoad, setFailedLoad] = useState(false);
  // Try again keeps the error up, its button busy, until the file arrives or fails again.
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (module) {
      if (liftOnLoad) liftVeil();
      return;
    }
    let cancelled = false;
    withTimeout(loadSecondary(), VIEW_TIMEOUT_MS).then(
      (m) => !cancelled && setModule(m),
      () => {
        if (cancelled) return;
        // A Try again that failed too: the browser may be holding on to the first failure (see loadSecondary).
        if (attempt) return reloadPage();
        setFailedLoad(true);
        setRetrying(false);
        liftVeil();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, module]);

  if (module) return view(module);
  if (failedLoad) {
    const retry = (): void => {
      if (retrying) return;
      setRetrying(true);
      setAttempt((n) => n + 1);
    };
    return failed ? (
      failed(retry, retrying)
    ) : (
      <PageError
        ctx={ctx}
        title={strings.pageFailedTitle}
        message={strings.pageFailed}
        onRetry={retry}
        retrying={retrying}
        onBack={onBack}
      />
    );
  }
  return <>{pending}</>;
}
