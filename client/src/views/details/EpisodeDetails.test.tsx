import { render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import { infoHash } from '../cardMenu';
import { DetailsView } from './DetailsView';
import { episodeCast } from './EpisodeDetails';

const series = {
  Id: 'sr',
  Name: 'Lumen Show',
  Type: 'Series',
  ServerId: 'srv',
  People: [
    { Id: 'a1', Name: 'Ada Lead', Type: 'Actor' },
    { Id: 'g1', Name: 'Gus Guest', Type: 'Actor' },
  ],
};
const seasons = {
  Items: [
    { Id: 's1', Name: 'Season 1', Type: 'Season', IndexNumber: 1 },
    { Id: 's2', Name: 'Season 2', Type: 'Season', IndexNumber: 2 },
  ],
};
const episode = (season: number, n: number) => ({
  Id: `s${season}e${n}`,
  Name: `Episode ${n}`,
  Type: 'Episode',
  ServerId: 'srv',
  SeriesId: 'sr',
  SeriesName: 'Lumen Show',
  SeasonId: `s${season}`,
  ParentIndexNumber: season,
  IndexNumber: n,
  PremiereDate: '2010-03-04T00:00:00.0000000Z',
  RunTimeTicks: 27_000_000_000,
  Overview: `Overview ${season}.${n}`,
  ImageTags: { Primary: 'still' },
  People: [{ Id: 'g1', Name: 'Gus Guest', Type: 'GuestStar' }],
});

function setup(id: string) {
  const client = createFakeClient(
    routes({
      'Items/sr': series,
      [`Items/${id}`]: episode(Number(id[1]), Number(id[3])),
      'Shows/sr/Seasons': seasons,
      'Shows/sr/Episodes': (r: AjaxRequest) => {
        const s = Number(new URL(r.url).searchParams.get('seasonId')!.slice(1));
        return { Items: [1, 2, 3].map((n) => episode(s, n)) };
      },
    }),
  );
  render(<DetailsView id={id} ctx={makeContext(client)} />);
  return client;
}

describe('EpisodeDetails', () => {
  it('shows the episode with its show, number, air date and runtime, and plays it', async () => {
    setup('s1e2');

    expect(await screen.findByRole('heading', { name: 'Episode 2', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lumen Show' })).toHaveAttribute(
      'href',
      '#/details?id=s1&serverId=srv',
    );
    expect(screen.getByText('S1:E2')).toBeInTheDocument();
    expect(screen.getByText('Mar 4, 2010')).toBeInTheDocument();
    expect(screen.getByText('45m')).toBeInTheDocument();
    expect(screen.getByText('Overview 1.2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('links the previous and next episodes and lists the season with this one marked', async () => {
    setup('s1e2');

    expect(await screen.findByRole('link', { name: 'Previous episode: S1:E1 · Episode 1' })).toHaveAttribute(
      'href',
      '#/details?id=s1e1&serverId=srv',
    );
    expect(screen.getByRole('link', { name: 'Next episode: S1:E3 · Episode 3' })).toBeInTheDocument();
    const row = screen.getByRole('region', { name: 'More from Season 1' });
    expect(within(row).getAllByRole('button')).toHaveLength(3);
    expect(row.querySelector('[aria-current="page"]')).toHaveAttribute('data-item-id', 's1e2');
  });

  it("crosses into the next season after a season's last episode", async () => {
    setup('s1e3');

    expect(await screen.findByRole('link', { name: 'Next episode: S2:E1 · Episode 1' })).toHaveAttribute(
      'href',
      '#/details?id=s2e1&serverId=srv',
    );
  });

  it('has no next link after the last episode of the show', async () => {
    setup('s2e3');

    expect(
      await screen.findByRole('link', { name: 'Previous episode: S2:E2 · Episode 2' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Next episode/ })).toBeNull();
  });

  it('lists guest stars before the main cast, each once', () => {
    const cast = episodeCast(episode(1, 1) as never, series as never);
    expect(cast.map((p) => p.Name)).toEqual(['Gus Guest', 'Ada Lead']);
  });

  it("opens an episode card's More info on the episode's own page", () => {
    expect(infoHash(episode(1, 1) as never)).toBe('#/details?id=s1e1&serverId=srv');
  });
});
