import { afterEach, describe, expect, it } from 'vitest';
import type { BaseItem, HomeResponse } from '../api/types';
import { resetSessionCaches } from '../util/sessionCaches';
import {
  clearCachedHome,
  getCachedHome,
  getSelection,
  rememberSelection,
  setCachedHome,
} from './home/homeStore';
import { forgetItem, OUTRANKS_MS, rememberEdit, withLocalChanges } from './itemChanges';

const movie = (Id: string, extra: Partial<BaseItem> = {}): BaseItem => ({
  Id,
  Name: Id,
  Type: 'Movie',
  ...extra,
});
const episode = (Id: string, SeriesId: string, SeasonId: string): BaseItem => ({
  Id,
  Name: Id,
  Type: 'Episode',
  SeriesId,
  SeasonId,
});

/** Home as /Lumen/Home serves it, still listing whatever was deleted or renamed in the last 30 s. */
const served = (): HomeResponse => ({
  ConfigVersion: 1,
  Hero: [{ Item: movie('a'), TrailerItemId: null }],
  Rows: [
    { Id: 'latest', Type: 'Latest', Title: 'Latest', Items: [movie('a'), movie('b'), movie('c')] },
    {
      Id: 'next',
      Type: 'NextUp',
      Title: 'Next up',
      Items: [episode('e1', 'show', 's1'), episode('e2', 'other', 's9')],
    },
  ],
});
const ids = (home: HomeResponse) => home.Rows.map((r) => `${r.Id}: ${r.Items.map((i) => i.Id).join(' ')}`);

describe('itemChanges', () => {
  afterEach(() => {
    resetSessionCaches();
    clearCachedHome('u1');
  });

  it('keeps titles deleted here out of every home the server still lists them in', () => {
    // Deleted 4 s apart: the second delete falls in the server's 30 s window, so its home still has both.
    forgetItem('u1', 'a');
    forgetItem('u1', 'b');
    const home = withLocalChanges('u1', served());
    expect(home.Hero).toEqual([]);
    expect(ids(home)).toEqual(['latest: c', 'next: e1 e2']);
    // Fetched again later, the same.
    expect(ids(withLocalChanges('u1', served()))).toEqual(['latest: c', 'next: e1 e2']);
  });

  it("leaves out a deleted series' or season's episodes too", () => {
    forgetItem('u1', 'show');
    expect(ids(withLocalChanges('u1', served()))).toEqual(['latest: a b c', 'next: e2']);
    forgetItem('u1', 's9');
    expect(ids(withLocalChanges('u1', served()))).toEqual(['latest: a b c']);
  });

  it('shows a title renamed here by its new name, with its user data as the server has it now', () => {
    rememberEdit('u1', movie('b', { Name: 'B (renamed)', UserData: { Played: false } }));
    const fetched = served();
    fetched.Rows[0]!.Items[1] = movie('b', { UserData: { Played: true } });
    const b = withLocalChanges('u1', fetched).Rows[0]!.Items[1]!;
    expect(b).toEqual(movie('b', { Name: 'B (renamed)', UserData: { Played: true } }));
  });

  it("is for that user only, and the session's only", () => {
    forgetItem('u1', 'a');
    expect(withLocalChanges('u2', served()).Hero).toHaveLength(1);
    resetSessionCaches();
    expect(withLocalChanges('u1', served()).Hero).toHaveLength(1);
  });

  it("gives way to the server's answer once it has caught up", () => {
    forgetItem('u1', 'a');
    rememberEdit('u1', movie('b', { Name: 'B (renamed)' }));
    const later = Date.now() + OUTRANKS_MS;
    const home = withLocalChanges('u1', served(), later);
    // Added back since (the same file has the same id), and renamed again elsewhere: the server knows best by now.
    expect(home.Hero).toHaveLength(1);
    expect(home.Rows[0]!.Items.map((i) => i.Name)).toEqual(['a', 'b', 'c']);
  });

  it('updates the cached home, and moves a selection on the title to the card after it in its row', () => {
    setCachedHome('u1', served());
    rememberSelection('u1', { itemId: 'b', rowId: 'latest', scrollY: 300, top: 120 });
    forgetItem('u1', 'b');
    expect(ids(getCachedHome('u1')!)).toEqual(['latest: a c', 'next: e1 e2']);
    expect(getSelection('u1')).toEqual({ itemId: 'c', rowId: 'latest', scrollY: 300, top: 120 });

    // The last in its row: the card before it.
    forgetItem('u1', 'c');
    expect(getSelection('u1')?.itemId).toBe('a');

    rememberEdit('u1', movie('a', { Name: 'A (renamed)' }));
    expect(getCachedHome('u1')!.Rows[0]!.Items[0]!.Name).toBe('A (renamed)');
  });
});
