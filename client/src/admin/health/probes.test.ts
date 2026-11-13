import { describe, expect, it, vi } from 'vitest';
import {
  addressKind,
  checkHttps,
  checkJellyfinVersion,
  checkProxyCache,
  checkQuickConnectAddress,
  PROBE_BODY,
  type ProbeEnv,
} from './probes';

const NOW = Date.parse('2026-11-12T12:00:00Z');

function env(
  respond: (url: string) => Response | Promise<Response>,
  origin = 'http://192.168.1.5:8096',
): ProbeEnv & { fetch: ReturnType<typeof vi.fn> } {
  const url = new URL(origin);
  return {
    fetch: vi.fn(async (u: string) => respond(u)),
    location: { protocol: url.protocol, hostname: url.hostname, origin: url.origin },
    url: (path, params) =>
      `${origin}/${path}${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`,
    now: () => NOW,
  };
}

const probe = (headers: Record<string, string>, body = PROBE_BODY, status = 200): Response =>
  new Response(body, { status, headers });

describe('checkJellyfinVersion', () => {
  it('is OK on a tested release, a warning with a way to updates on another', () => {
    expect(checkJellyfinVersion('12.4.1')).toMatchObject({
      Status: 'Ok',
      Message: 'Lumen has been tested with Jellyfin 12.4.',
    });
    const untested = checkJellyfinVersion('12.9.0');
    expect(untested.Status).toBe('Warning');
    expect(untested.Message).toContain("hasn't been tested with Jellyfin 12.9 yet");
    expect(untested.Fix).toEqual({ Label: 'Open Updates', Kind: 'setting', Target: 'updates' });
  });
});

describe('checkProxyCache', () => {
  it('is OK when the headers arrive as Lumen sent them (no proxy), and asks past every cache', async () => {
    const e = env(() => probe({ 'Cache-Control': 'no-cache' }));

    const result = await checkProxyCache(e);

    expect(result.Status).toBe('Ok');
    expect(result.Detail).toBe('Received: Cache-Control: no-cache.');
    const [url, init] = e.fetch.mock.calls[0]!;
    expect(url).toBe(`http://192.168.1.5:8096/Lumen/Assets/cache-probe.js?t=${NOW}`);
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it("is a problem when a proxy replaces them with a long lifetime (Nginx Proxy Manager's Cache Assets)", async () => {
    const result = await checkProxyCache(
      env(() => probe({ 'Cache-Control': 'max-age=2592000', Expires: 'Sat, 12 Dec 2026 12:00:00 GMT' })),
    );

    expect(result.Status).toBe('Problem');
    expect(result.Message).toContain('they arrive with max-age=2592000 (about 30 days)');
    expect(result.Message).toContain('Cache Assets');
  });

  it('is a problem for a future Expires alone, or no caching headers at all', async () => {
    expect(
      (await checkProxyCache(env(() => probe({ Expires: 'Sat, 12 Dec 2026 12:00:00 GMT' })))).Status,
    ).toBe('Problem');
    expect((await checkProxyCache(env(() => probe({})))).Message).toContain('no Cache-Control at all');
  });

  it('a past Expires beside no-cache is fine', async () => {
    expect(
      (await checkProxyCache(env(() => probe({ 'Cache-Control': 'no-cache', Expires: '0' })))).Status,
    ).toBe('Ok');
  });

  it("can't check when the file doesn't arrive, or something else comes back", async () => {
    expect((await checkProxyCache(env(() => Promise.reject(new TypeError('offline'))))).Status).toBe(
      'NotApplicable',
    );
    const other = await checkProxyCache(env(() => probe({}, '<html>login</html>', 200)));
    expect(other.Status).toBe('NotApplicable');
    expect(other.Message).toContain('something else');
  });
});

describe('checkHttps', () => {
  it.each([
    ['https:', 'media.example.org', 'Ok'],
    ['http:', 'localhost', 'NotApplicable'],
    ['http:', '127.0.0.1', 'NotApplicable'],
    ['http:', '192.168.1.5', 'NotApplicable'],
    ['http:', '10.0.0.2', 'NotApplicable'],
    ['http:', 'nas.local', 'NotApplicable'],
    ['http:', 'jellyfin', 'NotApplicable'],
    ['http:', 'media.example.org', 'Problem'],
    // Tailscale: its addresses (100.64.0.0/10) and MagicDNS names reach only the tailnet over plain HTTP.
    ['http:', '100.101.102.103', 'NotApplicable'],
    ['http:', 'nas.tail1234.ts.net', 'NotApplicable'],
    ['http:', '100.128.0.1', 'Problem'],
    ['http:', '2001:db8::1', 'Problem'],
  ])('%s//%s is %s', (protocol, hostname, status) => {
    expect(checkHttps({ protocol, hostname, origin: `${protocol}//${hostname}` }).Status).toBe(status);
  });

  it('never names the address', () => {
    expect(
      checkHttps({ protocol: 'http:', hostname: 'media.example.org', origin: '' }).Message,
    ).not.toContain('example');
  });

  it('knows private ranges from public ones', () => {
    expect(addressKind('172.20.1.1')).toBe('local');
    expect(addressKind('172.32.1.1')).toBe('public');
    expect(addressKind('[::1]')).toBe('loopback');
    expect(addressKind('[fd7a:115c:a1e0::1]')).toBe('local');
    expect(addressKind('[2001:db8::1]')).toBe('public');
    expect(addressKind('100.64.0.1')).toBe('private');
    expect(addressKind('100.127.255.254')).toBe('private');
    expect(addressKind('100.63.0.1')).toBe('public');
    expect(addressKind('jellyfin.tail1234.ts.net')).toBe('private');
    expect(addressKind('ts.net.example.org')).toBe('public');
  });

  it('says a Tailscale address is a private network, not the open internet', () => {
    const result = checkHttps({ protocol: 'http:', hostname: '100.101.102.103', origin: '' });
    expect(result.Message).toContain('private network');
    expect(result.Message).not.toContain('internet');
  });
});

describe('checkQuickConnectAddress', () => {
  const on = [
    { Id: 'quickConnect.enabled', Group: 'QuickConnect', Status: 'Ok', Title: '', Message: '' },
  ] as const;
  const info = (id: string): Response =>
    new Response(JSON.stringify({ Id: id }), { headers: { 'Content-Type': 'application/json' } });

  it('is OK when the address answers as this server', async () => {
    const e = env((url) => info(url.startsWith('https://tv.example.org') ? 'ABC-123' : 'abc123'));

    const result = await checkQuickConnectAddress(e, {
      QuickConnectAddress: 'https://tv.example.org/',
      Checks: [...on],
    });

    expect(result).toMatchObject({ Status: 'Ok', Detail: 'Checked https://tv.example.org.' });
    expect(result.Message).not.toContain('example');
    expect(e.fetch.mock.calls[0]![0]).toBe('https://tv.example.org/System/Info/Public');
  });

  it('warns when another server answers there', async () => {
    const e = env((url) => info(url.startsWith('https://tv.example.org') ? 'other' : 'abc123'));
    expect(
      (await checkQuickConnectAddress(e, { QuickConnectAddress: 'https://tv.example.org', Checks: [...on] }))
        .Status,
    ).toBe('Warning');
  });

  it("doesn't claim it's this server when this server's own id didn't load", async () => {
    const e = env((url) =>
      url.startsWith('https://tv.example.org') ? info('abc') : new Response('', { status: 500 }),
    );
    const result = await checkQuickConnectAddress(e, {
      QuickConnectAddress: 'https://tv.example.org',
      Checks: [...on],
    });
    expect(result.Status).toBe('Ok');
    expect(result.Message).toContain("Whether it's this one couldn't be checked");
    expect(result.Message).not.toContain("it's this server");
  });

  it("can't check another address it can't read; its own not answering is a problem", async () => {
    const e = env((url) =>
      url.startsWith('https://tv.example.org') ? Promise.reject(new TypeError('CORS')) : info('abc'),
    );
    expect(
      (await checkQuickConnectAddress(e, { QuickConnectAddress: 'https://tv.example.org', Checks: [...on] }))
        .Message,
    ).toMatch(/^Can't check from here/);

    const own = env(() => new Response('', { status: 502 }));
    expect(
      (
        await checkQuickConnectAddress(own, {
          QuickConnectAddress: 'http://192.168.1.5:8096',
          Checks: [...on],
        })
      ).Status,
    ).toBe('Problem');
  });

  it('has nothing to check without an address, or with Quick Connect off', async () => {
    const e = env(() => info('x'));
    expect((await checkQuickConnectAddress(e, { QuickConnectAddress: '', Checks: [...on] })).Status).toBe(
      'NotApplicable',
    );
    const off = [{ ...on[0], Status: 'NotApplicable' as const }];
    expect(
      (await checkQuickConnectAddress(e, { QuickConnectAddress: 'https://tv.example.org', Checks: off }))
        .Message,
    ).toBe('Quick Connect is off.');
    expect(e.fetch).not.toHaveBeenCalled();
  });
});
