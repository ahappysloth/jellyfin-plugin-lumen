import { useEffect, useRef, useState } from 'preact/hooks';
import { RequestError } from '../../api/lumenApi';
import type { CatalogState, CatalogTitle, RequestResult } from '../../api/types';
import { isBackKey } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { stateLabel } from './catalog';
import { titleStrings } from './titleStrings';

interface Props {
  title: CatalogTitle;
  ctx: ViewContext;
  onClose: () => void;
  /** After Seerr accepted the request; `seasons` is null for a movie. */
  onRequested: (result: RequestResult, seasons: number[] | null) => void;
}

/** A title's state once Seerr has accepted a request for it (a partly available show stays partly available). */
export function requestedState(title: CatalogTitle, result: RequestResult): CatalogState {
  if (title.State === 'PartlyAvailable') return 'PartlyAvailable';
  return result.State === 'None' ? 'Requested' : result.State;
}

type Phase =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'done'; pending: boolean }
  | { kind: 'error'; message: string };

/**
 * Confirms a request. A movie is one step; a show lists its seasons with what's already available or requested
 * (those can't be picked again). Seerr decides permissions, quota and approval; its answer is shown as-is.
 */
export function RequestDialog({ title, ctx, onClose, onRequested }: Props) {
  const requestable = title.Seasons.filter((s) => s.State === 'None').map((s) => s.Number);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(requestable));
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const isTv = title.MediaType === 'tv';
  const allSelected = requestable.length > 0 && requestable.every((n) => selected.has(n));

  // Focus moves into the dialog and returns to the button that opened it.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const back = opener.current;
    return () => (back as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, []);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [phase.kind]);

  const toggle = (n: number): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const send = (): void => {
    // Always name the seasons: "all" would also cover seasons Seerr adds later.
    const seasons = isTv ? [...selected].sort((a, b) => a - b) : null;
    setPhase({ kind: 'sending' });
    ctx.api
      .requestTitle(title.MediaType, title.TmdbId, seasons ?? undefined)
      .then((result) => {
        onRequested(result, seasons);
        setPhase({ kind: 'done', pending: result.NeedsApproval });
      })
      .catch((error: unknown) =>
        setPhase({
          kind: 'error',
          message: (error instanceof RequestError && error.message) || titleStrings.requestFailed,
        }),
      );
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isBackKey(e)) {
      // Even while sending (when it can't close yet), Back must not reach jellyfin-web, which would leave the page.
      e.preventDefault();
      e.stopPropagation();
      if (phase.kind !== 'sending') onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    // Keep Tab inside the dialog.
    const focusable = [
      ...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const headingId = `lmn-request-${title.Key}`;
  return (
    <div
      class="lmn-dialog"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && phase.kind !== 'sending') onClose();
      }}
    >
      <div
        ref={panel}
        class="lmn-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
      >
        {/* Like Escape and the backdrop, closing waits for an in-flight request to settle. */}
        <button
          type="button"
          class="lmn-dialog__close"
          aria-label={titleStrings.close}
          disabled={phase.kind === 'sending'}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
        <h2 id={headingId} class="lmn-dialog__title">
          {titleStrings.requestTitle(title.Title)}
        </h2>

        {phase.kind === 'done' || phase.kind === 'error' ? (
          <>
            <p class={`lmn-dialog__outcome${phase.kind === 'error' ? ' is-error' : ''}`} role="status">
              <Icon name={phase.kind === 'error' ? 'info' : 'check'} size={22} />
              {phase.kind === 'error'
                ? phase.message
                : phase.pending
                  ? titleStrings.requestPending
                  : titleStrings.requestDone}
            </p>
            <div class="lmn-dialog__actions">
              {phase.kind === 'error' && (
                <button
                  type="button"
                  class="lmn-button lmn-button--secondary"
                  onClick={() => setPhase({ kind: 'form' })}
                >
                  {strings.retry}
                </button>
              )}
              <button type="button" class="lmn-button lmn-button--primary" data-autofocus onClick={onClose}>
                {titleStrings.done}
              </button>
            </div>
          </>
        ) : (
          <>
            <p class="lmn-dialog__text">
              {isTv ? titleStrings.chooseSeasons : titleStrings.requestMovieConfirm}
            </p>
            {isTv && (
              <div class="lmn-seasons" role="group" aria-label={strings.season}>
                {requestable.length > 1 && (
                  <label class="lmn-seasons__row lmn-seasons__row--all">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(requestable))}
                    />
                    <span class="lmn-seasons__name">{titleStrings.allSeasons}</span>
                  </label>
                )}
                {title.Seasons.map((season) => {
                  const locked = season.State !== 'None';
                  return (
                    <label key={season.Number} class={`lmn-seasons__row${locked ? ' is-locked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={locked || selected.has(season.Number)}
                        disabled={locked}
                        onChange={() => toggle(season.Number)}
                      />
                      <span class="lmn-seasons__name">{season.Name}</span>
                      <span class="lmn-seasons__meta">
                        {locked
                          ? (stateLabel(season.State) ?? titleStrings.available)
                          : titleStrings.seasonEpisodes(season.EpisodeCount)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <div class="lmn-dialog__actions">
              <button
                type="button"
                class="lmn-button lmn-button--secondary"
                disabled={phase.kind === 'sending'}
                onClick={onClose}
              >
                {strings.cancel}
              </button>
              <button
                type="button"
                class="lmn-button lmn-button--primary"
                data-autofocus
                disabled={phase.kind === 'sending' || (isTv && selected.size === 0)}
                onClick={send}
              >
                {phase.kind === 'sending' ? titleStrings.sending : titleStrings.sendRequest}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
