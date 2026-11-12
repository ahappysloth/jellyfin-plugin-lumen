import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './publicAddress';

describe('isPublicAddress', () => {
  it('takes nothing (not set), or an http(s) address with a port or a base path', () => {
    for (const ok of [
      '',
      '  ',
      'https://jellyfin.example.com',
      'https://jellyfin.example.com/',
      'http://192.168.1.20:8096',
      'http://tv-box.tail1234.ts.net:8096/jellyfin/',
    ])
      expect(isPublicAddress(ok), ok).toBe(true);
  });

  it('refuses what the QR code could not open, or would carry along', () => {
    for (const bad of [
      'jellyfin.example.com',
      'ftp://jellyfin.example.com',
      'javascript:alert(1)',
      'https://user:pass@jellyfin.example.com',
      'https://jellyfin.example.com/?',
      'https://jellyfin.example.com/#/home',
      'https://jellyfin.example.com/"><script>',
      // 76 bytes: the QR code holds 75 before /web/#/quickconnect?code=123456.
      'https://' + 'a'.repeat(56) + '.example.com',
    ])
      expect(isPublicAddress(bad), bad).toBe(false);
    expect(isPublicAddress('https://' + 'a'.repeat(55) + '.example.com')).toBe(true);
  });
});
