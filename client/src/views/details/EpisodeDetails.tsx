import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, Person } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import { Icon } from '../../components/icons';
import { resolveImage } from '../../components/images';
import { playedPercent } from '../../components/ProgressBar';
import { useAutoFocus } from '../../components/useAutoFocus';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { cardMenuHandler } from '../cardMenu';
import { deriveBadges } from './badges';
import { downloadLink } from './download';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { adjacentSeasons, episodeNeighbors } from './episodeNeighbors';
import { goBack, useItemActions } from './useItemActions';

const code = (e: BaseItem): string => strings.episodeCode(e.ParentIndexNumber, e.IndexNumber);
const label = (e: BaseItem): string => [code(e), e.Name].filter(Boolean).join(' · ');

/** Guest stars first, then the show's cast, each person once. */
export function episodeCast(episode: BaseItem, series: BaseItem | null): Person[] {
  const seen = new Set<string>();
  const people = [
    ...(episode.People ?? []).filter((p) => p.Type === 'GuestStar'),
    ...(episode.People ?? []).filter((p) => p.Type === 'Actor'),
    ...(series?.People ?? []).filter((p) => p.Type === 'Actor'),
  ];
  return people.filter((p) => !seen.has(p.Id) && seen.add(p.Id));
}

interface Loaded {
  series: BaseItem | null;
  seasonName: string;
  season: BaseItem[];
  before: BaseItem[];
  after: BaseItem[];
}

/** An episode's page: its still, show and number, Play, previous/next, cast and the rest of its season. */
export function EpisodeDetails({ episode, ctx }: { episode: BaseItem; ctx: ViewContext }) {
  const actions = useItemActions(episode, ctx);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, true, ctx.layout);
  const seriesId = episode.SeriesId!;
  const seasonId = episode.SeasonId!;

  useEffect(() => {
    let cancelled = false;
    const none = { Items: [] as BaseItem[] };
    (async () => {
      const [series, seasons, season] = await Promise.all([
        ctx.api.getItem(seriesId).catch(() => null),
        ctx.api.getSeasons(seriesId).catch(() => none),
        ctx.api.getEpisodes(seriesId, seasonId),
      ]);
      const at = season.Items.findIndex((e) => e.Id === episode.Id);
      const { before, after } = adjacentSeasons(seasons.Items, seasonId);
      const [beforeEps, afterEps] = await Promise.all([
        at === 0 && before ? ctx.api.getEpisodes(seriesId, before.Id).catch(() => none) : none,
        at === season.Items.length - 1 && after
          ? ctx.api.getEpisodes(seriesId, after.Id).catch(() => none)
          : none,
      ]);
      if (cancelled) return;
      const own = seasons.Items.find((s) => s.Id === seasonId);
      setLoaded({
        series,
        seasonName:
          (own?.IndexNumber === 0 ? strings.specials : own?.Name) ?? episode.SeasonName ?? strings.season,
        season: season.Items,
        before: beforeEps.Items,
        after: afterEps.Items,
      });
    })().catch(() => {
      // The page still works without its season: no neighbours or row.
      if (!cancelled)
        setLoaded({
          series: null,
          seasonName: episode.SeasonName ?? strings.season,
          season: [],
          before: [],
          after: [],
        });
    });
    return () => {
      cancelled = true;
    };
  }, [episode.Id]);

  const ticks = resumeTicks(episode);
  const neighbors = loaded
    ? episodeNeighbors(episode.Id, loaded.season, loaded.before, loaded.after)
    : { previous: null, next: null };
  const open = (item: BaseItem): void => ctx.navigate(detailsHash(item.Id, item.ServerId));
  const onMenu = cardMenuHandler(ctx);

  return (
    <article ref={rootRef} class="lmn-details lmn-details--episode">
      <DetailsHeader
        item={episode}
        client={ctx.client}
        config={ctx.config}
        image={resolveImage(episode, ['Primary', 'Backdrop'])}
        eyebrow={
          <>
            <a href={detailsHash(seasonId, episode.ServerId)}>{episode.SeriesName ?? loaded?.series?.Name}</a>
            {code(episode) && <span>{code(episode)}</span>}
          </>
        }
        primary={{
          label: ticks ? strings.resume : strings.play,
          progress: ticks ? playedPercent(episode) : undefined,
          onClick: () => actions.play(episode, ticks),
          busy: actions.starting,
          restart: ticks ? () => actions.play(episode) : undefined,
        }}
        trailerId={null}
        download={downloadLink(episode, ctx.client, ctx.layout)}
        onBack={() => goBack(ctx)}
        badges={deriveBadges(episode.MediaStreams)}
        {...actions}
      />
      {(neighbors.previous || neighbors.next) && (
        <nav class="lmn-episode-nav" aria-label={strings.episodes}>
          {neighbors.previous ? (
            <a
              class="lmn-episode-nav__link"
              href={detailsHash(neighbors.previous.Id, neighbors.previous.ServerId)}
              aria-label={`${strings.previousEpisode}: ${label(neighbors.previous)}`}
            >
              <Icon name="chevronLeft" size={18} />
              <span>{label(neighbors.previous)}</span>
            </a>
          ) : (
            <span />
          )}
          {neighbors.next && (
            <a
              class="lmn-episode-nav__link lmn-episode-nav__link--next"
              href={detailsHash(neighbors.next.Id, neighbors.next.ServerId)}
              aria-label={`${strings.nextEpisode}: ${label(neighbors.next)}`}
            >
              <span>{label(neighbors.next)}</span>
              <Icon name="chevronRight" size={18} />
            </a>
          )}
        </nav>
      )}
      <CastRow
        people={episodeCast(episode, loaded?.series ?? null)}
        client={ctx.client}
        onSelect={(p) => ctx.navigate(detailsHash(p.Id, episode.ServerId))}
      />
      {loaded && loaded.season.length > 1 && (
        <section class="lmn-row" aria-label={strings.moreFromSeason(loaded.seasonName)}>
          <h2 class="lmn-row__title">{strings.moreFromSeason(loaded.seasonName)}</h2>
          <div class="lmn-row__scroller focuscontainer-x">
            {loaded.season.map((e) => (
              <Card
                key={e.Id}
                item={e}
                client={ctx.client}
                variant="landscape"
                caption={label(e)}
                current={e.Id === episode.Id}
                onSelect={open}
                onMenu={onMenu}
              />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
