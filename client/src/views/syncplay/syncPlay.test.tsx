import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { SyncPlayManager } from '../../compat/syncPlay';
import { ContextMenuHost } from '../../components/ContextMenu';
import { NO_SYNCPLAY, othersInGroup, readState, type SyncPlayState } from './syncPlayState';
import { openWatchTogether } from './WatchTogether';

const fakeManager = (over: Partial<Record<keyof SyncPlayManager, unknown>> = {}): SyncPlayManager =>
  ({
    isSyncPlayEnabled: () => false,
    getGroupInfo: () => null,
    isPlaylistEmpty: () => true,
    isPlaybackActive: () => false,
    resumeGroupPlayback: vi.fn(),
    haltGroupPlayback: vi.fn(),
    ...over,
  }) as SyncPlayManager;
const group = { GroupId: 'g1', GroupName: "Alex's group", Participants: ['Alex', 'Sam'] };

describe('SyncPlay state', () => {
  it('is unavailable without the manager or without access', () => {
    expect(readState(null, { Id: 'u', Name: 'Alex' })).toEqual(NO_SYNCPLAY);
    expect(readState(fakeManager(), { Id: 'u', Name: 'Alex', Policy: { SyncPlayAccess: 'None' } })).toEqual(
      NO_SYNCPLAY,
    );
  });

  it('reads the group and what the user can do', () => {
    const state = readState(
      fakeManager({ isSyncPlayEnabled: () => true, getGroupInfo: () => group, isPlaylistEmpty: () => false }),
      { Id: 'u', Name: 'Alex', Policy: { SyncPlayAccess: 'JoinGroups' } },
    );
    expect(state).toMatchObject({
      available: true,
      canCreate: false,
      canStart: true,
      canStop: false,
      self: 'Alex',
    });
    expect(state.group).toEqual(group);
    expect(othersInGroup(state)).toEqual(['Sam']);
  });
});

function setup(state: SyncPlayState, groups: unknown[] = []) {
  const client = createFakeClient(
    routes({ 'SyncPlay/List': groups, 'SyncPlay/Join': {}, 'SyncPlay/New': {}, 'SyncPlay/Leave': {} }),
  );
  render(
    <>
      <button type="button">anchor</button>
      <ContextMenuHost />
    </>,
  );
  const ctx = makeContext(client);
  return {
    client,
    open: () => openWatchTogether(ctx, state, screen.getByRole('button', { name: 'anchor' })),
  };
}

const available: SyncPlayState = { ...NO_SYNCPLAY, available: true, canCreate: true, self: 'Alex' };

describe('Watch together menu', () => {
  it('lists groups to join with who is in them, and creates a group named after the user', async () => {
    const { client, open } = setup(available, [
      { GroupId: 'g9', GroupName: "Sam's group", Participants: ['Sam'] },
    ]);
    await open();

    expect(screen.getByText('Watch together')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Sam's group/ }));
    expect(JSON.parse(client.requests.at(-1)!.data!)).toEqual({ GroupId: 'g9' });
    expect(client.requests.at(-1)!.url).toBe('http://jf/SyncPlay/Join');

    await open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New group' }));
    expect(JSON.parse(client.requests.at(-1)!.data!)).toEqual({ GroupName: "Alex's group" });
  });

  it('offers no New group to users who may only join', async () => {
    const { open } = setup({ ...available, canCreate: false });
    await open();
    expect(screen.queryByRole('menuitem', { name: 'New group' })).toBeNull();
  });

  it('shows the current group with its members and Leave group', async () => {
    const { client, open } = setup({ ...available, group });
    await open();

    expect(screen.getByText("Alex's group")).toBeInTheDocument();
    expect(screen.getByText('Alex, Sam')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave group' }));
    expect(client.requests.at(-1)!.url).toBe('http://jf/SyncPlay/Leave');
  });
});
