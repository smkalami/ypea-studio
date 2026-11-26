import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gap, measure, scaleOf, total, violation } from "./constraints.ts";
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

test("an == constraint holds within a fixed amount plus a fraction of the size of the right side", () => {
  // abs(left - right) <= tolerance + relative_tolerance * abs(right), with the allowed amount added up first
  assert.equal(gap("==", 10.4, 10, 0, 0.05), Math.abs(10.4 - 10) - (0 + 0.05 * 10));
  assert.equal(gap("==", 10.4, 10, 0.25, 0.05), Math.abs(10.4 - 10) - (0.25 + 0.05 * 10));
  assert.ok(gap("==", 10.4, 10, 0, 0.05) <= 0 && gap("==", 10.6, 10, 0, 0.05) > 0 && gap("==", 10.6, 10, 0.25, 0.05) <= 0);
  // the size of the right side counts, not its sign, and the left side does not count at all
  assert.equal(gap("==", -10.4, -10, 0, 0.05), gap("==", 10.4, 10, 0, 0.05));
  assert.ok(gap("==", 10, 10.6, 0, 0.05) > 0 && gap("==", 10, 9.5, 0, 0.05) > 0 && gap("==", 10, 10.5, 0, 0.05) <= 0);
  // on a right side of zero the relative part adds nothing: the constraint is exact, or as wide as the fixed amount
  for (const left of [0, 1e-300, -0.3, 7]) {
    assert.equal(gap("==", left, 0, 0, 0.5), gap("==", left, 0));
    assert.equal(gap("==", left, 0, 0.25, 0.5), gap("==", left, 0, 0.25));
    assert.equal(gap("==", left, -0, 0, 1e300), Math.abs(left));
  }
  assert.equal(violation("==", 1e-300, 0, 2, 0, 0.5), 5e-301);
  assert.equal(violation("==", 0, 0, 2, 0, 0.5), 0);
  // without tolerances, and with a fixed amount only, every number is what it was before the relative part existed
  for (const [left, right] of [[5.25, 5], [4.5, 5], [0.1 + 0.2, 0.3], [-3, 2], [1e17, 1], [0, 0], [-0, 5]]) {
    for (const tolerance of [0, 0.25, 1e-9]) {
      assert.equal(gap("==", left, right, tolerance, 0), Math.abs(left - right) - tolerance);
      assert.equal(gap("==", left, right, tolerance), Math.abs(left - right) - tolerance);
    }
    // only == has tolerances
    assert.equal(gap("<=", left, right, 0.25, 0.5), left - right);
    assert.equal(gap(">=", left, right, 0.25, 0.5), right - left);
  }
  // a side that is not a finite number never holds, whatever the tolerances
  for (const [left, right] of [[NaN, 5], [5, NaN], [Infinity, 5], [5, Infinity], [5, -Infinity], [Infinity, Infinity], [-Infinity, -Infinity], [NaN, NaN]]) {
    for (const [tolerance, relative] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [Infinity, 0]]) {
      assert.equal(gap("==", left, right, tolerance, relative) <= 0, false, `${left} == ${right} with ${tolerance} and ${relative}`);
      assert.equal(violation("==", left, right, 2, tolerance, relative), Infinity);
    }
  }
  // 0.25 is allowed: the gaps are 0.25, 0.75 and one below zero, and the scale is the median of the positive ones
  assert.equal(scaleOf("==", [5.5, 4, 5.2], [5, 5, 5], 0.05, 0.04), 0.5);
  assert.equal(scaleOf("==", [5.5, 4], [5, 5], 0.25, 0), scaleOf("==", [5.5, 4], [5, 5], 0.25));
});

test("a constraint is measured in its own unit: the excess, the plain difference and its percentage of the limit", () => {
  assert.deepEqual(measure("<=", 53, 50), { excess: 3, difference: 3, differencePercent: 6 });
  assert.deepEqual(measure("<=", 48, 50), { excess: -2, difference: -2, differencePercent: 4 });
  assert.deepEqual(measure(">=", 3, 5), { excess: 2, difference: -2, differencePercent: 40 });
  assert.deepEqual(measure(">=", 3, -5), { excess: -8, difference: 8, differencePercent: 160 });
  // for == the excess is counted after the tolerances, and the difference is not
  assert.deepEqual(measure("==", 5.5, 5, 0.25, 0.01), { excess: 0.5 - (0.25 + 0.01 * 5), difference: 0.5, differencePercent: 10 });
  assert.deepEqual(measure("==", 4.75, 5, 0.25), { excess: 0, difference: -0.25, differencePercent: 5 });
  // no percentage of a limit of zero, or of a value that is not finite
  assert.deepEqual(measure("<=", 3, 0), { excess: 3, difference: 3 });
  assert.deepEqual(measure("==", 0, 0, 0, 0.5), { excess: 0, difference: 0 });
  assert.deepEqual(measure("<=", Infinity, 50), { excess: Infinity, difference: Infinity });
  assert.deepEqual(measure("<=", 3, Infinity), { excess: -Infinity, difference: -Infinity });
  assert.deepEqual(Object.keys(measure("<=", NaN, 50)), ["excess", "difference"]);
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
