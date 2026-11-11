import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import type { BaseItem } from '../api/types';
import { ConfirmHost } from '../components/ConfirmDialog';
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

  it('asks before Mark as unwatched, and focus comes back to the card; Mark as watched goes ahead', async () => {
    render(
      <>
        <a href="#card">Alpha</a>
        <ConfirmHost />
      </>,
    );
    const requests: string[] = [];
    const ctx = makeContext(createFakeClient((r) => (requests.push(r.type), {})));
    const card = screen.getByRole('link', { name: 'Alpha' });
    const watched: BaseItem = { ...movie, UserData: { Played: true } };

    card.focus(); // the menu gives focus back to its card before acting
    entry(cardMenuEntries(watched, ctx), 'Mark as unwatched').onSelect();
    expect(await screen.findByRole('alertdialog', { name: 'Mark as unwatched?' })).toBeInTheDocument();
    expect(userDataValue(watched, 'Played')).toBe(true); // nothing yet
    fireEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }));
    expect(card).toHaveFocus();
    await waitFor(() => expect(requests).toEqual(['DELETE']));
    expect(userDataValue(watched, 'Played')).toBe(false);

    entry(cardMenuEntries(watched, ctx), 'Mark as watched').onSelect();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(requests).toEqual(['DELETE', 'POST']));
  });
});
