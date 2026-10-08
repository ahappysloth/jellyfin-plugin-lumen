import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { metaFor } from './badges';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { EpisodeList } from './EpisodeList';
import { SimilarRow } from './SimilarRow';
import { computeSmartPlay, type SmartPlay } from './smartPlay';
import { useItemActions } from './useItemActions';

const seasonLabel = (season: BaseItem): string => (season.IndexNumber === 0 ? strings.specials : season.Name);

interface Props {
  series: BaseItem;
  initialSeasonId?: string;
  ctx: ViewContext;
}

export function SeriesDetails({ series, initialSeasonId, ctx }: Props) {
  const actions = useItemActions(series, ctx);
  const [seasons, setSeasons] = useState<BaseItem[]>([]);
  const [seasonId, setSeasonId] = useState<string | undefined>(initialSeasonId);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<string, BaseItem[]>>({});
  const [smartPlay, setSmartPlay] = useState<SmartPlay | null>(null);

  const storeEpisodes = (id: string, items: BaseItem[]): void =>
    setEpisodesBySeason((current) => ({ ...current, [id]: items }));

  useEffect(() => {
    let cancelled = false;
    const empty = { Items: [] as BaseItem[] };
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
      setSeasonId(initialSeasonId ?? target?.SeasonId ?? defaultSeason?.Id);

      let first: BaseItem | undefined;
      if (defaultSeason) {
        const firstSeason = (await ctx.api.getEpisodes(series.Id, defaultSeason.Id)).Items;
        if (cancelled) return;
        storeEpisodes(defaultSeason.Id, firstSeason);
        first = firstSeason[0];
      }
      setSmartPlay(computeSmartPlay(resume.Items[0], nextUp.Items[0], first));
    })().catch(() => {
      if (!cancelled) ctx.onFallback();
    });
    return () => {
      cancelled = true;
    };
  }, [series.Id]);

  useEffect(() => {
    if (!seasonId || episodesBySeason[seasonId]) return;
    ctx.api
      .getEpisodes(series.Id, seasonId)
      .then((result) => storeEpisodes(seasonId, result.Items))
      .catch(() => undefined);
  }, [seasonId]);

  const episodes = seasonId ? episodesBySeason[seasonId] : undefined;
  return (
    <article class="lmn-details lmn-details--series">
      <DetailsHeader
        item={series}
        client={ctx.client}
        primary={
          smartPlay
            ? {
                label: smartPlay.label,
                progress: smartPlay.progress,
                onClick: () => actions.play(smartPlay.episodeId, smartPlay.startTicks),
              }
            : null
        }
        meta={metaFor(series)}
        badges={[]}
        {...actions}
      />
      <section class="lmn-episodes-section" aria-label={strings.episodes}>
        <div class="lmn-episodes-header">
          <h2>{strings.episodes}</h2>
          {seasons.length > 0 && (
            <select
              class="lmn-season-select"
              aria-label={strings.season}
              value={seasonId}
              onChange={(e) => setSeasonId((e.target as HTMLSelectElement).value)}
            >
              {seasons.map((s) => (
                <option key={s.Id} value={s.Id}>
                  {seasonLabel(s)}
                </option>
              ))}
            </select>
          )}
        </div>
        {episodes && (
          <EpisodeList
            episodes={episodes}
            client={ctx.client}
            onPlay={(ep) => actions.play(ep.Id, resumeTicks(ep))}
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
