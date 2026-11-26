// Every preset writes text that the engine accepts and that gives the expected value.
// Run from web/ with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProject } from "../../engine/project.ts";
import { testCandidate } from "../../engine/run.ts";
import { CAPACITY_PRESET, capacityConstraint, CONSTRAINT_PRESETS, helpersNote, LOAD_PRESET, OBJECTIVE_PRESETS, optionsFor, presetConstraint, withHelpers } from "./presets.ts";

const project = (extra: object) => parseProject({
  format: "ypea-studio-project", version: 1, name: "Presets",
  data: [
    { name: "items", kind: "columns", columns: [{ name: "weight", unit: "kg", values: [3, 7, 4] }, { name: "value", values: [40, 90, 55] }] },
    { name: "cost", kind: "matrix", values: [[0, 2, 9], [2, 0, 6], [9, 6, 0]] },
    // a depot and three items
    { name: "far", kind: "matrix", values: [[0, 1, 2, 4], [1, 0, 8, 16], [2, 8, 0, 32], [4, 16, 32, 0]] },
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
  assert.deepEqual(OBJECTIVE_PRESETS.map((p) => p.id), ["weighted-sum", "route-cost", "routes-length", "selected-total", "assignment-cost", "squared-error"]);
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
  assert.deepEqual(optionsFor(p, "matrix"), ["cost", "far"]);
  assert.deepEqual(optionsFor(p, "groups-variable"), ["groups"]);
  assert.deepEqual(optionsFor(p, "text"), []);
  assert.deepEqual(optionsFor(p, "number-variable"), ["offset", "gain"]);
  assert.deepEqual(optionsFor(p, "list-variable"), ["take", "amount", "route", "pick"]);
  assert.deepEqual(optionsFor(p, "yes-no-variable"), ["take", "pick"]);
  assert.deepEqual(optionsFor(p, "ordering-variable"), ["route"]);
  assert.deepEqual(optionsFor(p, "number"), []);
  // every need of every preset names a kind of thing that exists
  for (const one of [...OBJECTIVE_PRESETS, ...CONSTRAINT_PRESETS]) for (const need of one.needs) assert.ok(need.from === "number" || need.from === "text" || optionsFor(p, need.from).length > 0);
});

test("the routes preset writes helper functions that give the length of every route, wherever the depot is", () => {
  const routes = preset("routes-length");
  const lengthOf = (depot: string, groups: number[][]) => {
    const names = { routes: "groups", distance: "far", depot };
    const { functions, added } = withHelpers(undefined, routes.helpers!(names));
    assert.deepEqual(added, ["route_length", "total_length"]);
    assert.equal(routes.write(names), "total_length(groups)");
    return testCandidate(project({ functions, objective: { sense: "min", source: routes.write(names) } }), { ...candidate, groups }).objective;
  };
  // depot in row 0, items in rows 1 to 3: 0 to 1 to 2 and back is 1 + 8 + 2, and 0 to 3 and back is 4 + 4
  assert.equal(lengthOf("0", [[0, 1], [2]]), 19);
  // an empty group is a route of length 0: 0 to 1 to 2 to 3 and back is 1 + 8 + 32 + 4
  assert.equal(lengthOf("0", [[0, 1, 2], []]), 45);
  // depot in row 2, so item 2 is row 3: 2 to 0 to 1 and back is 2 + 1 + 8, and 2 to 3 and back is 32 + 32
  assert.equal(lengthOf("2", [[0, 1], [2]]), 75);
  // depot in the last row: 3 to 0 to 1 and back is 4 + 1 + 16, and 3 to 2 and back is 32 + 32
  assert.equal(lengthOf(" 3 ", [[0, 1], [2]]), 85);
  // with the depot first, the text is the plain form
  assert.equal(routes.helpers!({ routes: "groups", distance: "far", depot: "0" })[0].text,
    "def route_length(g):\n    if len(g) == 0:\n        return 0\n    return far[0, g[0] + 1] + sum(far[g[:-1] + 1, g[1:] + 1]) + far[g[-1] + 1, 0]\n");
  // a depot that is not a row of the table is refused before anything is written
  const refuse = (depot: string) => routes.refuse!({ routes: "groups", distance: "far", depot }, project({}));
  assert.deepEqual([refuse("0"), refuse("3")], [undefined, undefined]);
  for (const depot of ["4", "-1", "1.5", "first"]) assert.equal(refuse(depot), "The row of the depot must be a whole number from 0 to 3.");
});

test("the largest load preset adds a constraint and its helper function", () => {
  const names = { groups: "groups", loads: "weight", limit: " 9 ", unit: "" };
  const constraint = presetConstraint(LOAD_PRESET, names, project({}));
  assert.deepEqual(constraint, { name: "Largest load", left: "heaviest_load(groups)", op: "<=", right: "9", unit: "kg" });
  const { functions } = withHelpers(undefined, LOAD_PRESET.helpers!(names));
  // the groups carry 3 + 7 and 4
  const seen = testCandidate(project({ functions, constraints: [constraint] }), candidate);
  assert.deepEqual(seen.constraints, [{ name: "Largest load", op: "<=", unit: "kg", tolerance: 0, left: 10, right: 9, satisfied: false }]);
  // a typed unit wins over the unit of the column, and a column without one gives none
  assert.equal(presetConstraint(LOAD_PRESET, { ...names, unit: " t " }, project({})).unit, "t");
  assert.equal("unit" in presetConstraint(LOAD_PRESET, { ...names, loads: "value" }, project({})), false);
  // the other constraint preset still gives its own constraint
  assert.equal(presetConstraint(CAPACITY_PRESET, { sizes: "weight", take: "take", limit: "5" }, project({})).left, "sum(weight * take)");
});

test("a preset never replaces a function that is already there", () => {
  const helpers = [{ name: "route_length", text: "def route_length(g):\n    return 1\n" }, { name: "total_length", text: "def total_length(groups):\n    return 2\n" }];
  // nothing there yet: both are added, with an empty line between them
  assert.deepEqual(withHelpers(undefined, helpers), { functions: helpers[0].text + "\n" + helpers[1].text, added: ["route_length", "total_length"], kept: [] });
  // one is there, written another way: it stays, and the other is added after the user's text
  const own = "def  route_length (stops):\n    return 7\n\n\n";
  const mixed = withHelpers(own, helpers);
  assert.deepEqual([mixed.added, mixed.kept], [["total_length"], ["route_length"]]);
  assert.equal(mixed.functions, "def  route_length (stops):\n    return 7\n\n" + helpers[1].text);
  // a longer name is another function
  assert.deepEqual(withHelpers("def route_length_2(g):\n    return 0\n", helpers).kept, []);
  // all there, or nothing to add: the text is not touched
  assert.equal(withHelpers(mixed.functions, helpers).functions, mixed.functions);
  assert.equal(withHelpers(own, []).functions, own);
  assert.equal(helpersNote(["route_length", "total_length"], []), "Added to Functions: route_length, total_length.");
  assert.equal(helpersNote(["total_length"], ["route_length"]), "Added to Functions: total_length. Functions already has route_length, which was kept as it is. Check that it does what this preset expects.");
  assert.equal(helpersNote([], []), "");
});
