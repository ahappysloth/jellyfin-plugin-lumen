import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { updateManifest } from './update-manifest.mjs';

test('adds a version entry with the zip checksum, newest first, replacing an existing entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-manifest-'));
  const manifestPath = join(dir, 'manifest.json');
  const zipPath = join(dir, 'lumen.zip');
  writeFileSync(zipPath, 'zip-bytes');
  writeFileSync(
    manifestPath,
    JSON.stringify([{ guid: '186f9cb8-ba8e-4555-a700-ffa619f48264', name: 'Lumen', versions: [{ version: '0.1.0.0', changelog: 'old' }] }]),
  );

  updateManifest({ manifestPath, version: '0.2.0.0', zipPath, url: 'https://x/0.2.zip', changelog: 'new', now: new Date('2026-10-06T00:00:00Z') });
  updateManifest({ manifestPath, version: '0.2.0.0', zipPath, url: 'https://x/0.2b.zip', changelog: 'newer', now: new Date('2026-10-06T00:00:00Z') });

  const [plugin] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(plugin.versions.map((v) => v.version), ['0.2.0.0', '0.1.0.0']);
  assert.deepEqual(plugin.versions[0], {
    version: '0.2.0.0',
    changelog: 'newer',
    targetAbi: '12.1.0.0',
    sourceUrl: 'https://x/0.2b.zip',
    checksum: createHash('md5').update('zip-bytes').digest('hex'),
    timestamp: '2026-10-06T00:00:00Z',
  });
});
