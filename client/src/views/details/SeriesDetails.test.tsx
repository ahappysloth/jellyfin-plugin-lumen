import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import * as dialogs from '../../compat/itemMenu';
import { ContextMenuHost } from '../../components/ContextMenu';
import { resetItemMenuUsers } from '../itemMenu/itemMenu';
import { DetailsView } from './DetailsView';

const series = { Id: 'sr', Name: 'Lumen Show', Type: 'Series', ServerId: 's', Overview: 'A series.' };
const seasons = {
  Items: [
    { Id: 'sp', Name: 'Specials', Type: 'Season', IndexNumber: 0 },
    { Id: 's1', Name: 'Season 1', Type: 'Season', IndexNumber: 1 },
    { Id: 's2', Name: 'Season 2', Type: 'Season', IndexNumber: 2 },
  ],
};
const episodes = (seasonId: string) => ({
  Items: [1, 2].map((n) => ({
    Id: `${seasonId}e${n}`,
    Name: `Episode ${n}`,
    Type: 'Episode',
    SeasonId: seasonId,
    ParentIndexNumber: seasonId === 's2' ? 2 : 1,
    IndexNumber: n,
    RunTimeTicks: 9_000_000_000,
  })),
});

function client(nextUp: unknown[] = [], resume: unknown[] = []) {
  return createFakeClient(
    routes({
      'Items/sr': series,
      'Items/s2': { Id: 's2', Name: 'Season 2', Type: 'Season', SeriesId: 'sr' },
      'Shows/sr/Seasons': seasons,
      'Shows/sr/Episodes': (r: AjaxRequest) => episodes(new URL(r.url).searchParams.get('seasonId')!),
      'Shows/NextUp': { Items: nextUp },
      'UserItems/Resume': { Items: resume },
      'Items/sr/Similar': { Items: [] },
      Sessions: [{ Id: 'ss', DeviceId: 'dev+ice' }],
      'Sessions/ss/Playing': {},
    }),
  );
}

describe('SeriesDetails', () => {
  it('defaults to the first regular season and offers Play S1:E1 for a new show', async () => {
    render(<DetailsView id="sr" ctx={makeContext(client())} />);

    expect(await screen.findByRole('button', { name: 'Play S1:E1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Season: Season 1' })).toBeInTheDocument();
    expect(screen.getByText('1. Episode 1')).toBeInTheDocument();
  });

  it('loads the first season once, for both Smart Play and the episode list', async () => {
    const c = client();
    render(<DetailsView id="sr" ctx={makeContext(c)} />);

    await screen.findByText('1. Episode 1');
    const seasonLoads = c.requests.filter((r) => r.url.includes('Shows/sr/Episodes'));
    expect(seasonLoads).toHaveLength(1);
  });

  it('resumes the in-progress episode and selects its season', async () => {
    const resume = [
      {
        Id: 's2e1',
        Name: 'Episode 1',
        Type: 'Episode',
        SeasonId: 's2',
        ParentIndexNumber: 2,
        IndexNumber: 1,
        UserData: { PlaybackPositionTicks: 50 },
      },
    ];
    const c = client([], resume);
    render(<DetailsView id="sr" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume S2:E1/ }));

    expect(screen.getByRole('button', { name: 'Season: Season 2' })).toBeInTheDocument();
    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=s2e1&startPositionTicks=50'));
  });

  it('switches seasons and plays an episode', async () => {
    const c = client();
    render(<DetailsView id="sr" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Season:/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Season 2' }));
    fireEvent.click(await screen.findByRole('button', { name: /2\. Episode 2/ }));

    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=s2e2'));
  });

  it('opens a season route as its series with that season selected', async () => {
    render(<DetailsView id="s2" ctx={makeContext(client())} />);

    expect(await screen.findByRole('heading', { name: 'Lumen Show' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Season: Season 2' })).toBeInTheDocument());
  });

  it('labels season 0 as Specials', async () => {
    render(<DetailsView id="sr" ctx={makeContext(client())} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Season:/ }));
    expect(screen.getByRole('option', { name: 'Specials' })).toBeInTheDocument();
  });

  it('focuses Play in TV layout once it has loaded', async () => {
    render(<DetailsView id="sr" ctx={makeContext(client(), { layout: 'tv' })} />);

    const play = await screen.findByRole('button', { name: 'Play S1:E1' });
    await waitFor(() => expect(play).toHaveFocus());
  });
});

describe("SeriesDetails' season ⋯ menu", () => {
  const admin = { Id: 'user1', Name: 'admin', Policy: { IsAdministrator: true } };
  const season = (id: string, name: string) => ({
    Id: id,
    Name: name,
    Type: 'Season',
    SeriesId: 'sr',
    CanDelete: true,
  });
  beforeEach(() => {
    resetItemMenuUsers();
    vi.spyOn(dialogs, 'canOpenItemDialogs').mockReturnValue(true);
    vi.spyOn(dialogs, 'stockItemCommands').mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  const seasonClient = (season2: () => unknown) => {
    const base = client();
    const respond = base.respond;
    base.respond = (r) => {
      const path = new URL(r.url).pathname;
      if (path === '/Users/user1') return admin;
      if (path === '/Items/sr') return { ...series }; // a new object each time, as the server's JSON is
      if (path === '/Items/s1') return season('s1', 'Season 1');
      if (path === '/Items/s2') return season2();
      return respond(r);
    };
    return base;
  };
  const switchTo = async (name: string) => {
    fireEvent.click(await screen.findByRole('button', { name: /^Season:/ }));
    fireEvent.click(screen.getByRole('option', { name }));
  };

  it("never offers the previous season's menu while the next one's loads", async () => {
    let answer!: (value: unknown) => void;
    const c = seasonClient(() => new Promise((resolve) => (answer = resolve)));
    render(
      <>
        <DetailsView id="sr" ctx={makeContext(c)} />
        <ContextMenuHost />
      </>,
    );
    await screen.findByRole('button', { name: 'More actions for Season 1' });

    await switchTo('Season 2');
    // Season 2 is still being fetched: no ⋯ at all, rather than Season 1's (with its Delete season).
    await waitFor(() => expect(c.requests.some((r) => r.url.includes('Items/s2'))).toBe(true));
    expect(screen.queryByRole('button', { name: /^More actions for Season/ })).toBeNull();

    await act(async () => answer(season('s2', 'Season 2')));
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Season 2' }));
    expect(screen.getByRole('menu', { name: 'More actions for Season 2' })).toBeInTheDocument();
  });

  it("fetches the seasons and the season's episodes again after the season is edited", async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: true, deleted: false });
    const c = seasonClient(() => season('s2', 'Season 2'));
    render(
      <>
        <DetailsView id="sr" ctx={makeContext(c)} />
        <ContextMenuHost />
      </>,
    );
    const button = await screen.findByRole('button', { name: 'More actions for Season 1' });
    await screen.findByText('1. Episode 1');
    const count = (part: string) => c.requests.filter((r) => r.url.includes(part)).length;
    const [seasonLoads, episodeLoads] = [count('Shows/sr/Seasons'), count('Shows/sr/Episodes')];

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit metadata' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await waitFor(() => expect(count('Shows/sr/Seasons')).toBe(seasonLoads + 1));
    await waitFor(() => expect(count('Shows/sr/Episodes')).toBe(episodeLoads + 1));
    // The episodes stay on screen meanwhile.
    expect(screen.getByText('1. Episode 1')).toBeInTheDocument();
  });

  it('fetches seasons and episodes again when the series is reloaded after an edit', async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: true, deleted: false });
    const c = seasonClient(() => season('s2', 'Season 2'));
    render(
      <>
        <DetailsView id="sr" ctx={makeContext(c)} />
        <ContextMenuHost />
      </>,
    );
    await screen.findByText('1. Episode 1');
    const count = (part: string) => c.requests.filter((r) => r.url.includes(part)).length;
    const [seasonLoads, episodeLoads] = [count('Shows/sr/Seasons'), count('Shows/sr/Episodes')];

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Lumen Show' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Identify' }));

    await waitFor(() => expect(count('Shows/sr/Seasons')).toBe(seasonLoads + 1));
    await waitFor(() => expect(count('Shows/sr/Episodes')).toBeGreaterThan(episodeLoads));
    expect(screen.getByText('1. Episode 1')).toBeInTheDocument();
  });
});
