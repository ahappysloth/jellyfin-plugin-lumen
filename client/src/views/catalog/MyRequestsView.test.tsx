import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { myRequest } from '../../../test/myRequest';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { AllRequests, MyRequest } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { resetSessionCaches } from '../../util/sessionCaches';
import { everyoneKey } from './allRequests';
import { CatalogCard } from './CatalogCard';
import { MyRequestsView } from './MyRequestsView';
import { RequestProgressBlock } from './RequestProgressBlock';
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
    // Poster, the words, the status (a column of its own, so the statuses line up down the list), the chevron.
    for (const link of links) {
      expect(Array.from(link.children, (c) => c.classList[0])).toEqual([
        'lmn-request__art',
        'lmn-request__body',
        'lmn-request-progress',
        'lmn-icon',
      ]);
    }
  });

  it('shows the shape of the rows while they load, hidden from screen readers', async () => {
    const client = createFakeClient(
      routes({
        'Lumen/Requests/Mine': () => new Promise(() => undefined),
        'Lumen/Requests/Status': {
          Enabled: true,
          CanRequestMovies: true,
          CanRequestTv: true,
          ImageToken: 't',
        },
      }),
    );
    const ctx = makeContext(client, { config });
    startRequestProgress(ctx);
    const { container } = render(<MyRequestsView ctx={ctx} />);

    const pending = container.querySelector('.lmn-browse__pending')!;
    expect(pending).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(pending.querySelectorAll('.lmn-request--skeleton')).toHaveLength(3));
    expect(pending.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('list', { name: 'My requests' })).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
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

/** My requests as `admin` (or not), with the user's own `mine` and everyone's `all` on the server. */
async function loadAs(
  admin: boolean,
  mine: MyRequest[],
  all: AllRequests = { Requests: [], Partial: false },
  layout: 'desktop' | 'tv' = 'desktop',
) {
  const client = createFakeClient(
    routes({
      'Lumen/Requests/Mine': { Requests: mine },
      'Lumen/Requests/All': () => (admin ? all : Promise.reject({ status: 403 })),
      'Lumen/Requests/Status': { Enabled: true, CanRequestMovies: true, CanRequestTv: true, ImageToken: 't' },
      'Users/user1': { Id: 'user1', Name: 'me', Policy: { IsAdministrator: admin } },
      'QuickConnect/Enabled': false,
    }),
  );
  const ctx = makeContext(client, { config, layout });
  startRequestProgress(ctx);
  await act(() => refreshRequestProgress());
  return { ctx, client };
}

const allCalls = (client: { requests: AjaxRequest[] }) =>
  client.requests.filter((r) => r.url.endsWith('/Lumen/Requests/All'));
const rowTitles = () =>
  within(screen.getByRole('list', { name: 'My requests' }))
    .getAllByRole('link')
    .map((l) => l.querySelector('.lmn-request__title')!.textContent);
const chip = (name: RegExp) => screen.getByRole('button', { name });
/** Waits for a row with this title. */
const listed = (title: string) => waitFor(() => expect(rowTitles()).toContain(title));

describe('MyRequestsView search and filters', () => {
  afterEach(() => {
    resetSessionCaches();
    window.localStorage.clear();
  });

  const list = [
    myRequest({ key: 'movie-1', title: 'Amélie', Status: 'Requested' }),
    myRequest({ key: 'movie-2', title: 'The Matrix', Status: 'Downloading' }),
    myRequest({ key: 'tv-3', title: 'Lumen Saga', Status: 'Queued', Percent: null }),
    myRequest({ key: 'movie-4', title: 'Matrix Reloaded', Status: 'Ready', Percent: null }),
    myRequest({ key: 'movie-5', title: 'Stub Declined', Status: 'Declined', Percent: null }),
  ];

  it('filters by title as you type, ignoring case and accents, with a way to clear it', async () => {
    const { ctx } = await loadAs(false, list);
    render(<MyRequestsView ctx={ctx} />);
    const search = await screen.findByRole('searchbox', { name: 'Search requests' });

    fireEvent.input(search, { target: { value: 'MATRIX' } });
    expect(rowTitles()).toEqual(['The Matrix', 'Matrix Reloaded']);
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('2 requests');
    fireEvent.input(search, { target: { value: 'amelie' } });
    expect(rowTitles()).toEqual(['Amélie']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(rowTitles()).toHaveLength(5);
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
  });

  it('says when nothing matches the search, and clears it', async () => {
    const { ctx } = await loadAs(false, list);
    render(<MyRequestsView ctx={ctx} />);
    fireEvent.input(await screen.findByRole('searchbox'), { target: { value: 'nothing like it' } });

    expect(screen.queryByRole('list', { name: 'My requests' })).toBeNull();
    expect(screen.getByText('No requests match “nothing like it”')).toBeInTheDocument();
    expect(document.querySelector('.lmn-requests-empty .lmn-browse__empty-icon svg')).not.toBeNull();
    const clear = screen.getAllByRole('button', { name: 'Clear search' });
    fireEvent.click(clear[clear.length - 1]!);
    expect(rowTitles()).toHaveLength(5);
  });

  it('shows one chip at a time, each with its count, the counts following the search', async () => {
    const { ctx } = await loadAs(false, list);
    render(<MyRequestsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'My requests' });

    const chips = within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual([
      'All5',
      'Pending1',
      'Downloading2',
      'Available1',
      'Declined or failed1',
    ]);
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chip(/^Downloading/));
    expect(chip(/^Downloading/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'false');
    expect(rowTitles()).toEqual(['The Matrix', 'Lumen Saga']);

    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'matrix' } });
    expect(rowTitles()).toEqual(['The Matrix']);
    expect(chips.map((c) => c.textContent)).toEqual([
      'All2',
      'Pending0',
      'Downloading1',
      'Available1',
      'Declined or failed0',
    ]);
  });

  it('says when a chip has nothing, with a way back to all of them', async () => {
    const { ctx } = await loadAs(false, list.slice(0, 2));
    render(<MyRequestsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'My requests' });

    fireEvent.click(chip(/^Available/));
    expect(screen.getByText('Nothing is ready to watch yet')).toBeInTheDocument();
    fireEvent.click(chip(/^Declined or failed/));
    expect(screen.getByText('Nothing was declined or failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all requests' }));
    expect(rowTitles()).toHaveLength(2);
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no search or chips with no requests', async () => {
    const { ctx } = await loadAs(false, []);
    render(<MyRequestsView ctx={ctx} />);
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
  });

  it('on a TV, the newest request has the first focus, not the search or a chip', async () => {
    const { ctx } = await loadAs(true, list, undefined, 'tv');
    render(<MyRequestsView ctx={ctx} />);
    await screen.findByRole('switch');
    const first = within(await screen.findByRole('list', { name: 'My requests' })).getAllByRole('link')[0];
    expect(first).toHaveFocus();
  });
});

describe("MyRequestsView: everyone's requests", () => {
  afterEach(() => {
    resetSessionCaches();
    window.localStorage.clear();
  });

  const everyone: AllRequests = {
    Requests: [
      myRequest({
        key: 'movie-9',
        title: 'Kid Movie',
        Status: 'Requested',
        RequestIds: [9],
        RequestedBy: { Name: 'kid', UserId: 'kid1', ImageTag: 'tag' },
      }),
      myRequest({
        key: 'movie-603',
        title: 'The Matrix',
        RequestIds: [2],
        RequestedBy: { Name: 'me', UserId: 'user1' },
      }),
      myRequest({
        key: 'movie-603',
        title: 'The Matrix',
        Status: 'Ready',
        RequestIds: [1],
        RequestedBy: { Name: 'Seerr Sam' },
      }),
      myRequest({ key: 'movie-8', title: 'Unknown', Status: 'Failed', RequestIds: [8], RequestedBy: null }),
    ],
    Partial: false,
  };

  it('is never offered to someone who isn’t an administrator, even with it left on in this browser', async () => {
    window.localStorage.setItem(everyoneKey('user1'), '1');
    const { ctx, client } = await loadAs(false, [myRequest()], everyone);
    render(<MyRequestsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'My requests' });
    await act(() => new Promise((r) => setTimeout(r, 0)));

    expect(screen.queryByRole('switch')).toBeNull();
    expect(rowTitles()).toEqual(['The Matrix']);
    expect(allCalls(client)).toHaveLength(0);
  });

  it('shows an administrator every user’s requests, each with who asked, and keeps the switch on in this browser', async () => {
    const { ctx, client } = await loadAs(true, [myRequest()], everyone);
    render(<MyRequestsView ctx={ctx} />);
    const toggle = await screen.findByRole('switch', { name: 'Everyone’s requests' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(allCalls(client)).toHaveLength(0);

    await act(async () => toggle.click());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await listed('Kid Movie');
    expect(allCalls(client)).toHaveLength(1);
    expect(window.localStorage.getItem(everyoneKey('user1'))).toBe('1');
    expect(rowTitles()).toEqual(['Kid Movie', 'The Matrix', 'The Matrix', 'Unknown']);

    const rows = within(screen.getByRole('list', { name: 'My requests' })).getAllByRole('link');
    expect(rows[0]).toHaveTextContent('Requested by kid');
    expect(rows[0]!.querySelector('img.lmn-request__avatar')!.getAttribute('src')).toContain(
      'Users/kid1/Images/Primary?tag=tag',
    );
    expect(rows[2]).toHaveTextContent('Requested by Seerr Sam');
    expect(rows[2]!.querySelector('.lmn-request__avatar')).toHaveTextContent('S');
    expect(rows[3]).toHaveTextContent('Requested by Someone not on this server');

    // The search finds who asked too, and the chips count what's shown.
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'kid' } });
    expect(rowTitles()).toEqual(['Kid Movie']);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(chip(/^Available/)).toHaveTextContent('Available1');

    // Off: the user's own again, and off in this browser.
    await act(async () => toggle.click());
    expect(rowTitles()).toEqual(['The Matrix']);
    expect(screen.queryByText(/Requested by/)).toBeNull();
    expect(window.localStorage.getItem(everyoneKey('user1'))).toBeNull();
  });

  it('starts on where it was left on, for that user', async () => {
    window.localStorage.setItem(everyoneKey('user1'), '1');
    const { ctx } = await loadAs(true, [myRequest()], everyone);
    render(<MyRequestsView ctx={ctx} />);
    await listed('Kid Movie');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('left on, shows nothing until it knows who they are, rather than their own list first', async () => {
    window.localStorage.setItem(everyoneKey('user1'), '1');
    let answer: (account: unknown) => void = () => {};
    const client = createFakeClient(
      routes({
        'Lumen/Requests/Mine': {
          Requests: [myRequest({ key: 'movie-5', title: 'Only Mine', RequestIds: [5] })],
        },
        'Lumen/Requests/All': everyone,
        'Lumen/Requests/Status': {
          Enabled: true,
          CanRequestMovies: true,
          CanRequestTv: true,
          ImageToken: 't',
        },
        'Users/user1': () => new Promise((resolve) => (answer = resolve)),
        'QuickConnect/Enabled': false,
      }),
    );
    const ctx = makeContext(client, { config, layout: 'desktop' });
    startRequestProgress(ctx);
    await act(() => refreshRequestProgress());
    render(<MyRequestsView ctx={ctx} />);
    // Styles in, the user's own list loaded, and still no list while Jellyfin hasn't said they're an administrator.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('list', { name: 'My requests' })).toBeNull();

    await act(async () => answer({ Id: 'user1', Name: 'me', Policy: { IsAdministrator: true } }));
    await listed('Kid Movie');
    expect(rowTitles()).not.toContain('Only Mine');
  });

  it('offers the switch to an administrator with no requests of their own', async () => {
    const { ctx } = await loadAs(true, [], everyone);
    render(<MyRequestsView ctx={ctx} />);
    const toggle = await screen.findByRole('switch');
    await act(async () => toggle.click());
    await listed('Kid Movie');
  });

  it("says when everyone's requests couldn't be loaded, and Try again asks again", async () => {
    window.localStorage.setItem(everyoneKey('user1'), '1');
    let fail = true;
    const { ctx, client } = await loadAs(true, [myRequest()]);
    client.respond = ((inner) => (request: AjaxRequest) =>
      request.url.endsWith('/Lumen/Requests/All')
        ? fail
          ? Promise.reject({ status: 502 })
          : everyone
        : inner(request))(client.respond);
    render(<MyRequestsView ctx={ctx} />);

    expect(await screen.findByText("Couldn't load everyone's requests from Seerr.")).toBeInTheDocument();
    fail = false;
    await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
    await listed('Kid Movie');
  });

  it('counts time left down from when everyone’s requests arrived, not the user’s own', () => {
    // No answer of the user's own (reset): counted from theirs, it would be long gone.
    render(
      <RequestProgressBlock
        request={myRequest({ SecondsLeft: 600 })}
        compact
        receivedAt={Date.now() - 120_000}
      />,
    );
    expect(document.querySelector('.lmn-request-progress__status')).toHaveTextContent(
      'Downloading40% · 8 min left',
    );
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
