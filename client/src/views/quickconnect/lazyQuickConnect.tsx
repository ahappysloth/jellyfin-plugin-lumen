import { useEffect, useState } from 'preact/hooks';
import { loadStyles } from '../../util/loadStyles';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';

type QuickConnectModule = typeof import('./QuickConnect');

let loading: Promise<QuickConnectModule> | null = null;
let loaded: QuickConnectModule | null = null;

/**
 * Quick Connect (the approve page and the sign-in screen, with the QR encoder) is a file of its own with its own
 * stylesheet, loaded the first time either opens: most visits never use it. `/Lumen/Assets/` needs no sign-in, so the
 * sign-in page can load it too. A failed load is asked for again next time.
 */
export function loadQuickConnect(): Promise<QuickConnectModule> {
  loading ??= Promise.all([import('./QuickConnect'), loadStyles('lumen-quickconnect.css')]).then(
    ([module]) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return withTimeout(loading, VIEW_TIMEOUT_MS);
}

/**
 * The approve page once its file is in; until then the empty page a browse page shows while it loads. If the file can't
 * load, jellyfin-web's own Quick Connect page takes over (it reads `?code=` too: the address still has it then).
 */
export function LazyQuickConnectPage({ ctx }: { ctx: ViewContext }) {
  const [module, setModule] = useState<QuickConnectModule | null>(loaded);
  useEffect(() => {
    if (module) return;
    let cancelled = false;
    loadQuickConnect().then(
      (m) => !cancelled && setModule(m),
      () => !cancelled && ctx.onFallback(),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return module ? (
    <module.ApprovePage ctx={ctx} />
  ) : (
    <div class="lmn-browse lmn-browse__pending" aria-busy="true" />
  );
}
