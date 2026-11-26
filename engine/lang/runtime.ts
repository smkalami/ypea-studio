// The runtime library that generated code calls (as r_<name>). Each function gives the value
// that Python with NumPy gives, checked by spec/language/cases.json.
// A list is a typed array, a table is a Table, and a truth value is the number 1 or 0.

import { npSum } from "../numpy.ts";

/** An error raised while an expression runs, such as a position out of range. */
export class RuntimeError extends Error {
  /** The field the failing line belongs to: an expression's label, or a function's name. */
  field: string;
  /** Line inside that field's text, starting at 1. */
  line: number;
  constructor(message: string, field: string, line: number) {
    super(message);
    this.name = "RuntimeError";
    this.field = field;
    this.line = line;
  }
}

/** A table: the values in row-major order, with the numbers of rows and columns. */
export interface Table {
  d: Float64Array | Int32Array;
  r: number;
  c: number;
}

type List = Float64Array | Int32Array;

/** The largest list that code may create (ops.zeros, range as a value). */
const MAX_LENGTH = 10_000_000;

const MESSAGES = [
  "Something went wrong while evaluating this line.",
  "A position is out of range. Positions start at 0, and the last one is the length minus 1.",
  "Two lists that are combined have different lengths.",
  "Two tables that are combined have different shapes, or a list does not have one value for each column of the table.",
  "The smallest or largest element of an empty list was asked for.",
  "The step of a range cannot be 0.",
  "A whole number was needed, but the value is not a number or is infinite. A division by zero earlier can cause this.",
  "A whole number cannot be raised to a negative power. Write the base as a decimal number, for example 2.0 ** -1.",
  "A list would become too long.",
  "A list cannot have a negative length.",
];

/** Zero with the sign of x, as C's copysign(0, x). */
const signedZero = (x: number) => (x < 0 || (x === 0 && 1 / x < 0) ? -0 : 0);

/** Sort order of NumPy: ascending, with every NaN at the end. */
const order = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : x === y ? 0 : x !== x ? (y !== y ? 0 : 1) : -1);

/** A place in the generated code that can fail: the field and the line to report. */
export interface Site {
  field: string;
  line: number;
}

// The library is built once, not once for each program. With one copy of every function, V8
// can inline them into the generated code. With a copy for each program, a loop that calls
// them ran about a third slower from the second program on (measured with bench.ts).
function makeRuntime() {
  const fail = (code: number, site?: Site): never => {
    throw new RuntimeError(MESSAGES[code] ?? MESSAGES[0], site?.field ?? "", site?.line ?? 0);
  };

  /** Python's int() of a number, for sizes and shifts. */
  const int = (v: number, site?: Site): number => (Number.isFinite(v) ? Math.trunc(v) + 0 : fail(6, site));

  /** A size for a new list. */
  const size = (v: number, site?: Site): number => {
    const n = int(v, site);
    return n < 0 ? fail(9, site) : n > MAX_LENGTH ? fail(8, site) : n;
  };

  /** A position in a list of n elements, counted from the end when negative. */
  const ix = (i: number, n: number, site?: Site): number => {
    if (i < 0) i += n;
    return i >= 0 && i < n ? i : fail(1, site);
  };

  // NumPy's floor division and remainder of floats (npy_divmod), which follow CPython's float_divmod.
  const fdiv = (a: number, b: number): number => {
    if (b === 0) return a / b;
    const mod = a % b;
    let div = (a - mod) / b;
    if (mod !== 0 && b < 0 !== mod < 0) div -= 1;
    if (div === 0) return signedZero(a / b);
    const floor = Math.floor(div);
    return div - floor > 0.5 ? floor + 1 : floor;
  };
  const fmod = (a: number, b: number): number => {
    if (b === 0) return NaN;
    const mod = a % b;
    if (mod === 0) return signedZero(b);
    return b < 0 !== mod < 0 ? mod + b : mod;
  };

  // NumPy's minimum and maximum: a NaN wins, and of two equal values the second is returned.
  const min2 = (a: number, b: number): number => (a < b || a !== a ? a : b);
  const max2 = (a: number, b: number): number => (a > b || a !== a ? a : b);

  // C's pow, where JavaScript's differs: pow(1, y) and pow(-1, infinity) are 1.
  const pow = (a: number, b: number): number => {
    if (b === 2) return a * a;
    if (a === 1 || (a === -1 && (b === Infinity || b === -Infinity))) return 1;
    return Math.pow(a, b);
  };
  /** A whole number to a whole power of at least 0, by exact multiplications. */
  const wholePow = (a: number, b: number): number => {
    if (!(b < 2 ** 53)) return Math.pow(a, b);
    let result = 1;
    for (let base = a, e = b; e > 0; e = Math.floor(e / 2), base *= base) if (e % 2 === 1) result *= base;
    return result + 0;
  };

  /** Applies `step` down each column (axis 0) or along each row (axis 1), starting from `start`. */
  const fold = (t: Table, axis: number, start: number, step: (acc: number, v: number) => number, first: boolean, site?: Site): Float64Array => {
    const { d, r, c } = t, out = new Float64Array(axis === 0 ? c : r);
    if (first && (r === 0 || c === 0)) fail(4, site);
    for (let k = 0; k < out.length; k++) {
      const n = axis === 0 ? r : c, from = axis === 0 ? k : k * c, stride = axis === 0 ? c : 1;
      let acc = first ? d[from] : start;
      for (let j = first ? 1 : 0; j < n; j++) acc = step(acc, d[from + j * stride]);
      out[k] = acc;
    }
    return out;
  };

  /** Positions that sort the first n elements, with ties in index order. */
  const argsort = (a: List, n: number): Float64Array => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = i;
    return out.sort((i, j) => order(a[i], a[j]) || i - j);
  };

  const sum0 = (t: Table): Float64Array => fold(t, 0, 0, (acc, v) => acc + v, false);
  // np.sum starts from 0, so a sum of negative zeros is +0: hence the "+ 0"
  const sum1 = (t: Table): Float64Array => {
    const out = new Float64Array(t.r);
    for (let k = 0; k < t.r; k++) out[k] = npSum(t.d, k * t.c, (k + 1) * t.c) + 0;
    return out;
  };

  return {
    fail,
    npSum,
    ix,
    fdiv,
    fmod,
    min2,
    max2,
    pow,
    sum0,
    sum1,
    f64: (n: number) => new Float64Array(n),
    tab: (d: List, r: number, c: number): Table => ({ d, r, c }),
    sub: (a: List, from: number, to: number) => a.subarray(from, to),

    // ---- indexing ----
    /** a[low:high], clamped as Python does. An open end arrives as 0 or as infinity. */
    sl(a: List, low: number, high: number, site?: Site): List {
      const n = a.length;
      if (low !== low || high !== high) fail(6, site);
      if (low < 0) low += n;
      if (high < 0) high += n;
      low = Math.min(Math.max(low, 0), n);
      high = Math.min(Math.max(high, low), n);
      return a.subarray(low, high);
    },
    row(t: Table, i: number, site?: Site): List {
      const k = ix(i, t.r, site);
      return t.d.subarray(k * t.c, (k + 1) * t.c);
    },
    grp: (g: Int32Array[], i: number, site?: Site): Int32Array => g[ix(i, g.length, site)],

    // ---- arithmetic on single numbers ----
    // floor division and remainder of whole numbers: NumPy gives 0 for a zero divisor
    idiv: (a: number, b: number): number => (b === 0 ? 0 : fdiv(a, b) + 0),
    imod: (a: number, b: number): number => (b === 0 ? 0 : fmod(a, b) + 0),
    // the same for plain Python numbers, where Python stops with an error (see spec, section 4)
    pdiv: (a: number, b: number): number => (b === 0 ? a / b : fdiv(a, b) + 0),
    pmod: (a: number, b: number): number => (b === 0 ? NaN : fmod(a, b) + 0),
    /** Whole numbers from data or variables: NumPy refuses a negative power. */
    ipow: (a: number, b: number, site?: Site): number => (b < 0 ? fail(7, site) : wholePow(a, b)),
    /** Plain Python whole numbers: a negative power gives a decimal number. */
    ppow: (a: number, b: number): number => (b < 0 ? Math.pow(a, b) : wholePow(a, b)),
    abs: Math.abs,
    sqrt: Math.sqrt,
    floor: Math.floor,
    ceil: Math.ceil,
    exp: Math.exp,
    log: Math.log,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    /** np.round: a half goes to the even neighbor, and the sign of zero is kept. */
    round(x: number): number {
      if (!(Math.abs(x) < 4503599627370496)) return x;
      const low = Math.floor(x), part = x - low;
      const y = part > 0.5 || (part === 0.5 && low % 2 !== 0) ? low + 1 : low;
      return y === 0 ? signedZero(x) : y;
    },
    sign: (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : x === 0 ? 0 : NaN),

    // ---- the built-ins min and max: Python keeps the first of equal values and skips a NaN that is not first ----
    pymin(a: List, n: number, site?: Site): number {
      if (n === 0) fail(4, site);
      let m = a[0];
      for (let i = 1; i < n; i++) if (a[i] < m) m = a[i];
      return m;
    },
    pymax(a: List, n: number, site?: Site): number {
      if (n === 0) fail(4, site);
      let m = a[0];
      for (let i = 1; i < n; i++) if (a[i] > m) m = a[i];
      return m;
    },

    // ---- ops reductions ----
    npmin(a: List, n: number, site?: Site): number {
      if (n === 0) fail(4, site);
      let m = a[0];
      for (let i = 1; i < n; i++) m = min2(m, a[i]);
      return m;
    },
    npmax(a: List, n: number, site?: Site): number {
      if (n === 0) fail(4, site);
      let m = a[0];
      for (let i = 1; i < n; i++) m = max2(m, a[i]);
      return m;
    },
    mean0(t: Table): Float64Array {
      return sum0(t).map((v) => v / t.r);
    },
    mean1(t: Table): Float64Array {
      return sum1(t).map((v) => v / t.c);
    },
    prod0: (t: Table) => fold(t, 0, 1, (acc, v) => acc * v, false),
    prod1: (t: Table) => fold(t, 1, 1, (acc, v) => acc * v, false),
    min0: (t: Table, site?: Site) => fold(t, 0, 0, min2, true, site),
    min1: (t: Table, site?: Site) => fold(t, 1, 0, min2, true, site),
    max0: (t: Table, site?: Site) => fold(t, 0, 0, max2, true, site),
    max1: (t: Table, site?: Site) => fold(t, 1, 0, max2, true, site),

    // ---- ops on lists ----
    /** The first NaN if there is one, else the first smallest element. */
    argmin(a: List, n: number, site?: Site): number {
      if (n === 0) fail(4, site);
      let best = 0;
      for (let i = 0; i < n; i++) {
        if (a[i] !== a[i]) return i;
        if (a[i] < a[best]) best = i;
      }
      return best;
    },
    argmax(a: List, n: number, site?: Site): number {
      if (n === 0) fail(4, site);
      let best = 0;
      for (let i = 0; i < n; i++) {
        if (a[i] !== a[i]) return i;
        if (a[i] > a[best]) best = i;
      }
      return best;
    },
    argsort,
    sort(a: List, n: number): Float64Array {
      return argsort(a, n).map((i) => a[i]);
    },
    cumsum(a: List, n: number): Float64Array {
      const out = new Float64Array(n);
      for (let i = 0, acc = 0; i < n; i++) out[i] = acc = i === 0 ? a[0] : acc + a[i];
      return out;
    },
    /** The shift of ops.roll(a, k) as a number from 0 to n - 1. */
    rollk(k: number, n: number, site?: Site): number {
      const shift = int(k, site);
      return n === 0 ? 0 : ((shift % n) + n) % n;
    },
    roll(a: List, n: number, k: number, site?: Site): Float64Array {
      const out = new Float64Array(n), shift = n === 0 ? 0 : ((int(k, site) % n) + n) % n;
      for (let i = 0; i < n; i++) out[i + shift < n ? i + shift : i + shift - n] = a[i];
      return out;
    },
    dot(a: List, b: List, n: number, m: number, site?: Site): number {
      if (n !== m) fail(2, site);
      let s = 0;
      for (let i = 0; i < n; i++) s += a[i] * b[i];
      return s;
    },
    dot2(t: Table, b: List, m: number, site?: Site): Float64Array {
      if (t.c !== m) fail(3, site);
      const out = new Float64Array(t.r);
      for (let k = 0; k < t.r; k++) {
        let s = 0;
        for (let j = 0; j < m; j++) s += t.d[k * t.c + j] * b[j];
        out[k] = s;
      }
      return out;
    },

    // ---- making lists ----
    arr: (values: number[]) => Float64Array.from(values),
    zeros: (n: number, site?: Site) => new Float64Array(size(n, site)),
    ones: (n: number, site?: Site) => new Float64Array(size(n, site)).fill(1),
    arange(n: number, site?: Site): Float64Array {
      const out = new Float64Array(size(Math.max(int(n, site), 0), site));
      for (let i = 0; i < out.length; i++) out[i] = i;
      return out;
    },
    /** A bound of range(...) in a for loop. */
    rng: (v: number, site?: Site): number => (Number.isFinite(v) ? v : fail(6, site)),
    step: (v: number, site?: Site): number => (v === 0 ? fail(5, site) : Number.isFinite(v) ? v : fail(6, site)),
    /** range(start, stop, step) as a list. */
    range(start: number, stop: number, step: number, site?: Site): Float64Array {
      if (!(Number.isFinite(start) && Number.isFinite(stop) && Number.isFinite(step))) fail(6, site);
      if (step === 0) fail(5, site);
      const out = new Float64Array(size(Math.max(Math.ceil((stop - start) / step), 0), site));
      for (let i = 0; i < out.length; i++) out[i] = start + i * step;
      return out;
    },
  };
}

/** Everything generated code may call. */
export const runtime = makeRuntime();
