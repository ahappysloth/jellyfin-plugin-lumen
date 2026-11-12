/**
 * A QR code encoder (ISO/IEC 18004), just big enough for a Quick Connect link: byte mode, error correction level M,
 * versions 1 to 6 (up to 106 bytes: an address of up to 80 characters before `#/quickconnect?code=123456`). Hand-written
 * rather than a dependency: about 1.1 KB gzipped, in the Quick Connect file only.
 * - Level M rather than L: a screen doesn't get damaged, but a phone pointed at a glossy TV sees glare and reflections,
 *   and M costs little: a typical 55-byte address is version 4 (33×33 modules) at M against version 3 (29×29) at L.
 * - Always mask 2 (vertical stripes every third column), rather than scoring all eight with the standard's penalty
 *   rules: that's the file's 6 KB budget. Readers decode any mask; the scoring only steers away from patterns that look
 *   like finders or big blocks of one colour. For addresses like these, mask 2 is the one the scoring picks two times in
 *   three, and on average within 20 penalty points of the best (measured over 300 LAN, Tailscale and public addresses
 *   against the qrcode package's scoring); every length from 1 to 106 bytes decodes (qr.test.ts).
 */

/**
 * Per version 1..6 at level M: error-correction codewords per block, and the number of blocks. Stopping at 6 leaves out
 * the version information and the extra alignment patterns versions 7 and up have.
 */
const EC = [10, 16, 26, 18, 24, 16];
const BLOCKS = [1, 1, 1, 2, 2, 4];
export const QR_MAX_VERSION = 6;

export interface QrCode {
  /** Width (and height) in modules, without the quiet zone. */
  size: number;
  /** One 0 (light) or 1 (dark) per module, row by row. */
  modules: Uint8Array;
}

/** Data codewords per version 1..6 at level M (the rest of each version's codewords are error correction). */
const DATA = [16, 28, 44, 64, 86, 108];

/** Multiplication in GF(256) modulo x⁸ + x⁴ + x³ + x² + 1. */
function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >> 7) * 0x11d);
    z ^= ((y >> i) & 1) * x;
  }
  return z;
}

/** The Reed-Solomon remainder of `data` for `degree` error-correction codewords. */
function reedSolomon(data: number[], degree: number): number[] {
  // The generator polynomial's coefficients, highest power dropped.
  const gen: number[] = [];
  for (let i = 0; i < degree; i++) gen.push(i === degree - 1 ? 1 : 0);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      gen[j] = mul(gen[j]!, root);
      if (j + 1 < degree) gen[j] = gen[j]! ^ gen[j + 1]!;
    }
    root = mul(root, 2);
  }
  const rem = gen.map(() => 0);
  for (const b of data) {
    const factor = b ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] = rem[i]! ^ mul(gen[i]!, factor);
  }
  return rem;
}

/** Mask 2: a module is flipped in every third column (x % 3 == 0). */
const MASK = 2;

/** The QR code for `text` (UTF-8), or null when it's longer than version 6 holds. */
export function qrCode(text: string): QrCode | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  let v = 0;
  let dataLen: number;
  do {
    if (++v > QR_MAX_VERSION) return null;
    dataLen = DATA[v - 1]!;
  } while (12 + 8 * bytes.length > dataLen * 8);

  // Mode (byte), length, the data, a terminator, then padding.
  const bits: number[] = [];
  const put = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataLen * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    data.push(byte);
  }

  // The blocks (the longer ones last), each with its error correction, then interleaved.
  const ec = EC[v - 1]!;
  const blocks = BLOCKS[v - 1]!;
  const short = (dataLen / blocks) | 0;
  const longFrom = blocks - (dataLen % blocks);
  const parts: [number[], number[]][] = [];
  for (let i = 0, at = 0; i < blocks; i++) {
    const part = data.slice(at, (at += short + (i < longFrom ? 0 : 1)));
    parts.push([part, reedSolomon(part, ec)]);
  }
  const stream: number[] = [];
  for (let i = 0; i <= short; i++) for (const [part] of parts) if (i < part.length) stream.push(part[i]!);
  for (let i = 0; i < ec; i++) for (const [, code] of parts) stream.push(code[i]!);

  // The grid: function patterns first (marked in `fixed`), then the data in the standard's zigzag.
  const size = v * 4 + 17;
  const grid = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, dark: number | boolean): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    grid[y * size + x] = dark ? 1 : 0;
    fixed[y * size + x] = 1;
  };
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Finder patterns with their separators.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  // The alignment pattern (versions 2 to 6 have one, near the bottom right).
  if (v > 1)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        set(size - 7 + dx, size - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  /** The 15 format bits (level M and the mask) in both places; also reserves them before the data goes in. */
  const format = (mask: number): void => {
    let rem = mask;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const f = ((mask << 10) | rem) ^ 0x5412;
    const bit = (i: number): number => (f >> i) & 1;
    for (let i = 0; i < 6; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, 1);
  };
  // Written (and so reserved) before the data goes in: the mask is known from the start.
  format(MASK);
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (fixed[y * size + x]) continue;
        grid[y * size + x] = n < stream.length * 8 ? (stream[n >> 3]! >> (7 - (n & 7))) & 1 : 0;
        n++;
      }
  }

  for (let i = 0; i < size * size; i++) if (!fixed[i] && (i % size) % 3 === 0) grid[i] = 1 - grid[i]!;
  return { size, modules: grid };
}

/** The quiet zone the standard asks for around the code, in modules. */
export const QR_QUIET = 4;

/** One SVG path of the dark modules, in module units, offset by the quiet zone (the viewBox is size + 8 square). */
export function qrPath({ size, modules }: QrCode): string {
  let d = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!modules[y * size + x]) continue;
      let run = 1;
      while (x + run < size && modules[y * size + x + run]) run++;
      d += `M${x + QR_QUIET} ${y + QR_QUIET}h${run}v1h-${run}z`;
      // The module after the run is light: the loop's own step skips it.
      x += run;
    }
  return d;
}
