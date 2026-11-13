import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, CatalogItem, ChartEntry, ChartPage, RequestStatus } from '../../api/types';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { Icon } from '../../components/icons';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { registerSessionCache } from '../../util/sessionCaches';
import { type ChartPeriod, type ChartType, chartsHash } from '../../takeover/routes';
import { PageHeader, Segmented } from '../browse/Toolbar';
import { cardMenuHandler, infoHash } from '../cardMenu';
import { catalogHash, loadRequestStatus, useCatalogImageToken } from '../catalog/catalog';
import { LazyQuickRequest } from '../catalog/lazyTitle';
import type { ViewContext } from '../context';
import { CatalogEntry } from '../home/Top10Item';
import { CHART_PERIODS, chartFromHash, isChartsHash } from './chartsRoute';
import { chartsStrings } from './chartsStrings';

/** Titles per page: a few rows of posters at a time, so a TV never draws (or fetches art for) all 100 at once. */
export const CHART_PAGE = 24;

interface Chart {
  entries: ChartEntry[];
  /** How many titles the chart has for this user; pages run up to it. */
  total: number;
  /** Where the next page starts (the server pages by title, so a page Seerr couldn't fully describe is short). */
  next: number;
  /** When its first page came (Date.now()): an older copy is fetched again on the next visit (CHART_STALE_AFTER). */
  fetchedAt: number;
  /**
   * Where the pages start that came without some of their titles (Seerr failed on them, or was too slow: the page's
   * Missing). The page says so and offers to try again, and a copy with any isn't shown again on the next visit.
   */
  short: number[];
}

/** Puts a page into its chart's copy as it is now (another page may have landed meanwhile); `fresh` starts a new copy. */
function merge(forKey: string, page: ChartPage, fresh = false): void {
  const now = fresh ? null : (cache.get(forKey) ?? null);
  const seen = new Set((now?.entries ?? []).map(entryKey));
  cache.set(forKey, {
    // In rank order: a page asked for again brings the titles it lacked, which belong among those already here.
    entries: [...(now?.entries ?? []), ...page.Entries.filter((e) => !seen.has(entryKey(e)))].sort(
      (a, b) => a.Rank - b.Rank,
    ),
    total: page.TotalCount,
    next: Math.max(now?.next ?? 0, page.StartIndex + CHART_PAGE),
    fetchedAt: now?.fetchedAt ?? Date.now(),
    short: (now?.short ?? [])
      .filter((s) => s !== page.StartIndex)
      .concat(page.Missing ? [page.StartIndex] : []),
  });
}

/**
 * How long a chart loaded this session is shown again as it is. The server's copy is fresh for hours, but a TV left on
 * Lumen for days would otherwise show last week's chart, and titles Seerr couldn't describe the first time (left out of
 * their page) never come back.
 */
export const CHART_STALE_AFTER = 30 * 60 * 1000;

/** Charts loaded this session, by user, chart and period, so Back from a title shows its chart at once. */
const cache = new Map<string, Chart>();
/**
 * The charts with a page on its way, by the same key. Module-wide, not the view's: a page still loading when the user
 * switches chart (or leaves the page) lands in its chart's copy, and coming back to that chart waits for it rather than
 * asking for the same page again.
 */
const pending = new Set<string>();
/**
 * The views on screen (one, but a view left mid-load and the one opened next can overlap), told when a page lands or
 * fails. Module-wide like `pending`: a page asked for by a view that has since gone (Back, then the chart again, before
 * it lands) must still reach the view showing its chart, which waits for it rather than asking again.
 */
const listeners = new Set<(key: string, ok: boolean) => void>();
/** Which session a page was asked for in: one that lands after sign-out (clearCharts) is dropped. */
let session = 0;
/** The card last opened from a chart, and where the page was, for Back. */
let selection: { key: string; card: string; scrollY: number } | null = null;

/** Forgets the charts: the session ended (sign out, another user or server). */
export function clearCharts(): void {
  cache.clear();
  pending.clear();
  session++;
  selection = null;
}
registerSessionCache(clearCharts);

const entryKey = (entry: ChartEntry): string => entry.Catalog?.Key ?? entry.Item?.Id ?? String(entry.Rank);

/**
 * Top charts (Trakt design note, 2026-11-12): Trakt's most watched movies or shows of the week, month, year or all time,
 * up to 100, each with its true Trakt rank. Titles on the server are their normal cards; the rest, when the user has
 * Seerr, catalog cards with a Request button under them (as in the Top 10 rows). Pages of 24 load as the end of the grid
 * nears the screen. The chart and period live in the URL (replaced, not pushed, as Search does with its query), so Back
 * from a title returns to the same chart.
 */
export function ChartsView({ ctx }: { ctx: ViewContext }) {
  const [initial] = useState(() => chartFromHash(window.location.hash));
  const [type, setType] = useState<ChartType>(initial.chart);
  const [span, setSpan] = useState<ChartPeriod>(initial.period);
  const key = `${ctx.userId}|${type}|${span}`;
  // Back from a title: the card to focus and where the page was. Kept for the view's life, as useBrowseItems keeps
  // restoredSelectedId: were it read from `selection` on each render, the first re-render after it's cleared (Seerr's
  // request rights coming in, a page loading) would take the card away from useAutoFocus, which would then focus the
  // chart switch and jump to the top.
  const [restore] = useState(() => (selection?.key === key ? selection : null));
  const [data, setData] = useState<Chart | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Re-renders when a page is asked for (`pending` is module-wide, so `loading` below is read from it).
  const [, setPages] = useState(0);
  const latest = useRef(key);
  latest.current = key;
  // A page of the chart on screen landed or failed, whichever view asked for it: its copy is drawn, or Try again shown.
  // Declared before the effect that loads, so it's listening first.
  useEffect(() => {
    const settled = (forKey: string, ok: boolean): void => {
      if (forKey !== latest.current) return;
      setPages((n) => n + 1);
      if (ok) setData(cache.get(forKey) ?? null);
      else setError(true);
    };
    listeners.add(settled);
    return () => {
      listeners.delete(settled);
    };
  }, []);
  const loading = pending.has(key);

  // The chart and period in the URL, without a navigation (takeover/routes.ts chartsHash).
  useEffect(() => {
    const hash = chartsHash(type, span);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
  }, [type, span]);

  // The other way round: the URL changed under the open page (a link to another chart, the address edited). The page
  // isn't opened afresh for that (it's the same route), so it follows; its own switches replace the URL without a
  // hashchange. Not on the way to another page, which takes this one down.
  useEffect(() => {
    const onHash = (): void => {
      if (!isChartsHash(window.location.hash)) return;
      const asked = chartFromHash(window.location.hash);
      setType(asked.chart);
      setSpan(asked.period);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /** Asks for the chart's next page (its first when there's no copy), unless one is already on its way. */
  const load = (): void => {
    const forKey = key;
    if (pending.has(forKey)) return;
    const from = cache.get(forKey)?.next ?? 0;
    const asked = session;
    pending.add(forKey);
    setPages((n) => n + 1);
    setError(false);
    const settle = (ok: boolean): void => {
      pending.delete(forKey);
      listeners.forEach((settled) => settled(forKey, ok));
    };
    ctx.api.getChart(type, span, from, CHART_PAGE).then(
      (page) => {
        if (asked !== session) return;
        // Whether or not the chart is showing.
        merge(forKey, page, from === 0);
        settle(true);
      },
      () => {
        if (asked !== session) return;
        settle(false);
      },
    );
  };

  /**
   * Asks again for the pages that came without some of their titles, one at a time (each is up to 24 lookups for a
   * Seerr that was just struggling). A page that fails outright stays as it was, and the note with it.
   */
  const retryShort = (): void => {
    const forKey = key;
    const starts = cache.get(forKey)?.short ?? [];
    if (pending.has(forKey) || !starts.length) return;
    const asked = session;
    pending.add(forKey);
    setPages((n) => n + 1);
    void starts
      .reduce(
        (before, from) =>
          before.then(() =>
            ctx.api.getChart(type, span, from, CHART_PAGE).then(
              (page) => void (asked === session && merge(forKey, page)),
              () => undefined,
            ),
          ),
        Promise.resolve(),
      )
      .then(() => {
        if (asked !== session) return;
        pending.delete(forKey);
        listeners.forEach((settled) => settled(forKey, true));
        // The note goes once nothing is missing, and a TV remote's focus with its button: to the chart's first card.
        window.setTimeout(() => {
          if (!document.activeElement || document.activeElement === document.body)
            rootRef.current
              ?.querySelector<HTMLElement>('.lmn-charts__grid a, .lmn-charts__grid button')
              ?.focus();
        });
      });
  };

  // A new chart or period: the copy from this session if there is one, else its first page. A copy older than
  // CHART_STALE_AFTER, or one short of some titles, is fetched again, unless the user is coming Back to it (to the card
  // they left, where they were).
  useEffect(() => {
    let cached = cache.get(key) ?? null;
    if (
      cached &&
      !pending.has(key) &&
      restore?.key !== key &&
      (cached.short.length > 0 || Date.now() - cached.fetchedAt > CHART_STALE_AFTER)
    ) {
      cache.delete(key);
      cached = null;
    }
    setData(cached);
    setError(false);
    if (!cached) load();
  }, [key, attempt]);

  const hasMore = !!data && data.next < data.total;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading || error || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && load(), {
      rootMargin: '1200px 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [data, hasMore, loading, error]);

  const hasCatalog = !!data?.entries.some((e) => e.Catalog);
  const imageToken = useCatalogImageToken(ctx, hasCatalog);
  const [requests, setRequests] = useState<RequestStatus | null>(null);
  useEffect(() => {
    if (!hasCatalog) return undefined;
    let cancelled = false;
    void loadRequestStatus(ctx).then((status) => !cancelled && setRequests(status));
    return () => {
      cancelled = true;
    };
  }, [ctx.userId, hasCatalog]);
  const canRequest = (item: CatalogItem): boolean =>
    !!requests?.Enabled && (item.MediaType === 'movie' ? requests.CanRequestMovies : requests.CanRequestTv);
  const [requesting, setRequesting] = useState<CatalogItem | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  // TV: focus the card the user came back from (a library or catalog card: useAutoFocus finds either), else the chart
  // switch (the active Movies or Shows chip). Only as the page opens: switching chart or period leaves focus on the chip
  // the user pressed.
  const opened = useRef(false);
  if (data) opened.current = true;
  useAutoFocus(rootRef, opened.current, ctx.layout, restore?.card);
  // Once: `restore` is kept for the view's life, and the chart it's for drawn again later (after a chart still loading
  // was picked, then this one again) is not Back, so it doesn't jump to where the user once was.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!data || restore?.key !== key || restored.current) return undefined;
    restored.current = true;
    const top = restore.scrollY;
    window.scrollTo({ top });
    // On Back, jellyfin-web shows its own home page (under this one) again, and scrolls to the top as it does
    // (libraryMenu's viewshow) — sometimes after this has run. Back where the user was, after it.
    let later = 0;
    const again = (): void => {
      window.clearTimeout(later);
      later = window.setTimeout(() => window.scrollTo({ top }));
    };
    document.addEventListener('viewshow', again);
    const stop = window.setTimeout(() => document.removeEventListener('viewshow', again), 2000);
    return () => {
      window.clearTimeout(stop);
      window.clearTimeout(later);
      document.removeEventListener('viewshow', again);
    };
  }, [data !== null]);
  useEffect(() => {
    if (selection === restore) selection = null;
  }, []);

  const remember = (card: string): void => {
    selection = { key, card, scrollY: window.scrollY };
  };
  const openItem = (item: BaseItem): void => {
    remember(item.Id);
    ctx.navigate(infoHash(item));
  };
  const openCatalog = (item: CatalogItem): void => {
    remember(item.Key);
    ctx.navigate(catalogHash(item));
  };
  const onMenu = cardMenuHandler(ctx);
  const closeRequest = (): void => {
    const itemKey = requesting?.Key;
    setRequesting(null);
    // Back to the card's Request button, or to the card if the request took it away.
    const root = rootRef.current;
    if (!itemKey || !root) return;
    const back =
      root.querySelector<HTMLElement>(`[data-request-key="${itemKey}"]`) ??
      root.querySelector<HTMLElement>(`[data-catalog-key="${itemKey}"]`);
    window.setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body)
        back?.focus({ preventScroll: true });
    });
  };

  const typeLabel = type === 'movies' ? chartsStrings.movies : chartsStrings.shows;
  const label = chartsStrings.listLabel(typeLabel, chartsStrings.periods[span]);
  const first = !data && loading;
  return (
    <div ref={rootRef} class="lmn-browse lmn-charts">
      <PageHeader title={strings.topCharts} meta={chartsStrings.intro}>
        <Segmented
          label={chartsStrings.type}
          value={type}
          options={[
            { value: 'movies', label: chartsStrings.movies },
            { value: 'shows', label: chartsStrings.shows },
          ]}
          onChange={setType}
        />
        <Segmented
          label={chartsStrings.period}
          value={span}
          options={CHART_PERIODS.map((p) => ({
            value: p,
            label: chartsStrings.periods[p],
            short: chartsStrings.periodsShort[p],
          }))}
          onChange={setSpan}
        />
      </PageHeader>
      {data && data.short.length > 0 && (
        <p class="lmn-charts__partial" role="status">
          <span>{chartsStrings.partial}</span>
          {/* Not disabled while it tries: that would drop a TV remote's focus. retryShort ignores a second press. */}
          <button
            type="button"
            class={`lmn-button lmn-button--secondary${loading ? ' is-busy' : ''}`}
            aria-busy={loading ? 'true' : undefined}
            onClick={retryShort}
          >
            {loading ? strings.retrying : strings.retry}
          </button>
        </p>
      )}
      {data && data.total === 0 ? (
        <div class="lmn-browse__empty">
          <span class="lmn-browse__empty-icon">
            <Icon name="star" size={32} />
          </span>
          <p class="lmn-browse__empty-title">{chartsStrings.empty}</p>
          <p>{chartsStrings.emptyHint}</p>
        </div>
      ) : (
        // D-pad: Left and Right stay in the grid, Up and Down leave it (BrowseGrid's rule).
        <div
          class="lmn-browse-grid lmn-browse-grid--poster lmn-charts__grid focuscontainer-x"
          role="list"
          aria-label={label}
          aria-busy={loading}
        >
          {data?.entries.map((entry) => (
            <div
              role="listitem"
              key={entryKey(entry)}
              class={`lmn-browse-grid__cell lmn-charts__cell${entry.Rank <= 3 ? ' is-top' : ''}`}
            >
              <span class="lmn-charts__rank" aria-hidden="true">
                {chartsStrings.rank(entry.Rank)}
              </span>
              {entry.Catalog ? (
                <CatalogEntry
                  item={entry.Catalog}
                  rank={entry.Rank}
                  client={ctx.client}
                  imageToken={imageToken}
                  onSelect={openCatalog}
                  onRequest={canRequest(entry.Catalog) ? setRequesting : undefined}
                />
              ) : entry.Item ? (
                <Card
                  item={entry.Item}
                  client={ctx.client}
                  variant="poster"
                  rank={entry.Rank}
                  onSelect={openItem}
                  onMenu={onMenu}
                />
              ) : null}
            </div>
          ))}
          {loading &&
            Array.from({ length: first ? 12 : 6 }, (_, i) => (
              <div key={`s${i}`} class="lmn-browse-grid__cell lmn-browse-grid__skeleton" aria-hidden="true">
                <span class="lmn-card__art" />
                <span class="lmn-skeleton-line" />
              </div>
            ))}
        </div>
      )}
      {error && (
        <LoadError
          onRetry={() => {
            if (data) load();
            else setAttempt((n) => n + 1);
          }}
        />
      )}
      {hasMore && !error && <div ref={sentinel} class="lmn-browse-grid__sentinel" aria-hidden="true" />}
      {requesting && <LazyQuickRequest item={requesting} ctx={ctx} onClose={closeRequest} />}
    </div>
  );
}
