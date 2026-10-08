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
