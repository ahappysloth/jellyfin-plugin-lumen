import { useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { Icon } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { formatDate, formatNumber } from '../../util/locale';
import { BrowseGrid } from '../browse/BrowseGrid';
import { useGridPage } from '../browse/useGridPage';
import type { ViewContext } from '../context';
import { initials } from './CastRow';
import { goBack } from './useItemActions';
import { secondaryStrings } from '../secondary/secondaryStrings';

/** A biography longer than this gets a Read more toggle. */
const LONG_BIO = 420;

export function formatPersonDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** An actor or crew member: portrait, life dates, biography, and the titles in this library they're in. */
export function PersonDetails({ item, ctx }: { item: BaseItem; ctx: ViewContext }) {
  const rootRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);

  const queryKey = `${ctx.userId}|person|${item.Id}`;
  const { state, select, onMenu } = useGridPage(ctx, queryKey, (page) =>
    ctx.api.getBrowseItems({
      personIds: [item.Id],
      includeItemTypes: 'Movie,Series',
      sortBy: 'PremiereDate,ProductionYear,SortName',
      sortOrder: 'Descending',
      ...page,
    }),
  );
  useAutoFocus(rootRef, true, ctx.layout, state.restoredSelectedId ?? undefined);

  const photo = resolveImage(item, ['Primary']);
  const born = formatPersonDate(item.PremiereDate);
  const died = formatPersonDate(item.EndDate);
  const bio = item.Overview?.trim() ?? '';
  const long = bio.length > LONG_BIO;

  return (
    <article ref={rootRef} class="lmn-person-page">
      <header class="lmn-person-page__header">
        {photo && (
          <img
            class="lmn-person-page__ambient"
            src={imageUrl(ctx.client, photo, { width: 480 })}
            alt=""
            aria-hidden="true"
          />
        )}
        <div class="lmn-person-page__topbar">
          <button
            type="button"
            class="lmn-icon-button lmn-icon-button--lg lmn-autofocus"
            aria-label={strings.back}
            onClick={() => goBack(ctx)}
          >
            <Icon name="back" size={20} />
          </button>
        </div>
        <div class="lmn-person-page__intro">
          {photo ? (
            <img
              class="lmn-person-page__photo"
              src={imageUrl(ctx.client, photo, { width: 440 })}
              alt=""
              width={220}
              height={330}
            />
          ) : (
            <span class="lmn-person-page__photo lmn-person-page__photo--empty" aria-hidden="true">
              {initials(item.Name)}
            </span>
          )}
          <div class="lmn-person-page__info">
            <h1 class="lmn-person-page__name">{item.Name}</h1>
            {(born || died) && (
              <p class="lmn-meta lmn-person-page__dates">
                {born && <span>{secondaryStrings.born(born, item.ProductionLocations?.[0])}</span>}
                {died && <span>{secondaryStrings.died(died)}</span>}
              </p>
            )}
            {bio && (
              <>
                <p class={`lmn-person-page__bio${long && !expanded ? ' is-clamped' : ''}`}>{bio}</p>
                {long && (
                  <button
                    type="button"
                    class="lmn-link-button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((e) => !e)}
                  >
                    {expanded ? secondaryStrings.readLess : secondaryStrings.readMore}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      <section class="lmn-details__section" aria-label={secondaryStrings.knownFor}>
        <h2 class="lmn-row__title">
          {secondaryStrings.knownFor}
          {state.total ? <span class="lmn-row__count">{formatNumber(state.total)}</span> : null}
        </h2>
        <BrowseGrid
          state={state}
          client={ctx.client}
          variant="poster"
          label={secondaryStrings.knownFor}
          onSelect={select}
          onMenu={onMenu}
          empty={<p>{secondaryStrings.noPersonTitles}</p>}
        />
      </section>
    </article>
  );
}
