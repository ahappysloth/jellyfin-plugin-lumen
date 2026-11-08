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

/** Image URL sized for the rendered box. Dimensions must be integers or the server rejects the request. */
export function imageUrl(
  client: Pick<JellyfinApiClient, 'getUrl'>,
  ref: ImageRef,
  size: { width?: number; height?: number },
  dpr: number = globalThis.devicePixelRatio || 1,
): string {
  return client.getUrl(`Items/${ref.itemId}/Images/${ref.type}`, {
    fillWidth: size.width ? Math.ceil(size.width * dpr) : undefined,
    fillHeight: size.height ? Math.ceil(size.height * dpr) : undefined,
    quality: 90,
    tag: ref.tag,
  });
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
