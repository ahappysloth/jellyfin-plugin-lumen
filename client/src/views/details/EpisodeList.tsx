import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl, resolveImage } from '../../components/images';
import { ProgressBar, playedPercent } from '../../components/ProgressBar';
import { formatRuntime } from './badges';

interface Props {
  episodes: BaseItem[];
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onPlay: (episode: BaseItem) => void;
}

export function EpisodeList({ episodes, client, onPlay }: Props) {
  return (
    <ol class="lmn-episodes">
      {episodes.map((episode) => {
        const image = resolveImage(episode, ['Primary', 'Thumb']);
        const percent = playedPercent(episode);
        const runtime = formatRuntime(episode.RunTimeTicks);
        return (
          <li key={episode.Id}>
            <button
              type="button"
              class="lmn-episode"
              data-item-id={episode.Id}
              onClick={() => onPlay(episode)}
            >
              <span class="lmn-episode__thumb">
                {image ? (
                  <img
                    src={imageUrl(client, image, { width: 240, height: 135 })}
                    alt=""
                    loading="lazy"
                    width={240}
                    height={135}
                  />
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
          </li>
        );
      })}
    </ol>
  );
}
