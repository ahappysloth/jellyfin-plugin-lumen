import { useEffect, useRef, useState } from 'preact/hooks';
import type { CatalogItem, CatalogTitle } from '../../api/types';
import { isBackKey } from '../../compat/jellyfin';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { setCatalogState, stateLabel } from './catalog';
import { RequestDialog, requestedState } from './RequestDialog';
import { titleStrings } from './titleStrings';

/**
 * The request dialog for a card's Request button (the Top 10 rows), without opening the title's page: it loads the
 * title's details from Seerr (a show's seasons, what's left to request), then shows the same dialog the page does.
 * Every card for the title takes the new state once Seerr accepts.
 */
export function QuickRequest({
  item,
  ctx,
  onClose,
}: {
  item: CatalogItem;
  ctx: ViewContext;
  onClose: () => void;
}) {
  const [title, setTitle] = useState<CatalogTitle | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    withTimeout(ctx.api.getCatalogTitle(item.MediaType, item.TmdbId), VIEW_TIMEOUT_MS).then(
      (t) => {
        if (cancelled) return;
        // Requested elsewhere since the home screen loaded, say: say so rather than offer a form with nothing in it.
        if (t.CanRequest) setTitle(t);
        else {
          setCatalogState(t.Key, t.State);
          setFailed(
            t.State === 'Blocklisted'
              ? titleStrings.blocklisted
              : t.State === 'None'
                ? titleStrings.cannotRequest
                : (stateLabel(t.State) ?? titleStrings.available),
          );
        }
      },
      () => !cancelled && setFailed(titleStrings.titleFailed),
    );
    return () => {
      cancelled = true;
    };
  }, [item.Key]);

  // Focus in the dialog from the start, so Back and Escape close it while it loads. (The page puts it back on the card.)
  useEffect(() => {
    (panel.current?.querySelector<HTMLElement>('button') ?? panel.current)?.focus();
  }, [failed]);

  if (title) {
    return (
      <RequestDialog
        title={title}
        ctx={ctx}
        onClose={onClose}
        onRequested={(result) => setCatalogState(title.Key, requestedState(title, result))}
      />
    );
  }
  // Loading (usually a moment: Seerr's answer is cached) or failed: the dialog's frame, so the page doesn't flash.
  const headingId = `lmn-quick-request-${item.Key}`;
  return (
    <div class="lmn-dialog" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        class="lmn-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-busy={failed ? undefined : 'true'}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (!isBackKey(e)) return;
          // Back must not reach jellyfin-web, which would leave the page.
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <h2 id={headingId} class="lmn-dialog__title">
          {titleStrings.requestTitle(item.Title)}
        </h2>
        {failed && (
          <>
            <p class="lmn-dialog__text" role="status">
              {failed}
            </p>
            <div class="lmn-dialog__actions">
              <button type="button" class="lmn-button lmn-button--primary" onClick={onClose}>
                {titleStrings.close}
              </button>
            </div>
          </>
        )}
        {!failed && <p class="lmn-dialog__text">{titleStrings.loadingTitle}</p>}
      </div>
    </div>
  );
}
