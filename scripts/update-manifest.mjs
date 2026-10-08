// Adds (or replaces) a release in the Jellyfin plugin repository manifest. Usage:
//   node scripts/update-manifest.mjs --version 0.1.0.0 --zip artifacts/lumen_0.1.0.0.zip --url <download url> --changelog "<text>"
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export const TARGET_ABI = '12.1.0.0';

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
