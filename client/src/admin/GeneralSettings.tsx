import type { LumenConfig } from './adminApi';
import { Card, Field, Switch, inputValue } from './controls';

export function GeneralSettings({
  config,
  update,
}: {
  config: LumenConfig;
  update: (patch: Partial<LumenConfig>) => void;
}) {
  return (
    <Card title="General">
      <Switch
        label="Enable Lumen"
        hint="Off shows Jellyfin's own pages everywhere."
        checked={config.Enabled}
        onChange={(v) => update({ Enabled: v })}
      />
      <Switch
        label="Replace the home screen"
        checked={config.HomeTakeover}
        onChange={(v) => update({ HomeTakeover: v })}
      />
      <Switch
        label="Replace movie and series details pages"
        checked={config.DetailsTakeover}
        onChange={(v) => update({ DetailsTakeover: v })}
      />
      <Switch
        label="Replace the Movies, Shows, Favorites, Search and Settings pages"
        checked={config.LibraryTakeover}
        onChange={(v) => update({ LibraryTakeover: v })}
      />
      <Switch
        label="Restyle Jellyfin's sign-in, settings and Dashboard pages"
        hint="Settings, the Dashboard and the metadata editor keep working as before; only their look changes."
        checked={config.StyleStockPages}
        onChange={(v) => update({ StyleStockPages: v })}
      />
      <Switch
        label="Use Lumen's video player controls"
        hint="Jellyfin's player keeps playing the video; Lumen replaces its controls and menus."
        checked={config.StyleVideoPlayer}
        onChange={(v) => update({ StyleVideoPlayer: v })}
      />
      <Switch
        label="Load Jellyfin's web app faster"
        hint="Sends its files at the best compression, and lets browsers and the Jellyfin apps keep the versioned ones for up to a week. Applies even with Lumen off. Turning it off doesn't clear what they've already kept: that expires within a week."
        checked={config.OptimizeWebClientFiles ?? true}
        onChange={(v) => update({ OptimizeWebClientFiles: v })}
      />
      <Field label="Accent color" hint="Badges, ratings, progress bars and this page's buttons.">
        <input
          type="color"
          value={config.AccentColor}
          onInput={(e) => update({ AccentColor: inputValue(e) })}
        />
      </Field>
    </Card>
  );
}
