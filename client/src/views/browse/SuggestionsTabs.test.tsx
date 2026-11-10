import { render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import type { BaseItem } from '../../api/types';
import { LibraryView } from './LibraryView';
import { groupByAirDay } from './SuggestionsTabs';
import { resetSessionCaches } from '../../util/sessionCaches';

const LIB = '0123456789abcdef0123456789abcdef';
const item = (Id: string, Type = 'Movie', extra: Partial<BaseItem> = {}): BaseItem => ({
  Id,
  Name: Id,
  Type,
  ServerId: 's',
  ...extra,
});
const type = (r: AjaxRequest) => new URL(r.url).searchParams.get('includeItemTypes');

describe('Suggestions tab', () => {
  afterEach(resetSessionCaches);

  it('shows the rows from the last visit at once while they refresh', async () => {
    let answer: (rows: BaseItem[]) => void = () => undefined;
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
        'UserItems/Resume': { Items: [] },
        'Items/Latest': [item('new1')],
        'Movies/Recommendations': [],
      }),
    );
    const first = render(
      <LibraryView id={LIB} collection="movies" tab="suggestions" ctx={makeContext(client)} />,
    );
    expect(await screen.findByText('Latest movies')).toBeInTheDocument();
    first.unmount();

    client.respond = routes({
      [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
      'UserItems/Resume': { Items: [] },
      'Items/Latest': () => new Promise<BaseItem[]>((r) => (answer = r)),
      'Movies/Recommendations': [],
    });
    render(<LibraryView id={LIB} collection="movies" tab="suggestions" ctx={makeContext(client)} />);
    expect(await screen.findByText('Latest movies')).toBeInTheDocument();
    answer([]);
    expect(await screen.findByText(/No suggestions yet/)).toBeInTheDocument();
  });

  it("shows Jellyfin's movie rows, recommendations titled by their reason, and hides empty rows", async () => {
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
        'UserItems/Resume': { Items: [] },
        'Items/Latest': [item('new1')],
        'Movies/Recommendations': [
          {
            RecommendationType: 'SimilarToRecentlyPlayed',
            BaselineItemName: 'Lumen Alpha',
            CategoryId: 'c1',
            Items: [item('r1')],
          },
          {
            RecommendationType: 'HasActorFromRecentlyPlayed',
            BaselineItemName: 'Ada Vance',
            CategoryId: 'c2',
            Items: [item('r2')],
          },
        ],
      }),
    );
    render(<LibraryView id={LIB} collection="movies" tab="suggestions" ctx={makeContext(client)} />);

    expect(await screen.findByRole('region', { name: 'Latest movies' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Because you watched Lumen Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Starring Ada Vance' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Continue watching' })).toBeNull();
  });

  it("shows a show library's continue watching, next up and latest episodes", async () => {
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'TV', Type: 'CollectionFolder' },
        'UserItems/Resume': (r: AjaxRequest) => ({
          Items: type(r) === 'Episode' ? [item('e1', 'Episode')] : [],
        }),
        'Shows/NextUp': { Items: [item('e2', 'Episode')] },
        'Items/Latest': [item('e3', 'Episode')],
      }),
    );
    render(<LibraryView id={LIB} collection="tvshows" tab="suggestions" ctx={makeContext(client)} />);

    expect(await screen.findByRole('region', { name: 'Continue watching' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next up' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Latest episodes' })).toBeInTheDocument();
  });

  it('says so when there is nothing to suggest', async () => {
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
        'UserItems/Resume': { Items: [] },
        'Items/Latest': [],
        'Movies/Recommendations': [],
      }),
    );
    render(<LibraryView id={LIB} collection="movies" tab="suggestions" ctx={makeContext(client)} />);

    expect(await screen.findByText(/No suggestions yet/)).toBeInTheDocument();
  });
});

describe('Upcoming tab', () => {
  it('groups episodes by air day', async () => {
    const soon = new Date();
    soon.setHours(23, 0, 0, 0);
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'TV', Type: 'CollectionFolder' },
        'Shows/Upcoming': {
          Items: [item('u1', 'Episode', { PremiereDate: soon.toISOString(), SeriesName: 'Lumen Show' })],
        },
      }),
    );
    render(<LibraryView id={LIB} collection="tvshows" tab="upcoming" ctx={makeContext(client)} />);

    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getAllByRole('button')).toHaveLength(1);
  });

  it('says so when nothing is scheduled', async () => {
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'TV', Type: 'CollectionFolder' },
        'Shows/Upcoming': { Items: [] },
      }),
    );
    render(<LibraryView id={LIB} collection="tvshows" tab="upcoming" ctx={makeContext(client)} />);

    expect(await screen.findByText('No upcoming episodes.')).toBeInTheDocument();
  });

  it('orders days, labels today and tomorrow, and skips undated episodes', () => {
    const now = new Date(2026, 10, 9, 12);
    const at = (d: number, h = 20) => new Date(2026, 10, d, h).toISOString();
    const groups = groupByAirDay(
      [
        item('c', 'Episode', { PremiereDate: at(13) }),
        item('a', 'Episode', { PremiereDate: at(9) }),
        item('b', 'Episode', { PremiereDate: at(10) }),
        item('x', 'Episode'),
        item('a2', 'Episode', { PremiereDate: at(9, 22) }),
      ],
      now,
    );
    expect(groups.map((g) => g.label.startsWith('Fri') || g.label)).toEqual(['Today', 'Tomorrow', true]);
    expect(groups[0]!.items.map((i) => i.Id)).toEqual(['a', 'a2']);
  });
});
