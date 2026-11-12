import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, CatalogItem } from '../../api/types';
import { Card } from '../../components/Card';
import { Icon } from '../../components/icons';
import { type CardVariant, type ImageRef, imageUrl } from '../../components/images';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { boxAt, useImageWidth } from '../../components/useImageWidth';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import { CatalogCard } from '../catalog/CatalogCard';
import { catalogHash, loadRequestStatus, useCatalogImageToken } from '../catalog/catalog';
import { type CardMenuHandler, infoHash, useCardMenu } from '../cardMenu';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';
import { captionFor } from '../home/Row';
import { secondaryStrings } from '../secondary/secondaryStrings';

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;
const PER_KIND = 24;
const PEOPLE = 12;

interface Section {
  key: string;
  title: string;
  variant: CardVariant;
  items: BaseItem[];
}

export interface SearchResults {
  query: string;
  sections: Section[];
  people: BaseItem[];
  /** Seerr titles not already listed above; empty when request features are off for this user. */
  catalog: CatalogItem[];
  /** Every library search failed (offline, server down): not the same as "no results". */
  failed: boolean;
}

const KINDS: readonly { key: string; title: string; type: string; variant: CardVariant }[] = [
  { key: 'movies', title: strings.movies, type: 'Movie', variant: 'poster' },
  { key: 'shows', title: strings.shows, type: 'Series', variant: 'poster' },
  { key: 'episodes', title: strings.episodesTab, type: 'Episode', variant: 'landscape' },
];

/**
 * Searches each kind separately so every section gets its own best matches. A failed kind is just left out, unless
 * they all failed: then the result says so.
 */
export async function runSearch(ctx: ViewContext, query: string): Promise<SearchResults> {
  const catalogSearch = loadRequestStatus(ctx).then((status) =>
    status.Enabled ? ctx.api.searchCatalog(query).then((r) => r.Results) : [],
  );
  let failures = 0;
  const none = (): { Items: BaseItem[] } => {
    failures++;
    return { Items: [] };
  };
  const [people, ...kinds] = await Promise.all([
    ctx.api.searchPeople(query, PEOPLE).catch(none),
    ...KINDS.map((kind) =>
      ctx.api
        .getBrowseItems({
          includeItemTypes: kind.type,
          searchTerm: query,
          sortBy: 'SortName',
          sortOrder: 'Ascending',
          startIndex: 0,
          limit: PER_KIND,
          count: false,
        })
        .catch(none),
    ),
  ]);
  const failed = failures === KINDS.length + 1;
  const sections = KINDS.map((kind, i) => ({ ...kind, items: kinds[i]!.Items })).filter(
    (s) => s.items.length > 0,
  );
  const listed = new Set<string>();
  for (const s of sections) for (const i of s.items) listed.add(i.Id.replace(/-/g, '').toLowerCase());
  const catalog = (await catalogSearch.catch(() => [] as CatalogItem[])).filter(
    (c) => !c.JellyfinItemId || !listed.has(c.JellyfinItemId.replace(/-/g, '').toLowerCase()),
  );
  return { query, sections, people: people.Items, catalog: failed ? [] : catalog, failed };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Results by kind as you type, with a random "Explore" grid before you do. */
export function SearchView({ initialQuery, ctx }: { initialQuery: string; ctx: ViewContext }) {
  const imageToken = useCatalogImageToken(ctx);
  const [input, setInput] = useState(initialQuery);
  const query = useDebounced(input.trim(), DEBOUNCE_MS);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [explore, setExplore] = useState<BaseItem[] | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const latest = useRef('');
  const resultsRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const { onMenu, shown: visible } = useCardMenu(ctx);
  const searching = query.length >= MIN_QUERY;

  useEffect(() => {
    liftVeil();
    if (ctx.layout !== 'tv') field.current?.focus({ preventScroll: true });
  }, []);

  // Keep the query in the URL (without a navigation), so Back from a result returns to the same search.
  useEffect(() => {
    const hash = query ? `#/search?query=${encodeURIComponent(query)}` : '#/search';
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
  }, [query]);

  useEffect(() => {
    latest.current = query;
    if (!searching) return;
    runSearch(ctx, query)
      .then((next) => {
        if (latest.current === next.query) setResults(next);
      })
      .catch(() => undefined);
  }, [query, attempt]);

  useEffect(() => {
    if (searching || explore) return;
    ctx.api
      .getBrowseItems({
        includeItemTypes: 'Movie,Series',
        sortBy: 'Random',
        sortOrder: 'Ascending',
        startIndex: 0,
        limit: PER_KIND,
        count: false,
      })
      .then((r) => setExplore(r.Items))
      .catch(() => setExplore([]));
  }, [searching]);

  const shown = searching && results?.query === query ? results : null;
  const pending = searching && !shown;
  const open = (item: BaseItem): void => ctx.navigate(infoHash(item));
  const failed = !!shown?.failed;
  const count = shown
    ? shown.sections.reduce((n, s) => n + s.items.length, 0) + shown.people.length + shown.catalog.length
    : 0;
  const empty = shown && !failed && count === 0;
  // TV: focus the first result (or Explore card) rather than the field, which would open the on-screen keyboard.
  useAutoFocus(resultsRef, !!(shown ?? explore), ctx.layout);
  const status = !searching
    ? ''
    : pending
      ? secondaryStrings.searching
      : failed
        ? '' // the error block announces itself
        : secondaryStrings.resultCount(count);

  return (
    <div class="lmn-browse lmn-search">
      <form
        class="lmn-search__form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          field.current?.blur(); // closes the phone keyboard
        }}
      >
        <Icon name="search" size={24} class="lmn-search__icon" />
        <input
          ref={field}
          class="lmn-search__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellcheck={false}
          placeholder={secondaryStrings.searchPlaceholder}
          aria-label={strings.search}
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
        {input && (
          <button
            type="button"
            class="lmn-search__clear"
            aria-label={secondaryStrings.clearSearch}
            onClick={() => {
              setInput('');
              field.current?.focus();
            }}
          >
            <Icon name="close" size={20} />
          </button>
        )}
      </form>

      {/* One short line for screen readers, rather than re-reading every section on each keystroke. */}
      <p class="lmn-visually-hidden" role="status">
        {status}
      </p>
      <div ref={resultsRef} aria-busy={pending}>
        {!searching && explore && explore.length > 0 && (
          <ResultSection
            title={secondaryStrings.explore}
            variant="poster"
            items={visible(explore)}
            ctx={ctx}
            onMenu={onMenu}
          />
        )}
        {failed && (
          <LoadError
            message={secondaryStrings.searchFailed}
            onRetry={() => {
              setResults(null);
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {empty && (
          <div class="lmn-browse__empty">
            <p class="lmn-browse__empty-title">{secondaryStrings.noResults(query)}</p>
            <p>{secondaryStrings.noResultsHint}</p>
          </div>
        )}
        {shown?.sections.map((section) => (
          <ResultSection
            key={section.key}
            title={section.title}
            variant={section.variant}
            items={visible(section.items)}
            ctx={ctx}
            onMenu={onMenu}
          />
        ))}
        {shown && shown.people.length > 0 && (
          <section class="lmn-search__section" aria-label={secondaryStrings.people}>
            <h2 class="lmn-row__title">{secondaryStrings.people}</h2>
            <div class="lmn-search__people">
              {shown.people.map((person) => (
                <button key={person.Id} type="button" class="lmn-person" onClick={() => open(person)}>
                  {person.ImageTags?.Primary ? (
                    <PersonPhoto
                      client={ctx.client}
                      image={{ itemId: person.Id, type: 'Primary', tag: person.ImageTags.Primary }}
                    />
                  ) : (
                    <span class="lmn-person__photo lmn-person__photo--empty" aria-hidden="true">
                      {initials(person.Name)}
                    </span>
                  )}
                  <span class="lmn-person__name">{person.Name}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {shown && shown.catalog.length > 0 && (
          <section class="lmn-search__section" aria-label={secondaryStrings.moreToRequest}>
            <h2 class="lmn-row__title">{secondaryStrings.moreToRequest}</h2>
            <div
              class="lmn-browse-grid lmn-browse-grid--poster"
              role="list"
              aria-label={secondaryStrings.moreToRequest}
            >
              {shown.catalog.map((item) => (
                <div role="listitem" key={item.Key} class="lmn-browse-grid__cell">
                  <CatalogCard
                    item={item}
                    client={ctx.client}
                    imageToken={imageToken}
                    variant="poster"
                    onSelect={(i) => ctx.navigate(catalogHash(i))}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** One kind of result as a card grid. */
function ResultSection({
  title,
  variant,
  items,
  ctx: viewCtx,
  onMenu: menu,
}: {
  title: string;
  variant: CardVariant;
  items: BaseItem[];
  ctx: ViewContext;
  onMenu: CardMenuHandler;
}) {
  if (items.length === 0) return null; // its last title was deleted from its card's menu
  return (
    <section class="lmn-search__section" aria-label={title}>
      <h2 class="lmn-row__title">{title}</h2>
      <div class={`lmn-browse-grid lmn-browse-grid--${variant}`} role="list" aria-label={title}>
        {items.map((item) => (
          <div role="listitem" key={item.Id} class="lmn-browse-grid__cell">
            <Card
              item={item}
              client={viewCtx.client}
              variant={variant}
              caption={captionFor(item)}
              onSelect={(selected) => viewCtx.navigate(infoHash(selected))}
              onMenu={menu}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

const PHOTO = { width: 116, height: 154 };

/** A person's photo, as wide as its column in the people grid (minmax(116px, 1fr)). */
function PersonPhoto({ client, image }: { client: ViewContext['client']; image: ImageRef }) {
  const ref = useRef<HTMLImageElement>(null);
  const width = useImageWidth(ref, PHOTO.width);
  return (
    <img
      ref={ref}
      class="lmn-person__photo"
      src={width ? imageUrl(client, image, boxAt(PHOTO, width)) : undefined}
      alt=""
      loading="lazy"
    />
  );
}
