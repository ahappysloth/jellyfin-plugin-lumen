import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { BaseItem } from '../../api/types';
import { canDownload, downloadLink, downloadTitle, downloadUrl, nativeDownload } from './download';

const movie: BaseItem = {
  Id: 'm1',
  Name: 'Lumen Alpha',
  Type: 'Movie',
  ServerId: 's1',
  CanDownload: true,
  Path: '/media/movies/Lumen Alpha (2001)/Lumen Alpha (2001).mkv',
  MediaSources: [{ Size: 4_216_000_000 }],
};

describe('download', () => {
  afterEach(() => {
    delete (window as Window & { NativeShell?: unknown }).NativeShell;
  });

  it("offers the file of a movie or an episode the server says this user may download (their policy's in it)", () => {
    expect(canDownload(movie, 'desktop')).toBe(true);
    expect(canDownload({ ...movie, Type: 'Episode' }, 'mobile')).toBe(true);
    expect(canDownload({ ...movie, CanDownload: false }, 'desktop')).toBe(false);
    expect(canDownload({ ...movie, CanDownload: undefined }, 'desktop')).toBe(false);
  });

  it('offers no download of a folder (a series or season), nor on a TV, like jellyfin-web', () => {
    expect(canDownload({ ...movie, Type: 'Series' }, 'desktop')).toBe(false);
    expect(canDownload({ ...movie, Type: 'Season' }, 'desktop')).toBe(false);
    expect(canDownload(movie, 'tv')).toBe(false);
    expect(downloadLink(movie, createFakeClient(), 'tv')).toBeNull();
  });

  it("links to the server's download of the file, authenticated as jellyfin-web 12 does it (ApiKey)", () => {
    expect(downloadUrl(createFakeClient(), 'm1')).toBe('http://jf/Items/m1/Download?ApiKey=token1');
    expect(downloadLink(movie, createFakeClient(), 'desktop')?.url).toBe(
      'http://jf/Items/m1/Download?ApiKey=token1',
    );
  });

  it('says how big the file is in its tooltip', () => {
    expect(downloadTitle(movie)).toBe('Download (4.2 GB)');
    expect(downloadTitle({ ...movie, MediaSources: [{ Size: 962_304 }] })).toBe('Download (1 MB)');
    expect(downloadTitle({ ...movie, MediaSources: [{ Size: 734_000_000 }] })).toBe('Download (734 MB)');
    expect(downloadTitle({ ...movie, MediaSources: undefined })).toBe('Download');
    // Several versions: the item's own file, which is what the endpoint sends.
    expect(
      downloadTitle({
        ...movie,
        MediaSources: [
          { Id: 'other', Size: 9e9 },
          { Id: 'm1', Size: 2e9 },
        ],
      }),
    ).toBe('Download (2 GB)');
  });

  it("asks an official app whether it can save files, as jellyfin-web's appHost does", () => {
    const supports = vi.fn(() => false);
    Object.assign(window, { NativeShell: { AppHost: { supports } } });
    expect(canDownload(movie, 'desktop')).toBe(false);
    expect(supports).toHaveBeenCalledWith('filedownload');
    supports.mockReturnValue(true);
    expect(canDownload(movie, 'desktop')).toBe(true);
  });

  it("hands the file to the official apps' shell, as jellyfin-web's appHost does", () => {
    const downloadFiles = vi.fn();
    Object.assign(window, { NativeShell: { downloadFiles } });

    expect(nativeDownload(movie, 'http://jf/Items/m1/Download?ApiKey=token1')).toBe(true);
    expect(downloadFiles).toHaveBeenCalledWith([
      {
        url: 'http://jf/Items/m1/Download?ApiKey=token1',
        item: movie,
        itemId: 'm1',
        serverId: 's1',
        title: 'Lumen Alpha',
        filename: 'Lumen Alpha (2001).mkv',
      },
    ]);
  });

  it("uses an older shell's one-file download, and leaves a browser to follow the link", () => {
    expect(nativeDownload(movie, 'u')).toBe(false);

    const downloadFile = vi.fn();
    Object.assign(window, { NativeShell: { downloadFile } });
    expect(nativeDownload(movie, 'u')).toBe(true);
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({ url: 'u', itemId: 'm1' }));
  });
});
