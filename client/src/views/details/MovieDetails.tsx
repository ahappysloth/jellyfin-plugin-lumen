import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { playedPercent } from '../../components/ProgressBar';
import { useAutoFocus } from '../../components/useAutoFocus';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { deriveBadges, metaFor } from './badges';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { SimilarRow } from './SimilarRow';
import { useItemActions } from './useItemActions';

export function MovieDetails({ item, ctx }: { item: BaseItem; ctx: ViewContext }) {
  const actions = useItemActions(item, ctx);
  const [trailerId, setTrailerId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, true, ctx.layout);

  useEffect(() => {
    if ((item.LocalTrailerCount ?? 0) === 0) return;
    ctx.api
      .getLocalTrailers(item.Id)
      .then((trailers) => setTrailerId(trailers[0]?.Id ?? null))
      .catch(() => undefined);
  }, [item.Id]);

  const ticks = resumeTicks(item);
  return (
    <article ref={rootRef} class="lmn-details lmn-details--movie">
      <DetailsHeader
        item={item}
        client={ctx.client}
        primary={{
          label: ticks ? strings.resume : strings.play,
          progress: ticks ? playedPercent(item) : undefined,
          onClick: () => actions.play(item.Id, ticks),
        }}
        onTrailer={trailerId ? () => actions.play(trailerId) : undefined}
        meta={metaFor(item)}
        badges={deriveBadges(item.MediaStreams)}
        {...actions}
      />
      <CastRow
        people={item.People ?? []}
        client={ctx.client}
        onSelect={(p) => ctx.navigate(detailsHash(p.Id, item.ServerId))}
      />
      <SimilarRow itemId={item.Id} ctx={ctx} />
    </article>
  );
}
