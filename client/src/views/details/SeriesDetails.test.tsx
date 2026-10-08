import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
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
    expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('s1');
    expect(screen.getByText('1. Episode 1')).toBeInTheDocument();
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

    expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('s2');
    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=s2e1&startPositionTicks=50'));
  });

  it('switches seasons and plays an episode', async () => {
    const c = client();
    render(<DetailsView id="sr" ctx={makeContext(c)} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Season' }), { target: { value: 's2' } });
    fireEvent.click(await screen.findByRole('button', { name: /2\. Episode 2/ }));

    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=s2e2'));
  });

  it('opens a season route as its series with that season selected', async () => {
    render(<DetailsView id="s2" ctx={makeContext(client())} />);

    expect(await screen.findByRole('heading', { name: 'Lumen Show' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('s2'));
  });

  it('labels season 0 as Specials', async () => {
    render(<DetailsView id="sr" ctx={makeContext(client())} />);

    expect(await screen.findByRole('option', { name: 'Specials' })).toBeInTheDocument();
  });
});
