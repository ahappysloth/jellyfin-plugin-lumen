import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, HomeRow } from '../../api/types';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { cardMenuHandler, infoHash } from '../cardMenu';
import type { ViewContext } from '../context';
import { captionFor, Row } from '../home/Row';
import { PageHeader } from './Toolbar';
import { formatDate } from '../../util/locale';
import { registerSessionCache } from '../../util/sessionCaches';

type Collection = 'movies' | 'tvshows';

const row = (id: string, title: string, items: BaseItem[]): HomeRow => ({
  Id: id,
  Type: 'Suggestions',
  Title: title,
  Items: items,
});

/** Each library's suggestions as last loaded this session: coming back shows them at once while they refresh. */
const shown = new Map<string, HomeRow[]>();
registerSessionCache(() => shown.clear());

/** The library's suggestion rows, from Jellyfin's own lists; a failed or empty list is left out. */
export async function loadSuggestions(
  ctx: ViewContext,
  id: string,
  collection: Collection,
): Promise<HomeRow[]> {
  const none =
    <T,>(fallback: T) =>
    () =>
      fallback;
  const empty = { Items: [] as BaseItem[] };
  if (collection === 'movies') {
    const [resume, latest, recommendations] = await Promise.all([
      ctx.api.getResumeIn(id, 'Movie').catch(none(empty)),
      ctx.api.getLatestIn(id, 'Movie').catch(none([] as BaseItem[])),
      ctx.api.getMovieRecommendations(id).catch(none([])),
    ]);
    return [
      row('resume', strings.continueWatching, resume.Items),
      row('latest', strings.latestMovies, latest),
      ...recommendations.map((r, i) =>
        row(
          `rec-${r.CategoryId ?? i}`,
          strings.recommendation(r.RecommendationType, r.BaselineItemName),
          r.Items,
        ),
      ),
    ].filter((r) => r.Items.length > 0);
  }
  const [resume, nextUp, latest] = await Promise.all([
    ctx.api.getResumeIn(id, 'Episode').catch(none(empty)),
    ctx.api.getNextUpIn(id).catch(none(empty)),
    ctx.api.getLatestIn(id, 'Episode').catch(none([] as BaseItem[])),
  ]);
  return [
    row('resume', strings.continueWatching, resume.Items),
    row('nextup', strings.nextUp, nextUp.Items),
    row('latest', strings.latestEpisodes, latest),
  ].filter((r) => r.Items.length > 0);
}

/** A library's Suggestions tab: home-style rows of what to watch next. */
export function SuggestionsTab({
  id,
  collection,
  title,
  tabs,
  ctx,
}: {
  id: string;
  collection: Collection;
  title: string;
  tabs: ComponentChildren;
  ctx: ViewContext;
}) {
  const cacheKey = `${ctx.userId}:${id}`;
  const [rows, setRows] = useState<HomeRow[] | null>(() => shown.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, rows !== null || failed, ctx.layout);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const cached = shown.get(cacheKey);
    if (cached) setRows(cached);
    loadSuggestions(ctx, id, collection)
      .then((r) => {
        shown.set(cacheKey, r);
        if (!cancelled) setRows(r);
      })
      // A refresh that fails behind cached rows keeps them.
      .catch(() => !cancelled && !cached && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, ctx.userId, attempt]);

  const onMenu = cardMenuHandler(ctx);
  return (
    <div ref={rootRef} class="lmn-browse lmn-suggestions">
      <PageHeader title={title} tabs={tabs} />
      {failed && <LoadError onRetry={() => setAttempt((n) => n + 1)} />}
      {rows && rows.length === 0 && (
        <div class="lmn-browse__empty">
          <p>{strings.noSuggestions}</p>
        </div>
      )}
      {rows?.map((r) => (
        <Row
          key={r.Id}
          row={r}
          client={ctx.client}
          onSelect={(item) => ctx.navigate(infoHash(item))}
          onMenu={onMenu}
        />
      ))}
      {!rows && !failed && <div class="lmn-browse__pending" aria-busy="true" />}
    </div>
  );
}

/** The local calendar day of a date, as YYYY-MM-DD (for grouping). */
export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Upcoming episodes grouped by local air day, soonest first: "Today", "Tomorrow", then "Fri, Nov 13". */
export function groupByAirDay(
  items: BaseItem[],
  now: Date = new Date(),
): { label: string; items: BaseItem[] }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const groups = new Map<string, { label: string; items: BaseItem[] }>();
  for (const item of items) {
    const date = item.PremiereDate ? new Date(item.PremiereDate) : null;
    if (!date || Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    const label =
      key === dayKey(now)
        ? strings.today
        : key === dayKey(tomorrow)
          ? strings.tomorrow
          : formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

/** Shows' Upcoming tab: episodes due to air, by day. */
export function UpcomingTab({
  id,
  title,
  tabs,
  ctx,
}: {
  id: string;
  title: string;
  tabs: ComponentChildren;
  ctx: ViewContext;
}) {
  const [items, setItems] = useState<BaseItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, items !== null || failed, ctx.layout);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    ctx.api
      .getUpcoming(id)
      .then((r) => !cancelled && setItems(r.Items))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, ctx.userId, attempt]);

  const groups = items ? groupByAirDay(items) : [];
  const onMenu = cardMenuHandler(ctx);
  return (
    <div ref={rootRef} class="lmn-browse lmn-upcoming">
      <PageHeader title={title} tabs={tabs} />
      {failed && <LoadError onRetry={() => setAttempt((n) => n + 1)} />}
      {items && groups.length === 0 && (
        <div class="lmn-browse__empty">
          <p>{strings.noUpcoming}</p>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.label} class="lmn-upcoming__day" aria-label={group.label}>
          <h2 class="lmn-row__title">{group.label}</h2>
          <div class="lmn-browse-grid lmn-browse-grid--landscape focuscontainer-x">
            {group.items.map((item) => (
              <Card
                key={item.Id}
                item={item}
                client={ctx.client}
                variant="landscape"
                caption={captionFor(item)}
                onSelect={(selected) => ctx.navigate(infoHash(selected))}
                onMenu={onMenu}
              />
            ))}
          </div>
        </section>
      ))}
      {!items && !failed && <div class="lmn-browse__pending" aria-busy="true" />}
    </div>
  );
}
