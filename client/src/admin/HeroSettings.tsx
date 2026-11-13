import { Dropdown } from '../components/Dropdown';
import type { LumenConfig } from './adminApi';
import { HERO_LABELS, HERO_SOURCES } from './configModel';
import { Card, Field, NumberField, OptionSelect, Switch } from './controls';
import type { Lookups } from './useAdminConfig';

export function HeroSettings({
  config,
  lookups,
  update,
}: {
  config: LumenConfig;
  lookups: Lookups;
  update: (patch: Partial<LumenConfig>) => void;
}) {
  return (
    <Card title="Hero banner" anchor="hero" intro="The large rotating banner at the top of the home screen.">
      <div class="lmna-grid">
        <Field label="Source">
          <Dropdown
            label="Source"
            hideLabel
            value={String(config.HeroSource)}
            options={HERO_SOURCES.map((s) => ({ value: s, label: HERO_LABELS[s] }))}
            onChange={(v) => update({ HeroSource: v as typeof config.HeroSource })}
          />
        </Field>
        {config.HeroSource === 'Collection' && (
          <Field label="Collection">
            <OptionSelect
              label="Collection"
              options={lookups.Collection}
              value={config.HeroCollectionId ?? ''}
              onChange={(v) => update({ HeroCollectionId: v || null })}
            />
          </Field>
        )}
        <NumberField
          label="Items"
          value={config.HeroCount}
          min={1}
          max={10}
          onChange={(v) => update({ HeroCount: v })}
        />
        <NumberField
          label="Seconds per slide"
          value={config.HeroIntervalSeconds}
          min={3}
          max={60}
          onChange={(v) => update({ HeroIntervalSeconds: v })}
        />
      </div>
      <div style={{ marginTop: '18px' }}>
        <Switch
          label="Play muted trailer previews"
          hint="A title's local trailer, behind the banner and behind details pages."
          checked={config.TrailerPreview}
          onChange={(v) => update({ TrailerPreview: v })}
        />
        {config.TrailerPreview && (
          <>
            <NumberField
              label="Seconds before the trailer starts"
              value={config.TrailerDelaySeconds}
              min={0}
              max={30}
              onChange={(v) => update({ TrailerDelaySeconds: v })}
            />
            <Switch
              label="Let trailers finish before the next slide"
              hint="Off, each slide stays for its seconds and cuts its trailer short. On, a slide whose trailer is playing stays until the trailer ends."
              checked={config.HeroWaitForTrailer}
              onChange={(v) => update({ HeroWaitForTrailer: v })}
            />
            {/* Saved as YouTubeTrailers, its name when YouTube's were the only online trailers: a server that had it on
                keeps it on, IMDb's included. */}
            <Switch
              label="Use online trailers when there's no local one (IMDb, then YouTube)"
              hint="The viewer's browser then loads the trailer from IMDb's video servers (imdb-video.media-imdb.com), or else YouTube's (youtube-nocookie.com), which see its address. Nothing is stored on this server. A local trailer always wins. An IMDb trailer plays like a local one, TVs included; a YouTube trailer keeps its slide until it finishes, and not on TVs."
              checked={!!config.YouTubeTrailers}
              onChange={(v) => update({ YouTubeTrailers: v })}
            />
          </>
        )}
      </div>
    </Card>
  );
}
