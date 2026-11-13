import { isPublicAddress, normalizePublicAddress } from '../util/publicAddress';
import type { LumenConfig } from './adminApi';
import { Card, Field, Switch, inputValue } from './controls';

export function GeneralSettings({
  config,
  update,
}: {
  config: LumenConfig;
  update: (patch: Partial<LumenConfig>) => void;
}) {
  const address = config.QuickConnectAddress ?? '';
  const addressOk = isPublicAddress(address);
  // What the QR code will open, as the sign-in screen builds it (views/quickconnect/model.ts qrBase, approveUrl): an
  // address copied with jellyfin-web's /web/ on the end loses it, and this shows that it did.
  const qrLink = addressOk && address.trim() ? `${normalizePublicAddress(address)}/web/#/quickconnect` : null;
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
      <Switch
        label="Name the home-screen app after this server"
        hint="When off, the app is called Lumen. An icon already on a phone's home screen keeps its name until it's removed and added again."
        checked={config.AppNameFromServer ?? false}
        onChange={(v) => update({ AppNameFromServer: v })}
      />
      <Field
        label="Public address for QR codes"
        hint={
          addressOk
            ? `Where phones reach this server, like https://jellyfin.example.com (with its base path, if it has one). Quick Connect's QR code on the sign-in page opens it. Leave empty to use the address the TV or computer showing the code uses: set it when that's a LAN address your phones can't reach or aren't signed in at.${qrLink ? ` QR codes will open: ${qrLink}` : ''}`
            : 'Enter an http:// or https:// address without a ? or #, like https://jellyfin.example.com, at most 75 characters.'
        }
      >
        <input
          type="url"
          name="lumen-quick-connect-address"
          inputMode="url"
          autoComplete="off"
          spellcheck={false}
          placeholder="https://jellyfin.example.com"
          aria-invalid={addressOk ? undefined : 'true'}
          value={address}
          onInput={(e) => update({ QuickConnectAddress: inputValue(e) })}
        />
      </Field>
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
