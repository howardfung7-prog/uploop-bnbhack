import { tr } from "./i18n";
/// A QR encoder (§71.157). Written here, with **no third-party package**.
///
/// Why not `npm i qrcode`: this code goes on the deposit page, and one wrong module means a user's
/// USDT lands at someone else's address. `app/package.json` currently has 4 runtime dependencies,
/// every one of them outside the money path; pushing a dependency tree we cannot finish reading
/// into that path for the sake of one static image is a bigger risk than writing these 200 lines
/// ourselves (the supply-chain side of it).
/// What we get by writing it: the input is one string, the output is one boolean matrix, and there
/// is no network, no DOM and no global state. The whole thing is a pure function — readable and
/// testable end to end.
///
/// The coverage is deliberately narrowed to **just enough**:
/// * 8-bit byte mode only (addresses are ASCII, so the numeric / alphanumeric modes' compression is
///   of no use)
/// * error-correction level fixed at **M** (about 15%, the usual default for QR codes)
/// * **versions 1..6 only** (21×21 up to 41×41). Version ≥ 7 needs an extra "version information"
///   area drawn, and none of that is done here — 6-M holds 106 bytes while an EVM address is 42
///   characters, which leaves more than twice the room needed.
///
/// The spec is ISO/IEC 18004. The implementation details (mask scoring, the order the format
/// information is laid out in) were written against Project Nayuki's qrcodegen reference
/// implementation, and coordinates are always (x = column, y = row).

/// The format-information bits for error-correction level M (L=01 M=00 Q=11 H=10). Only M is used
/// here.
const EC_BITS_M = 0;

/// For each version (1..6) at error-correction level M: [EC codewords per block, blocks, data
/// codewords per block].
/// At level M versions 1..6 all have a single "group" (every block the same length), so
/// interleaving is a plain transpose by index and there is no mix of long and short blocks to
/// handle — which is the other reason for stopping at version 6.
const SPEC_M: Array<[number, number, number]> = [
  [10, 1, 16],   // v1: 26 codewords total = 16 data + 10 EC
  [16, 1, 28],   // v2: 44 total
  [26, 1, 44],   // v3: 70 total
  [18, 2, 32],   // v4: 100 total
  [24, 2, 43],   // v5: 134 total
  [16, 4, 27],   // v6: 172 total
];

/// The centre coordinate of the one alignment pattern each of versions 2..6 has (version 1 has
/// none).
/// The spec gives the cross product of the coordinate table [6, N], and the three cells that land
/// on a finder pattern come out, which leaves just this one: (N, N).
const ALIGN_CENTER = [0, 0, 18, 22, 26, 30, 34];

const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

// ---------------------------------------------------------------- GF(256)

/// GF(256) log / antilog tables, primitive polynomial 0x11D. Computed once at module load.
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  EXP[255] = EXP[0];
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);

/// The generator polynomial g(x) = (x−α⁰)(x−α¹)…(x−α^(n−1)), coefficients from the highest degree
/// down, with the leading 1 left off.
function generator(n: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g.slice(1);
}

/// The Reed-Solomon error-correction codewords: divide the data polynomial by the generator
/// polynomial and take the remainder.
function ecCodewords(data: Uint8Array, n: number): Uint8Array {
  const g = generator(n);
  const rem = new Uint8Array(n);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.copyWithin(0, 1);
    rem[n - 1] = 0;
    for (let i = 0; i < n; i++) rem[i] ^= mul(g[i], factor);
  }
  return rem;
}

// ---------------------------------------------------------------- the data segment

/// Encode a string into this version's complete data codewords (error correction included, already
/// interleaved).
function codewords(bytes: Uint8Array, version: number): Uint8Array {
  const [ecLen, blocks, dataPerBlock] = SPEC_M[version - 1];
  const total = blocks * dataPerBlock;

  // The bit stream: mode indicator 0100 (byte mode) + an 8-bit character count (8 bits for
  // versions 1..9) + the data
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);

  // A terminator of at most four 0s (fewer if they will not fit), then 0s up to a whole byte
  const cap = total * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(total);
  for (let i = 0; i < bits.length; i++) data[i >> 3] |= bits[i] << (7 - (i & 7));
  // The pad bytes: the spec's alternating 11101100 / 00010001, not just any old 0s
  for (let i = bits.length / 8, alt = true; i < total; i++, alt = !alt) data[i] = alt ? 0xec : 0x11;

  // Compute error correction per block, then interleave by transposing on the index (every block's
  // data codeword 0 first, then every block's codeword 1, and so on; the same for error correction)
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < blocks; b++) {
    const chunk = data.subarray(b * dataPerBlock, (b + 1) * dataPerBlock);
    dataBlocks.push(chunk);
    ecBlocks.push(ecCodewords(chunk, ecLen));
  }
  const out = new Uint8Array(total + blocks * ecLen);
  let k = 0;
  for (let i = 0; i < dataPerBlock; i++) for (const blk of dataBlocks) out[k++] = blk[i];
  for (let i = 0; i < ecLen; i++) for (const blk of ecBlocks) out[k++] = blk[i];
  return out;
}

// ---------------------------------------------------------------- drawing the matrix

class Canvas {
  readonly size: number;
  readonly mod: boolean[][];       // true = dark
  readonly fixed: boolean[][];     // true = a function pattern; neither the data nor the mask may touch it

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.mod = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(x: number, y: number, dark: boolean): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.mod[y][x] = dark;
    this.fixed[y][x] = true;
  }

  /// A finder pattern, separator included: centred on (x, y), the rings at Chebyshev distance 2 and
  /// 4 are light.
  finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x + dx, y + dy, d !== 2 && d !== 4);
      }
    }
  }

  /// An alignment pattern: 5×5, with only the ring at distance 1 light.
  align(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  patterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);      // the vertical timing pattern
      this.set(i, 6, i % 2 === 0);      // the horizontal one
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    if (this.version >= 2) {
      const c = ALIGN_CENTER[this.version];
      this.align(c, c);
    }
    // Claim the format-information area first (the value does not matter; the real one is written
    // once the mask has been chosen) so that no data codeword gets placed there
    this.format(0);
  }

  /// The 15 format-information bits: 5 data bits (2 for the error-correction level + 3 for the
  /// mask) + the 10 check bits of BCH(15,5), then XOR 0x5412.
  /// Two copies go down, in the positions the spec nails down — not where they seem like they
  /// should go (the two copies have to agree exactly, or a decoder cannot trust either of them).
  format(mask: number): void {
    const data = (EC_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true);   // this cell is always dark
  }

  /// The codewords go into the non-function cells in two-column groups, right to left, snaking up
  /// and down. Column 6 is the timing pattern and the whole column is skipped.
  data(words: Uint8Array): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? this.size - 1 - vert : vert;
          if (!this.fixed[y][x] && i < words.length * 8) {
            this.mod[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  /// The mask: flip the data area by some rule, to break up large same-colour areas and false
  /// finder patterns. Function cells are not flipped.
  /// XOR twice is no flip at all, so choosing a mask can go "flip it on, score it, flip it back".
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.fixed[y][x]) continue;
        let flip: boolean;
        switch (mask) {
          case 0: flip = (x + y) % 2 === 0; break;
          case 1: flip = y % 2 === 0; break;
          case 2: flip = x % 3 === 0; break;
          case 3: flip = (x + y) % 3 === 0; break;
          case 4: flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: flip = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (flip) this.mod[y][x] = !this.mod[y][x];
      }
    }
  }

  /// The spec's four penalty rules. Lower is better — all eight masks scan, and picking the
  /// lowest-scoring one only makes it scan better.
  ///
  /// N3 (false finder patterns) cannot be done the easy way by matching a bit pattern over an
  /// 11-cell window: the spec says those 4 light cells **may fall outside the symbol**, so the ones
  /// hugging the edge have to count too. This follows the reference implementation and keeps the
  /// most recent 7 run lengths, with a run of "light outside the symbol" added at each end.
  penalty(): number {
    const n = this.size;
    let score = 0;

    /// Called right after a **light** run has been recorded; returns how many false finder patterns
    /// it made up: 0, 1 or 2.
    const finderCount = (h: number[]): number => {
      const k = h[1];
      const core = k > 0 && h[2] === k && h[3] === k * 3 && h[4] === k && h[5] === k;
      return (core && h[0] >= k * 4 && h[6] >= k ? 1 : 0) + (core && h[6] >= k * 4 && h[0] >= k ? 1 : 0);
    };
    const addRun = (len: number, h: number[]) => {
      if (h[0] === 0) len += n;          // before the first run there is still the "light outside the symbol"
      h.unshift(len);
      h.pop();
    };

    const line = (get: (i: number) => boolean) => {
      let color = false, run = 0;
      const h = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        if (get(i) === color) {
          run++;
          if (run === 5) score += PENALTY_N1;
          else if (run > 5) score++;
        } else {
          addRun(run, h);
          if (!color) score += finderCount(h) * PENALTY_N3;
          color = get(i);
          run = 1;
        }
      }
      if (color) { addRun(run, h); run = 0; }
      addRun(run + n, h);                // the same "light outside the symbol" at the end
      score += finderCount(h) * PENALTY_N3;
    };
    for (let y = 0; y < n; y++) line((x) => this.mod[y][x]);
    for (let x = 0; x < n; x++) line((y) => this.mod[y][x]);

    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = this.mod[y][x];
        if (c === this.mod[y][x + 1] && c === this.mod[y + 1][x] && c === this.mod[y + 1][x + 1]) score += PENALTY_N2;
      }
    }

    let dark = 0;
    for (const row of this.mod) for (const c of row) if (c) dark++;
    const total = n * n;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_N4;
    return score;
  }
}

// ---------------------------------------------------------------- the public surface

/// The longest string (in bytes) this encoder can hold. Above that `qrMatrix` throws, and the
/// caller decides what to show.
export const QR_MAX_BYTES = SPEC_M[5][1] * SPEC_M[5][2] - 2;   // 4×27 − 2 (the 12 bits of mode + count take 1.5 bytes, rounded down)

/// Encode a piece of text into a QR matrix. `m[y][x] === true` means that cell is dark.
///
/// The matrix returned has **no quiet zone** (the light border of at least 4 cells all round) —
/// that belongs to the display layer, and whoever draws it must not forget to leave it.
///
/// `mask` is only for the checking script (`scripts/check-qr.mjs`): the eight masks are equivalent
/// and any of them scans, so ordinary calls should leave it off and let the penalty score pick.
/// The checking script passes it because comparing "all eight masks against the reference
/// implementation" verifies far more thoroughly than comparing "only the one that was picked
/// automatically" — the latter stops matching the moment the penalty computation differs, and
/// getting the penalty wrong **does not affect whether the code scans**, so a mismatch there proves
/// nothing.
export function qrMatrix(text: string, mask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  // How many bytes a version holds = its data codewords − 2 (4 bits of mode + 8 bits of count = 12
  // bits, which take 1.5 bytes; counted conservatively as 2)
  const version = SPEC_M.findIndex(([, blocks, per]) => bytes.length <= blocks * per - 2) + 1;
  if (version === 0) throw new Error(tr("A QR code cannot hold {0} bytes (the limit is {1})", bytes.length, QR_MAX_BYTES));

  const c = new Canvas(version);
  c.patterns();
  c.data(codewords(bytes, version));

  let best = mask ?? 0;
  if (mask === undefined) {
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      c.applyMask(m);
      c.format(m);
      const s = c.penalty();
      if (s < bestScore) { bestScore = s; best = m; }
      c.applyMask(m);               // XOR twice = back where it was
    }
  }
  c.applyMask(best);
  c.format(best);
  return c.mod;
}
