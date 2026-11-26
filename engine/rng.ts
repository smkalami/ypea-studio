// The Studio generator. The specification is spec/rng.md, and ypea carries the same generator
// as an opt-in. Every draw must stay identical on both sides, so change nothing here without
// changing the specification, the Python side and spec/parity/rng.json together.

const M = 0xd256d193;
const W = 0x9e3779b9;

/** High 32 bits of the unsigned product a * b. */
function mulhi(a: number, b: number): number {
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const t = a1 * b0 + ((a0 * b0) >>> 16);
  const w = (t & 0xffff) + a0 * b1;
  return (a1 * b1 + (t >>> 16) + (w >>> 16)) >>> 0;
}

/** Philox2x32-10 (Salmon et al., 2011): two 32-bit words from a 64-bit counter and a 32-bit key. */
export function philox(c0: number, c1: number, key: number): [number, number] {
  for (let r = 0; r < 10; r++) {
    if (r) key = (key + W) >>> 0;
    const lo = Math.imul(M, c0) >>> 0;
    c0 = (mulhi(M, c0) ^ key ^ c1) >>> 0;
    c1 = lo;
  }
  return [c0, c1];
}

// ln, cos and sin are not the same to the last digit in JavaScript and NumPy, so the generator
// uses its own, built from + - * / in a fixed order, which IEEE 754 makes identical everywhere.
const SQRT_HALF = 0.7071067811865476;
const LN2 = 0.6931471805599453;
const QUARTER_PI = 0.7853981633974483;

/** ln(x) for 0 < x <= 1. */
export function lnUnit(x: number): number {
  let e = 0;
  while (x < SQRT_HALF) {
    x *= 2;
    e--;
  }
  const s = (x - 1) / (x + 1), z = s * s;
  let acc = 1 / 25;
  for (let k = 11; k >= 0; k--) acc = acc * z + 1 / (2 * k + 1);
  return e * LN2 + 2 * s * acc;
}

/** [cos(2 pi u), sin(2 pi u)] for 0 <= u < 1. */
export function cosSin2pi(u: number): [number, number] {
  const q = 8 * u, k = Math.floor(q), t = q - k;
  const a = QUARTER_PI * (k & 1 ? 1 - t : t), z = a * a;
  let c = 1, s = 1;
  for (let j = 10; j >= 1; j--) {
    c = 1 - (z * c) / ((2 * j - 1) * (2 * j));
    s = 1 - (z * s) / (2 * j * (2 * j + 1));
  }
  s *= a;
  // a is the distance to the nearest multiple of pi / 2, so odd octants swap the two
  const swap = ((k + 1) >> 1) & 1;
  const cos = swap ? s : c, sin = swap ? c : s;
  return [((k + 2) >> 2) & 1 ? -cos : cos, k >= 4 ? -sin : sin];
}

/** Seed of run `runIndex` of an experiment with base seed `base`. */
export function deriveSeed(base: number, runIndex: number): number {
  return philox(runIndex >>> 0, 0xffffffff, base >>> 0)[0];
}

export class Rng {
  readonly seed: number;
  private lo = 0;
  private hi = 0;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error(`seed must be an integer from 0 to 4294967295, got ${seed}`);
    }
    this.seed = seed;
  }

  /** Uniform in [0, 1) with 53 random bits. Every draw of every kind uses one counter step per uniform. */
  random(): number {
    const [a, b] = philox(this.lo, this.hi, this.seed);
    this.lo = (this.lo + 1) >>> 0;
    if (this.lo === 0) this.hi = (this.hi + 1) >>> 0;
    return ((a >>> 5) * 67108864 + (b >>> 6)) / 9007199254740992;
  }

  /** Fills `out` in index order (row-major for a flattened array). */
  fill(out: Float64Array): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.random();
    return out;
  }

  uniform(low: number, high: number): number {
    return low + (high - low) * this.random();
  }

  /** Integer in [low, high), high excluded. */
  integers(low: number, high: number): number {
    return low + Math.floor(this.random() * (high - low));
  }

  /** Box-Muller, cosine branch only: two uniforms per normal, with no cached second value. */
  standardNormal(): number {
    const u1 = this.random(), u2 = this.random();
    return Math.sqrt(-2 * lnUnit(1 - u1)) * cosSin2pi(u2)[0];
  }

  standardCauchy(): number {
    // tan(pi (u - 1/2)) = -cos(pi u) / sin(pi u)
    const [c, s] = cosSin2pi(this.random() / 2);
    return -c / s;
  }

  /** Number of trials up to and including the first success, at least 1. */
  geometric(p: number): number {
    const u = this.random();
    return p >= 1 ? 1 : Math.floor(lnUnit(1 - u) / lnUnit(1 - p)) + 1;
  }

  /** Index drawn with probabilities `p` (which sum to 1): the first index whose running total exceeds u. */
  choice(p: ArrayLike<number>): number {
    const u = this.random();
    let c = 0;
    for (let i = 0; i < p.length; i++) {
      c += p[i];
      if (u < c) return i;
    }
    return p.length - 1;
  }

  /** Random permutation of 0..n-1: the stable sort order of n uniforms. */
  permutation(n: number): Int32Array {
    const keys = this.fill(new Float64Array(n));
    return Int32Array.from({ length: n }, (_, i) => i).sort((i, j) => keys[i] - keys[j] || i - j);
  }
}
