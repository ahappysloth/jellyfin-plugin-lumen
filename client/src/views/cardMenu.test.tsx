import { render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import type { BaseItem } from '../api/types';
import { ToastHost } from '../components/Toast';
import { cardMenuEntries } from './cardMenu';
import { clearUserData, userDataValue } from './userDataStore';

const movie: BaseItem = {
  Id: 'm1',
  Name: 'Alpha',
  Type: 'Movie',
  ServerId: 's',
  UserData: { IsFavorite: false },
};
const entry = (entries: ReturnType<typeof cardMenuEntries>, label: string) =>
  entries.find((e) => e.label === label)!;

describe('cardMenuEntries', () => {
  afterEach(clearUserData);

  it('lets the grid save its place before Play leaves the page, as More info does', async () => {
    const beforeNavigate = vi.fn();
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('offline'))));
    const entries = cardMenuEntries(movie, ctx, { beforeNavigate, onError: vi.fn() });

    entry(entries, 'Play').onSelect();
    expect(beforeNavigate).toHaveBeenCalledWith(movie);
    entry(entries, 'More info').onSelect();
    expect(beforeNavigate).toHaveBeenCalledTimes(2);
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=m1&serverId=s');
  });

  it('reports a failed Play and a refused favorite in the shared toast by default', async () => {
    render(<ToastHost />);
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('offline'))));

    entry(cardMenuEntries(movie, ctx), 'Play').onSelect();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't start playback"));

    entry(cardMenuEntries(movie, ctx), 'Add to favorites').onSelect();
    expect(userDataValue(movie, 'IsFavorite')).toBe(true); // optimistic
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't update favorites"));
    expect(userDataValue(movie, 'IsFavorite')).toBe(false); // rolled back
  });
});
