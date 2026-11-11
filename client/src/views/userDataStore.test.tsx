import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import type { BaseItem } from '../api/types';
import { ConfirmHost } from '../components/ConfirmDialog';
import { clearBrowseState, saveSnapshot, takeSnapshot } from './browse/browseStore';
import {
  clearUserData,
  markedUnwatched,
  reconcileUserData,
  setUserData,
  togglePlayed,
  toggleUserData,
  userDataValue,
  useUserDataChanges,
} from './userDataStore';

/** A fake server whose answers the test settles one by one, in order. */
function controlledServer() {
  const calls: { type: string; resolve: () => void; reject: () => void }[] = [];
  const client = createFakeClient(
    (r) =>
      new Promise<unknown>((resolve, reject) => {
        calls.push({ type: r.type, resolve: () => resolve({}), reject: () => reject(new Error('offline')) });
      }),
  );
  /** Lets the queue reach the next request. */
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { ctx: makeContext(client), calls, tick };
}

const item: BaseItem = { Id: 'm1', Name: 'Alpha', Type: 'Movie', UserData: { IsFavorite: false } };

describe('userDataStore', () => {
  afterEach(clearUserData);

  it('sends changes to one item in order, and a stale failure does not roll back a newer change', async () => {
    const calls: string[] = [];
    let failFirst = true;
    const client = createFakeClient((r) => {
      calls.push(`${r.type}`);
      if (failFirst) {
        failFirst = false;
        return Promise.reject(new Error('flaky'));
      }
      return {};
    });
    const ctx = makeContext(client);

    const first = setUserData(ctx, item, 'IsFavorite', true); // fails
    const second = setUserData(ctx, item, 'IsFavorite', false); // succeeds, and is the latest intent
    expect(userDataValue(item, 'IsFavorite')).toBe(false);

    expect(await first).toBe(true); // superseded: the newer change reports for itself
    expect(await second).toBe(true);
    expect(calls).toEqual(['POST', 'DELETE']); // sequential, in order
    expect(userDataValue(item, 'IsFavorite')).toBe(false); // not rolled back to "favorite"
  });

  it('rolls back a failed latest change, and fresh server data replaces settled overrides', async () => {
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    await setUserData(ctx, item, 'Played', true);
    expect(userDataValue(item, 'Played')).toBe(false);

    const ok = makeContext(createFakeClient(() => ({})));
    await setUserData(ok, item, 'IsFavorite', true);
    expect(userDataValue(item, 'IsFavorite')).toBe(true);
    reconcileUserData({ ...item, UserData: { IsFavorite: false } });
    expect(userDataValue({ ...item, UserData: { IsFavorite: false } }, 'IsFavorite')).toBe(false);
  });

  describe('failure sequences', () => {
    afterEach(clearBrowseState);

    it('rolls back to the server value, not the previous optimistic one, when every change fails', async () => {
      // The review's scenario: the server says "not favorite"; offline, the user taps twice (on, then off).
      const { ctx, calls, tick } = controlledServer();
      const first = setUserData(ctx, item, 'IsFavorite', true);
      const second = setUserData(ctx, item, 'IsFavorite', false);
      const third = setUserData(ctx, item, 'IsFavorite', true);
      expect(userDataValue(item, 'IsFavorite')).toBe(true);

      await tick();
      calls[0]!.reject();
      await tick();
      calls[1]!.reject();
      await tick();
      calls[2]!.reject();

      expect(await first).toBe(true);
      expect(await second).toBe(true);
      expect(await third).toBe(false);
      expect(userDataValue(item, 'IsFavorite')).toBe(false); // the server's value, not "true" from tap two
    });

    it('rolls back to the last value the server confirmed', async () => {
      const { ctx, calls, tick } = controlledServer();
      const first = setUserData(ctx, item, 'Played', true); // succeeds: the server now says watched
      const second = setUserData(ctx, item, 'Played', false); // fails
      await tick();
      calls[0]!.resolve();
      await tick();
      calls[1]!.reject();

      expect(await first).toBe(true);
      expect(await second).toBe(false);
      expect(userDataValue(item, 'Played')).toBe(true);
    });

    it('keeps a pending change through fresh server data, then settles to what the server confirmed', async () => {
      const { ctx, calls, tick } = controlledServer();
      const change = setUserData(ctx, item, 'IsFavorite', true);
      reconcileUserData(item); // e.g. the details page loaded meanwhile: the change in flight still wins
      expect(userDataValue(item, 'IsFavorite')).toBe(true);
      await tick();
      calls[0]!.resolve();
      expect(await change).toBe(true);

      // Later, the server's data wins again, and a failure rolls back to it.
      const fresh: BaseItem = { ...item, UserData: { IsFavorite: true } };
      reconcileUserData(fresh);
      const off = setUserData(ctx, fresh, 'IsFavorite', false);
      await tick();
      calls[1]!.reject();
      expect(await off).toBe(false);
      expect(userDataValue(fresh, 'IsFavorite')).toBe(true);
    });

    it('reports a refused toggle once, with the field it was about', async () => {
      const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
      const onError = vi.fn();
      toggleUserData(ctx, item, 'IsFavorite', true, onError);
      toggleUserData(ctx, item, 'Played', true, onError);
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
      expect(onError).toHaveBeenCalledWith("Couldn't update favorites. Try again.");
      expect(onError).toHaveBeenCalledWith("Couldn't update watched status. Try again.");
    });

    it('drops grids that filter on the field and updates the item in the others', async () => {
      const ctx = makeContext(createFakeClient(() => ({})));
      const snapshot = { items: [item], total: 1, scrollY: 400 };
      saveSnapshot('u|library|all', { ...snapshot });
      saveSnapshot('u|favorites|movies', { ...snapshot }, { dependsOn: ['IsFavorite'] });
      saveSnapshot('u|library|unwatched', { ...snapshot }, { dependsOn: ['Played'] });

      await setUserData(ctx, item, 'IsFavorite', true);

      expect(takeSnapshot('u|favorites|movies')).toBeUndefined();
      expect(takeSnapshot('u|library|unwatched')?.scrollY).toBe(400); // filters on Played, not favorites
      expect(takeSnapshot('u|library|all')?.items[0]?.UserData?.IsFavorite).toBe(true);
    });
  });

  describe('togglePlayed', () => {
    afterEach(cleanup);
    const watched: BaseItem = { ...item, UserData: { Played: true } };

    it('marks watched at once, without asking', async () => {
      render(<ConfirmHost />);
      const requests: string[] = [];
      const ctx = makeContext(createFakeClient((r) => (requests.push(r.type), {})));
      togglePlayed(ctx, item, true, vi.fn());
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(userDataValue(item, 'Played')).toBe(true);
      await vi.waitFor(() => expect(requests).toEqual(['POST']));
    });

    it('asks before marking unwatched: Cancel changes nothing, confirming sends it', async () => {
      render(<ConfirmHost />);
      const requests: string[] = [];
      const ctx = makeContext(createFakeClient((r) => (requests.push(r.type), {})));

      togglePlayed(ctx, watched, false, vi.fn());
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      await new Promise((r) => setTimeout(r, 0));
      expect(userDataValue(watched, 'Played')).toBe(true);
      expect(markedUnwatched(watched)).toBe(false);
      expect(requests).toEqual([]);

      togglePlayed(ctx, watched, false, vi.fn());
      expect(await screen.findByRole('alertdialog', { name: 'Mark as unwatched?' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }));
      await vi.waitFor(() => expect(requests).toEqual(['DELETE']));
      expect(userDataValue(watched, 'Played')).toBe(false);
      expect(markedUnwatched(watched)).toBe(true);
    });

    it.each([
      ['Movie', 'This resets how far you got and removes it from your History.'],
      ['Episode', 'This resets how far you got and removes it from your History.'],
      ['Series', "This resets every episode's progress and removes them from your History."],
      ['Season', "This resets every episode's progress and removes them from your History."],
    ])('says what marking a %s unwatched resets', async (Type, body) => {
      render(<ConfirmHost />);
      togglePlayed(makeContext(createFakeClient(() => ({}))), { ...watched, Type }, false, vi.fn());
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(body);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  it('remembers titles marked unwatched (History leaves them out) until a refusal or marking watched again', async () => {
    const { ctx, calls, tick } = controlledServer();
    const off = setUserData(ctx, item, 'Played', false);
    expect(markedUnwatched(item)).toBe(true); // at once, like the value
    await tick();
    calls[0]!.reject();
    expect(await off).toBe(false);
    expect(markedUnwatched(item)).toBe(false);

    void setUserData(ctx, item, 'Played', false);
    expect(markedUnwatched(item)).toBe(true);
    void setUserData(ctx, item, 'Played', true);
    expect(markedUnwatched(item)).toBe(false);
    clearUserData();
    void setUserData(ctx, item, 'Played', false);
    clearUserData();
    expect(markedUnwatched(item)).toBe(false);
  });

  it('stops leaving a title out once it was played after it was marked unwatched (here or on another device)', () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T20:00:00Z'), toFake: ['Date'] });
    const { ctx } = controlledServer();
    const playedAt = (date: string): BaseItem => ({
      ...item,
      UserData: { Played: true, LastPlayedDate: date },
    });
    void setUserData(ctx, item, 'Played', false);

    // A page saved before, or the server's answer before it caught up: still left out.
    expect(markedUnwatched(playedAt('2026-11-11T19:00:00.0000000Z'))).toBe(true);
    expect(markedUnwatched(item)).toBe(true); // no date at all
    expect(markedUnwatched(playedAt('not a date'))).toBe(true);
    // Played again since: History lists it again.
    expect(markedUnwatched(playedAt('2026-11-11T20:30:00.0000000Z'))).toBe(false);

    // The server's clock is ahead: the play it dated after this one's now is still the one undone.
    const ahead = playedAt('2026-11-11T20:02:00.0000000Z');
    void setUserData(ctx, ahead, 'Played', false);
    expect(markedUnwatched(ahead)).toBe(true);
    expect(markedUnwatched(playedAt('2026-11-11T20:03:00.0000000Z'))).toBe(false);
    vi.useRealTimers();
  });

  it('forgets the unwatch when fresh server data shows the title played, but not while the change is on its way', async () => {
    const { ctx, calls, tick } = controlledServer();
    const played: BaseItem = { ...item, UserData: { Played: true } };
    const off = setUserData(ctx, item, 'Played', false);
    reconcileUserData(played); // still in flight: the change wins
    expect(markedUnwatched(item)).toBe(true);
    await tick();
    calls[0]!.resolve();
    await off;

    reconcileUserData({ ...item, UserData: { Played: false } }); // the server agrees it's unwatched
    expect(markedUnwatched(item)).toBe(true);
    const listener = vi.fn();
    render(<Listener onChange={listener} />);
    reconcileUserData(played); // e.g. its details page, after it was played on the TV
    expect(markedUnwatched(item)).toBe(false);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled()); // History re-renders and lists it again
    cleanup();
  });
});

function Listener({ onChange }: { onChange: () => void }) {
  useUserDataChanges();
  onChange();
  return null;
}
