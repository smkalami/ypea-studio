import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  type Batch, cycleCrossover, defaultOperators, insertion, inversion, NativeOperators, onePointCrossover, orderCrossover, pmx,
  roundHalfEven, type Row, scramble, swap, uniformCrossover,
} from "./operators.ts";
import { Rng } from "./rng.ts";
import { fromPlain, makeVariable, toPlain, type Value, type Variable } from "./variables.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../spec/parity/${name}.json`, import.meta.url), "utf8"));
const batch = (v: Variable, plain: unknown[]): Batch<Value> => plain.map((row) => fromPlain(v, row));
const plain = (v: Variable, rows: Batch<Value>) => rows.map((row) => toPlain(v, row));
const ints = (rows: number[][]): Batch => rows.map((row) => Int32Array.from(row));
const lists = (rows: Batch) => rows.map((row) => Array.from(row));

test("every type with native operators encodes as ypea encodes it", () => {
  const { cases } = read("encode");
  assert.deepEqual([...new Set(cases.map((c: any) => c.variable.type))], ["real", "integer", "binary", "permutation", "selection", "binary_selection", "partition", "binary_partition"]);
  for (const { variable, values, encoded } of cases) {
    const v = makeVariable(variable);
    values.forEach((value: unknown, i: number) => {
      // codes sit at an offset, as they do inside a population
      const codes = new Float64Array(v.codeSize + 2).fill(9);
      v.encode!(fromPlain(v, value), codes, 2);
      assert.deepEqual(Array.from(codes), [9, 9, ...encoded[i]], `${JSON.stringify(variable)} row ${i}`);
      // a real value may come back one rounding step away, in ypea too, so only the other types are checked
      if (variable.type !== "real") assert.deepEqual(toPlain(v, v.decode(codes, 2)), value, `${JSON.stringify(variable)} row ${i} decodes back`);
    });
  }
});

test("halves round to the even neighbor, as in Python and NumPy", () => {
  assert.deepEqual([0, 0.5, 1.5, 2.4, 2.5, 2.6, 3.5, 7].map(roundHalfEven), [0, 0, 2, 2, 2, 3, 4, 7]);
});

test("types without native operators have no encoder and no operators", () => {
  for (const spec of [
    { name: "v", type: "fixed_sum", shape: [3], target: 1 },
    { name: "v", type: "fixed_row_sum", shape: [2, 3], target: 1 },
    { name: "v", type: "fixed_column_sum", shape: [2, 3], target: 1 },
  ]) {
    assert.equal(makeVariable(spec).encode, undefined);
    assert.equal(defaultOperators(makeVariable(spec)), null);
  }
});

test("the crossovers of two orderings match ypea at every pair of cut points", () => {
  const ops: Record<string, typeof orderCrossover> = { order_crossover: orderCrossover, pmx, cycle_crossover: cycleCrossover };
  for (const { name, p1, p2, children } of read("operators").orderings) {
    for (const [i, j, child] of children) {
      assert.deepEqual(Array.from(ops[name](Int32Array.from(p1), Int32Array.from(p2), i, j)), child, `${name} of ${p1} and ${p2} at ${i}, ${j}`);
    }
  }
});

test("the moves of an ordering match ypea at every pair of positions", () => {
  const ops: Record<string, typeof scramble> = { swap, inversion, insertion, scramble };
  for (const { name, x, i, j, seed, result, next } of read("operators").moves) {
    const rng = new Rng(seed);
    assert.deepEqual(Array.from(ops[name](Int32Array.from(x), i, j, rng)), result, `${name} at ${i}, ${j}`);
    assert.equal(rng.random(), next, `${name} uses the same number of draws`);
  }
});

test("the array crossovers match ypea", () => {
  const ops: Record<string, typeof uniformCrossover> = { uniform_crossover: uniformCrossover, one_point_crossover: onePointCrossover };
  for (const { name, x1, x2, seed, result, next } of read("operators").arrays) {
    const rng = new Rng(seed);
    assert.deepEqual(ops[name](ints(x1), ints(x2), rng).map(lists), result, `${name}, seed ${seed}`);
    assert.equal(rng.random(), next, `${name} uses the same number of draws`);
  }
});

test("the default operators of every type match ypea, value for value and draw for draw", () => {
  for (const { variable, params, method, seed, x1, x2, result, next } of read("operators").defaults) {
    const v = makeVariable(variable), ops = defaultOperators(v, params)!, rng = new Rng(seed);
    const got = method === "crossover" ? ops.crossover(batch(v, x1), batch(v, x2), rng) : [ops.mutate(batch(v, x1), rng)];
    const label = `${method} of ${JSON.stringify(variable)}`;
    assert.deepEqual(got.map((rows) => plain(v, rows)), result, label);
    assert.equal(rng.random(), next, `${label} uses the same number of draws`);
  }
});

// What must hold for a value of each type, whatever the operators did to it.
function assertValid(v: Variable, row: Value, label: string): void {
  const spec = v.spec;
  if (spec.type === "partition" || spec.type === "binary_partition") {
    // fromPlain refuses anything but k groups that hold every item once, or a table with one 1 in every column
    assert.doesNotThrow(() => fromPlain(v, toPlain(v, row)), label);
    return;
  }
  const values = Array.from(row as Row);
  const whole = (low: number, high: number) => values.every((x) => Number.isInteger(x) && x >= low && x <= high);
  const at = (bound: number | number[], i: number) => (typeof bound === "number" ? bound : bound[i]);
  if (spec.type === "real" || spec.type === "integer") {
    values.forEach((x, i) => assert.ok(x >= at(spec.lb, i) && x <= at(spec.ub, i) && (spec.type === "real" || Number.isInteger(x)), `${label}: ${x} is out of bounds`));
  } else if (spec.type === "binary") {
    assert.ok(whole(0, 1), `${label}: not 0 or 1`);
  } else if (spec.type === "permutation") {
    assert.deepEqual([...values].sort((a, b) => a - b), values.map((_, i) => i), `${label}: not a permutation`);
  } else if (spec.type === "selection") {
    assert.ok(values.length === spec.k && whole(0, spec.n - 1) && new Set(values).size === spec.k, `${label}: not ${spec.k} distinct items`);
  } else if (spec.type === "binary_selection") {
    assert.ok(values.length === spec.n && whole(0, 1) && values.reduce((a, b) => a + b, 0) === spec.k, `${label}: not ${spec.k} ones`);
  }
}

const SPECS = [
  { name: "v", type: "real", shape: [], lb: -1, ub: 3 },
  { name: "v", type: "real", shape: [2, 3], lb: [0, -5, 2, 0, 0, 1], ub: [1, 5, 2, 0.5, 9, 1] },
  { name: "v", type: "integer", shape: [5], lb: [-3, 0, 7, -40, 0], ub: [22, 1, 7, 40, 2] },
  { name: "v", type: "integer", shape: [], lb: 0, ub: 3 },
  { name: "v", type: "binary", shape: [6] },
  { name: "v", type: "binary", shape: [] },
  { name: "v", type: "permutation", n: 9 },
  { name: "v", type: "permutation", n: 2 },
  { name: "v", type: "permutation", n: 1 },
  { name: "v", type: "selection", n: 9, k: 4 },
  { name: "v", type: "selection", n: 5, k: 1 },
  { name: "v", type: "selection", n: 4, k: 4 },
  { name: "v", type: "binary_selection", n: 9, k: 4 },
  { name: "v", type: "binary_selection", n: 5, k: 1 },
  { name: "v", type: "binary_selection", n: 4, k: 4 },
  { name: "v", type: "partition", n: 9, k: 3 },
  { name: "v", type: "partition", n: 5, k: 1 },
  { name: "v", type: "partition", n: 1, k: 1 },
  { name: "v", type: "partition", n: 2, k: 4 },
  { name: "v", type: "binary_partition", n: 9, k: 3 },
  { name: "v", type: "binary_partition", n: 1, k: 2 },
];

for (const spec of SPECS) {
  test(`operators keep the invariant of ${JSON.stringify(spec).replace('"name":"v",', "")}`, () => {
    const v = makeVariable(spec), rng = new Rng(7), rows = 12;
    const ops = defaultOperators(v, { alpha: 0.5, rate: 0.4, sigma: 0.5 })!;
    // toPlain and fromPlain copy a value out of the buffer that decode reuses
    const decoded = (codes: Float64Array) => fromPlain(v, toPlain(v, v.decode(codes, 0)));
    let a: Batch<Value> = [], b: Batch<Value> = [];
    for (let r = 0; r < rows; r++) {
      a.push(decoded(rng.fill(new Float64Array(v.codeSize))));
      b.push(decoded(rng.fill(new Float64Array(v.codeSize))));
    }
    const check = (rowsOut: Batch<Value>, label: string) => {
      assert.equal(rowsOut.length, rows);
      rowsOut.forEach((row) => {
        assertValid(v, row, label);
        // A valid value survives the trip through its codes. A real value may come back one
        // rounding step away (in ypea too), and must still be a valid value.
        const codes = new Float64Array(v.codeSize);
        v.encode!(row, codes, 0);
        assert.ok(codes.every((c) => c >= 0 && c <= 1), `${label}: codes outside [0, 1]`);
        const back = decoded(codes);
        if (spec.type !== "real") assert.deepEqual(toPlain(v, back), toPlain(v, row), `${label}: does not decode back`);
        else {
          assertValid(v, back, `${label}, decoded back`);
          (back as Row).forEach((x, i) => assert.ok(Math.abs(x - (row as Row)[i]) <= 1e-14, `${label}: ${x} decodes back far from ${(row as Row)[i]}`));
        }
      });
    };
    for (let round = 0; round < 40; round++) {
      [a, b] = ops.crossover(a, b, rng);
      check(a, "first child");
      check(b, "second child");
      const inputs = plain(v, a);
      b = ops.mutate(a, rng);
      check(b, "mutant");
      assert.deepEqual(plain(v, a), inputs, "mutate must not change its input");
    }
  });
}

test("NativeOperators handles each variable on its own slice, and code operators fill the rest", () => {
  const variables = [
    { name: "x", type: "real", shape: [2], lb: -1, ub: 1 },
    { name: "g", type: "fixed_sum", shape: [5], target: 1 },
    { name: "p", type: "permutation", n: 5 },
  ].map(makeVariable);
  const dim = 2 + 5 + 5, rows = 6, rng = new Rng(3);
  const native = new NativeOperators(variables, {});
  const x1 = rng.fill(new Float64Array(rows * dim)), x2 = rng.fill(new Float64Array(rows * dim));
  const seen: number[][] = [];
  // a code operator that marks its slice, so the test can see where it was used
  const mark = (parts: Float64Array[], r: number, width: number) => {
    seen.push([parts.length, r, width]);
    return parts.map((part) => part.map(() => 0.25));
  };
  // a mutation changes each variable of a row with probability 1 / 3, and at least one per row
  let marked = 0;
  for (const [method, parents] of [["crossover", [x1, x2]], ["mutate", [x1]]] as const) {
    const out = native.apply(method, parents, rows, rng, mark);
    assert.equal(out.length, parents.length);
    out.forEach((y, o) => {
      for (let r = 0; r < rows; r++) {
        const row = Array.from(y.subarray(r * dim, (r + 1) * dim)), parent = Array.from(parents[o].subarray(r * dim, (r + 1) * dim));
        const kept = [[0, 2], [2, 7], [7, 12]].map(([a, b]) => row.slice(a, b).every((c, i) => c === parent[a + i]));
        assert.ok(method === "mutate" ? kept.includes(false) : !kept.includes(true), "a crossover changes every variable, a mutation at least one");
        if (!kept[1]) assert.deepEqual(row.slice(2, 7), [0.25, 0.25, 0.25, 0.25, 0.25], "the fixed sum slice comes from the code operator");
        if (!kept[2]) assert.deepEqual([...row.slice(7)].sort(), [0.1, 0.3, 0.5, 0.7, 0.9], "the ordering slice holds the codes of an ordering");
        assert.ok(row.slice(0, 2).every((c) => c >= 0 && c <= 1));
        if (method === "mutate" && !kept[1]) marked++;
      }
    });
  }
  // the code operator gets only the rows whose fixed sum the mutation picked
  assert.ok(marked > 0 && marked < rows, "the seed gives a mix of picked and kept rows");
  assert.deepEqual(seen, [[2, rows, 5], [1, marked, 5]]);
});
