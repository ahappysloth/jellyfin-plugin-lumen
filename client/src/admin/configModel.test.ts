import { describe, expect, it } from 'vitest';
import type { LumenConfig, SectionDef, SectionParamDef, SectionTypeDef } from './adminApi';
import {
  canAdd,
  getParam,
  isRepeatable,
  moveSectionTo,
  newSection,
  normalizeConfig,
  normalizeId,
  removeSection,
  sameConfig,
  setParam,
} from './configModel';

const section = (id: string): SectionDef => ({
  Id: id,
  Type: 'NextUp',
  Enabled: true,
  Title: null,
  Params: [],
});

describe('configModel', () => {
  it('normalizes a numeric hero source', () => {
    expect(normalizeConfig({ HeroSource: 2, Sections: [] } as unknown as LumenConfig).HeroSource).toBe(
      'Collection',
    );
  });

  it('moves sections within bounds only, and removes them', () => {
    const list = [section('a'), section('b'), section('c')];
    expect(moveSectionTo(list, 0, 1).map((s) => s.Id)).toEqual(['b', 'a', 'c']);
    expect(moveSectionTo(list, 0, 2).map((s) => s.Id)).toEqual(['b', 'c', 'a']);
    expect(moveSectionTo(list, 2, 0).map((s) => s.Id)).toEqual(['c', 'a', 'b']);
    expect(moveSectionTo(list, 0, -1)).toBe(list);
    expect(moveSectionTo(list, 1, 3)).toBe(list);
    expect(moveSectionTo(list, 1, 1)).toBe(list);
    expect(removeSection(list, 1).map((s) => s.Id)).toEqual(['a', 'c']);
  });

  it('creates sections with default parameter values', () => {
    const created = newSection(
      {
        Type: 'Genre',
        DisplayName: 'Genre rows',
        Parameters: [
          {
            Name: 'genreCount',
            Label: 'n',
            Kind: 'Integer',
            Required: false,
            DefaultValue: '3',
            Min: 1,
            Max: 6,
          },
          { Name: 'x', Label: 'x', Kind: 'Text', Required: false, DefaultValue: null, Min: null, Max: null },
        ],
      },
      'id1',
    );
    expect(created).toEqual({
      Id: 'id1',
      Type: 'Genre',
      Enabled: true,
      Title: null,
      Params: [{ Name: 'genreCount', Value: '3' }],
    });
  });

  it('treats a parameter whose DefaultValue is omitted (undefined) as having no default', () => {
    const created = newSection(
      {
        Type: 'Genre',
        DisplayName: 'Genre rows',
        Parameters: [{ Name: 'x', Label: 'x', Kind: 'Text', Required: false, Min: null, Max: null } as never],
      },
      'id2',
    );
    expect(created.Params).toEqual([]);
  });

  it('sets, replaces, and clears parameters case-insensitively', () => {
    let s = setParam(section('a'), 'libraryId', 'L1');
    s = setParam(s, 'LIBRARYID', 'L2');
    expect(getParam(s, 'libraryid')).toBe('L2');
    expect(setParam(s, 'libraryId', '').Params).toEqual([]);
  });

  it('normalizes ids for comparison', () => {
    expect(normalizeId('AB-CD')).toBe('abcd');
    expect(normalizeId(null)).toBe('');
  });

  describe('section types on the home screen more than once', () => {
    const param = (Kind: string): SectionParamDef => ({
      Name: 'p',
      Label: 'P',
      Kind,
      Required: false,
      DefaultValue: null,
      Min: null,
      Max: null,
    });
    const type = (Type: string, ...kinds: string[]): SectionTypeDef => ({
      Type,
      DisplayName: Type,
      Parameters: kinds.map(param),
    });

    it('are the ones that pick a source: a library, collection, playlist or tag', () => {
      expect(isRepeatable(type('RecentlyAdded', 'Library'))).toBe(true);
      expect(isRepeatable(type('Curated', 'Collection', 'Playlist', 'Text'))).toBe(true);
      expect(isRepeatable(type('Playlisted', 'Playlist'))).toBe(true);
      expect(isRepeatable(type('NextUp'))).toBe(false);
      expect(isRepeatable(type('Genre', 'Integer'))).toBe(false);
    });

    it('can be added again; any other type only while it is not in the list', () => {
      const sections = [section('a')]; // NextUp
      expect(canAdd(type('NextUp'), sections)).toBe(false);
      expect(canAdd(type('NextUp'), [])).toBe(true);
      expect(canAdd(type('Trending', 'Integer'), sections)).toBe(true);
      expect(canAdd(type('NextUp', 'Library'), sections)).toBe(true);
    });
  });
});

describe('sameConfig', () => {
  const loaded = (): LumenConfig =>
    ({
      ConfigVersion: 3,
      Enabled: true,
      AccentColor: '#E30B17',
      HeroSource: 'RecentlyAdded',
      HeroCollectionId: null,
      SeerrUrl: null,
      SeerrApiKeySet: true,
      TraktClientIdSet: true,
      ClearTraktClientId: false,
      Sections: [
        {
          Id: 'a',
          Type: 'RecentlyAdded',
          Enabled: true,
          Title: null,
          Params: [
            { Name: 'libraryId', Value: '0F3A1C2B-4D5E-6F70-8192-A3B4C5D6E7F8' },
            { Name: 'limit', Value: '20' },
          ],
        },
        section('b'),
      ],
    }) as unknown as LumenConfig;

  it('sees a real change', () => {
    expect(sameConfig(loaded(), { ...loaded(), Enabled: false })).toBe(false);
    expect(sameConfig(loaded(), { ...loaded(), SeerrUrl: 'http://seerr:5055' })).toBe(false);
    expect(sameConfig(loaded(), { ...loaded(), SeerrApiKey: 'new-key' })).toBe(false);
    expect(sameConfig(loaded(), { ...loaded(), TraktClientId: 'new-id' })).toBe(false);
    expect(sameConfig(loaded(), { ...loaded(), TraktClientId: '', ClearTraktClientId: true })).toBe(false);
    expect(sameConfig(loaded(), { ...loaded(), AccentColor: '#00a4dc' })).toBe(false);
    const sections = loaded().Sections;
    expect(sameConfig(loaded(), { ...loaded(), Sections: moveSectionTo(sections, 0, 1) })).toBe(false);
    expect(
      sameConfig(loaded(), { ...loaded(), Sections: [setParam(sections[0]!, 'limit', '30'), sections[1]!] }),
    ).toBe(false);
  });

  it('a switch turned on and off again, or a section moved down and back up, is no change', () => {
    const twice = { ...loaded(), Enabled: false };
    expect(sameConfig(loaded(), { ...twice, Enabled: true })).toBe(true);
    const sections = moveSectionTo(moveSectionTo(loaded().Sections, 0, 1), 1, 0);
    expect(sameConfig(loaded(), { ...loaded(), Sections: sections })).toBe(true);
  });

  it('a value typed and deleted again is no change: empty, null and absent are the same', () => {
    expect(sameConfig(loaded(), { ...loaded(), SeerrUrl: '' })).toBe(true);
    expect(sameConfig(loaded(), { ...loaded(), HeroCollectionId: '' })).toBe(true);
    const titled = { ...loaded().Sections[1]!, Title: '' };
    expect(sameConfig(loaded(), { ...loaded(), Sections: [loaded().Sections[0]!, titled] })).toBe(true);
  });

  it('a key typed into its field and cleared again is no change', () => {
    // The server never sends a key, only whether one is saved; the field sends '' once typed into.
    expect(sameConfig(loaded(), { ...loaded(), SeerrApiKey: '' })).toBe(true);
    expect(sameConfig(loaded(), { ...loaded(), TraktClientId: '', ClearTraktClientId: false })).toBe(true);
    const noFlag = { ...loaded() };
    delete noFlag.ClearTraktClientId;
    expect(sameConfig(noFlag, { ...loaded(), TraktClientId: '' })).toBe(true);
  });

  it('compares a parameter set changed and changed back regardless of order, and ids and colours regardless of case', () => {
    const [first, second] = loaded().Sections;
    const edited = setParam(
      setParam(first!, 'libraryId', 'x'),
      'libraryId',
      '0f3a1c2b4d5e6f708192a3b4c5d6e7f8',
    );
    // setParam moves the edited parameter to the end.
    expect(edited.Params.map((p) => p.Name)).toEqual(['limit', 'libraryId']);
    expect(sameConfig(loaded(), { ...loaded(), Sections: [edited, second!] })).toBe(true);
    expect(sameConfig(loaded(), { ...loaded(), AccentColor: '#e30b17' })).toBe(true);
    // As the server may send it: the hero source as a number.
    expect(sameConfig(loaded(), { ...loaded(), HeroSource: 0 })).toBe(true);
  });
});
