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

/** The list with the section at `from` taken out and put back in at `to` (an index in the list as it ends up). */
export function moveSectionTo(sections: SectionDef[], from: number, to: number): SectionDef[] {
  if (from === to || from < 0 || from >= sections.length || to < 0 || to >= sections.length) return sections;
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
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

/** A Jellyfin item id, with or without dashes, in either case. */
const GUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * A value as the comparison sees it. Empty, null and absent are one value: a field typed into and cleared again comes
 * back as '' where the server sent null (a section's title, the Seerr address), and a write-only key field (Seerr's,
 * Trakt's) the server never sends at all. Ids compare as normalizeId writes them, since a picker's id and the stored one
 * may differ in dashes or case. Object keys are sorted, and keys without a value dropped.
 */
function comparable(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return GUID.test(value) ? normalizeId(value) : value;
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = comparable((value as Record<string, unknown>)[key]);
    if (v !== null) out[key] = v;
  }
  return out;
}

/** What a configuration says, without the differences that don't change it. See sameConfig. */
function canonical(config: LumenConfig): string {
  const c = normalizeConfig(config);
  return JSON.stringify(
    comparable({
      ...c,
      // The colour input writes lower case; the server may store upper.
      AccentColor: c.AccentColor?.toLowerCase(),
      // Only says something with a stored key to remove; false is the same as not there.
      ClearTraktClientId: !!c.ClearTraktClientId || null,
      // A section's parameters are a set (setParam moves an edited one to the end, getParam ignores case).
      Sections: c.Sections.map((s) => ({
        ...s,
        Params: s.Params.map((p) => ({ Name: p.Name.toLowerCase(), Value: p.Value })).sort((a, b) =>
          a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0,
        ),
      })),
    }),
  );
}

/**
 * Whether two configurations would save the same: what "unsaved changes" means. A switch turned on and off again, a
 * section moved down and back up, a value typed and deleted, or a key typed into its field and cleared again all leave
 * the configuration the same as it was loaded.
 */
export function sameConfig(a: LumenConfig, b: LumenConfig): boolean {
  return a === b || canonical(a) === canonical(b);
}
