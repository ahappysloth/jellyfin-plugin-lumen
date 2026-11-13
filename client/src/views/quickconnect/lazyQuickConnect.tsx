import { useEffect, useState } from 'preact/hooks';
import { onNavigate } from '../../takeover/navigation';
import { loadStyles } from '../../util/loadStyles';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';

type QuickConnectModule = typeof import('./QuickConnect');

let loading: Promise<QuickConnectModule> | null = null;
let loaded: QuickConnectModule | null = null;
const CODE_IN_HASH = /[?&]code=/;

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
 *
 * A link with a code opened while the page shows (another QR code scanned) changes only the address, not the route:
 * the page opens afresh for it, as it would have from anywhere else, reading the code and taking it out of the address.
 */
export function LazyQuickConnectPage({ ctx }: { ctx: ViewContext }) {
  const [module, setModule] = useState<QuickConnectModule | null>(loaded);
  const [link, setLink] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!module)
      loadQuickConnect().then(
        (m) => !cancelled && setModule(m),
        () => !cancelled && ctx.onFallback(),
      );
    const stop = onNavigate(() => CODE_IN_HASH.test(window.location.hash) && setLink((n) => n + 1));
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return module ? (
    <module.ApprovePage key={link} ctx={ctx} />
  ) : (
    <div class="lmn-browse lmn-browse__pending" aria-busy="true" />
  );
}
