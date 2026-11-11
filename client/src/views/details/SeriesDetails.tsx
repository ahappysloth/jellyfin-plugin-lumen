import { Dropdown } from '../../components/Dropdown';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { useAutoFocus } from '../../components/useAutoFocus';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import { Icon } from '../../components/icons';
import { useItemMenu, useMoreButton } from '../itemMenu/lazyItemMenu';
import type { DetailsProps } from './DetailsView';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { EpisodeList } from './EpisodeList';
import { SimilarRow } from './SimilarRow';
import { computeSmartPlay, type SmartPlay } from './smartPlay';
import { goBack, useItemActions, useLocalTrailer } from './useItemActions';

const seasonLabel = (season: BaseItem): string => (season.IndexNumber === 0 ? strings.specials : season.Name);

interface Props extends DetailsProps {
  series: BaseItem;
  initialSeasonId?: string;
}

export function SeriesDetails({ series, initialSeasonId, ctx, reload }: Props) {
  const actions = useItemActions(series, ctx);
  const more = useItemMenu(ctx, series, {
    complete: true,
    onChanged: reload,
    onDeleted: () => goBack(ctx),
    fallback: ctx.onFallback,
  });
  // Seasons are fetched again after one is edited or deleted from its own ⋯ menu.
  const [seasonsVersion, setSeasonsVersion] = useState(0);
  // Which load the episodes shown came from: a reload fetches the shown season's again, showing the old ones meanwhile.
  const [episodesLoad, setEpisodesLoad] = useState(0);
  const loads = useRef(0);
  const loadedSeries = useRef<string | null>(null);
  const trailerId = useLocalTrailer(series, ctx);
  const [seasons, setSeasons] = useState<BaseItem[]>([]);
  const [seasonId, setSeasonId] = useState<string | undefined>(initialSeasonId);
  const [episodesBySeason, setEpisodesBySeason] = useState<
    Record<string, { load: number; items: BaseItem[] }>
  >({});
  const [smartPlay, setSmartPlay] = useState<SmartPlay | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, true, ctx.layout);

  // One request per season: the first season loads for Smart Play while it may also be the season shown.
  const episodeRequests = useRef(new Map<string, Promise<BaseItem[]>>());
  const loadEpisodes = (id: string): Promise<BaseItem[]> => {
    let request = episodeRequests.current.get(id);
    if (!request) {
      request = ctx.api.getEpisodes(series.Id, id).then((result) => result.Items);
      episodeRequests.current.set(id, request);
      // A failed season can be tried again by picking it again.
      request.catch(() => episodeRequests.current.delete(id));
    }
    return request;
  };

  // Again when the page has the series afresh (an edit, Identify or Refresh from its ⋯ menu: its seasons and episodes
  // may have changed too), or a season was edited or deleted.
  useEffect(() => {
    let cancelled = false;
    const empty = { Items: [] as BaseItem[] };
    const load = loads.current++;
    if (load > 0) episodeRequests.current.clear();
    const reloading = loadedSeries.current === series.Id;
    loadedSeries.current = series.Id;
    (async () => {
      const [seasonResult, resume, nextUp] = await Promise.all([
        ctx.api.getSeasons(series.Id),
        ctx.api.getResumeForSeries(series.Id).catch(() => empty),
        ctx.api.getNextUp(series.Id).catch(() => empty),
      ]);
      if (cancelled) return;
      const list = seasonResult.Items;
      const defaultSeason = list.find((s) => (s.IndexNumber ?? 0) > 0) ?? list[0];
      const target = resume.Items[0] ?? nextUp.Items[0];
      setSeasons(list);
      setEpisodesLoad(load);
      // After a reload, the season shown stays if it's still there.
      const listed = (id: string | undefined): id is string => !!id && list.some((s) => s.Id === id);
      setSeasonId(
        (shown) =>
          [shown, initialSeasonId, target?.SeasonId, defaultSeason?.Id].find(listed) ?? defaultSeason?.Id,
      );

      let first: BaseItem | undefined;
      if (defaultSeason) {
        const firstSeason = await loadEpisodes(defaultSeason.Id);
        if (cancelled) return;
        first = firstSeason[0];
      }
      setSmartPlay(computeSmartPlay(resume.Items[0], nextUp.Items[0], first));
    })().catch(() => {
      // A reload that fails keeps the page as it was.
      if (!cancelled && !reloading) ctx.onFallback();
    });
    return () => {
      cancelled = true;
    };
  }, [series, seasonsVersion]);
  const reloadSeasons = (): void => setSeasonsVersion((v) => v + 1);
  const season = seasons.find((s) => s.Id === seasonId);
  const seasonMore = useItemMenu(ctx, season, { onChanged: reloadSeasons, onDeleted: reloadSeasons });
  const seasonMoreButton = useMoreButton(seasonMore);

  useEffect(() => {
    if (!seasonId || episodesBySeason[seasonId]?.load === episodesLoad) return;
    const load = episodesLoad;
    loadEpisodes(seasonId)
      .then((items) => setEpisodesBySeason((current) => ({ ...current, [seasonId]: { load, items } })))
      .catch(() => undefined);
  }, [seasonId, episodesLoad]);

  const episodes = seasonId ? episodesBySeason[seasonId]?.items : undefined;
  return (
    <article ref={rootRef} class="lmn-details lmn-details--series">
      <DetailsHeader
        item={series}
        client={ctx.client}
        config={ctx.config}
        primary={
          smartPlay
            ? {
                label: smartPlay.label,
                progress: smartPlay.progress,
                onClick: () => actions.play(smartPlay.episodeId, smartPlay.startTicks),
                busy: actions.starting,
                restart: smartPlay.startTicks ? () => actions.play(smartPlay.episodeId) : undefined,
              }
            : null
        }
        trailerId={trailerId}
        onTrailer={trailerId ? () => actions.play(trailerId) : undefined}
        onBack={() => goBack(ctx)}
        badges={[]}
        {...actions}
        more={more}
      />
      <section class="lmn-episodes-section" aria-label={strings.episodes}>
        <div class="lmn-episodes-header">
          <h2>{strings.episodes}</h2>
          {seasons.length > 0 && (
            <Dropdown
              label={strings.season}
              hideLabel
              value={seasonId ?? ''}
              options={seasons.map((s) => ({ value: s.Id, label: seasonLabel(s) }))}
              onChange={setSeasonId}
            />
          )}
          {season && seasonMore?.item.Id === season.Id && (
            <button
              type="button"
              class="lmn-icon-button lmn-icon-button--lg"
              aria-label={strings.moreActionsFor(seasonLabel(season))}
              aria-haspopup="menu"
              aria-expanded={seasonMoreButton.expanded}
              onClick={(e) => seasonMoreButton.open(e.currentTarget)}
            >
              <Icon name="more" size={18} />
            </button>
          )}
        </div>
        {episodes && (
          <EpisodeList
            episodes={episodes}
            client={ctx.client}
            onPlay={(ep) => actions.play(ep, resumeTicks(ep))}
            detailsHref={(ep) => detailsHash(ep.Id, ep.ServerId)}
          />
        )}
      </section>
      <CastRow
        people={series.People ?? []}
        client={ctx.client}
        onSelect={(p) => ctx.navigate(detailsHash(p.Id, series.ServerId))}
      />
      <SimilarRow itemId={series.Id} ctx={ctx} />
    </article>
  );
}
