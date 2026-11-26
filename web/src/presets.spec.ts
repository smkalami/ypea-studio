// Every preset writes text that the engine accepts and that gives the expected value.
// Run from web/ with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProject } from "../../engine/project.ts";
import { testCandidate } from "../../engine/run.ts";
import { CAPACITY_PRESET, capacityConstraint, OBJECTIVE_PRESETS, optionsFor } from "./presets.ts";

const project = (extra: object) => parseProject({
  format: "ypea-studio-project", version: 1, name: "Presets",
  data: [
    { name: "items", kind: "columns", columns: [{ name: "weight", unit: "kg", values: [3, 7, 4] }, { name: "value", values: [40, 90, 55] }] },
    { name: "cost", kind: "matrix", values: [[0, 2, 9], [2, 0, 6], [9, 6, 0]] },
  ],
  variables: [
    { name: "take", type: "binary", shape: [3] },
    { name: "amount", type: "real", shape: [3], lb: 0, ub: 10 },
    { name: "route", type: "permutation", n: 3 },
    { name: "offset", type: "real", shape: [], lb: -10, ub: 10 },
    { name: "gain", type: "integer", shape: [], lb: -10, ub: 10 },
    { name: "table", type: "real", shape: [2, 2], lb: 0, ub: 1 },
    { name: "groups", type: "partition", n: 3, k: 2 },
    { name: "pick", type: "binary_selection", n: 3, k: 1 },
  ],
  objective: { sense: "min", source: "0" },
  run: { method: "random", settings: {}, budget: 10, seed: 1 },
  ...extra,
});
const candidate = {
  take: [1, 0, 1], amount: [1, 2, 0.5], route: [2, 0, 1], offset: 1, gain: 2,
  table: [[0, 0], [0, 0]], groups: [[0, 1], [2]], pick: [0, 1, 0],
};
const preset = (id: string) => OBJECTIVE_PRESETS.find((p) => p.id === id)!;
const valueOf = (source: string) => testCandidate(project({ objective: { sense: "min", source } }), candidate).objective;

test("each objective preset gives the expected value on a small case", () => {
  assert.deepEqual(OBJECTIVE_PRESETS.map((p) => p.id), ["weighted-sum", "route-cost", "selected-total", "assignment-cost", "squared-error"]);
  // 3 * 1 + 7 * 2 + 4 * 0.5
  assert.equal(valueOf(preset("weighted-sum").write({ weights: "weight", x: "amount" })), 19);
  // 2 to 0, 0 to 1, 1 back to 2: 9 + 2 + 6
  const route = preset("route-cost").write({ distance: "cost", route: "route" });
  assert.equal(route, "sum(cost[route, ops.roll(route, -1)])");
  assert.equal(valueOf(route), 17);
  // items 0 and 2: 40 + 55
  assert.equal(valueOf(preset("selected-total").write({ values: "value", take: "take" })), 95);
  // row 0 takes column 2, row 1 column 0, row 2 column 1: 9 + 2 + 6
  assert.equal(valueOf(preset("assignment-cost").write({ cost: "cost", task: "route" })), 17);
  // the line 1 + 2 * weight gives 7, 15, 9 against 40, 90, 55
  const squared = preset("squared-error").write({ y: "value", x: "weight", offset: "offset", gain: "gain" });
  assert.equal(squared, "sum((value - (offset + gain * weight)) ** 2)");
  assert.equal(valueOf(squared), 33 ** 2 + 75 ** 2 + 46 ** 2);
});

test("the capacity limit preset adds a constraint in the unit of its column", () => {
  const names = { sizes: "weight", take: "take", limit: " 6.5 " };
  const constraint = capacityConstraint(names, project({}));
  assert.deepEqual(constraint, { name: "Total weight", left: "sum(weight * take)", op: "<=", right: "6.5", unit: "kg" });
  assert.equal(CAPACITY_PRESET.write(names), constraint.left);
  const seen = testCandidate(project({ constraints: [constraint] }), candidate);
  assert.deepEqual(seen.constraints, [{ name: "Total weight", op: "<=", unit: "kg", tolerance: 0, left: 7, right: 6.5, satisfied: false }]);
  // a column without a unit gives a constraint without one
  assert.equal("unit" in capacityConstraint({ ...names, sizes: "value" }, project({})), false);
});

test("a preset offers only the names that fit", () => {
  const p = project({});
  assert.deepEqual(optionsFor(p, "column"), ["weight", "value"]);
  assert.deepEqual(optionsFor(p, "matrix"), ["cost"]);
  assert.deepEqual(optionsFor(p, "number-variable"), ["offset", "gain"]);
  assert.deepEqual(optionsFor(p, "list-variable"), ["take", "amount", "route", "pick"]);
  assert.deepEqual(optionsFor(p, "yes-no-variable"), ["take", "pick"]);
  assert.deepEqual(optionsFor(p, "ordering-variable"), ["route"]);
  assert.deepEqual(optionsFor(p, "number"), []);
  // every need of every preset names a kind of thing that exists
  for (const one of [...OBJECTIVE_PRESETS, CAPACITY_PRESET]) for (const need of one.needs) assert.ok(need.from === "number" || optionsFor(p, need.from).length > 0);
});
