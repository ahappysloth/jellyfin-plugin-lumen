import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import type { BaseItem } from '../api/types';
import { clearUserData, reconcileUserData, setUserData, userDataValue } from './userDataStore';

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

    expect(await first).toBe(false);
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
});
