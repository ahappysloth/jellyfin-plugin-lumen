import { useEffect, useState } from 'preact/hooks';
import { strings } from '../../strings';
import { loadStyles } from '../../util/loadStyles';
import { reloadIfReachable } from '../../util/reloadPage';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { liftVeil } from '../../veil/veil';
import type { ViewContext } from '../context';
import { PageError } from '../pageError';

type ChartsModule = typeof import('./ChartsView');

let loading: Promise<ChartsModule> | null = null;
let loaded: ChartsModule | null = null;

/**
 * The Top charts page is a file of its own (./ChartsView.tsx) with its own stylesheet, loaded the first time it opens:
 * only servers with a Trakt key have it, so the rest never download it. A failed load is asked for again next time,
 * though a browser may remember the failure until the page reloads (as it will for a page left open across a Lumen
 * update, whose old file is gone): so a Try again that fails too reloads the page.
 */
export function loadCharts(): Promise<ChartsModule> {
  loading ??= Promise.all([import('./ChartsView'), loadStyles('lumen-charts.css')]).then(
    ([module]) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * ChartsView once its file is in; until then the empty page a browse page shows while it loads. Its header draws at once,
 * so the veil lifts as the file arrives. If the file can't load, Lumen's error page with Try again.
 */
export function LazyCharts({ ctx }: { ctx: ViewContext }) {
  const [module, setModule] = useState<ChartsModule | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (module) {
      liftVeil();
      return;
    }
    let cancelled = false;
    setFailed(false);
    withTimeout(loadCharts(), VIEW_TIMEOUT_MS).then(
      (m) => !cancelled && setModule(m),
      () => {
        if (cancelled) return;
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
  }, [attempt, module]);

  if (module) return <module.ChartsView ctx={ctx} />;
  if (failed)
    return (
      <PageError
        ctx={ctx}
        title={strings.pageFailedTitle}
        message={strings.loadFailed}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  return <div class="lmn-browse lmn-browse__pending" aria-busy="true" />;
}
