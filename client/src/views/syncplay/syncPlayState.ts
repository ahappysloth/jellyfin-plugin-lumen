import { useEffect, useState } from 'preact/hooks';
import type { UserInfo } from '../../api/types';
import { findSyncPlay, type SyncPlayGroupInfo, type SyncPlayManager } from '../../compat/syncPlay';
import type { ViewContext } from '../context';

export interface SyncPlayState {
  /** jellyfin-web's SyncPlay was found and the user may join groups. */
  available: boolean;
  canCreate: boolean;
  group: SyncPlayGroupInfo | null;
  /** The group has a queue but this client isn't playing it (offer Start group playback). */
  canStart: boolean;
  /** This client is playing the group's queue (offer Stop group playback). */
  canStop: boolean;
  /** The signed-in user's name, to tell them apart from the others in the group. */
  self: string | null;
}

export const NO_SYNCPLAY: SyncPlayState = {
  available: false,
  canCreate: false,
  group: null,
  canStart: false,
  canStop: false,
  self: null,
};
const POLL_MS = 1500;

/** Each user's account (for their SyncPlay permission and name), fetched once per page load. */
const access = new Map<string, Promise<UserInfo | undefined>>();

function userOf(ctx: ViewContext): Promise<UserInfo | undefined> {
  let p = access.get(ctx.userId);
  if (!p) {
    p = ctx.api.getCurrentUser().then(
      (u) => u,
      () => {
        access.delete(ctx.userId);
        return undefined;
      },
    );
    access.set(ctx.userId, p);
  }
  return p;
}

export function readState(manager: SyncPlayManager | null, user: UserInfo | undefined): SyncPlayState {
  const level = user?.Policy?.SyncPlayAccess ?? 'CreateAndJoinGroups';
  if (!manager || level === 'None') return NO_SYNCPLAY;
  const enabled = manager.isSyncPlayEnabled();
  const info = enabled ? manager.getGroupInfo() : null;
  const active = enabled && manager.isPlaybackActive();
  return {
    available: true,
    canCreate: level === 'CreateAndJoinGroups',
    group: info ? { ...info, Participants: [...(info.Participants ?? [])] } : null,
    canStart: enabled && !active && !manager.isPlaylistEmpty(),
    canStop: active,
    self: user?.Name ?? null,
  };
}

const same = (a: SyncPlayState, b: SyncPlayState): boolean =>
  a.available === b.available &&
  a.canCreate === b.canCreate &&
  a.canStart === b.canStart &&
  a.canStop === b.canStop &&
  a.group?.GroupId === b.group?.GroupId &&
  a.group?.GroupName === b.group?.GroupName &&
  a.group?.Participants.join('\n') === b.group?.Participants.join('\n');

/**
 * SyncPlay as jellyfin-web's manager sees it, re-read every 1.5 s (the manager only announces changes through
 * jellyfin-web's private event helper). Unavailable when the manager can't be found or the user has no access.
 */
export function useSyncPlayState(
  ctx: ViewContext,
  find: () => SyncPlayManager | null = findSyncPlay,
): SyncPlayState {
  const [state, setState] = useState<SyncPlayState>(NO_SYNCPLAY);
  useEffect(() => {
    let cancelled = false;
    let user: UserInfo | undefined | null = null;
    const tick = (): void => {
      if (cancelled || user === null) return;
      const next = readState(find(), user);
      setState((prev) => (same(prev, next) ? prev : next));
    };
    void userOf(ctx).then((u) => {
      user = u;
      tick();
    });
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ctx.userId]);
  return state;
}

/** The others in the group (the user's own name removed once), for "Watching with …". */
export function othersInGroup(state: SyncPlayState): string[] {
  const names = [...(state.group?.Participants ?? [])];
  const own = state.self ? names.indexOf(state.self) : -1;
  if (own >= 0) names.splice(own, 1);
  return names;
}

export function clearSyncPlayAccess(): void {
  access.clear();
}
