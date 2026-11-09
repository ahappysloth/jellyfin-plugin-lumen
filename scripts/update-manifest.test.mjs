import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TARGET_ABI, targetAbiFrom, updateManifest } from './update-manifest.mjs';

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
    targetAbi: TARGET_ABI,
    sourceUrl: 'https://x/0.2b.zip',
    checksum: createHash('md5').update('zip-bytes').digest('hex'),
    timestamp: '2026-10-06T00:00:00Z',
  });
});

test('takes the target ABI from the Jellyfin.Controller package version', () => {
  assert.equal(targetAbiFrom('<PackageVersion Include="Jellyfin.Controller" Version="12.1.0" />'), '12.1.0.0');
  assert.equal(targetAbiFrom('<PackageVersion Include="Jellyfin.Controller" Version="12.3.1.2" />'), '12.3.1.2');
  assert.throws(() => targetAbiFrom('<PackageVersion Include="Jellyfin.Model" Version="12.1.0" />'));
  assert.match(TARGET_ABI, /^\d+\.\d+\.\d+\.\d+$/);
});

test('re-publishing an unchanged release leaves the manifest as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-manifest-'));
  const manifestPath = join(dir, 'manifest.json');
  const zipPath = join(dir, 'lumen.zip');
  writeFileSync(zipPath, 'zip-bytes');
  writeFileSync(manifestPath, JSON.stringify([{ name: 'Lumen', versions: [] }]));
  const publish = (now) =>
    updateManifest({ manifestPath, version: '0.3.0.0', zipPath, url: 'https://x/0.3.zip', changelog: 'c', now });

  publish(new Date('2026-11-01T00:00:00Z'));
  const first = readFileSync(manifestPath, 'utf8');
  publish(new Date('2026-11-02T00:00:00Z'));
  assert.equal(readFileSync(manifestPath, 'utf8'), first);
});
