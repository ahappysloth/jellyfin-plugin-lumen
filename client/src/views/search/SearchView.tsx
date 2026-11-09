import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { Card } from '../../components/Card';
import { Icon } from '../../components/icons';
import { type CardVariant, imageUrl } from '../../components/images';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import { cardMenuHandler, infoHash } from '../cardMenu';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';
import { captionFor } from '../home/Row';

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
}

const KINDS: readonly { key: string; title: string; type: string; variant: CardVariant }[] = [
  { key: 'movies', title: strings.movies, type: 'Movie', variant: 'poster' },
  { key: 'shows', title: strings.shows, type: 'Series', variant: 'poster' },
  { key: 'episodes', title: strings.episodesTab, type: 'Episode', variant: 'landscape' },
];

/** Searches each kind separately so every section gets its own best matches. A failed kind is just left out. */
export async function runSearch(ctx: ViewContext, query: string): Promise<SearchResults> {
  const [people, ...kinds] = await Promise.all([
    ctx.api.searchPeople(query, PEOPLE).catch(() => ({ Items: [] })),
    ...KINDS.map((kind) =>
      ctx.api
        .getBrowseItems({
          includeItemTypes: kind.type,
          searchTerm: query,
          sortBy: 'SortName',
          sortOrder: 'Ascending',
          startIndex: 0,
          limit: PER_KIND,
        })
        .catch(() => ({ Items: [] })),
    ),
  ]);
  return {
    query,
    sections: KINDS.map((kind, i) => ({ ...kind, items: kinds[i]!.Items })).filter((s) => s.items.length > 0),
    people: people.Items,
  };
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
  const [input, setInput] = useState(initialQuery);
  const query = useDebounced(input.trim(), DEBOUNCE_MS);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [explore, setExplore] = useState<BaseItem[] | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const latest = useRef('');
  const onMenu = cardMenuHandler(ctx);
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
  }, [query]);

  useEffect(() => {
    if (searching || explore) return;
    ctx.api
      .getBrowseItems({
        includeItemTypes: 'Movie,Series',
        sortBy: 'Random',
        sortOrder: 'Ascending',
        startIndex: 0,
        limit: PER_KIND,
      })
      .then((r) => setExplore(r.Items))
      .catch(() => setExplore([]));
  }, [searching]);

  const shown = searching && results?.query === query ? results : null;
  const pending = searching && !shown;
  const open = (item: BaseItem): void => ctx.navigate(infoHash(item));
  const empty = shown && shown.sections.length === 0 && shown.people.length === 0;

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
        <Icon name="search" size={22} class="lmn-search__icon" />
        <input
          ref={field}
          class="lmn-search__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellcheck={false}
          placeholder={strings.searchPlaceholder}
          aria-label={strings.search}
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
        {input && (
          <button
            type="button"
            class="lmn-search__clear"
            aria-label={strings.clearSearch}
            onClick={() => {
              setInput('');
              field.current?.focus();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </form>

      <div aria-live="polite" aria-busy={pending}>
        {!searching && explore && explore.length > 0 && (
          <ResultSection title={strings.explore} variant="poster" items={explore} ctx={ctx} onMenu={onMenu} />
        )}
        {empty && (
          <div class="lmn-browse__empty">
            <p class="lmn-browse__empty-title">{strings.noResults(query)}</p>
            <p>{strings.noResultsHint}</p>
          </div>
        )}
        {shown?.sections.map((section) => (
          <ResultSection
            key={section.key}
            title={section.title}
            variant={section.variant}
            items={section.items}
            ctx={ctx}
            onMenu={onMenu}
          />
        ))}
        {shown && shown.people.length > 0 && (
          <section class="lmn-search__section" aria-label={strings.people}>
            <h2 class="lmn-row__title">{strings.people}</h2>
            <div class="lmn-search__people">
              {shown.people.map((person) => (
                <button key={person.Id} type="button" class="lmn-person" onClick={() => open(person)}>
                  {person.ImageTags?.Primary ? (
                    <img
                      class="lmn-person__photo"
                      src={imageUrl(
                        ctx.client,
                        { itemId: person.Id, type: 'Primary', tag: person.ImageTags.Primary },
                        { width: 116, height: 154 },
                      )}
                      alt=""
                      loading="lazy"
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
  onMenu: ReturnType<typeof cardMenuHandler>;
}) {
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
