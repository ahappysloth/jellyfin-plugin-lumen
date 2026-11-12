import type { BadgeKey, BaseItem, CatalogItem, HomeRow, HomeRowEntry } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { CardMenuHandler } from '../cardMenu';
import { CatalogCard } from '../catalog/CatalogCard';
import { useCatalogState } from '../catalog/catalog';

/** The "Top 10 this week" rows (server: Top10Providers.cs). Their cards are ranked in the order the server sends them. */
export const isTop10Row = (row: HomeRow): boolean => row.Type === 'Top10Movies' || row.Type === 'Top10Shows';

/**
 * Trakt's other rows (server: TraktRowProviders.cs): Box Office, Most Anticipated, Trending and Trakt lists. Their cards
 * are Top 10's, posters with a Request button under the ones not on the server, but without the numerals.
 */
export const isTraktRow = (row: HomeRow): boolean =>
  [
    'TraktBoxOffice',
    'TraktAnticipatedMovies',
    'TraktAnticipatedShows',
    'TraktTrendingMovies',
    'TraktTrendingShows',
    'TraktList',
  ].indexOf(row.Type) >= 0;

/** A Top 10 row's cards, ranked 1..n in the order the server sent them; a Trakt row's, in order without ranks. */
export function Top10Items({
  row,
  client,
  catalogImageToken,
  badges,
  onSelect,
  onMenu,
  onSelectCatalog,
  canRequest,
  onRequest,
}: {
  row: HomeRow;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  catalogImageToken?: string | null;
  badges?: Record<string, BadgeKey>;
  onSelect: (item: BaseItem, row: HomeRow) => void;
  onMenu?: CardMenuHandler;
  onSelectCatalog?: (item: CatalogItem) => void;
  canRequest?: (item: CatalogItem) => boolean;
  onRequest?: (item: CatalogItem) => void;
}) {
  const ranked = isTop10Row(row);
  return (
    <>
      {(row.Entries ?? []).map((entry, i) => (
        <Top10Item
          key={entry.Catalog?.Key ?? entry.Item?.Id}
          entry={entry}
          rank={ranked ? i + 1 : undefined}
          client={client}
          catalogImageToken={catalogImageToken}
          badge={entry.Item ? badges?.[entry.Item.Id] : undefined}
          onSelect={(selected) => onSelect(selected, row)}
          onMenu={onMenu}
          onSelectCatalog={onSelectCatalog}
          onRequest={entry.Catalog && canRequest?.(entry.Catalog) ? onRequest : undefined}
        />
      ))}
    </>
  );
}

interface Props {
  entry: HomeRowEntry;
  /** Top 10's place, shown as the big numeral; none in Trakt's other rows. */
  rank?: number;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  catalogImageToken?: string | null;
  badge?: BadgeKey;
  onSelect: (item: BaseItem) => void;
  onMenu?: CardMenuHandler;
  onSelectCatalog?: (item: CatalogItem) => void;
  /** Opens the request dialog in place; absent when the user can't request this kind of title. */
  onRequest?: (item: CatalogItem) => void;
}

/**
 * One ranked card: a big numeral (Top 10 only), then a poster card. A title on the server is its normal card; one that isn't is a
 * catalog card with a Request button under it, so it can be requested without leaving the home screen. The numeral is
 * decoration (aria-hidden): the rank is read as the start of the card's name instead ("3, Title"). The button sits below
 * the card, not over it, so the TV's D-pad reaches it (Down from the card).
 */
export function Top10Item({
  entry,
  rank,
  client,
  catalogImageToken,
  badge,
  onSelect,
  onMenu,
  onSelectCatalog,
  onRequest,
}: Props) {
  const catalog = entry.Catalog;
  return (
    <div
      class={`lmn-top10${rank === undefined ? ' lmn-top10--plain' : rank >= 10 ? ' lmn-top10--wide' : ''}`}
    >
      {rank !== undefined && (
        <span class="lmn-top10__rank" aria-hidden="true">
          {rank}
        </span>
      )}
      <div class="lmn-top10__card">
        {catalog ? (
          <CatalogEntry
            item={catalog}
            rank={rank}
            client={client}
            imageToken={catalogImageToken}
            onSelect={(c) => onSelectCatalog?.(c)}
            onRequest={onRequest}
          />
        ) : entry.Item ? (
          <Card
            item={entry.Item}
            client={client}
            variant="poster"
            rank={rank}
            badge={badge}
            onSelect={onSelect}
            onMenu={onMenu}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A catalog card with the Request button under it (Top 10, Trakt's rows and Top charts). */
export function CatalogEntry({
  item,
  rank,
  client,
  imageToken,
  onSelect,
  onRequest,
}: {
  item: CatalogItem;
  rank?: number;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  imageToken: string | null | undefined;
  onSelect: (item: CatalogItem) => void;
  onRequest?: (item: CatalogItem) => void;
}) {
  // Once requested (here or elsewhere this session) the card's tab says so, and the button goes.
  const state = useCatalogState(item);
  const requestable = !!onRequest && !item.JellyfinItemId && state === 'None';
  return (
    <>
      <CatalogCard
        item={item}
        client={client}
        imageToken={imageToken}
        variant="poster"
        rank={rank}
        // The button below says Request: the card's tab would only repeat it.
        hideRequestTab={requestable}
        onSelect={onSelect}
      />
      {requestable && (
        <button
          type="button"
          class="lmn-top10__request"
          data-request-key={item.Key}
          aria-label={strings.requestNamed(item.Title)}
          onClick={() => onRequest?.(item)}
        >
          <Icon name="plus" size={16} />
          {strings.request}
        </button>
      )}
    </>
  );
}
