import { useEffect, useRef, useState } from 'preact/hooks';
import { HOME_HASH } from '../compat/jellyfin';
import { LoadError } from '../components/LoadError';
import { useAutoFocus } from '../components/useAutoFocus';
import { strings } from '../strings';
import type { ViewContext } from './context';

/**
 * Pages that draw their own header in place of Lumen's nav (details, catalog titles: App.tsx) have none when they can't
 * load, which would leave a dead end. While one shows its error it asks App for the nav back.
 */
let failedPages = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** True while a page that normally hides Lumen's nav is showing its error instead. */
export function useFailedPage(): boolean {
  const [failed, setFailed] = useState(failedPages > 0);
  useEffect(() => {
    const listener = (): void => setFailed(failedPages > 0);
    listeners.add(listener);
    // The page's own effects (useMarkFailedPage) run before its parent's: catch up on any that already did.
    listener();
    return () => void listeners.delete(listener);
  }, []);
  return failed;
}

/** For the life of the calling component, the page has failed: App shows Lumen's nav. */
export function useMarkFailedPage(): void {
  useEffect(() => {
    failedPages++;
    notify();
    return () => {
      failedPages--;
      notify();
    };
  }, []);
}

/** Marks the page failed while it's rendered (useMarkFailedPage), for an error block of the page's own. */
export function FailedPageMark() {
  useMarkFailedPage();
  return null;
}

/**
 * A whole page Lumen couldn't show: what went wrong, Try again when there's something to retry, and a way out (Back,
 * or Home). Lumen's nav stays on screen.
 */
export function PageError({
  ctx,
  title,
  message,
  onRetry,
  onBack,
}: {
  ctx: ViewContext;
  title: string;
  message: string;
  onRetry?: () => void;
  /** Back to where the user came from; without it the way out is Home. */
  onBack?: () => void;
}) {
  useMarkFailedPage();
  const root = useRef<HTMLElement>(null);
  useAutoFocus(root, true, ctx.layout);
  return (
    <section ref={root} class="lmn-page-error" aria-labelledby="lmn-page-error-title">
      <h1 id="lmn-page-error-title" class="lmn-page-error__title">
        {title}
      </h1>
      <LoadError message={message} onRetry={onRetry}>
        {onBack ? (
          <button
            type="button"
            class={`lmn-button lmn-button--secondary${onRetry ? '' : ' lmn-autofocus'}`}
            onClick={onBack}
          >
            {strings.back}
          </button>
        ) : (
          <a class="lmn-button lmn-button--secondary lmn-autofocus" href={HOME_HASH}>
            {strings.home}
          </a>
        )}
      </LoadError>
    </section>
  );
}
