import { describe, expect, it } from 'vitest';
import { describeCheck, describeDevice, parseClient } from './devices';

const WEBOS =
  'tv Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36';
const MAC_CHROME =
  'desktop Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IPHONE =
  'mobile Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

describe('parseClient', () => {
  it.each([
    [WEBOS, 'LG TV (webOS)', 'Chromium 68 (built in)', 'tv', true],
    [MAC_CHROME, 'Mac', 'Chrome 131', 'desktop', false],
    [IPHONE, 'iPhone', 'Safari 17', 'mobile', false],
    [
      'desktop Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Windows PC',
      'Firefox 132',
      'desktop',
      false,
    ],
    [
      'mobile Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      'Android phone or tablet',
      'Android app (WebView, Chrome 130)',
      'mobile',
      false,
    ],
    [
      'tv Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36',
      'Samsung TV (Tizen)',
      'WebKit',
      'tv',
      true,
    ],
  ])('reads %s', (client, device, browser, layout, tv) => {
    expect(parseClient(client)).toMatchObject({ device, browser, layout, tv });
  });

  it('copes with a report from before the layout was sent, or a cut-off agent', () => {
    expect(parseClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/5')).toMatchObject({
      device: 'Mac',
      layout: '',
    });
  });
});

describe('describeCheck', () => {
  it('says what broke and what Lumen did, in words', () => {
    expect(describeCheck('selector.upNext')).toMatchObject({
      broke: "Jellyfin's next-episode card changed.",
      did: "Lumen shows Jellyfin's own next-episode card instead.",
      status: 'Warning',
    });
    expect(describeCheck('playbackManager:webpack')).toMatchObject({
      status: 'Problem',
      did: expect.stringMatching(/own video player/),
    });
    expect(describeCheck('reactRoot').did).toMatch(/Jellyfin's own pages/);
    expect(describeCheck('history').cause).toBe('browser');
  });

  it("names an id it doesn't know rather than hiding it", () => {
    expect(describeCheck('somethingNew').broke).toContain('somethingNew');
    expect(describeCheck('selector.newThing').status).toBe('Warning');
  });
});

describe('describeDevice', () => {
  it('a tested Jellyfin: a bug report, and an old TV browser: the TV’s update', () => {
    const row = describeDevice({
      Client: WEBOS,
      ServerVersion: '12.4.0',
      FailedChecks: ['selector.upNext'],
      LastSeen: '',
    });

    expect(row.title).toBe('LG TV (webOS), Chromium 68 (built in), TV layout');
    expect(row.status).toBe('Warning');
    expect(row.advice).toContain(
      'Lumen is tested with Jellyfin 12.4, so updating Jellyfin is unlikely to help.',
    );
    expect(row.advice).toContain("updates only with the TV's software");
    expect(row.ids).toEqual(['selector.upNext']);
  });

  it('an untested Jellyfin: a Lumen update may fix it; player methods read as one sentence', () => {
    const row = describeDevice({
      Client: MAC_CHROME,
      ServerVersion: '12.5.0 (untested)',
      FailedChecks: ['playbackManager.getPlaybackRate', 'playbackManager.setPlaybackRate'],
      LastSeen: '',
    });

    expect(row.status).toBe('Problem');
    expect(row.broke).toEqual([
      "Jellyfin's video player changed: it no longer has getPlaybackRate and setPlaybackRate, which Lumen's controls use.",
    ]);
    expect(row.advice).toBe(
      "Lumen hasn't been tested with Jellyfin 12.5 yet: a Lumen update may fix this. Updating the browser won't.",
    );
  });

  it('a browser-side failure: updating the browser', () => {
    expect(
      describeDevice({ Client: MAC_CHROME, ServerVersion: '12.4.0', FailedChecks: ['history'], LastSeen: '' })
        .advice,
    ).toBe('Updating the browser should fix this.');
  });
});
