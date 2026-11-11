import type { BaseItem } from '../../api/types';

/**
 * The item commands of jellyfin-web's ⋯ menu that Lumen offers, by jellyfin-web's ids (components/itemContextMenu.js
 * getCommands, 12.4), which compat/itemMenu.ts hands back to jellyfin-web to run. Play, queue, shuffle and the like
 * are left out: Lumen's pages and card menus have their own.
 */
export type ItemCommand =
  | 'addtoplaylist'
  | 'addtocollection'
  | 'download'
  | 'downloadall'
  | 'copy-stream'
  | 'moremediainfo'
  | 'edit'
  | 'editimages'
  | 'editsubtitles'
  | 'identify'
  | 'refresh'
  | 'delete';

/** The parts of a user's policy jellyfin-web's menu reads. */
export interface MenuPolicy {
  IsAdministrator?: boolean;
  EnableCollectionManagement?: boolean;
  EnableSubtitleManagement?: boolean;
  EnableContentDownloading?: boolean;
}

/** The item as `GET /Items/{id}` returns it: list endpoints leave out CanDelete and MediaSources. */
export type MenuItem = BaseItem & {
  CanDelete?: boolean;
  LocationType?: string;
  CollectionType?: string;
  /** A recording's state (only a completed one can be edited). */
  Status?: string;
};

export interface MenuEnv {
  /**
   * A TV: jellyfin-web offers no collection or playlist pickers there (`browser.tv`), and nowhere to save a download
   * (appHost's FileDownload feature).
   */
  tv: boolean;
  /** The page already shows a Download button for this item (details/download.ts), so the menu needn't repeat it. */
  downloadButton?: boolean;
}

/** Lumen's order: the everyday actions first, then the administrator's editors, then Delete on its own. */
export const COMMAND_GROUPS: readonly (readonly ItemCommand[])[] = [
  ['addtoplaylist', 'addtocollection', 'download', 'downloadall', 'copy-stream', 'moremediainfo'],
  ['edit', 'editimages', 'editsubtitles', 'identify', 'refresh'],
  ['delete'],
];

const LIVE_TV_TYPES = ['Program', 'TvChannel', 'Timer', 'SeriesTimer'];
/** jellyfin-web's DOWNLOAD_ALL_TYPES: folders whose files "Download all" fetches one by one. */
const DOWNLOAD_ALL_TYPES = ['BoxSet', 'MusicAlbum', 'Season', 'Series'];
const IDENTIFIABLE = [
  'Movie',
  'Trailer',
  'Series',
  'BoxSet',
  'Person',
  'Book',
  'MusicAlbum',
  'MusicArtist',
  'MusicVideo',
];
const NOT_IN_COLLECTIONS = [
  'Genre',
  'MusicGenre',
  'Studio',
  'UserView',
  'CollectionFolder',
  'Audio',
  'Program',
  'Timer',
  'SeriesTimer',
];

// itemHelper.js, 12.4.
const isLocal = (item: MenuItem): boolean => item.Id.indexOf('local') === 0;
const unfinishedRecording = (item: MenuItem): boolean =>
  item.Type === 'Recording' && item.Status !== 'Completed';

function supportsAddingToCollection(item: MenuItem): boolean {
  return (
    !unfinishedRecording(item) &&
    !item.CollectionType &&
    !NOT_IN_COLLECTIONS.includes(item.Type) &&
    item.MediaType !== 'Photo' &&
    !isLocal(item)
  );
}

function supportsAddingToPlaylist(item: MenuItem): boolean {
  if (LIVE_TV_TYPES.includes(item.Type) || item.MediaType === 'Photo' || unfinishedRecording(item))
    return false;
  if (isLocal(item) || item.CollectionType === 'livetv') return false;
  return (
    !!item.MediaType ||
    !!item.IsFolder ||
    item.Type === 'Genre' ||
    item.Type === 'MusicGenre' ||
    item.Type === 'MusicArtist'
  );
}

function canEdit(policy: MenuPolicy, item: MenuItem): boolean {
  if (['UserRootFolder', 'UserView', 'Program', 'Timer', 'SeriesTimer'].includes(item.Type)) return false;
  return !unfinishedRecording(item) && !isLocal(item) && !!policy.IsAdministrator;
}

function canEditImages(policy: MenuPolicy, item: MenuItem): boolean {
  if (item.MediaType === 'Photo') return false;
  if (item.Type === 'UserView') return !!policy.IsAdministrator;
  return !unfinishedRecording(item) && canEdit(policy, item);
}

function canEditSubtitles(policy: MenuPolicy, item: MenuItem): boolean {
  if (item.MediaType !== 'Video' || unfinishedRecording(item)) return false;
  if (['TvChannel', 'Program', 'Timer', 'SeriesTimer', 'UserRootFolder', 'UserView'].includes(item.Type))
    return false;
  if (isLocal(item) || item.LocationType === 'Virtual') return false;
  return !!(policy.EnableSubtitleManagement || policy.IsAdministrator);
}

function canIdentify(policy: MenuPolicy, item: MenuItem): boolean {
  return IDENTIFIABLE.includes(item.Type) && !!policy.IsAdministrator && !isLocal(item);
}

function canRefreshMetadata(policy: MenuPolicy, item: MenuItem): boolean {
  if (!policy.IsAdministrator || item.CollectionType === 'livetv') return false;
  return (
    !['Timer', 'SeriesTimer', 'Program', 'TvChannel'].includes(item.Type) &&
    !unfinishedRecording(item) &&
    !isLocal(item)
  );
}

/**
 * What jellyfin-web's ⋯ menu would offer this user for this item (getCommands), in Lumen's order. The server's own
 * per-item answers (CanDelete, CanDownload) already fold in the user's deletion and download rights; the rest is the
 * user's policy, as jellyfin-web reads it.
 */
export function itemCommands(item: MenuItem, policy: MenuPolicy, env: MenuEnv): ItemCommand[] {
  const offered = new Set<ItemCommand>();
  if (!env.tv) {
    if (supportsAddingToCollection(item) && (policy.IsAdministrator || policy.EnableCollectionManagement))
      offered.add('addtocollection');
    if (supportsAddingToPlaylist(item)) offered.add('addtoplaylist');
    if (policy.EnableContentDownloading && DOWNLOAD_ALL_TYPES.includes(item.Type)) offered.add('downloadall');
    // Books get a Download button of their own in jellyfin-web, so its menu leaves them out.
    if (item.CanDownload && item.Type !== 'Book') {
      if (!env.downloadButton) offered.add('download');
      offered.add('copy-stream');
    }
  }
  if (item.CanDelete) offered.add('delete');
  if (canEdit(policy, item)) offered.add('edit');
  if (canEditImages(policy, item)) offered.add('editimages');
  if (canEditSubtitles(policy, item)) offered.add('editsubtitles');
  if (canIdentify(policy, item)) offered.add('identify');
  if (item.MediaSources) offered.add('moremediainfo');
  if (canRefreshMetadata(policy, item)) offered.add('refresh');
  const ordered: ItemCommand[] = [];
  for (const group of COMMAND_GROUPS)
    for (const command of group) if (offered.has(command)) ordered.push(command);
  return ordered;
}
