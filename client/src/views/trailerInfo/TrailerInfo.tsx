/**
 * The Trailer section of a title's Media info: what the server found of its trailer online and why (GET
 * Lumen/…/TrailerInfo), and what happened with it on this device (views/home/trailerLog.ts), with "Check again" for an
 * administrator. A file of its own (./lazyTrailerInfo.ts), loaded as Media info or Trailer info opens.
 *
 * A movie's Media info is jellyfin-web's dialog (components/itemMediaInfo, opened by compat/itemMenu.ts): the section
 * is added to it once it shows, after its #mediaInfoContent, in the dialog's own markup (.mediaInfoContent,
 * .mediaInfoStream, .mediaInfoLabel), so it looks like the rest of it, skinned or not. Nothing of the stock dialog is
 * changed: if this file never loads, or fails, the dialog is as it was. A show has no Media info (jellyfin-web offers it
 * only for items with media sources), so its ⋯ menu has "Trailer info", the same section in a Lumen dialog.
 */
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getLayout, isBackKey } from '../../compat/jellyfin';
import { MEDIA_INFO_DIALOG } from '../../compat/registry';
import { Icon } from '../../components/icons';
import { onNavigate } from '../../takeover/navigation';
import type { TrailerStep } from '../home/trailerLog';
import type { ViewContext } from '../context';
import { lastAttempt } from './deviceLog';
import { trailerInfoStrings as t } from './trailerInfoStrings';

/** The title the section is for: its log key (the item's id) and its API path (`Items/{id}`). */
export interface TrailerTarget {
  key: string;
  of: string;
  name: string;
}

interface SourceInfo {
  Status: string;
  Detail?: string | null;
  Cached: boolean;
  FetchedAt?: string | null;
  /** Check again failed where a trailer had been found: that one is kept (the rest of this), and still served. */
  RefreshFailed?: { Status: string; Detail?: string | null } | null;
}

/** GET Lumen/…/TrailerInfo (Api/Dtos.cs TrailerInfoDto). */
export interface TrailerInfoResponse {
  Previews: boolean;
  OnlineTrailers: boolean;
  LocalTrailer?: boolean | null;
  Skipped?: string | null;
  Imdb: SourceInfo & { Id?: string | null; Qualities: string[] };
  YouTube: SourceInfo & { VideoId?: string | null; Source?: string | null };
  CanRefresh: boolean;
}

type Load = TrailerInfoResponse | 'loading' | 'failed';

function ask(ctx: ViewContext, of: string, refresh: boolean): Promise<TrailerInfoResponse> {
  return ctx.client.ajax({
    type: refresh ? 'POST' : 'GET',
    url: ctx.client.getUrl(`Lumen/${of}/TrailerInfo${refresh ? '/Refresh' : ''}`),
    dataType: 'json',
  }) as Promise<TrailerInfoResponse>;
}

function ago(at: string | number): string {
  const minutes = Math.floor((Date.now() - new Date(at).getTime()) / 60000);
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const since =
    minutes < 1 ? t.justNow : minutes < 120 ? t.minutesAgo(minutes) : t.hoursAgo(Math.floor(minutes / 60));
  return `${time} (${since})`;
}

function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <>
      <span class="mediaInfoLabel">{label}</span>
      <span class="mediaInfoAttribute">{children}</span>
      <br />
    </>
  );
}

/** A source's result in words: its status, and IMDb's qualities or the detail the server gave. */
function result(source: SourceInfo, imdb: boolean, qualities: string[] = []): string {
  const detail = source.Detail ? `: ${source.Detail}` : '';
  switch (source.Status) {
    case 'found':
      return imdb ? t.qualities(qualities) : t.found;
    case 'notFound':
      return (imdb ? t.noImdbTrailer : t.notFound) + detail;
    case 'noId':
      return t.noId(imdb ? 'IMDb' : 'TMDB');
    case 'httpError':
      return t.httpError + detail;
    case 'timeout':
      return t.timeout + detail;
    case 'skipped':
      return t.skipped;
    case 'noSeerr':
      return t.noSeerr + detail;
    default:
      return t.error + detail;
  }
}

function Fetched({ source, imdb }: { source: SourceInfo; imdb: boolean }) {
  const failed = source.RefreshFailed;
  const when = source.FetchedAt && ago(source.FetchedAt);
  return (
    <>
      {when && <Row label={t.answer}>{source.Cached ? t.cached(when) : t.fetched(when)}</Row>}
      {failed && (
        <Row label={t.checkAgain}>{t.refreshFailed(result({ ...failed, Cached: false }, imdb))}</Row>
      )}
    </>
  );
}

/** A step as it was tried: IMDb's file in the quality noted then (none for one that failed before it loaded). */
function stepLabel(step: TrailerStep): string {
  if (step.source === 'imdb') return step.quality ? `${t.imdb} ${step.quality}` : t.imdb;
  if (step.source === 'local') {
    const how =
      step.quality === 'hls' ? t.hls : step.quality === 'mp4' ? t.mp4 : step.quality ? t.direct : '';
    return how ? `${t.local} (${how})` : t.local;
  }
  return step.source === 'youtube' ? t.youTube : t.lookup;
}

function stepResult(step: TrailerStep): string {
  switch (step.outcome) {
    case 'played':
      return step.ms !== undefined ? t.played((step.ms / 1000).toFixed(1)) : t.playedNoTime;
    case 'pending':
      return t.pending;
    case 'timeout':
      return t.timedOut;
    case 'blocked':
      return t.blocked;
    case 'unsupported':
      return t.unsupported;
    case 'skipped':
      return t.skippedTv;
    case 'none':
      return t.none;
    default: {
      const code =
        step.code === undefined
          ? ''
          : `: ${step.source === 'youtube' ? t.youTubeError(step.code) : step.source === 'lookup' ? t.httpStatus(step.code) : t.mediaError(step.code)}`;
      return t.failed + code + (step.message ? ` (${step.message})` : '');
    }
  }
}

/**
 * The section. `lumen` is for Lumen's own dialog, whose title already says what it is about and whose buttons are
 * Lumen's.
 */
export function TrailerInfo({
  ctx,
  target,
  lumen,
}: {
  ctx: ViewContext;
  target: TrailerTarget;
  lumen?: boolean;
}) {
  const [info, setInfo] = useState<Load>('loading');
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    ask(ctx, target.of, false).then(
      (answer) => live && setInfo(answer),
      () => live && setInfo('failed'),
    );
    return () => {
      live = false;
    };
  }, []);

  const checkAgain = (): void => {
    // Still focusable while it asks (aria-disabled, not disabled), and the same button after: a disabled one would drop
    // focus to the page, out of Lumen's dialog (whose Escape and Back then go nowhere) and, on a TV, out of the remote's
    // reach.
    if (checking) return;
    setChecking(true);
    setNote(t.checking);
    ask(ctx, target.of, true).then(
      (answer) => {
        setInfo(answer);
        setNote(t.checked);
        setChecking(false);
      },
      (error: unknown) => {
        // jellyfin-web's ajax rejects with the Response.
        const response = error as Response | null;
        const wait = response?.status === 429 ? Number(response.headers?.get('Retry-After')) : NaN;
        setNote(wait > 0 ? t.tooSoon(wait) : t.checkFailed);
        setChecking(false);
      },
    );
  };

  const attempt = lastAttempt(target.key);
  const ready = typeof info === 'object' ? info : null;
  const imdb = ready?.Imdb;
  const youTube = ready?.YouTube;
  return (
    <div
      class="mediaInfoContent lmn-trailer-info"
      // A remote's focus can land below the fold of a TV's full-screen dialog. jellyfin-web's scroll manager
      // (components/scrollManager.js, the TV layout's only) scrolls the dialog to it as it gets focus, but to the wrong
      // place over Lumen's page; marked as scrolling itself, the section is scrolled here instead: at once, as the
      // dialog's smooth scrolling was cut short there. Only in the TV layout: elsewhere the browser does it, and a click
      // would move the control out from under the pointer.
      data-scroll-mode-x="custom"
      data-scroll-mode-y="custom"
      onFocusCapture={(e) => {
        if (getLayout() === 'tv')
          (e.target as Element).scrollIntoView?.({ block: 'center', behavior: 'instant' });
      }}
    >
      {!lumen && <h2 class="mediaInfoStreamType">{t.heading}</h2>}
      <div class="mediaInfoStream">
        <h3 class="lmn-trailer-info__group">{t.server}</h3>
        {info === 'loading' && <p class="lmn-trailer-info__note">{t.loading}</p>}
        {info === 'failed' && <p class="lmn-trailer-info__note">{t.loadFailed}</p>}
        {ready && imdb && youTube && (
          <>
            <Row label={t.onlineTrailers}>
              {!ready.Previews ? t.previewsOff : !ready.OnlineTrailers ? t.onlineOff : t.on}
            </Row>
            {ready.LocalTrailer != null && (
              <Row label={t.localTrailer}>{ready.LocalTrailer ? t.localWins : t.no}</Row>
            )}
            <Row label={t.imdbId}>{imdb.Id ?? t.noImdbId}</Row>
            <Row label={t.imdb}>{result(imdb, true, imdb.Qualities)}</Row>
            <Fetched source={imdb} imdb />
            <Row label={t.youTube}>
              {youTube.VideoId ? (
                <>
                  <a
                    // Not where jellyfin-web's dialog puts focus as it opens (focusManager.autoFocus skips these): a
                    // TV's would jump to the bottom of Media info. The D-pad reaches them.
                    class="noautofocus"
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(youTube.VideoId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {youTube.VideoId}
                  </a>{' '}
                  {youTube.Source === 'jellyfin' ? t.fromJellyfin : t.fromSeerr}
                </>
              ) : (
                result(youTube, false)
              )}
            </Row>
            <Fetched source={youTube} imdb={false} />
          </>
        )}
      </div>
      <div class="mediaInfoStream">
        <h3 class="lmn-trailer-info__group">{t.device}</h3>
        {attempt ? (
          <>
            <Row label={t.lastAttempt}>
              {ago(attempt.at)}
              {attempt.tv ? `, ${t.tvLayout}` : ''}
            </Row>
            {attempt.steps.map((step, i) => (
              <Row key={i} label={stepLabel(step)}>
                {stepResult(step)}
              </Row>
            ))}
          </>
        ) : (
          <p class="lmn-trailer-info__note">{t.notPlayed}</p>
        )}
      </div>
      {ready?.CanRefresh && (
        <p class="lmn-trailer-info__actions">
          <button
            type="button"
            class={
              lumen
                ? 'lmn-button lmn-button--secondary'
                : 'raised emby-button lmn-trailer-info__check noautofocus'
            }
            aria-disabled={checking || undefined}
            onClick={checkAgain}
          >
            {t.checkAgain}
          </button>
        </p>
      )}
      <p class="lmn-trailer-info__note" role="status">
        {note}
      </p>
    </div>
  );
}

/**
 * How long after Media info is asked for its dialog may take to show (its chunk, then the item, from the server), at
 * most: the watch ends sooner as jellyfin-web is done opening it (settleMediaInfo).
 */
const DIALOG_WAIT_MS = 10_000;

/**
 * Ends the last call's watch for its dialog, taking it first if it's up (`take`): a newer call is for another dialog,
 * which that one mustn't take.
 */
let watching: ((take?: boolean) => void) | null = null;

/**
 * Adds the section to jellyfin-web's Media info dialog as it shows (or now, if it's up). Its markup doesn't say which
 * item it's for (a heading, then the media sources, filled in later), so only the first Media info dialog to show
 * after the call is taken, and only one without the section already: the watch ends as any shows, as the page changes,
 * as jellyfin-web is done opening the one asked for (settleMediaInfo: one that failed to open leaves nothing to wait
 * for, and another title's Media info, opened next, mustn't get this section), or after DIALOG_WAIT_MS. Taken down as
 * the dialog closes (dialogHelper's `close`).
 */
export function attachToMediaInfo(ctx: ViewContext, target: TrailerTarget, doc: Document = document): void {
  watching?.();
  /** Whether a Media info dialog has shown: this title's, with the section added unless it had it already. */
  const attach = (): boolean => {
    const content = doc.querySelector(MEDIA_INFO_DIALOG.content);
    const dialog = content?.closest(MEDIA_INFO_DIALOG.dialog);
    if (!content || !dialog) return false;
    if (dialog.hasAttribute('data-lmn-trailer')) return true;
    dialog.setAttribute('data-lmn-trailer', '');
    const host = doc.createElement('div');
    try {
      // Beside the stock content, not in it: jellyfin-web fills that with innerHTML once it has the user.
      content.parentNode!.insertBefore(host, content.nextSibling);
      render(<TrailerInfo ctx={ctx} target={target} />, host);
      dialog.addEventListener('close', () => render(null, host), { once: true });
    } catch {
      host.remove();
    }
    return true;
  };
  if (attach()) return;
  const observer = new MutationObserver(() => {
    if (attach()) end();
  });
  const timer = setTimeout(() => end(), DIALOG_WAIT_MS);
  // The page changed: a dialog up by now is the one asked for (jellyfin-web may note an open dialog in the history),
  // and one that shows later is another page's, another title's.
  const stopNavigation = onNavigate(() => end(true), doc.defaultView ?? window);
  const end = (take?: boolean): void => {
    if (take) attach();
    observer.disconnect();
    clearTimeout(timer);
    stopNavigation();
    if (watching === end) watching = null;
  };
  watching = end;
  observer.observe(doc.body, { childList: true, subtree: true });
}

/**
 * jellyfin-web is done opening the Media info dialog last asked for (compat/itemMenu.ts's openItemDialog has settled):
 * it's up by now, or never will be. The section goes in if it hasn't yet, and the watch for the dialog ends.
 */
export function settleMediaInfo(): void {
  watching?.(true);
}

function TrailerInfoDialog({
  ctx,
  target,
  onClose,
}: {
  ctx: ViewContext;
  target: TrailerTarget;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    window.addEventListener('hashchange', onClose);
    return () => window.removeEventListener('hashchange', onClose);
  }, []);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isBackKey(e)) {
      // Back must not reach jellyfin-web, which would leave the page.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    // Keep Tab inside the dialog, as views/catalog/RequestDialog.tsx does.
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('button, a[href]')];
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
  return (
    <div
      class="lmn-dialog"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        class="lmn-dialog__panel lmn-trailer-dialog focuscontainer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lmn-trailer-dialog-title"
        onKeyDown={onKeyDown}
      >
        <button type="button" class="lmn-dialog__close" aria-label={t.close} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
        <h2 id="lmn-trailer-dialog-title" class="lmn-dialog__title">
          {t.dialogTitle(target.name)}
        </h2>
        <TrailerInfo ctx={ctx} target={target} lumen />
      </div>
    </div>
  );
}

/** Trailer info for a title without Media info (a show): the section in Lumen's dialog, until closed. */
export function openTrailerInfoDialog(
  ctx: ViewContext,
  target: TrailerTarget,
  returnFocus: Element | null,
): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const close = (): void => {
    render(null, host);
    host.remove();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
      returnFocus.focus({ preventScroll: true });
  };
  render(<TrailerInfoDialog ctx={ctx} target={target} onClose={close} />, host);
}
