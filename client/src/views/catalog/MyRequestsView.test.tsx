import { act, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { myRequest } from '../../../test/myRequest';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { MyRequest } from '../../api/types';
import { CatalogCard } from './CatalogCard';
import { MyRequestsView } from './MyRequestsView';
import { refreshRequestProgress, reset, startRequestProgress } from './requestProgress';

const config = { ...testConfig, Requests: true };

async function load(requests: MyRequest[]) {
  const client = createFakeClient(
    routes({
      'Lumen/Requests/Mine': { Requests: requests },
      'Lumen/Requests/Status': { Enabled: true, CanRequestMovies: true, CanRequestTv: true, ImageToken: 't' },
    }),
  );
  const ctx = makeContext(client, { config });
  startRequestProgress(ctx);
  await act(() => refreshRequestProgress());
  return ctx;
}

afterEach(reset);

describe('MyRequestsView', () => {
  it('lists the requests with their status, progress and a link to each title', async () => {
    const ctx = await load([
      myRequest({
        key: 'tv-1399',
        title: 'Lumen Saga',
        EpisodesDone: 3,
        EpisodesTotal: 8,
        SecondsLeft: null,
      }),
      myRequest({
        Status: 'Ready',
        Percent: null,
        SecondsLeft: null,
        Item: { ...myRequest().Item, JellyfinItemId: 'abc' },
      }),
      myRequest({ key: 'movie-700', title: 'Declined Movie', Status: 'Declined', Percent: null }),
    ]);
    render(<MyRequestsView ctx={ctx} />);

    const list = await screen.findByRole('list', { name: 'My requests' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '#/home?title=tv-1399',
      '#/details?id=abc',
      '#/home?title=movie-700',
    ]);
    expect(links[0]).toHaveTextContent('Downloading3 of 8 episodes');
    expect(within(links[0]!).getByRole('progressbar', { name: 'Downloading' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(links[1]).toHaveTextContent('Ready');
    expect(within(links[1]!).queryByRole('progressbar')).toBeNull();
    expect(links[2]).toHaveTextContent('Declined');
  });

  it('says when there are none', async () => {
    const ctx = await load([]);
    render(<MyRequestsView ctx={ctx} />);
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
  });

  it("says when they couldn't be loaded, with Try again, focused on a TV, then the first request once it works", async () => {
    let fail = true;
    const client = createFakeClient(
      routes({
        'Lumen/Requests/Mine': () =>
          fail ? Promise.reject({ status: 502 }) : { Requests: [myRequest({ title: 'Lumen Saga' })] },
        'Lumen/Requests/Status': {
          Enabled: true,
          CanRequestMovies: true,
          CanRequestTv: true,
          ImageToken: 't',
        },
      }),
    );
    const ctx = makeContext(client, { config, layout: 'tv' });
    startRequestProgress(ctx);
    await act(() => refreshRequestProgress());
    render(<MyRequestsView ctx={ctx} />);

    expect(screen.getByText("Couldn't load your requests from Seerr.")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveFocus();

    fail = false;
    await act(async () => {
      retry.click();
      await refreshRequestProgress();
    });
    const list = await screen.findByRole('list', { name: 'My requests' });
    expect(within(list).getByRole('link')).toHaveFocus();
  });

  it('says so on a server without Seerr, and asks nothing', () => {
    const client = createFakeClient(routes({}));
    render(<MyRequestsView ctx={makeContext(client)} />);
    expect(screen.getByText("Requests aren't available for your account.")).toBeInTheDocument();
    expect(client.requests).toHaveLength(0);
  });
});

describe("CatalogCard with the user's own request", () => {
  it('shows its status, a progress bar and the percentage and time left', async () => {
    const ctx = await load([myRequest({ Percent: 45, SecondsLeft: 750 })]);
    render(
      <CatalogCard
        item={{ ...myRequest().Item, State: 'Downloading' }}
        client={ctx.client}
        imageToken="t"
        variant="poster"
        onSelect={() => {}}
      />,
    );

    const card = screen.getByRole('button', { name: /^The Matrix, Downloading, 45% · 13 min left$/ });
    expect(card.querySelector('.lmn-card__state')).toHaveTextContent('Downloading');
    expect(card.querySelector<HTMLElement>('.lmn-progress__fill')!.style.width).toBe('45%');
    expect(card.querySelector('.lmn-card__meta')).toHaveTextContent('45% · 13 min left');
  });

  it('says plainly when it was declined, with no bar', async () => {
    const ctx = await load([myRequest({ Status: 'Declined', Percent: null, SecondsLeft: null })]);
    render(
      <CatalogCard
        item={myRequest().Item}
        client={ctx.client}
        imageToken="t"
        variant="poster"
        onSelect={() => {}}
      />,
    );

    const card = screen.getByRole('button', { name: 'The Matrix, Declined' });
    expect(card.querySelector('.lmn-card__state')).toHaveClass('is-problem');
    expect(card.querySelector('.lmn-progress')).toBeNull();
  });

  it("keeps another user's request as the card's plain state", () => {
    render(
      <CatalogCard
        item={{ ...myRequest().Item, State: 'Downloading' }}
        client={createFakeClient()}
        imageToken="t"
        variant="poster"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'The Matrix, Downloading' })).toBeInTheDocument();
    expect(document.querySelector('.lmn-progress')).toBeNull();
  });
});
