import { useEffect, useRef, useState } from 'preact/hooks';
import type { LumenApi } from '../../api/lumenApi';
import type { JellyfinApiClient } from '../../compat/jellyfin';

/** One resolution of an item's trickplay images (BaseItemDto.Trickplay[mediaSourceId][width]). */
export interface TrickplayInfo {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  /** Milliseconds between thumbnails. */
  Interval: number;
}

export interface TrickplayFrame {
  /** Which tile image (a TileWidth × TileHeight grid of thumbnails). */
  tile: number;
  /** The thumbnail's offset inside the tile, in the tile's own pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The thumbnail for a time: which tile holds it and where. */
export function trickplayFrame(ms: number, info: TrickplayInfo): TrickplayFrame {
  const perTile = info.TileWidth * info.TileHeight;
  const index = Math.min(info.ThumbnailCount - 1, Math.max(0, Math.floor(ms / info.Interval)));
  const inTile = index % perTile;
  return {
    tile: Math.floor(index / perTile),
    x: (inTile % info.TileWidth) * info.Width,
    y: Math.floor(inTile / info.TileWidth) * info.Height,
    width: info.Width,
    height: info.Height,
  };
}

export type TrickplayPreview = (ms: number) => (TrickplayFrame & { url: string }) | null;

/** The resolution to use: the widest up to 320 px (Jellyfin's default), else the narrowest. */
export function pickResolution(byWidth: Record<string, TrickplayInfo> | undefined): TrickplayInfo | null {
  const all = Object.values(byWidth ?? {}).sort((a, b) => a.Width - b.Width);
  return [...all].reverse().find((i) => i.Width <= 320) ?? all[0] ?? null;
}

/**
 * The playing item's trickplay thumbnails, for the seek bar. Tiles need the user's token, so they're fetched with the
 * Authorization header (never a token in an image URL) and shown from object URLs, loaded on first use and kept until
 * the item changes. Null when the server has none (trickplay is off by default in each library).
 */
export function useTrickplay(
  api: LumenApi,
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>,
  itemId: string | undefined,
  mediaSourceId: string | undefined,
): TrickplayPreview | null {
  const [info, setInfo] = useState<TrickplayInfo | null>(null);
  const [, setLoaded] = useState(0);
  const tiles = useRef(new Map<number, string | 'loading' | 'failed'>());

  useEffect(() => {
    setInfo(null);
    if (!itemId) return;
    let cancelled = false;
    api
      .getItem(itemId)
      .then((item) => {
        const sources =
          (item as { Trickplay?: Record<string, Record<string, TrickplayInfo>> }).Trickplay ?? {};
        const bySource = (mediaSourceId && sources[mediaSourceId]) || Object.values(sources)[0];
        if (!cancelled) setInfo(pickResolution(bySource));
      })
      .catch(() => undefined);
    const cache = tiles.current;
    return () => {
      cancelled = true;
      cache.forEach((url) => url !== 'loading' && url !== 'failed' && URL.revokeObjectURL(url));
      cache.clear();
    };
  }, [itemId, mediaSourceId]);

  if (!info || !itemId) return null;
  return (ms) => {
    const frame = trickplayFrame(ms, info);
    const cached = tiles.current.get(frame.tile);
    if (cached === undefined) {
      tiles.current.set(frame.tile, 'loading');
      const url = client.getUrl(`Videos/${itemId}/Trickplay/${info.Width}/${frame.tile}.jpg`, {
        mediaSourceId: mediaSourceId ?? undefined,
      });
      fetch(url, { headers: { Authorization: `MediaBrowser Token="${client.accessToken() ?? ''}"` } })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => {
          tiles.current.set(frame.tile, URL.createObjectURL(blob));
          setLoaded((n) => n + 1);
        })
        .catch(() => tiles.current.set(frame.tile, 'failed'));
      return null;
    }
    return cached === 'loading' || cached === 'failed' ? null : { ...frame, url: cached };
  };
}
