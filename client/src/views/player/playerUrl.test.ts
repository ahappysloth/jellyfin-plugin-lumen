import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import type { PlaybackManager } from '../../compat/playbackManager';
import { showToast } from '../../components/Toast';
import { startPlayback } from '../../playback/startPlayback';
import { strings } from '../../strings';
import { playerStrings } from './playerStrings';
import { playerHash, playerUrlItem, rememberPosition, restorePlayback } from './playerUrl';

vi.mock('../../playback/startPlayback', () => ({ startPlayback: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../../components/Toast', () => ({ showToast: vi.fn() }));

const ID = '0123456789abcdef0123456789abcdef';
const movie: BaseItem = {
  Id: ID,
  Name: 'Lumen Alpha',
  Type: 'Movie',
  ServerId: 's1',
  UserData: { PlaybackPositionTicks: 600_000_000 },
};

describe('the player URL', () => {
  it("is the title's details URL with /video added", () => {
    expect(playerHash(ID, 's1')).toBe(`#/details/video?id=${ID}&serverId=s1`);
    expect(playerHash(ID)).toBe(`#/details/video?id=${ID}`);
  });

  it('names the item it plays; #/video and every other address name none', () => {
    expect(playerUrlItem(`#/details/video?id=${ID}&serverId=s1`)).toBe(ID);
    expect(playerUrlItem(`#!/details/video?serverId=s1&id=${ID}`)).toBe(ID);
    expect(playerUrlItem('#/video')).toBeNull();
    expect(playerUrlItem(`#/details?id=${ID}`)).toBeNull();
    expect(playerUrlItem('#/details/video?id=nope')).toBeNull();
    expect(playerUrlItem('#/details/video')).toBeNull();
  });
});

describe('restorePlayback', () => {
  let video: HTMLVideoElement | null = null;
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', `#/details/video?id=${ID}`);
  });
  afterEach(() => {
    vi.clearAllMocks();
    video?.remove();
    video = null;
  });

  const context = (item: BaseItem | Error = movie) =>
    makeContext(
      createFakeClient(
        routes({ [`Items/${ID}`]: () => (item instanceof Error ? Promise.reject(item) : item) }),
      ),
    );
  const manager = (extra: Partial<PlaybackManager> = {}) => extra as PlaybackManager;

  it("puts its details page in this entry's place, then plays it from its resume point as Resume does", async () => {
    const popped = vi.fn();
    window.addEventListener('popstate', popped);
    const length = history.length;
    const ctx = context();

    await restorePlayback(ctx, ID, manager());

    window.removeEventListener('popstate', popped);
    expect(location.hash).toBe(`#/details?id=${ID}&serverId=s1`);
    expect(history.length).toBe(length);
    expect(popped).toHaveBeenCalled(); // jellyfin-web's router follows
    expect(startPlayback).toHaveBeenCalledWith(ctx, expect.objectContaining({ Id: ID }));
    expect(vi.mocked(startPlayback).mock.calls[0]![1].UserData?.PlaybackPositionTicks).toBe(600_000_000);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('starts where this tab was as the page went, once, for that title only', async () => {
    rememberPosition(ID, 50_000_000);
    await restorePlayback(context(), ID, manager());
    expect(vi.mocked(startPlayback).mock.calls[0]![1].UserData?.PlaybackPositionTicks).toBe(50_000_000);
    expect(sessionStorage.getItem('lmnPosition')).toBeNull();

    rememberPosition('fedcba9876543210fedcba9876543210', 50_000_000);
    await restorePlayback(context(), ID, manager());
    expect(vi.mocked(startPlayback).mock.calls[1]![1].UserData?.PlaybackPositionTicks).toBe(600_000_000);
  });

  it("goes home with a toast for a title that isn't there (removed, or not this user's)", async () => {
    await restorePlayback(context(new Error('404')), ID, manager());
    expect(location.hash).toBe('#/home');
    expect(showToast).toHaveBeenCalledWith(playerStrings.restoreFailed);
    expect(startPlayback).not.toHaveBeenCalled();
  });

  it("stays on the title's page with a toast when it can't play", async () => {
    vi.mocked(startPlayback).mockRejectedValueOnce(new Error('no'));
    await restorePlayback(context(), ID, manager());
    expect(location.hash).toBe(`#/details?id=${ID}&serverId=s1`);
    expect(showToast).toHaveBeenCalledWith(strings.playbackFailed);
  });

  it('leaves what plays to the group in Watch together: its page only', async () => {
    await restorePlayback(context(), ID, manager({ syncPlayEnabled: true }));
    expect(location.hash).toBe(`#/details?id=${ID}&serverId=s1`);
    expect(startPlayback).not.toHaveBeenCalled();
  });

  it("opens the player paused when the browser wouldn't start the video without a click", async () => {
    video = document.createElement('video');
    video.className = 'htmlvideoplayer';
    document.body.appendChild(video); // paused: play() was refused
    await restorePlayback(context(), ID, manager());
    expect(location.hash).toBe('#/video');
  });

  it("leaves the player's page to jellyfin-web when the video plays", async () => {
    video = document.createElement('video');
    video.className = 'htmlvideoplayer';
    Object.defineProperty(video, 'paused', { value: false });
    document.body.appendChild(video);
    await restorePlayback(context(), ID, manager());
    expect(location.hash).toBe(`#/details?id=${ID}&serverId=s1`);
  });
});
