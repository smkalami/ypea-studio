// Native operators for the Genetic Algorithm and Simulated Annealing, from ypea's
// operators/__init__.py. A native operator works on the decoded values of one variable, so
// an ordering is changed as an ordering and not through its codes. Every operator keeps the
// invariant of its type: a permutation stays a permutation, k ones stay k ones, and values
// stay in their bounds.
//
// The draws follow ypea: an operator draws each kind of random number for the whole batch
// before the next kind, and it draws them even when a row ends up not using them.

import type { Rng } from "./rng.ts";
import type { Variable } from "./variables.ts";

/** The decoded value of one variable in one solution, flat in row-major order. */
export type Row = Float64Array | Int32Array;
/** One row per solution. */
export type Batch = Row[];

export interface Operators {
  /** Step size of the mutation. The solver updates it as its own step size decays. */
  sigma: number;
  crossover(x1: Batch, x2: Batch, rng: Rng): [Batch, Batch];
  mutate(x: Batch, rng: Rng): Batch;
}

/** ypea's defaults: `alpha` widens blend crossover, `rate` is the share of elements a mutation changes. */
export interface OperatorParams {
  alpha?: number;
  rate?: number;
  sigma?: number;
}

/** Python's round() and NumPy's for a non-negative number: halves go to the even neighbor. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 || (d === 0.5 && f % 2 === 0) ? f : f + 1;
}

const at = (value: number | number[], i: number) => (typeof value === "number" ? value : value[i]);
const clip = (x: number, low: number, high: number) => (x < low ? low : x > high ? high : x);
const copy = (x: Batch): Batch => x.map((row) => row.slice());

/** `count` draws of one kind, in order. */
function draws(count: number, draw: (index: number) => number): Float64Array {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = draw(i);
  return out;
}

/** Elements to change: each with probability `rate`, and at least one per row. */
function flags(rng: Rng, rows: number, size: number, rate: number): Uint8Array {
  const flag = new Uint8Array(rows * size);
  for (let i = 0; i < flag.length; i++) flag[i] = rng.random() < rate ? 1 : 0;
  for (let r = 0; r < rows; r++) flag[r * size + rng.integers(0, size)] = 1;
  return flag;
}

// array crossovers (any element type)

/** Each element comes from either parent with probability 1/2. */
export function uniformCrossover(x1: Batch, x2: Batch, rng: Rng): [Batch, Batch] {
  const y1 = copy(x1), y2 = copy(x2);
  for (let r = 0; r < x1.length; r++) {
    for (let i = 0; i < x1[r].length; i++) {
      if (rng.random() < 0.5) {
        y1[r][i] = x2[r][i];
        y2[r][i] = x1[r][i];
      }
    }
  }
  return [y1, y2];
}

/** The children swap the tails of the parents after a random cut. */
export function onePointCrossover(x1: Batch, x2: Batch, rng: Rng): [Batch, Batch] {
  const y1 = copy(x1), y2 = copy(x2), m = x1.length ? x1[0].length : 0;
  if (m < 2) return [y1, y2];
  const cut = draws(x1.length, () => rng.integers(1, m));
  for (let r = 0; r < x1.length; r++) {
    for (let i = cut[r]; i < m; i++) {
      y1[r][i] = x2[r][i];
      y2[r][i] = x1[r][i];
    }
  }
  return [y1, y2];
}

// permutation crossovers: one pair of rows, cut points i <= j

/** Position of every item in a permutation. */
function positions(p: Int32Array): Int32Array {
  const where = new Int32Array(p.length);
  p.forEach((item, k) => (where[item] = k));
  return where;
}

/** Which items lie in p[i..j). */
function segment(p: Int32Array, i: number, j: number): Uint8Array {
  const inside = new Uint8Array(p.length);
  for (let k = i; k < j; k++) inside[p[k]] = 1;
  return inside;
}

/** Order crossover (OX): keep p1[i..j), fill the rest in the order of p2 after j. */
export function orderCrossover(p1: Int32Array, p2: Int32Array, i: number, j: number): Int32Array {
  const m = p1.length, child = p1.slice(), inside = segment(p1, i, j);
  // both the free positions and the items of p2 are walked from j, around the end
  let from = 0;
  for (let t = 0; t < m; t++) {
    const pos = (t + j) % m;
    if (pos >= i && pos < j) continue;
    while (inside[p2[(from + j) % m]]) from++;
    child[pos] = p2[(from++ + j) % m];
  }
  return child;
}

/** Partially mapped crossover (PMX): keep p1[i..j), place the rest of p2 through the mapping. */
export function pmx(p1: Int32Array, p2: Int32Array, i: number, j: number): Int32Array {
  const child = p2.slice(), where1 = positions(p1), inside = segment(p1, i, j);
  for (let k = i; k < j; k++) child[k] = p1[k];
  for (let k = 0; k < p1.length; k++) {
    if (k >= i && k < j) continue;
    let x = p2[k];
    while (inside[x]) x = p2[where1[x]];
    child[k] = x;
  }
  return child;
}

/** Cycle crossover (CX): alternate cycles come from p1 and p2. The cut points are unused. */
export function cycleCrossover(p1: Int32Array, p2: Int32Array): Int32Array {
  const where1 = positions(p1), cycle = new Int32Array(p1.length).fill(-1);
  let c = 0;
  for (let s = 0; s < p1.length; s++) {
    let k = s;
    while (cycle[k] < 0) {
      cycle[k] = c;
      k = where1[p2[k]];
    }
    if (cycle[s] === c) c++;
  }
  return p1.map((item, k) => (cycle[k] % 2 === 1 ? p2[k] : item));
}

// permutation mutations: one row, two distinct positions i and j

export function swap(x: Int32Array, i: number, j: number): Int32Array {
  const y = x.slice();
  y[i] = x[j];
  y[j] = x[i];
  return y;
}

export function inversion(x: Int32Array, i: number, j: number): Int32Array {
  const low = Math.min(i, j), high = Math.max(i, j) + 1, y = x.slice();
  for (let k = low; k < high; k++) y[k] = x[low + high - 1 - k];
  return y;
}

/** Moves the item at position i to position j. */
export function insertion(x: Int32Array, i: number, j: number): Int32Array {
  const y = Array.from(x);
  y.splice(j, 0, y.splice(i, 1)[0]);
  return Int32Array.from(y);
}

export function scramble(x: Int32Array, i: number, j: number, rng: Rng): Int32Array {
  const low = Math.min(i, j), high = Math.max(i, j) + 1, y = x.slice();
  rng.permutation(high - low).forEach((from, k) => (y[low + k] = x[low + from]));
  return y;
}

const CROSSOVERS = [orderCrossover, pmx, cycleCrossover];
const MUTATIONS = [swap, inversion, insertion];

// the operators of each variable type

type Bounded = { lb: number | number[]; ub: number | number[] };

/** Blend crossover (BLX alpha) and Gaussian mutation with a step of sigma * (ub - lb). */
function realOperators({ lb, ub }: Bounded, { alpha = 0.1, rate = 0.1, sigma = 0.1 }: OperatorParams): Operators {
  return {
    sigma,
    crossover(x1, x2, rng) {
      const y1 = copy(x1), y2 = copy(x2);
      for (let r = 0; r < x1.length; r++) {
        for (let i = 0; i < x1[r].length; i++) {
          const a = rng.uniform(-alpha, 1 + alpha), u = x1[r][i], v = x2[r][i];
          y1[r][i] = clip(a * u + (1 - a) * v, at(lb, i), at(ub, i));
          y2[r][i] = clip(a * v + (1 - a) * u, at(lb, i), at(ub, i));
        }
      }
      return [y1, y2];
    },
    mutate(x, rng) {
      const y = copy(x), size = x[0].length, flag = flags(rng, x.length, size, rate);
      for (let r = 0; r < x.length; r++) {
        for (let i = 0; i < size; i++) {
          // a normal is drawn for every element, changed or not
          const step = flag[r * size + i] * rng.standardNormal();
          y[r][i] = clip(x[r][i] + step * this.sigma * (at(ub, i) - at(lb, i)), at(lb, i), at(ub, i));
        }
      }
      return y;
    },
  };
}

/**
 * Uniform crossover. A changed element creeps (with probability `creep`) by up to
 * sigma * (ub - lb) steps, at least one, or is reset to a different value. A binary variable
 * has no creep, so its reset is a bit flip.
 */
function integerOperators({ lb, ub }: Bounded, { rate = 0.1, sigma = 0.1 }: OperatorParams, creep: number): Operators {
  return {
    sigma,
    crossover: uniformCrossover,
    mutate(x, rng) {
      const rows = x.length, size = x[0].length, count = rows * size;
      const width = (k: number) => at(ub, k % size) - at(lb, k % size) + 1;
      const flag = flags(rng, rows, size, rate);
      const offset = draws(count, (k) => rng.integers(0, Math.max(width(k) - 1, 1)));
      // without creep its three batches are not drawn at all
      const none = new Float64Array(0);
      const step = creep ? draws(count, (k) => 1 + rng.integers(0, Math.max(roundHalfEven(this.sigma * (width(k) - 1)), 1))) : none;
      const down = creep ? draws(count, () => (rng.random() < 0.5 ? 1 : 0)) : none;
      const creeps = creep ? draws(count, () => (rng.random() < creep ? 1 : 0)) : none;
      const y = copy(x);
      for (let k = 0; k < count; k++) {
        if (!flag[k]) continue;
        const r = Math.floor(k / size), i = k % size, low = at(lb, i), value = x[r][i];
        y[r][i] = creeps[k]
          ? clip(value + (down[k] ? -step[k] : step[k]), low, at(ub, i))
          : low + ((value - low + 1 + offset[k]) % width(k));
      }
      return y;
    },
  };
}

/** For each pair one crossover, and for each row one move, picked at random from the lists. */
function permutationOperators(): Operators {
  return {
    sigma: 0,
    crossover(x1, x2, rng) {
      const a = x1 as Int32Array[], b = x2 as Int32Array[], n = a.length, m = n ? a[0].length : 0;
      const which = draws(n, () => rng.integers(0, CROSSOVERS.length));
      const cuts = draws(2 * n, () => rng.integers(0, m + 1));
      const y1: Batch = [], y2: Batch = [];
      for (let r = 0; r < n; r++) {
        const op = CROSSOVERS[which[r]], i = Math.min(cuts[2 * r], cuts[2 * r + 1]), j = Math.max(cuts[2 * r], cuts[2 * r + 1]);
        y1.push(op(a[r], b[r], i, j));
        y2.push(op(b[r], a[r], i, j));
      }
      return [y1, y2];
    },
    mutate(x, rng) {
      const a = x as Int32Array[], n = a.length, m = n ? a[0].length : 0;
      if (m < 2) return copy(x);
      const which = draws(n, () => rng.integers(0, MUTATIONS.length));
      const i = draws(n, () => rng.integers(0, m));
      const j = draws(n, () => rng.integers(0, m - 1)).map((d, r) => (i[r] + 1 + d) % m);
      return a.map((row, r) => MUTATIONS[which[r]](row, i[r], j[r]));
    },
  };
}

/**
 * Ordered selection of k distinct items out of n. Crossover takes an item from the other
 * parent at a random half of the positions, when the child does not hold it yet. Mutation
 * replaces one item with an unused one, or swaps two positions.
 */
function selectionOperators(n: number): Operators {
  return {
    sigma: 0,
    crossover(x1, x2, rng) {
      const y1 = copy(x1), y2 = copy(x2), k = x1.length ? x1[0].length : 0;
      const take = draws(x1.length * k, () => (rng.random() < 0.5 ? 1 : 0));
      for (let r = 0; r < x1.length; r++) {
        for (let i = 0; i < k; i++) {
          if (!take[r * k + i]) continue;
          // the child is checked as it stands now, with the items it already took
          if (!y1[r].includes(x2[r][i])) y1[r][i] = x2[r][i];
          if (!y2[r].includes(x1[r][i])) y2[r][i] = x1[r][i];
        }
      }
      return [y1, y2];
    },
    mutate(x, rng) {
      const rows = x.length, k = x[0].length;
      const replace = draws(rows, () => (rng.random() < 0.5 || k === 1 ? 1 : 0));
      const pos = draws(rows, () => rng.integers(0, k));
      const other = draws(rows, () => rng.integers(0, Math.max(n - k, 1)));
      const pos2 = draws(rows, () => rng.integers(0, Math.max(k - 1, 1))).map((d, r) => (pos[r] + 1 + d) % k);
      const y = copy(x);
      for (let r = 0; r < rows; r++) {
        if (replace[r] && n > k) {
          // the unused items, in index order
          const unused: number[] = [];
          for (let item = 0; item < n; item++) if (!x[r].includes(item)) unused.push(item);
          y[r][pos[r]] = unused[other[r]];
        } else if (k > 1) {
          y[r][pos[r]] = x[r][pos2[r]];
          y[r][pos2[r]] = x[r][pos[r]];
        }
      }
      return y;
    },
  };
}

/**
 * A 0 and 1 mask with exactly k ones. Crossover keeps the common ones and shares the others
 * at random between the two children. Mutation swaps a one and a zero.
 */
function binarySelectionOperators(k: number): Operators {
  const where = (row: Row, value: number) => Array.from(row.keys()).filter((i) => row[i] === value);
  return {
    sigma: 0,
    crossover(x1, x2, rng) {
      const y1: Batch = [], y2: Batch = [];
      for (let r = 0; r < x1.length; r++) {
        const a = x1[r], b = x2[r], c1 = a.map((v, i) => v & b[i]), c2 = c1.slice();
        const differ = Array.from(a.keys()).filter((i) => a[i] !== b[i]);
        const diff = Array.from(rng.permutation(differ.length), (p) => differ[p]);
        const half = Math.floor(diff.length / 2);
        diff.forEach((item, t) => ((t < half ? c1 : c2)[item] = 1));
        y1.push(c1);
        y2.push(c2);
      }
      return [y1, y2];
    },
    mutate(x, rng) {
      const rows = x.length, n = x[0].length, y = copy(x);
      if (k === n) return y;
      const one = draws(rows, () => rng.integers(0, k)), zero = draws(rows, () => rng.integers(0, n - k));
      for (let r = 0; r < rows; r++) {
        y[r][where(x[r], 1)[one[r]]] = 0;
        y[r][where(x[r], 0)[zero[r]]] = 1;
      }
      return y;
    },
  };
}

/** The native operators of a variable, or null if its type has none. */
export function defaultOperators(variable: Variable, params: OperatorParams = {}): Operators | null {
  const spec = variable.spec;
  switch (spec.type) {
    case "real":
      return realOperators(spec, params);
    case "integer":
      return integerOperators(spec, params, 0.5);
    case "binary":
      return integerOperators({ lb: 0, ub: 1 }, params, 0);
    case "permutation":
      return permutationOperators();
    case "selection":
      return selectionOperators(spec.n);
    case "binary_selection":
      return binarySelectionOperators(spec.k);
    default:
      return null;
  }
}

/** A solver's own operator on codes: batches of `rows` rows of `width` codes in, the same out. */
export type CodeOperator = (parts: Float64Array[], rows: number, width: number) => Float64Array[];

/**
 * The operators of one run: each variable's native operators, or the solver's code operators
 * on that variable's slice of the codes when its type has none.
 */
export class NativeOperators {
  private readonly variables: Variable[];
  private readonly dim: number;
  private readonly defaults: (Operators | null)[];

  constructor(variables: Variable[], params: OperatorParams = {}) {
    this.variables = variables;
    this.dim = variables.reduce((sum, v) => sum + v.codeSize, 0);
    this.defaults = variables.map((v) => defaultOperators(v, params));
  }

  setSigma(sigma: number): void {
    for (const d of this.defaults) if (d) d.sigma = sigma;
  }

  /**
   * Applies "crossover" (two parent batches in, two out) or "mutate" (one in, one out) to
   * batches of `rows` rows of codes, variable by variable, and returns batches of codes.
   */
  apply(method: "crossover" | "mutate", parents: Float64Array[], rows: number, rng: Rng, fallback: CodeOperator): Float64Array[] {
    const { dim } = this, out = parents.map((p) => new Float64Array(p.length));
    let start = 0;
    this.variables.forEach((v, index) => {
      const ops = this.defaults[index], width = v.codeSize;
      if (!ops) {
        const parts = parents.map((p) => {
          const part = new Float64Array(rows * width);
          for (let r = 0; r < rows; r++) part.set(p.subarray(r * dim + start, r * dim + start + width), r * width);
          return part;
        });
        fallback(parts, rows, width).forEach((y, o) => {
          for (let r = 0; r < rows; r++) out[o].set(y.subarray(r * width, (r + 1) * width), r * dim + start);
        });
      } else {
        // decode gives a buffer that the variable reuses, so every row is copied
        const values = parents.map((p) => Array.from({ length: rows }, (_, r) => (v.decode(p, r * dim + start) as Row).slice()));
        const results = method === "crossover" ? ops.crossover(values[0], values[1], rng) : [ops.mutate(values[0], rng)];
        results.forEach((y, o) => y.forEach((row, r) => v.encode!(row, out[o], r * dim + start)));
      }
      start += width;
    });
    return out;
  }
}
