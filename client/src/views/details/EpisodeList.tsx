import { useRef } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { type ImageRef, imageUrl, resolveImage } from '../../components/images';
import { strings } from '../../strings';
import { ProgressBar, playedPercent } from '../../components/ProgressBar';
import { boxAt, useImageWidth } from '../../components/useImageWidth';
import { formatRuntime } from './badges';

/**
 * The still's box: .lmn-episode's first column, 260 px (full width on a phone: it is measured), exactly 16:9 like a
 * landscape card, so the same still at the same step is one URL at any width.
 */
const STILL = { width: 260, height: 146.25 };

interface Props {
  episodes: BaseItem[];
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onPlay: (episode: BaseItem) => void;
  /** The episode's own page; a details link sits beside each row's play button. */
  detailsHref?: (episode: BaseItem) => string;
}

export function EpisodeList({ episodes, client, onPlay, detailsHref }: Props) {
  return (
    <ol class="lmn-episodes">
      {episodes.map((episode) => {
        const image = resolveImage(episode, ['Primary', 'Thumb']);
        const percent = playedPercent(episode);
        const runtime = formatRuntime(episode.RunTimeTicks);
        return (
          // The row's own strip under the details link plays too, as the whole row did when the link sat on top of it.
          // (Mouse only: the button is the row's keyboard and D-pad target.)
          <li
            key={episode.Id}
            class="lmn-episodes__item"
            onClick={(e) => e.target === e.currentTarget && onPlay(episode)}
          >
            <button
              type="button"
              class="lmn-episode"
              data-item-id={episode.Id}
              onClick={() => onPlay(episode)}
            >
              <span class="lmn-episode__thumb">
                {image ? (
                  <Still client={client} image={image} />
                ) : (
                  <span class="lmn-card__placeholder">{episode.Name}</span>
                )}
                {percent > 0 && percent < 100 && <ProgressBar percent={percent} />}
              </span>
              <span class="lmn-episode__body">
                <span class="lmn-episode__title">
                  {episode.IndexNumber}. {episode.Name}
                </span>
                {runtime && <span class="lmn-episode__runtime">{runtime}</span>}
                {episode.Overview && <span class="lmn-episode__overview">{episode.Overview}</span>}
              </span>
            </button>
            {detailsHref && (
              <a
                class="lmn-icon-button lmn-episodes__details"
                href={detailsHref(episode)}
                aria-label={strings.episodeDetails(episode.Name)}
              >
                <Icon name="info" size={22} />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** An episode's still, at the width its thumbnail box renders (260 px beside the text; full width on a phone). */
function Still({ client, image }: { client: Pick<JellyfinApiClient, 'getUrl'>; image: ImageRef }) {
  const ref = useRef<HTMLImageElement>(null);
  const width = useImageWidth(ref, STILL.width);
  return (
    <img
      ref={ref}
      src={width ? imageUrl(client, image, boxAt(STILL, width)) : undefined}
      alt=""
      loading="lazy"
      width={260}
      height={146}
    />
  );
}
