import { describe, expect, it } from 'vitest';
import type { LumenConfig, SectionDef } from './adminApi';
import {
  getParam,
  moveSection,
  newSection,
  normalizeConfig,
  normalizeId,
  removeSection,
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
    expect(moveSection(list, 0, 1).map((s) => s.Id)).toEqual(['b', 'a', 'c']);
    expect(moveSection(list, 0, -1)).toBe(list);
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
});
