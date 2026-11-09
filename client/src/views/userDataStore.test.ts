import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import type { BaseItem } from '../api/types';
import { clearBrowseState, saveSnapshot, takeSnapshot } from './browse/browseStore';
import {
  clearUserData,
  reconcileUserData,
  setUserData,
  toggleUserData,
  userDataValue,
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
});
