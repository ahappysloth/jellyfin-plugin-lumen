import type { BaseItem } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';

export type ImageType = 'Primary' | 'Backdrop' | 'Logo' | 'Thumb';

export interface ImageRef {
  itemId: string;
  type: ImageType;
  tag: string;
}

export type CardVariant = 'landscape' | 'poster';

export const CARD_SIZES: Record<CardVariant, { width: number; height: number }> = {
  landscape: { width: 320, height: 180 },
  poster: { width: 180, height: 270 },
};

/** The first available image among `preferred`, using the item's own image or its parent's (series). */
export function resolveImage(item: BaseItem, preferred: readonly ImageType[]): ImageRef | null {
  for (const type of preferred) {
    const ref = ownImage(item, type) ?? parentImage(item, type);
    if (ref) return ref;
  }
  return null;
}

function ownImage(item: BaseItem, type: ImageType): ImageRef | null {
  const tag = type === 'Backdrop' ? item.BackdropImageTags?.[0] : item.ImageTags?.[type];
  return tag ? { itemId: item.Id, type, tag } : null;
}

function parentImage(item: BaseItem, type: ImageType): ImageRef | null {
  const pick = (itemId: string | undefined, tag: string | undefined): ImageRef | null =>
    itemId && tag ? { itemId, type, tag } : null;
  switch (type) {
    case 'Backdrop':
      return pick(item.ParentBackdropItemId, item.ParentBackdropImageTags?.[0]);
    case 'Logo':
      return pick(item.ParentLogoItemId, item.ParentLogoImageTag);
    case 'Thumb':
      return pick(item.ParentThumbItemId, item.ParentThumbImageTag);
    default:
      return null;
  }
}

/**
 * The widths (CSS px) images are requested at. A request's width rounds up to the next step and its height keeps the
 * box's shape, so the same artwork shown at nearby sizes (a 320 px card, a 268 px genre tile, a 260 px episode row)
 * is one URL: the server resizes it once and the browser downloads and caches it once. Steps are at most 1.5× apart,
 * so from 120 px up an image is never more than 1.5× wider than its box (the device pixel ratio applies on top).
 */
export const IMAGE_WIDTHS = [120, 180, 240, 320, 480, 640, 960, 1280, 1600, 1920] as const;

/** The step a box `width` CSS px wide is requested at (the largest step for anything wider). */
export function ladderWidth(width: number): number {
  return IMAGE_WIDTHS.find((step) => step >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

/**
 * Image URL for a box `size.width` × `size.height` CSS px (height optional: then the image keeps its own shape),
 * rounded up to IMAGE_WIDTHS, times the device pixel ratio. The height is taken from the box's shape at the step's
 * width before the ratio is applied, so boxes of one shape that round to the same step give the same URL at any
 * ratio. Dimensions must be integers or the server rejects the request.
 */
export function imageUrl(
  client: Pick<JellyfinApiClient, 'getUrl'>,
  ref: ImageRef,
  size: { width: number; height?: number },
  dpr: number = globalThis.devicePixelRatio || 1,
): string {
  const width = ladderWidth(size.width);
  const height = size.height ? Math.round((width * size.height) / size.width) : undefined;
  return exactImageUrl(client, ref, width, height, dpr);
}

/** Image URL for exactly `width` (× `height`) CSS px, times the device pixel ratio. */
function exactImageUrl(
  client: Pick<JellyfinApiClient, 'getUrl'>,
  ref: ImageRef,
  width: number,
  height: number | undefined,
  dpr: number,
): string {
  return client.getUrl(`Items/${ref.itemId}/Images/${ref.type}`, {
    fillWidth: Math.ceil(width * dpr),
    fillHeight: height ? Math.ceil(height * dpr) : undefined,
    quality: 90,
    tag: ref.tag,
  });
}

/** A title logo over the home banner or a details page (.lmn-hero__logo, .lmn-details__logo: at most 420 CSS px). */
export const TITLE_LOGO = { width: 420 };

/**
 * A full-width backdrop (the home banner, a details page; one URL for both): sized to the window in 160 px steps (so
 * it caches across small resizes), at least 640 and at most 1920 CSS px, and at most 2× pixel density. Phones and
 * sharp screens don't need more under the fade. Not on IMAGE_WIDTHS: at these sizes its steps up to 1.5× apart would
 * cost up to 2.25× the pixels, and no smaller box shows the same backdrop.
 */
export function backdropUrl(client: Pick<JellyfinApiClient, 'getUrl'>, ref: ImageRef): string {
  const width = Math.min(1920, Math.max(640, Math.ceil(window.innerWidth / 160) * 160));
  return exactImageUrl(client, ref, width, undefined, Math.min(2, globalThis.devicePixelRatio || 1));
}

/**
 * The loading screen's backdrop, blurred and dimmed: 1280 px at any pixel density is plenty. One of backdropUrl's
 * steps, so on a 1121–1280 px window at 1× it is the URL the home banner and details page already loaded.
 */
export function loadingBackdropUrl(client: Pick<JellyfinApiClient, 'getUrl'>, ref: ImageRef): string {
  return exactImageUrl(client, ref, 1280, undefined, 1);
}

export interface CardArt {
  image: ImageRef | null;
  /** Title logo laid over a plain backdrop (Thumb art and episode stills already carry their own). */
  logo: ImageRef | null;
}

/**
 * Landscape cards use, in order: an episode's still; a Thumb (key art that usually includes the title); a backdrop
 * with the title logo on top; the poster. Poster cards use the poster only.
 */
export function cardArt(item: BaseItem, variant: CardVariant): CardArt {
  if (variant === 'poster') return { image: resolveImage(item, ['Primary']), logo: null };
  if (item.Type === 'Episode')
    return { image: resolveImage(item, ['Primary', 'Thumb', 'Backdrop']), logo: null };
  const thumb = resolveImage(item, ['Thumb']);
  if (thumb) return { image: thumb, logo: null };
  const backdrop = resolveImage(item, ['Backdrop']);
  if (backdrop) return { image: backdrop, logo: resolveImage(item, ['Logo']) };
  return { image: resolveImage(item, ['Primary']), logo: null };
}
