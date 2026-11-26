// The 11 variable types: how each is written in a project file, checked, and decoded from
// codes in [0, 1]. Decoding follows ypea's variables.py, so both sides give the same values.

import { npSum } from "./numpy.ts";

export type VariableSpec =
  | { name: string; type: "real" | "integer"; shape: number[]; lb: number | number[]; ub: number | number[]; unit?: string }
  | { name: string; type: "binary"; shape: number[]; unit?: string }
  | { name: string; type: "permutation"; n: number }
  | { name: string; type: "selection" | "binary_selection" | "partition" | "binary_partition"; n: number; k: number }
  | { name: string; type: "fixed_sum" | "fixed_row_sum" | "fixed_column_sum"; shape: number[]; target: number | number[]; unit?: string };

/** A decoded value. Arrays are flat in row-major order. A partition is a list of groups. */
export type Value = Float64Array | Int32Array | Int32Array[];

export interface Variable {
  spec: VariableSpec;
  /** How many codes the variable uses. */
  codeSize: number;
  /** Shape of the decoded value: [] for one number, [n] or [rows, columns]. A partition has [k] groups. */
  shape: number[];
  /** Decodes into a buffer the variable owns. The result is valid until the next call. */
  decode(codes: Float64Array, offset: number): Value;
}

/** Largest number of codes one variable may use. A shared project file is untrusted input. */
const MAX_CODES = 100_000;

const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown, low: number): v is number => Number.isInteger(v) && (v as number) >= low && (v as number) <= MAX_CODES;
const at = (value: number | number[], i: number) => (typeof value === "number" ? value : value[i]);

/** Checks a variable from a project file and builds its decoder. Throws a message for the user. */
export function makeVariable(raw: any): Variable {
  if (typeof raw?.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.name)) {
    throw new Error(`every variable needs a "name" made of letters, digits and underscores`);
  }
  const fail = (message: string): never => {
    throw new Error(`variable "${raw.name}": ${message}`);
  };
  const shape = (dims: number[]): number[] => {
    const ok = Array.isArray(raw.shape) && dims.includes(raw.shape.length) && raw.shape.every((n: unknown) => isCount(n, 1));
    if (!ok) fail(`"shape" must be ${dims.map((d) => ["[]", "[n]", "[rows, columns]"][d]).join(" or ")}`);
    return raw.shape;
  };
  const values = (key: string, size: number, integer = false) => {
    const v = raw[key];
    const good = (x: unknown) => isFinite(x) && (!integer || Number.isInteger(x));
    if (!(good(v) || (Array.isArray(v) && v.length === size && v.every(good)))) {
      fail(`"${key}" must be ${integer ? "a whole number" : "a number"} or a list of ${size}`);
    }
  };
  const count = (key: string, low: number) => {
    if (!isCount(raw[key], low)) fail(`"${key}" must be a whole number, at least ${low}`);
    return raw[key] as number;
  };
  const sized = (variable: Variable): Variable => {
    if (variable.codeSize > MAX_CODES) fail(`it is too large (${variable.codeSize} values, the limit is ${MAX_CODES})`);
    return variable;
  };

  switch (raw.type) {
    case "real":
    case "integer":
    case "binary": {
      const s = shape([0, 1, 2]), size = s.reduce((a, b) => a * b, 1);
      const integer = raw.type !== "real";
      const lb = raw.type === "binary" ? 0 : raw.lb, ub = raw.type === "binary" ? 1 : raw.ub;
      if (raw.type !== "binary") {
        values("lb", size, integer);
        values("ub", size, integer);
        for (let i = 0; i < size; i++) if (at(ub, i) < at(lb, i)) fail("upper bound is below lower bound");
      }
      const out = integer ? new Int32Array(size) : new Float64Array(size);
      return sized({
        spec: raw, codeSize: size, shape: s,
        decode(codes, offset) {
          for (let i = 0; i < size; i++) {
            const c = codes[offset + i], low = at(lb, i), high = at(ub, i);
            // the cap keeps code 1.0 at the upper bound
            out[i] = integer ? low + Math.min(Math.floor((high - low + 1) * c), high - low) : low + (high - low) * c;
          }
          return out;
        },
      });
    }

    case "permutation":
    case "selection":
    case "binary_selection": {
      const n = count("n", 1), k = raw.type === "permutation" ? n : count("k", 1);
      if (k > n) fail(`"k" must be at most "n"`);
      const order = new Int32Array(n), mask = new Int32Array(n);
      return sized({
        spec: raw, codeSize: n, shape: [raw.type === "selection" ? k : n],
        decode(codes, offset) {
          argsort(codes, offset, order);
          if (raw.type !== "binary_selection") return order.subarray(0, k);
          mask.fill(0);
          for (let i = 0; i < k; i++) mask[order[i]] = 1;
          return mask;
        },
      });
    }

    case "partition":
    case "binary_partition": {
      // n items and k - 1 separators are sorted together, and the separators cut the order into k groups
      const n = count("n", 1), k = count("k", 1);
      const order = new Int32Array(n + k - 1), matrix = new Int32Array(raw.type === "partition" ? 0 : k * n);
      return sized({
        spec: raw, codeSize: n + k - 1, shape: raw.type === "partition" ? [k] : [k, n],
        decode(codes, offset) {
          argsort(codes, offset, order);
          const groups: Int32Array[] = [];
          let start = 0;
          for (let i = 0; i <= order.length; i++) {
            if (i === order.length || order[i] >= n) {
              groups.push(order.subarray(start, i));
              start = i + 1;
            }
          }
          if (raw.type === "partition") return groups;
          matrix.fill(0);
          groups.forEach((group, j) => group.forEach((item) => (matrix[j * n + item] = 1)));
          return matrix;
        },
      });
    }

    case "fixed_sum":
    case "fixed_row_sum":
    case "fixed_column_sum": {
      const s = shape(raw.type === "fixed_sum" ? [1, 2] : [2]), size = s.reduce((a, b) => a * b, 1);
      const columns = s[s.length - 1];
      // each element belongs to one group whose sum is fixed: everything, its row, or its column
      const groupCount = raw.type === "fixed_sum" ? 1 : raw.type === "fixed_row_sum" ? s[0] : s[1];
      const groupOf = (i: number) => (raw.type === "fixed_sum" ? 0 : raw.type === "fixed_row_sum" ? Math.floor(i / columns) : i % columns);
      values("target", groupCount);
      const out = new Float64Array(size), sums = new Float64Array(groupCount);
      return sized({
        spec: raw, codeSize: size, shape: s,
        decode(codes, offset) {
          // as NumPy adds: in pairs over everything or over a row, in index order down a column
          if (raw.type === "fixed_column_sum") {
            sums.fill(0);
            for (let i = 0; i < size; i++) sums[i % columns] += codes[offset + i];
          } else {
            const width = size / groupCount;
            for (let g = 0; g < groupCount; g++) sums[g] = npSum(codes, offset + g * width, offset + (g + 1) * width);
          }
          for (let i = 0; i < size; i++) {
            const g = groupOf(i), target = at(raw.target, g);
            // all zero codes would give 0 / 0, so the target is shared equally instead
            out[i] = sums[g] > 0 ? (target * codes[offset + i]) / sums[g] : target / (size / groupCount);
          }
          return out;
        },
      });
    }

    default:
      return fail(`type "${raw.type}" is not known`);
  }
}

/** Stable sort order of `out.length` codes: ties keep their index order. */
function argsort(codes: Float64Array, offset: number, out: Int32Array): void {
  for (let i = 0; i < out.length; i++) out[i] = i;
  out.sort((i, j) => codes[offset + i] - codes[offset + j] || i - j);
}

/** A decoded value as plain JSON, shaped like the variable: a number, a list, or rows. */
export function toPlain(variable: Variable, value: Value): unknown {
  if (Array.isArray(value)) return value.map((group) => Array.from(group));
  const flat = Array.from(value as ArrayLike<number>);
  if (variable.shape.length === 0) return flat[0];
  if (variable.shape.length === 1) return flat;
  const columns = variable.shape[1];
  return Array.from({ length: variable.shape[0] }, (_, r) => flat.slice(r * columns, (r + 1) * columns));
}

/**
 * The reverse of toPlain, for a solution that a person typed or a file supplied: checks that
 * the value is a valid value of the variable and returns it in the engine's form. Throws a
 * message for the user.
 */
export function fromPlain(variable: Variable, plain: unknown): Value {
  const spec = variable.spec;
  const fail = (message: string): never => {
    throw new Error(`"${spec.name}" ${message}`);
  };
  const whole = (v: unknown, low: number, high: number): v is number => Number.isInteger(v) && (v as number) >= low && (v as number) <= high;

  if (spec.type === "partition") {
    const ok = Array.isArray(plain) && plain.length === spec.k && plain.every((g) => Array.isArray(g) && g.every((i) => whole(i, 0, spec.n - 1)));
    if (!ok) fail(`must be ${spec.k} groups of positions from 0 to ${spec.n - 1}`);
    const groups = plain as number[][], all = groups.flat();
    if (all.length !== spec.n || new Set(all).size !== spec.n) fail(`must place every position from 0 to ${spec.n - 1} in exactly one group`);
    return groups.map((g) => Int32Array.from(g));
  }

  // every other type is a number, a list or rows of numbers, with the variable's shape
  const [rows, columns] = variable.shape;
  let flat: unknown[];
  if (variable.shape.length === 0) flat = [plain];
  else if (variable.shape.length === 1) flat = Array.isArray(plain) && plain.length === rows ? plain : fail(`must be a list of ${rows} numbers`);
  else {
    const ok = Array.isArray(plain) && plain.length === rows && plain.every((r) => Array.isArray(r) && r.length === columns);
    flat = ok ? (plain as unknown[][]).flat() : fail(`must be ${rows} rows of ${columns} numbers`);
  }
  if (!flat.every((v) => typeof v === "number" && Number.isFinite(v))) fail("must hold numbers only");
  const v = flat as number[], size = v.length;
  const at = (bound: number | number[], i: number) => (typeof bound === "number" ? bound : bound[i]);
  const distinct = () => new Set(v).size === size;
  // sums typed by hand are rounded, so a fixed sum may be off by a little
  const near = (sum: number, target: number) => Math.abs(sum - target) <= 1e-9 * Math.max(1, Math.abs(target));

  switch (spec.type) {
    case "real":
    case "integer":
      v.forEach((x, i) => {
        if (x < at(spec.lb, i) || x > at(spec.ub, i)) fail(`must be from ${at(spec.lb, i)} to ${at(spec.ub, i)}, got ${x}`);
        if (spec.type === "integer" && !Number.isInteger(x)) fail(`must be a whole number, got ${x}`);
      });
      return spec.type === "real" ? Float64Array.from(v) : Int32Array.from(v);
    case "binary":
      if (!v.every((x) => x === 0 || x === 1)) fail("must be 0 or 1");
      return Int32Array.from(v);
    case "permutation":
    case "selection":
      if (!v.every((x) => whole(x, 0, spec.n - 1)) || !distinct()) fail(`must be ${size} different positions from 0 to ${spec.n - 1}`);
      return Int32Array.from(v);
    case "binary_selection":
      if (!v.every((x) => x === 0 || x === 1) || v.reduce<number>((a, b) => a + b, 0) !== spec.k) fail(`must be 0 or 1, with exactly ${spec.k} ones`);
      return Int32Array.from(v);
    case "binary_partition":
      for (let j = 0; j < columns; j++) {
        let ones = 0;
        for (let r = 0; r < rows; r++) ones += v[r * columns + j] === 1 ? 1 : v[r * columns + j] === 0 ? 0 : NaN;
        if (ones !== 1) fail("must be 0 or 1, with exactly one 1 in every column");
      }
      return Int32Array.from(v);
    case "fixed_sum":
    case "fixed_row_sum":
    case "fixed_column_sum": {
      if (!v.every((x) => x >= 0)) fail("must not hold negative numbers");
      const groups = spec.type === "fixed_sum" ? 1 : spec.type === "fixed_row_sum" ? rows : columns;
      const sums = new Array<number>(groups).fill(0);
      const width = variable.shape[variable.shape.length - 1];
      v.forEach((x, i) => (sums[spec.type === "fixed_sum" ? 0 : spec.type === "fixed_row_sum" ? Math.floor(i / width) : i % width] += x));
      sums.forEach((s, g) => {
        if (!near(s, at(spec.target, g))) fail(`must add up to ${at(spec.target, g)}, got ${s}`);
      });
      return Float64Array.from(v);
    }
  }
  return fail("has a type that is not known");
}
