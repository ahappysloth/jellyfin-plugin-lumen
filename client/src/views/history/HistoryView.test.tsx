import { render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { setJellyfinLocale } from '../../../test/locale';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { clearBrowseState } from '../browse/browseStore';
import { clearUserData } from '../userDataStore';
import { HistoryView, historyCells, playedDay, playedOnly } from './HistoryView';

const at = (date: Date, hour: number): string => {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const played = (item: Partial<BaseItem> & { Id: string }, when?: string): BaseItem =>
  ({ Name: item.Id, Type: 'Movie', ...item, UserData: when ? { LastPlayedDate: when } : {} }) as BaseItem;

describe('playedOnly', () => {
  it('keeps titles up to the first one never played (those sort last)', () => {
    const page = {
      Items: [played({ Id: 'a' }, at(new Date(), 9)), played({ Id: 'b' }), played({ Id: 'c' })],
      TotalRecordCount: 300,
    };
    expect(playedOnly(page).Items.map((i) => i.Id)).toEqual(['a']);
    const all = { Items: [played({ Id: 'a' }, at(new Date(), 9))], TotalRecordCount: 1 };
    expect(playedOnly(all)).toBe(all);
  });
});

describe('playedDay', () => {
  const now = new Date(2026, 10, 11, 20);
  let restoreLocale: () => void;
  beforeEach(() => {
    restoreLocale = setJellyfinLocale('en-US');
  });
  afterEach(() => restoreLocale());

  it('says Today and Yesterday, then the date, with the year only for other years', () => {
    expect(playedDay(played({ Id: 'a' }, at(now, 8)), now)).toEqual({ key: '2026-11-11', label: 'Today' });
    expect(playedDay(played({ Id: 'a' }, at(new Date(2026, 10, 10), 23)), now).label).toBe('Yesterday');
    expect(playedDay(played({ Id: 'a' }, at(new Date(2026, 10, 6), 12)), now).label).toBe('Fri, Nov 6');
    expect(playedDay(played({ Id: 'a' }, at(new Date(2025, 11, 31), 12)), now).label).toBe(
      'Wed, Dec 31, 2025',
    );
  });

  it('crosses month and year boundaries for Yesterday', () => {
    const newYear = new Date(2027, 0, 1, 9);
    expect(playedDay(played({ Id: 'a' }, at(new Date(2026, 11, 31), 22)), newYear).label).toBe('Yesterday');
  });
});

const episode = (id: string, series: string, n: number, when = at(new Date(), 20)): BaseItem =>
  played(
    {
      Id: id,
      Name: `Episode ${n}`,
      Type: 'Episode',
      SeriesId: series,
      SeriesName: `Show ${series}`,
      ParentIndexNumber: 1,
      IndexNumber: n,
      ServerId: 's',
    },
    when,
  );

describe('historyCells', () => {
  it("makes a run of one show's episodes one card for the show, with the latest's art and no menu", () => {
    const cells = historyCells([
      episode('a6', 'A', 6),
      episode('a5', 'A', 5),
      episode('a4', 'A', 4),
      played({ Id: 'm1', Name: 'Movie' }, at(new Date(), 19)),
      episode('a3', 'A', 3),
      episode('b1', 'B', 1),
      episode('b2', 'B', 2),
    ]);
    expect(cells.map((c) => [c.item.Id, c.item.Type, c.caption, c.artItem?.Id, !!c.menu])).toEqual([
      ['A', 'Series', '3 episodes', 'a6', false],
      ['m1', 'Movie', undefined, undefined, true],
      // On its own: an episode as usual.
      ['a3', 'Episode', 'S1:E3 · Episode 3', undefined, true],
      ['B', 'Series', '2 episodes', 'b1', false],
    ]);
    expect(cells[0]!.item).toMatchObject({ Name: 'Show A', ServerId: 's' });
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
  });
});

describe('HistoryView', () => {
  afterEach(() => {
    clearBrowseState();
    clearUserData();
  });

  it('lists what the user played, newest first, by day; episodes under their show', async () => {
    let query: URLSearchParams | null = null;
    const items = [
      played(
        {
          Id: 'e1',
          Name: 'Pilot',
          Type: 'Episode',
          SeriesName: 'Lumen Show',
          ParentIndexNumber: 1,
          IndexNumber: 1,
        },
        at(new Date(), 21),
      ),
      played({ Id: 'm1', Name: 'Lumen Alpha' }, at(new Date(), 9)),
      played({ Id: 'm2', Name: 'Lumen Beta' }, at(daysAgo(1), 20)),
      played({ Id: 'm3', Name: 'Never Played' }),
    ];
    const ctx = makeContext(
      createFakeClient(
        routes({
          Items: (r: AjaxRequest) => {
            query = new URL(r.url).searchParams;
            return { Items: items, TotalRecordCount: 40 };
          },
        }),
      ),
    );
    render(<HistoryView ctx={ctx} />);

    expect(screen.getByRole('heading', { name: 'History', level: 1 })).toBeInTheDocument();
    const today = await screen.findByRole('list', { name: 'Today' });
    expect(within(today).getByRole('link', { name: /^Lumen Show ?S1:E1 · Pilot$/ })).toBeInTheDocument();
    expect(within(today).getByRole('link', { name: 'Lumen Alpha' })).toBeInTheDocument();
    const yesterday = screen.getByRole('list', { name: 'Yesterday' });
    expect(within(yesterday).getByRole('link', { name: 'Lumen Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Never Played' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Today',
      'Yesterday',
    ]);

    // D-pad: the day sections don't wall focus in (Down from Today reaches Yesterday): only Left/Right stay in a grid.
    for (const grid of [today, yesterday]) {
      expect(grid).toHaveClass('focuscontainer-x');
      expect(grid).not.toHaveClass('focuscontainer');
    }

    expect(query!.get('sortBy')).toBe('DatePlayed');
    // Never counted: that would be a second query over the whole library.
    expect(query!.get('enableTotalRecordCount')).toBe('false');
    expect(query!.get('sortOrder')).toBe('Descending');
    expect(query!.get('includeItemTypes')).toBe('Movie,Episode');
  });

  it("shows a run of a show's episodes on one day as one card that opens the show", async () => {
    const ctx = makeContext(
      createFakeClient(
        routes({
          Items: {
            Items: [episode('a3', 'A', 3), episode('a2', 'A', 2), episode('a1', 'A', 1, at(daysAgo(1), 20))],
            TotalRecordCount: 0,
          },
        }),
      ),
    );
    render(<HistoryView ctx={ctx} />);
    const today = await screen.findByRole('list', { name: 'Today' });
    const card = within(today).getByRole('link', { name: /^Show A ?2 episodes$/ });
    expect(card).toHaveAttribute('href', expect.stringContaining('id=A'));
    expect(within(today).getAllByRole('link')).toHaveLength(1);
    // The run stops at the day: yesterday's episode is its own card.
    const yesterday = screen.getByRole('list', { name: 'Yesterday' });
    expect(within(yesterday).getByRole('link', { name: /^Show A ?S1:E1 · Episode 1$/ })).toBeInTheDocument();
  });

  it('says so when nothing has been watched', async () => {
    const ctx = makeContext(
      createFakeClient(routes({ Items: { Items: [played({ Id: 'm' })], TotalRecordCount: 1 } })),
    );
    render(<HistoryView ctx={ctx} />);
    expect(await screen.findByText('Nothing watched yet')).toBeInTheDocument();
  });
});
