import { describe, expect, it } from 'vitest';
import { describeDevice } from './devices';
import type { HealthCheck } from './healthModel';
import { buildReport, redact } from './report';

const SEERR = 'http://seerr.home.example:5055';
const SEERR_KEY = 'MTczMTQ0NjQwMDAwMGFiY2RlZjEyMzQ1Njc4OQ==';
const TRAKT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const TOKEN = 'f3a9c1d27b8e4f6a9c0d1e2f3a4b5c6d';

const check = (over: Partial<HealthCheck>): HealthCheck => ({
  Id: 'x',
  Group: 'Server',
  Status: 'Ok',
  Title: 'X',
  Message: 'Fine.',
  ...over,
});

function report(checks: HealthCheck[]): string {
  return buildReport({
    checkedAt: new Date('2026-11-12T14:03:00Z'),
    lumenVersion: '0.5.0',
    jellyfinVersion: '12.4.0',
    groups: [{ label: 'Requests (Seerr)', checks }],
    devices: [
      describeDevice({
        Client: 'tv Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106',
        ServerVersion: '12.4.0',
        FailedChecks: ['selector.upNext', 'playbackManager.getSupportedPlaybackRates'],
        LastSeen: '2026-11-12T10:00:00Z',
      }),
    ],
    settings: {
      requestsEnabled: true,
      seerrAddressSet: true,
      seerrKeySet: true,
      traktKeySet: true,
      quickConnectAddressSet: true,
    },
    secrets: [
      SEERR,
      'https://tv.home.example',
      'http://jellyfin.home.example:8096',
      'jellyfin.home.example:8096',
    ],
  });
}

describe('the copied report', () => {
  it('has the versions, every check with its status, the settings as set / not set, and the devices', () => {
    const text = report([
      check({
        Id: 'requests.seerr',
        Title: 'Seerr connection',
        Status: 'Problem',
        Message: "Lumen can't reach Seerr.",
      }),
      check({
        Id: 'requests.services',
        Title: 'Radarr and Sonarr',
        Status: 'NotApplicable',
        Message: 'Seerr isn’t set up.',
      }),
    ]);

    expect(text).toContain('Checked: 2026-11-12 14:03 UTC');
    expect(text).toContain('Lumen 0.5.0, Jellyfin 12.4.0');
    expect(text).toContain('- Requests: on; Seerr address set, API key set');
    expect(text).toContain('- Trakt key: set');
    expect(text).toContain("- Problem: Seerr connection [requests.seerr]: Lumen can't reach Seerr.");
    expect(text).toContain('- Not applicable: Radarr and Sonarr [requests.services]');
    expect(text).toContain(
      '- Problem: LG TV (webOS), Chromium 68 (built in), TV layout; Jellyfin 12.4.0; last seen 2026-11-12 10:00 UTC',
    );
    // Check ids stay whole, however long.
    expect(text).toContain('Checks: selector.upNext, playbackManager.getSupportedPlaybackRates');
  });

  it('holds no secret or address, even when a message carries one', () => {
    const text = report([
      check({
        Message: `Couldn't reach Seerr: Connection refused (seerr.home.example:5055) at ${SEERR}/api/v1/status`,
      }),
      check({ Message: `key ${SEERR_KEY} trakt ${TRAKT_KEY} vapid ${VAPID} token ${TOKEN}` }),
      check({
        Message:
          'Webhook https://hooks.example.net/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX failed; mail admin@home.example',
      }),
      check({
        Message:
          'Phones reach https://tv.home.example and 192.168.1.20:8096, this page jellyfin.home.example:8096',
      }),
      check({ Message: 'A note only the page shows', Detail: 'Tried https://tv.home.example/secret.' }),
    ]);

    for (const secret of [
      'seerr.home.example',
      '5055',
      SEERR_KEY.slice(0, 20),
      TRAKT_KEY,
      VAPID.slice(0, 20),
      TOKEN,
      'hooks.example.net',
      'XXXXXXXXXXXX',
      'admin@',
      'tv.home.example',
      '192.168.1.20',
      'jellyfin.home.example',
      'secret',
    ])
      expect(text, secret).not.toContain(secret);
    expect(text).toContain('[address]');
    expect(text).toContain('[redacted]');
  });

  it('redact leaves ordinary words, versions and ids alone', () => {
    const text =
      'Lumen 0.5.0 on Jellyfin 12.4.0: playbackManager.enableAutomaticBitrateDetection, Chromium 68.';
    expect(redact(text, [])).toBe(text);
  });
});
