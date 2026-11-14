import { describe, expect, it } from 'vitest';
import { itemCommands, type MenuItem, type MenuPolicy } from './itemCommands';

// Items as GET /Items/{id} returns them to the user in question (CanDelete and CanDownload are per user).
const movie: MenuItem = {
  Id: 'm1',
  Name: 'Movie',
  Type: 'Movie',
  MediaType: 'Video',
  LocationType: 'FileSystem',
  MediaSources: [{ Id: 'm1' }],
  CanDownload: true,
  CanDelete: true,
};
const episode: MenuItem = { ...movie, Id: 'e1', Type: 'Episode' };
const series: MenuItem = { Id: 's1', Name: 'Show', Type: 'Series', IsFolder: true, CanDelete: true };
const season: MenuItem = { ...series, Id: 'se1', Type: 'Season' };
const collection: MenuItem = { Id: 'c1', Name: 'Saga', Type: 'BoxSet', IsFolder: true, CanDelete: true };

const admin: MenuPolicy = { IsAdministrator: true, EnableContentDownloading: true };
// A restricted user as Jellyfin creates one: may download, nothing else.
const kid: MenuPolicy = { IsAdministrator: false, EnableContentDownloading: true };
const asKid = (item: MenuItem): MenuItem => ({ ...item, CanDelete: false });
const desktop = { tv: false };
const tv = { tv: true };

describe('itemCommands (jellyfin-web 12.4 getCommands)', () => {
  it('gives an administrator every action on a movie, everyday ones first and Delete last', () => {
    expect(itemCommands(movie, admin, desktop)).toEqual([
      'addtoplaylist',
      'addtocollection',
      'download',
      'copy-stream',
      'moremediainfo',
      'edit',
      'editimages',
      'editsubtitles',
      'identify',
      'refresh',
      'delete',
    ]);
  });

  it('gives a restricted user only the playlist, downloads and media info', () => {
    expect(itemCommands(asKid(movie), kid, desktop)).toEqual([
      'addtoplaylist',
      'download',
      'copy-stream',
      'moremediainfo',
    ]);
  });

  it('leaves Download out where the page has its own button, but keeps Copy stream URL', () => {
    expect(itemCommands(asKid(episode), kid, { tv: false, downloadButton: true })).toEqual([
      'addtoplaylist',
      'copy-stream',
      'moremediainfo',
    ]);
  });

  it('offers a series and a season "Download all", not Download, and never Identify for a season', () => {
    expect(itemCommands(series, admin, desktop)).toEqual([
      'addtoplaylist',
      'addtocollection',
      'downloadall',
      'edit',
      'editimages',
      'identify',
      'refresh',
      'delete',
    ]);
    expect(itemCommands(season, admin, desktop)).toEqual([
      'addtoplaylist',
      'addtocollection',
      'downloadall',
      'edit',
      'editimages',
      'refresh',
      'delete',
    ]);
  });

  it('offers no Identify for an episode, and Edit subtitles only for video files', () => {
    const commands = itemCommands(episode, admin, desktop);
    expect(commands).not.toContain('identify');
    expect(commands).toContain('editsubtitles');
    expect(itemCommands(series, admin, desktop)).not.toContain('editsubtitles');
    expect(itemCommands({ ...episode, LocationType: 'Virtual' }, admin, desktop)).not.toContain(
      'editsubtitles',
    );
  });

  it('lets a collection be identified and downloaded whole', () => {
    expect(itemCommands(collection, admin, desktop)).toEqual([
      'addtoplaylist',
      'addtocollection',
      'downloadall',
      'edit',
      'editimages',
      'identify',
      'refresh',
      'delete',
    ]);
  });

  it('follows the policy switches a non-administrator can be given', () => {
    const manager: MenuPolicy = { ...kid, EnableCollectionManagement: true, EnableSubtitleManagement: true };
    expect(itemCommands(asKid(movie), manager, desktop)).toEqual([
      'addtoplaylist',
      'addtocollection',
      'download',
      'copy-stream',
      'moremediainfo',
      'editsubtitles',
    ]);
    const noDownloads: MenuPolicy = { ...kid, EnableContentDownloading: false };
    expect(itemCommands({ ...asKid(series) }, noDownloads, desktop)).toEqual(['addtoplaylist']);
  });

  it('deletes only what the server says this user may delete', () => {
    expect(itemCommands({ ...movie, CanDelete: false }, admin, desktop)).not.toContain('delete');
    expect(itemCommands({ ...movie, CanDelete: true }, kid, desktop)).toContain('delete');
  });

  it('downloads only what the server says this user may download', () => {
    expect(itemCommands({ ...movie, CanDownload: false }, admin, desktop)).not.toContain('copy-stream');
  });

  it('offers no pickers or downloads on a TV, like jellyfin-web', () => {
    expect(itemCommands(movie, admin, tv)).toEqual([
      'moremediainfo',
      'edit',
      'editimages',
      'editsubtitles',
      'identify',
      'refresh',
      'delete',
    ]);
    // Nothing at all for a restricted user's series on a TV: the page then shows no More button.
    expect(itemCommands(asKid(series), kid, tv)).toEqual([]);
  });

  it("leaves out jellyfin-web's local (offline) items' server actions", () => {
    const local = { ...movie, Id: 'local:1', CanDelete: false };
    expect(itemCommands(local, admin, desktop)).toEqual(['download', 'copy-stream', 'moremediainfo']);
  });

  it('gives a show Lumen’s Trailer info while trailer previews are on: a movie has it in Media info', () => {
    expect(itemCommands(asKid(series), kid, { tv: true, trailerInfo: true })).toEqual(['trailerinfo']);
    expect(itemCommands(movie, kid, { tv: false, trailerInfo: true })).not.toContain('trailerinfo');
    expect(itemCommands(asKid(series), kid, { tv: true })).toEqual([]);
    expect(itemCommands(asKid(season), kid, { tv: true, trailerInfo: true })).toEqual([]);
  });
});
