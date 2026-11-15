import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  mine: MyRequest[] | (() => { Requests: MyRequest[] }),
  all: AllRequests = { Requests: [], Partial: false },
  layout: 'desktop' | 'tv' = 'desktop',
) {
  const client = createFakeClient(
    routes({
      'Lumen/Requests/Mine': typeof mine === 'function' ? mine : { Requests: mine },
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
const chipNames = () =>
  within(screen.getByRole('group', { name: 'Show' }))
    .getAllByRole('button')
    .map((c) => c.textContent);
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

    // Named as the rows' statuses are, in a request's order; only those with a request under them (no Failed here).
    expect(chipNames()).toEqual(['All5', 'Pending1', 'Queued1', 'Downloading1', 'Ready1', 'Declined1']);
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chip(/^Queued/));
    expect(chip(/^Queued/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'false');
    expect(rowTitles()).toEqual(['Lumen Saga']);
    expect(screen.getByRole('list', { name: 'My requests' })).toHaveTextContent('QueuedWaiting to download');

    fireEvent.click(chip(/^Downloading/));
    expect(rowTitles()).toEqual(['The Matrix']);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'matrix' } });
    expect(rowTitles()).toEqual(['The Matrix']);
    expect(chipNames()).toEqual(['All2', 'Downloading1', 'Ready1']);
  });

  it('keeps the active chip when nothing is left under it, saying so, with a way back to all of them', async () => {
    let mine = [
      myRequest({ key: 'movie-1', title: 'Amélie', Status: 'Requested' }),
      myRequest({ key: 'movie-2', title: 'The Matrix', Status: 'Downloading' }),
    ];
    const { ctx } = await loadAs(false, () => ({ Requests: mine }));
    render(<MyRequestsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'My requests' });
    expect(chipNames()).toEqual(['All2', 'Pending1', 'Downloading1']);

    fireEvent.click(chip(/^Pending/));
    expect(rowTitles()).toEqual(['Amélie']);
    // Approved meanwhile: a check moves it on.
    mine = [{ ...mine[0]!, Status: 'Queued' }, mine[1]!];
    await act(() => refreshRequestProgress());
    expect(chipNames()).toEqual(['All2', 'Pending0', 'Queued1', 'Downloading1']);
    expect(chip(/^Pending/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Nothing is waiting for approval')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all requests' }));
    expect(rowTitles()).toHaveLength(2);
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
    // No longer active, and empty: gone.
    expect(chipNames()).toEqual(['All2', 'Queued1', 'Downloading1']);
  });

  it('moves focus to the chip in its place when a check takes away the one it was on', async () => {
    let mine = [
      myRequest({ key: 'movie-1', title: 'Amélie', Status: 'Requested' }),
      myRequest({ key: 'movie-2', title: 'The Matrix', Status: 'Queued' }),
    ];
    const { ctx } = await loadAs(false, () => ({ Requests: mine }), undefined, 'tv');
    render(<MyRequestsView ctx={ctx} />);
    const list = await screen.findByRole('list', { name: 'My requests' });
    // The TV's first focus, the newest request, before the remote moves up to the chips.
    await waitFor(() => expect(within(list).getAllByRole('link')[0]).toHaveFocus());

    // Resting on Pending (All is the active one): it goes, and the next chip takes focus.
    act(() => chip(/^Pending/).focus());
    mine = [{ ...mine[0]!, Status: 'Queued' }, mine[1]!];
    await act(() => refreshRequestProgress());
    expect(chipNames()).toEqual(['All2', 'Queued2']);
    expect(chip(/^Queued/)).toHaveFocus();

    // The last one goes: the one before it.
    mine = mine.map((r) => ({ ...r, Status: 'Ready' as const }));
    await act(() => refreshRequestProgress());
    expect(chipNames()).toEqual(['All2', 'Ready2']);
    expect(chip(/^Ready/)).toHaveFocus();
    mine = mine.map((r) => ({ ...r, Status: 'Failed' as const }));
    await act(() => refreshRequestProgress());
    expect(chipNames()).toEqual(['All2', 'Failed2']);
    expect(chip(/^Failed/)).toHaveFocus();

    // Focus elsewhere stays where it is.
    const first = within(screen.getByRole('list', { name: 'My requests' })).getAllByRole('link')[0]!;
    act(() => first.focus());
    mine = mine.map((r) => ({ ...r, Status: 'Declined' as const }));
    await act(() => refreshRequestProgress());
    expect(chipNames()).toEqual(['All2', 'Declined2']);
    expect(within(screen.getByRole('list', { name: 'My requests' })).getAllByRole('link')[0]).toHaveFocus();
  });

  describe('opened from a title page’s status', () => {
    const at = (key: string) => window.history.replaceState(null, '', `#/home?lumen=requests&request=${key}`);
    afterEach(() => window.history.replaceState(null, '', '#/'));

    it('scrolls to that request and lights it up, under All', async () => {
      const scroll = vi.fn();
      const had = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scroll;
      try {
        at('tv-3');
        const { ctx } = await loadAs(false, list);
        render(<MyRequestsView ctx={ctx} />);
        const rows = within(await screen.findByRole('list', { name: 'My requests' })).getAllByRole('link');
        expect(rows).toHaveLength(5);
        expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
        expect(rows.filter((r) => r.classList.contains('is-found'))).toEqual([rows[2]]);
        await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
        expect(scroll.mock.contexts[0]).toBe(rows[2]);
        // Lit up once: gone when its moment is over.
        fireEvent.animationEnd(rows[2]!);
        expect(rows[2]).not.toHaveClass('is-found');
      } finally {
        Element.prototype.scrollIntoView = had;
      }
    });

    it('gives that request the first focus on a TV', async () => {
      at('movie-4');
      const { ctx } = await loadAs(false, list, undefined, 'tv');
      render(<MyRequestsView ctx={ctx} />);
      const rows = within(await screen.findByRole('list', { name: 'My requests' })).getAllByRole('link');
      await waitFor(() => expect(rows[3]).toHaveFocus());
      expect(rows[3]).toHaveTextContent('Matrix Reloaded');
    });

    it('with a request not in the list (older than it goes back, say), is the page as usual', async () => {
      at('movie-999');
      const { ctx } = await loadAs(false, list, undefined, 'tv');
      render(<MyRequestsView ctx={ctx} />);
      const rows = within(await screen.findByRole('list', { name: 'My requests' })).getAllByRole('link');
      await waitFor(() => expect(rows[0]).toHaveFocus());
      expect(document.querySelector('.is-found')).toBeNull();
    });

    it('in everyone’s requests, picks the user’s own row for the title', async () => {
      window.localStorage.setItem(everyoneKey('user1'), '1');
      at('movie-603');
      // The user's own list hasn't got it (yet): their row is known by who asked.
      const { ctx } = await loadAs(true, [], {
        Requests: [
          myRequest({ RequestIds: [2], RequestedBy: { Name: 'kid', UserId: 'kid1' } }),
          myRequest({ RequestIds: [1], Status: 'Ready', RequestedBy: { Name: 'me', UserId: 'user1' } }),
        ],
        Partial: false,
      });
      render(<MyRequestsView ctx={ctx} />);
      await waitFor(() => expect(document.querySelectorAll('.lmn-request__by')).toHaveLength(2));
      const found = document.querySelectorAll('.lmn-request.is-found');
      expect(found).toHaveLength(1);
      expect(found[0]).toHaveTextContent('Requested by me');
    });
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
    expect(chipNames()).toEqual(['All4', 'Pending1', 'Downloading1', 'Ready1', 'Failed1']);

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
      <RequestProgressBlock request={myRequest({ SecondsLeft: 600 })} receivedAt={Date.now() - 120_000} />,
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

  it('says Pending while it waits for approval, and Downloading while it’s added to the library, as My requests does', async () => {
    const ctx = await load([
      myRequest({ Status: 'Requested', Percent: null, SecondsLeft: null }),
      myRequest({
        key: 'movie-604',
        title: 'Reloaded',
        Status: 'Processing',
        Percent: 100,
        SecondsLeft: null,
      }),
    ]);
    const card = (key: string, title: string) =>
      render(
        <CatalogCard
          item={{ ...myRequest().Item, Key: key, Title: title, State: 'Requested' }}
          client={ctx.client}
          imageToken="t"
          variant="poster"
          onSelect={() => {}}
        />,
      );
    card('movie-603', 'The Matrix');
    card('movie-604', 'Reloaded');

    expect(screen.getByRole('button', { name: 'The Matrix, Pending' })).toBeInTheDocument();
    const processing = screen.getByRole('button', { name: 'Reloaded, Downloading, Adding to your library' });
    expect(processing.querySelector('.lmn-card__state')).toHaveTextContent('Downloading');
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
