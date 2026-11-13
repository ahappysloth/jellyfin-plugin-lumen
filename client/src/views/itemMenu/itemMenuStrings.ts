/**
 * Strings only the item menu shows (see strings.ts). Only its chunk imports this (views/itemMenu/lazyItemMenu.ts), so
 * they don't weigh on startup. The ones the core's cards and details pages show too (More actions…, the More button's
 * label, the failed-load message) stay in strings.ts.
 */
export const itemMenuStrings = {
  addToPlaylist: 'Add to playlist',
  addToCollection: 'Add to collection',
  downloadAll: 'Download all',
  copyStreamUrl: 'Copy stream URL',
  streamUrlCopied: 'Stream URL copied',
  copyFailed: 'Couldn’t copy the stream URL',
  mediaInfo: 'Media info',
  trailerInfo: 'Trailer info',
  editMetadata: 'Edit metadata',
  editImages: 'Edit images',
  editSubtitles: 'Edit subtitles',
  identify: 'Identify',
  refreshMetadata: 'Refresh metadata',
  deleteItem: (type: string) =>
    ({
      Movie: 'Delete movie',
      Series: 'Delete series',
      Season: 'Delete season',
      Episode: 'Delete episode',
      BoxSet: 'Delete collection',
    })[type] ?? 'Delete',
  noMoreActions: 'Nothing more to do with this one',
} as const;
