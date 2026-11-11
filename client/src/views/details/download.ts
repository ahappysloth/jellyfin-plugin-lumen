import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient, Layout } from '../../compat/jellyfin';
import { strings } from '../../strings';
import { formatNumber } from '../../util/locale';

/**
 * Types with one file to download. jellyfin-web's own Download is per file too; a series or season is a folder (its
 * "Download all" in jellyfin-web's menu fetches every episode in turn, not something a button on the page should start).
 */
const DOWNLOADABLE = ['Movie', 'Episode', 'Video', 'MusicVideo'];

/**
 * Whether the page offers Download. The server's CanDownload already says whether this user may download
 * (EnableContentDownloading) as well as whether the item is a file; like jellyfin-web, TVs get no Download (it hides
 * it on TV browsers and consoles: nowhere to save to).
 */
export function canDownload(item: BaseItem, layout: Layout, win: Window = window): boolean {
  if (layout === 'tv' || !item.CanDownload || !DOWNLOADABLE.includes(item.Type)) return false;
  // An official app says whether it can save files, as jellyfin-web asks it (appHost.supports('filedownload')).
  const host = (win as Window & { NativeShell?: { AppHost?: { supports?: (feature: string) => boolean } } })
    .NativeShell?.AppHost;
  return typeof host?.supports === 'function' ? host.supports('filedownload') : true;
}

/**
 * The file itself, as jellyfin-web 12's Download builds it (the SDK's getDownloadUrl): authenticated in the URL, since
 * the browser fetches it, not Lumen. The server sends it as an attachment, named after the file.
 */
export function downloadUrl(
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>,
  itemId: string,
): string {
  return client.getUrl(`Items/${itemId}/Download`, { ApiKey: client.accessToken() ?? undefined });
}

/** "Download (4.2 GB)": the button's tooltip, so a big file isn't a surprise. */
export function downloadTitle(item: BaseItem, win: Window = window): string {
  // The item's own file (what the endpoint sends), not another version's.
  const sources = item.MediaSources ?? [];
  const bytes = (sources.find((s) => s.Id === item.Id) ?? sources[0])?.Size;
  if (!bytes) return strings.download;
  const gb = bytes / 1e9;
  const size =
    gb >= 1
      ? `${formatNumber(Math.round(gb * 10) / 10, win)} GB`
      : `${formatNumber(Math.max(1, Math.round(bytes / 1e6)), win)} MB`;
  return strings.downloadSize(size);
}

export interface DownloadLink {
  url: string;
  title: string;
}

/** The page's Download, or null where it offers none. */
export function downloadLink(
  item: BaseItem,
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>,
  layout: Layout,
): DownloadLink | null {
  return canDownload(item, layout) ? { url: downloadUrl(client, item.Id), title: downloadTitle(item) } : null;
}

interface NativeShell {
  downloadFiles?: (items: unknown[]) => void;
  downloadFile?: (item: unknown) => void;
}

/**
 * The official apps save files themselves (jellyfin-web's appHost.downloadFiles hands them to window.NativeShell); a
 * WebView may do nothing with a plain download link. Returns false in a browser, which follows the link instead.
 */
export function nativeDownload(item: BaseItem, url: string, win: Window = window): boolean {
  const shell = (win as Window & { NativeShell?: NativeShell }).NativeShell;
  const file = {
    url,
    item,
    itemId: item.Id,
    serverId: item.ServerId,
    title: item.Name,
    filename: item.Path?.replace(/^.*[\\/]/, '') ?? item.Name,
  };
  if (shell?.downloadFiles) shell.downloadFiles([file]);
  else if (shell?.downloadFile) shell.downloadFile(file);
  else return false;
  return true;
}
