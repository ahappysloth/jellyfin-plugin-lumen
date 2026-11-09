// Adds (or replaces) a release in the Jellyfin plugin repository manifest. Usage:
//   node scripts/update-manifest.mjs --version 0.1.0.0 --zip artifacts/lumen_0.1.0.0.zip --url <download url> --changelog "<text>"
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * The Jellyfin ABI a release targets: the Jellyfin.Controller version the plugin builds against
 * (Directory.Packages.props), as four parts. Kept in one place so a package bump can't leave the manifest behind.
 */
export function targetAbiFrom(propsXml) {
  const match = /<PackageVersion\s+Include="Jellyfin\.Controller"\s+Version="(\d+(?:\.\d+){1,3})"/.exec(propsXml);
  if (!match) throw new Error('Directory.Packages.props has no Jellyfin.Controller PackageVersion');
  const parts = match[1].split('.');
  while (parts.length < 4) parts.push('0');
  return parts.join('.');
}

export const TARGET_ABI = targetAbiFrom(readFileSync(new URL('../Directory.Packages.props', import.meta.url), 'utf8'));

export function updateManifest({ manifestPath, version, zipPath, url, changelog, now = new Date() }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plugin = manifest[0];
  const entry = {
    version,
    changelog,
    targetAbi: TARGET_ABI,
    sourceUrl: url,
    checksum: createHash('md5').update(readFileSync(zipPath)).digest('hex'),
    timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  // Re-publishing the same release (a re-run) keeps its original timestamp, so the manifest doesn't change.
  const existing = plugin.versions.find((v) => v.version === version);
  if (existing && ['changelog', 'targetAbi', 'sourceUrl', 'checksum'].every((k) => existing[k] === entry[k]))
    entry.timestamp = existing.timestamp;
  plugin.versions = [entry, ...plugin.versions.filter((v) => v.version !== version)];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string', default: 'manifest.json' },
      version: { type: 'string' },
      zip: { type: 'string' },
      url: { type: 'string' },
      changelog: { type: 'string', default: '' },
    },
  });
  updateManifest({ manifestPath: values.manifest, version: values.version, zipPath: values.zip, url: values.url, changelog: values.changelog });
}
