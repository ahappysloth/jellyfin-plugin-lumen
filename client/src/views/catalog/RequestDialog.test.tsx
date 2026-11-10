import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { CatalogTitle } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { pressRemoteBack, REMOTE_BACK_KEY_CODES } from '../../../test/remoteBack';
import { RequestDialog } from './RequestDialog';

const show: CatalogTitle = {
  Key: 'tv-7',
  MediaType: 'tv',
  TmdbId: 7,
  Title: 'Lumen Saga',
  GenreNames: [],
  State: 'PartlyAvailable',
  Cast: [],
  Recommendations: [],
  CanRequest: true,
  Seasons: [
    { Number: 1, Name: 'Season 1', EpisodeCount: 10, State: 'Available' },
    { Number: 2, Name: 'Season 2', EpisodeCount: 8, State: 'None' },
    { Number: 3, Name: 'Season 3', EpisodeCount: 6, State: 'None' },
  ],
};
const movie: CatalogTitle = {
  ...show,
  Key: 'movie-9',
  MediaType: 'movie',
  TmdbId: 9,
  Title: 'Film',
  Seasons: [],
};

function setup(title: CatalogTitle, post: (r: AjaxRequest) => unknown) {
  document.querySelectorAll('[data-opener]').forEach((el) => el.remove());
  const opener = document.createElement('button');
  opener.dataset.opener = '';
  opener.textContent = 'Open dialog';
  document.body.append(opener);
  opener.focus();
  const client = createFakeClient(routes({ 'Lumen/Requests': post }));
  const onClose = vi.fn();
  const onRequested = vi.fn();
  const view = render(
    <RequestDialog title={title} ctx={makeContext(client)} onClose={onClose} onRequested={onRequested} />,
  );
  const dialog = screen.getByRole('dialog', { name: `Request ${title.Title}` });
  const posts = () => client.requests.filter((r) => r.type === 'POST').map((r) => JSON.parse(r.data!));
  return { dialog, onClose, onRequested, posts, opener, view };
}

describe('RequestDialog', () => {
  afterEach(() => document.querySelectorAll('[data-opener]').forEach((el) => el.remove()));

  it('selects every requestable season to start, and All seasons toggles them together', () => {
    const { dialog } = setup(show, () => ({}));
    const all = within(dialog).getByRole('checkbox', { name: /All seasons/ });
    const s2 = within(dialog).getByRole('checkbox', { name: /Season 2/ });
    const s3 = within(dialog).getByRole('checkbox', { name: /Season 3/ });
    const send = within(dialog).getByRole('button', { name: 'Request' });
    expect(within(dialog).getByRole('checkbox', { name: /Season 1/ })).toBeDisabled();
    expect([all, s2, s3].every((c) => (c as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(all);
    expect(s2).not.toBeChecked();
    expect(s3).not.toBeChecked();
    expect(send).toBeDisabled(); // nothing to request

    fireEvent.click(s3);
    expect(all).not.toBeChecked();
    expect(send).toBeEnabled();
    fireEvent.click(s2);
    expect(all).toBeChecked();
  });

  it('sends the chosen seasons in order and reports approval pending', async () => {
    const { dialog, onRequested, posts } = setup(show, () => ({ State: 'Requested', NeedsApproval: true }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Season 2/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Season 2/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

    expect(await within(dialog).findByText('Requested, waiting for approval.')).toBeInTheDocument();
    expect(posts()).toEqual([{ MediaType: 'tv', TmdbId: 7, Seasons: [2, 3] }]);
    expect(onRequested).toHaveBeenCalledWith({ State: 'Requested', NeedsApproval: true }, [2, 3]);
  });

  it('shows a failure, and Try again returns to the form to send again', async () => {
    let fail = true;
    const { dialog, onRequested, posts } = setup(movie, () =>
      fail ? Promise.reject(new Error('offline')) : { State: 'Requested', NeedsApproval: false },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

    expect(await within(dialog).findByText("Couldn't send the request. Try again.")).toBeInTheDocument();
    expect(onRequested).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus());

    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    const send = within(dialog).getByRole('button', { name: 'Request' });
    await waitFor(() => expect(send).toHaveFocus());
    fireEvent.click(send);

    expect(await within(dialog).findByText(/Requested. It will appear/)).toBeInTheDocument();
    expect(posts()).toHaveLength(2);
    expect(onRequested).toHaveBeenCalledTimes(1);
  });

  it('blocks Escape and the backdrop while sending', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const { dialog, onClose } = setup(movie, () => new Promise((r) => (answer = r)));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));
    expect(within(dialog).getByRole('button', { name: 'Requesting…' })).toBeDisabled();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    answer({ State: 'Requested', NeedsApproval: false });
    await within(dialog).findByText(/Requested. It will appear/);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(REMOTE_BACK_KEY_CODES)(
    "closes on a TV remote's Back (keyCode %i), and never lets jellyfin-web go back a page too",
    async (keyCode) => {
      let answer: (v: unknown) => void = () => undefined;
      const { dialog, onClose } = setup(movie, () => new Promise((r) => (answer = r)));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

      // While sending it can't close yet, but Back still mustn't leave the page underneath.
      expect(pressRemoteBack(dialog, keyCode).reachedJellyfin).toBe(false);
      expect(onClose).not.toHaveBeenCalled();

      answer({ State: 'Requested', NeedsApproval: false });
      await within(dialog).findByText(/Requested. It will appear/);
      expect(pressRemoteBack(dialog, keyCode).reachedJellyfin).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('traps Tab inside the dialog and gives focus back to its opener', async () => {
    const { dialog, opener, view } = setup(movie, () => ({}));
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const send = within(dialog).getByRole('button', { name: 'Request' });
    await waitFor(() => expect(send).toHaveFocus()); // the primary action

    fireEvent.keyDown(dialog, { key: 'Tab' }); // from the last control
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true }); // from the first
    expect(send).toHaveFocus();

    view.unmount();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
