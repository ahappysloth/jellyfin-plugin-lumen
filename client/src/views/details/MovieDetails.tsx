import { useRef } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { playedPercent } from '../../components/ProgressBar';
import { useAutoFocus } from '../../components/useAutoFocus';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import { useItemMenu } from '../itemMenu/lazyItemMenu';
import type { DetailsProps } from './DetailsView';
import { deriveBadges } from './badges';
import { downloadLink } from './download';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { SimilarRow } from './SimilarRow';
import { goBack, useItemActions, useLocalTrailer } from './useItemActions';

export function MovieDetails({ item, ctx, reload }: DetailsProps & { item: BaseItem }) {
  const actions = useItemActions(item, ctx);
  const trailerId = useLocalTrailer(item, ctx);
  const download = downloadLink(item, ctx.client, ctx.layout);
  const more = useItemMenu(ctx, item, {
    complete: true,
    downloadButton: !!download,
    onChanged: reload,
    onDeleted: () => goBack(ctx),
    fallback: ctx.onFallback,
  });
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, true, ctx.layout);

  const ticks = resumeTicks(item);
  return (
    <article ref={rootRef} class="lmn-details lmn-details--movie">
      <DetailsHeader
        item={item}
        client={ctx.client}
        config={ctx.config}
        primary={{
          label: ticks ? strings.resume : strings.play,
          progress: ticks ? playedPercent(item) : undefined,
          onClick: () => actions.play(item, ticks),
          busy: actions.starting,
          restart: ticks ? () => actions.play(item) : undefined,
        }}
        trailerId={trailerId}
        onlineTrailer={() => ctx.api.getOnlineTrailer(`Items/${item.Id}`)}
        onTrailer={trailerId ? () => actions.play(trailerId) : undefined}
        download={download}
        more={more}
        onBack={() => goBack(ctx)}
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
