import type { LumenConfig, SectionDef, SectionTypeDef } from './adminApi';

export const HERO_SOURCES = ['RecentlyAdded', 'TopRatedUnplayed', 'Collection'] as const;
export type HeroSourceName = (typeof HERO_SOURCES)[number];
export const HERO_LABELS: Record<HeroSourceName, string> = {
  RecentlyAdded: 'Recently added',
  TopRatedUnplayed: 'Top rated, not yet watched',
  Collection: 'A collection',
};

export function normalizeConfig(config: LumenConfig): LumenConfig {
  const source =
    typeof config.HeroSource === 'number'
      ? (HERO_SOURCES[config.HeroSource] ?? 'RecentlyAdded')
      : config.HeroSource;
  return { ...config, HeroSource: source, Sections: config.Sections ?? [] };
}

export function moveSection(sections: SectionDef[], index: number, delta: -1 | 1): SectionDef[] {
  const target = index + delta;
  if (target < 0 || target >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function removeSection(sections: SectionDef[], index: number): SectionDef[] {
  return sections.filter((_, i) => i !== index);
}

/** Parameter kinds that pick what a section shows (a library, collection, playlist or tag). */
const SOURCE_KINDS = ['Library', 'Collection', 'Playlist', 'Text'];

/**
 * Whether a section type makes sense more than once on the home screen: only one that picks a source (Recently Added in
 * each library, a curated row per collection). A second Next Up or Trending would show the same row twice.
 */
export function isRepeatable(type: SectionTypeDef): boolean {
  return type.Parameters.some((p) => SOURCE_KINDS.includes(p.Kind));
}

/** Whether a type can be added now: repeatable, or not in the list yet (removing it makes it addable again). */
export function canAdd(type: SectionTypeDef, sections: SectionDef[]): boolean {
  return isRepeatable(type) || !sections.some((s) => s.Type === type.Type);
}

export function newSection(type: SectionTypeDef, id: string): SectionDef {
  return {
    Id: id,
    Type: type.Type,
    Enabled: true,
    Title: null,
    Params: type.Parameters.filter((p) => p.DefaultValue != null).map((p) => ({
      Name: p.Name,
      Value: p.DefaultValue as string,
    })),
  };
}

export function getParam(section: SectionDef, name: string): string {
  return section.Params.find((p) => p.Name.toLowerCase() === name.toLowerCase())?.Value ?? '';
}

export function setParam(section: SectionDef, name: string, value: string): SectionDef {
  const rest = section.Params.filter((p) => p.Name.toLowerCase() !== name.toLowerCase());
  return { ...section, Params: value === '' ? rest : [...rest, { Name: name, Value: value }] };
}

export const normalizeId = (id: string | null | undefined): string =>
  (id ?? '').replace(/-/g, '').toLowerCase();
