import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gap, scaleOf, total, violation } from "./constraints.ts";
import { fromPlain, makeVariable, toPlain } from "./variables.ts";

test("violations are zero when a constraint holds and scaled when it does not", () => {
  assert.equal(violation("<=", 48.2, 50, 2), 0);
  assert.equal(violation("<=", 53, 50, 2), 1.5);
  assert.equal(violation(">=", 3, 5, 4), 0.5);
  assert.equal(violation(">=", 7, 5, 4), 0);
  assert.equal(violation("==", 5.25, 5, 0.5), 0.5);
  assert.equal(violation("==", 5.25, 5, 0.5, 0.25), 0);
  assert.equal(violation("==", 4.5, 5, 0.5, 0.25), 0.5);
  assert.equal(violation("<=", NaN, 50, 2), Infinity);
  assert.equal(violation("<=", Infinity, 50, 2), Infinity);
  assert.equal(violation("<=", -Infinity, 50, 2), 0);
  assert.equal(gap("<=", 48.2, 50), 48.2 - 50);
  assert.equal(total([0, 1.5, 0.25]), 1.75);
  assert.equal(total([]), 0);
});

test("the scale is the median positive gap, then the size of the sides, then 1", () => {
  // gaps 3, -2, 1, 7 against a limit of 50: the positive ones are 1, 3 and 7
  assert.equal(scaleOf("<=", [53, 48, 51, 57], [50, 50, 50, 50]), 3);
  assert.equal(scaleOf("<=", [53, 51], [50, 50]), 2);
  // never violated in the sample: the typical size of the two sides
  assert.equal(scaleOf("<=", [10, 20, 30], [50, 50, 50]), 50);
  // nothing to go by
  assert.equal(scaleOf("<=", [0, 0], [0, 0]), 1);
  assert.equal(scaleOf("<=", [], []), 1);
  // non-finite sides are left out, and the floor holds
  assert.equal(scaleOf("<=", [NaN, Infinity, 52], [50, 50, 50]), 2);
  assert.equal(scaleOf("<=", [1e-20, 2e-20], [0, 0]), 1e-12);
  assert.equal(scaleOf("==", [5.5, 4], [5, 5], 0.25), 0.5);
});

test("a typed-in solution is checked against its variable", () => {
  const cases = JSON.parse(readFileSync(new URL("../spec/parity/variables.json", import.meta.url), "utf8")).cases;
  // every value that ypea decodes is accepted, and comes back unchanged
  for (const { variable, decoded } of cases) {
    const v = makeVariable(variable);
    for (const plain of decoded) assert.deepEqual(toPlain(v, fromPlain(v, plain)), plain, JSON.stringify(variable));
  }
  const bad = (spec: object, plain: unknown, message: RegExp) =>
    assert.throws(() => fromPlain(makeVariable({ name: "v", ...spec }), plain), message);
  bad({ type: "real", shape: [], lb: -10, ub: 10 }, 11, /from -10 to 10/);
  bad({ type: "real", shape: [], lb: -10, ub: 10 }, "3", /numbers only/);
  bad({ type: "real", shape: [2], lb: 0, ub: 1 }, [0.5], /list of 2/);
  bad({ type: "real", shape: [2], lb: 0, ub: 1 }, [0.5, NaN], /numbers only/);
  bad({ type: "real", shape: [2, 2], lb: 0, ub: 1 }, [[0, 1], [1]], /2 rows of 2/);
  bad({ type: "integer", shape: [], lb: 0, ub: 5 }, 2.5, /whole number/);
  bad({ type: "binary", shape: [3] }, [0, 2, 1], /0 or 1/);
  bad({ type: "permutation", n: 3 }, [0, 1, 1], /different positions/);
  bad({ type: "permutation", n: 3 }, [0, 1, 3], /different positions/);
  bad({ type: "selection", n: 5, k: 2 }, [1, 1], /different positions/);
  bad({ type: "binary_selection", n: 4, k: 2 }, [1, 1, 1, 0], /exactly 2 ones/);
  bad({ type: "partition", n: 4, k: 2 }, [[0, 1], [2]], /exactly one group/);
  bad({ type: "partition", n: 4, k: 2 }, [[0, 1, 2, 3]], /2 groups/);
  bad({ type: "partition", n: 4, k: 2 }, [[0, 1], [1, 2, 3]], /exactly one group/);
  bad({ type: "binary_partition", n: 3, k: 2 }, [[1, 0, 1], [0, 0, 1]], /one 1 in every column/);
  bad({ type: "fixed_sum", shape: [3], target: 10 }, [5, 4, 2], /add up to 10/);
  bad({ type: "fixed_sum", shape: [3], target: 10 }, [12, -4, 2], /negative/);
  bad({ type: "fixed_row_sum", shape: [2, 2], target: [1, 2] }, [[0.5, 0.5], [1, 0.5]], /add up to 2/);
  bad({ type: "fixed_column_sum", shape: [2, 2], target: 1 }, [[0.5, 0.5], [0.5, 0.6]], /add up to 1/);
});
