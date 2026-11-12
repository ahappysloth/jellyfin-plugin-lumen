import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, CatalogItem, ChartEntry, RequestStatus } from '../../api/types';
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
import { CHART_PERIODS, chartFromHash } from './chartsRoute';
import { chartsStrings } from './chartsStrings';

/** Titles per page: a few rows of posters at a time, so a TV never draws (or fetches art for) all 100 at once. */
export const CHART_PAGE = 24;

interface Chart {
  entries: ChartEntry[];
  /** How many titles the chart has for this user; pages run up to it. */
  total: number;
  /** Where the next page starts (the server pages by title, so a page Seerr couldn't fully describe is short). */
  next: number;
}

/** Charts loaded this session, by user, chart and period, so Back from a title shows its chart at once. */
const cache = new Map<string, Chart>();
/** The card last opened from a chart, and where the page was, for Back. */
let selection: { key: string; card: string; scrollY: number } | null = null;

/** Forgets the charts: the session ended (sign out, another user or server). */
export function clearCharts(): void {
  cache.clear();
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
  const [data, setData] = useState<Chart | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(key);
  latest.current = key;

  // The chart and period in the URL, without a navigation (takeover/routes.ts chartsHash).
  useEffect(() => {
    const hash = chartsHash(type, span);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
  }, [type, span]);

  const load = (from: Chart | null): void => {
    const forKey = key;
    setLoading(true);
    setError(false);
    ctx.api.getChart(type, span, from?.next ?? 0, CHART_PAGE).then(
      (page) => {
        if (latest.current !== forKey) return;
        const seen = new Set((from?.entries ?? []).map(entryKey));
        const chartNow: Chart = {
          entries: [...(from?.entries ?? []), ...page.Entries.filter((e) => !seen.has(entryKey(e)))],
          total: page.TotalCount,
          next: page.StartIndex + CHART_PAGE,
        };
        cache.set(forKey, chartNow);
        setData(chartNow);
        setLoading(false);
      },
      () => {
        if (latest.current !== forKey) return;
        setLoading(false);
        setError(true);
      },
    );
  };

  // A new chart or period: the copy from this session if there is one, else its first page.
  useEffect(() => {
    const cached = cache.get(key) ?? null;
    setData(cached);
    // A load still running for the chart the user left is ignored when it lands (latest), so it mustn't hold this one.
    setLoading(false);
    setError(false);
    if (!cached) load(null);
  }, [key, attempt]);

  const hasMore = !!data && data.next < data.total;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading || error || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && load(data), {
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
  const restore = selection?.key === key ? selection : null;
  // TV: focus the card the user came back from, else the chart switch (the active Movies or Shows chip). Only as the
  // page opens: switching chart or period leaves focus on the chip the user pressed.
  const opened = useRef(false);
  if (data) opened.current = true;
  useAutoFocus(rootRef, opened.current, ctx.layout, restore?.card);
  useLayoutEffect(() => {
    if (data && restore) window.scrollTo({ top: restore.scrollY });
  }, [data !== null]);
  // useAutoFocus finds library cards by item id; a catalog card (by its key) is focused here, after it.
  useEffect(() => {
    if (!data || !restore) return;
    selection = null;
    const card = rootRef.current?.querySelector<HTMLElement>(`[data-catalog-key="${restore.card}"]`);
    if (card) card.focus({ preventScroll: ctx.layout !== 'tv' });
  }, [data !== null]);

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
          options={CHART_PERIODS.map((p) => ({ value: p, label: chartsStrings.periods[p] }))}
          onChange={setSpan}
        />
      </PageHeader>
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
            if (data) load(data);
            else setAttempt((n) => n + 1);
          }}
        />
      )}
      {hasMore && !error && <div ref={sentinel} class="lmn-browse-grid__sentinel" aria-hidden="true" />}
      {requesting && <LazyQuickRequest item={requesting} ctx={ctx} onClose={closeRequest} />}
    </div>
  );
}
