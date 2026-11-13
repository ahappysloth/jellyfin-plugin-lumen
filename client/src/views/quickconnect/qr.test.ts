import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { QR_QUIET, qrCode, qrPath, type QrCode } from './qr';

/** Draws the code as pixels (with its quiet zone) and reads it back with jsQR, a decoder written independently. */
function decode({ size, modules }: QrCode, scale = 3): string | undefined {
  const width = (size + 2 * QR_QUIET) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (modules[y * size + x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + QR_QUIET) * scale + dy) * width + (x + QR_QUIET) * scale + dx) * 4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
  return jsQR(pixels, width, width)?.data;
}

/** Each row of modules as hex, as the vectors below are written. */
function rows({ size, modules }: QrCode): string[] {
  const out: string[] = [];
  for (let y = 0; y < size; y++) {
    let bits = '';
    for (let x = 0; x < size; x++) bits += modules[y * size + x];
    out.push(
      BigInt(`0b${bits}`)
        .toString(16)
        .padStart(Math.ceil(size / 4), '0'),
    );
  }
  return out;
}

describe('qrCode', () => {
  // From the qrcode package (1.5.4), byte mode, level M, mask 2: module for module the same.
  it('matches a reference encoder', () => {
    expect(rows(qrCode('HELLO')!)).toEqual([
      '1fc27f',
      '104541',
      '17585d',
      '17555d',
      '17595d',
      '105e41',
      '1fd57f',
      '001800',
      '17c67c',
      '0dafcc',
      '07d16e',
      '0d0fcc',
      '0bf125',
      '001528',
      '1fce96',
      '10543e',
      '175a96',
      '175be8',
      '175964',
      '104fdc',
      '1fd916',
    ]);
    expect(rows(qrCode('https://jellyfin.example.com/web/#/quickconnect?code=123456')!)).toEqual([
      '1fc75ba7f',
      '104531c41',
      '175f51d5d',
      '17590f75d',
      '175a72a5d',
      '1055c5541',
      '1fd55557f',
      '001e55a00',
      '17cdc867c',
      '068c87a6d',
      '01fef5114',
      '0031b0cdf',
      '0c7a4c7bb',
      '0430ab647',
      '1c46a09ca',
      '093455ef4',
      '0b54687b1',
      '0fa757a6d',
      '12e9fcd74',
      '0d94548fd',
      '0354de3b8',
      '1eba83649',
      '15787144a',
      '14a7f3a4f',
      '13f6ef3f9',
      '0012d7115',
      '1fc0fd756',
      '105a81f1e',
      '17547c5fa',
      '1755cb397',
      '1751a976c',
      '10497681c',
      '1fdb287ea',
    ]);
  });

  it('decodes at every length it holds, through each of its six versions and their block layouts', () => {
    const base = 'https://jellyfin.example.com/jf/web/#/quickconnect?code=' + '1234567890'.repeat(6);
    const sizes = new Set<number>();
    for (let n = 1; n <= 106; n++) {
      const text = base.slice(0, n);
      const code = qrCode(text)!;
      sizes.add(code.size);
      expect(decode(code), `${n} bytes`).toBe(text);
    }
    expect([...sizes]).toEqual([21, 25, 29, 33, 37, 41]);
  });

  it('decodes the addresses it will really carry, LAN, Tailscale and public, and UTF-8', () => {
    for (const text of [
      'http://192.168.1.20:8096/web/#/quickconnect?code=987654',
      'https://jellyfin.apyx.cc/web/#/quickconnect?code=123456',
      'http://media.tail1234.ts.net:8096/jellyfin/web/index.html#/quickconnect?code=555555',
      'https://bücher.example/web/#/quickconnect?code=100000',
    ])
      expect(decode(qrCode(text)!)).toBe(text);
  });

  it('gives up past version 6 (106 bytes)', () => {
    expect(qrCode('x'.repeat(106))).not.toBeNull();
    expect(qrCode('x'.repeat(107))).toBeNull();
  });
});

describe('qrPath', () => {
  it('draws each run of dark modules as one rectangle, offset by the quiet zone', () => {
    const modules = new Uint8Array([1, 1, 0, 0, 1, 0, 1, 1, 1]);
    expect(qrPath({ size: 3, modules })).toBe('M4 4h2v1h-2zM5 5h1v1h-1zM4 6h3v1h-3z');
  });
});
