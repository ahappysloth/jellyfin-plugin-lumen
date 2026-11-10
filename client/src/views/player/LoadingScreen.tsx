import { loadingBackdropUrl, resolveImage } from '../../components/images';
import type { StartingInfo } from '../../playback/starting';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import type { PlayerSnapshot } from './playerState';

/**
 * Before the first frame: the title's backdrop, dimmed, with its name and a spinner. Shown from the Play click
 * (`starting`, over the page) and kept by the player until the video plays, so it's one continuous screen.
 */
export function LoadingScreen({
  ctx,
  snap,
  starting,
}: {
  ctx: Pick<ViewContext, 'client'>;
  snap: PlayerSnapshot | null;
  starting: StartingInfo | null;
}) {
  const item = snap?.item;
  // The same URL as the Play click's `starting` backdrop, so taking over from it never downloads the image again.
  const ref = item
    ? resolveImage({ ...item, Name: item.Name ?? '', Type: item.Type ?? '' }, ['Backdrop'])
    : null;
  const backdrop = starting?.backdrop ?? (ref ? loadingBackdropUrl(ctx.client, ref) : null);
  const title = starting?.title ?? (item ? (item.Type === 'Episode' ? item.SeriesName : item.Name) : null);
  return (
    <div class="lmn-player-loading" role="status" aria-label={strings.player.starting}>
      {backdrop && (
        <img
          class="lmn-player-loading__backdrop"
          src={backdrop}
          alt=""
          onError={(e) => e.currentTarget.remove()}
        />
      )}
      <div class="lmn-player-loading__content">
        <span class="lmn-spinner lmn-player-loading__spinner" aria-hidden="true" />
        {title && <p class="lmn-player-loading__title">{title}</p>}
      </div>
    </div>
  );
}
