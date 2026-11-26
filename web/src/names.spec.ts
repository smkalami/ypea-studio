// Finding and renaming the uses of a name: code is read as names, never as text.

import assert from "node:assert/strict";
import { test } from "node:test";
import knapsack from "../../examples/knapsack.json" with { type: "json" };
import linefit from "../../examples/linefit.json" with { type: "json" };
import tsp from "../../examples/tsp.json" with { type: "json" };
import vrp from "../../examples/vrp.json" with { type: "json" };
import { parseProject, type Project } from "../../engine/project.ts";
import { checkProject } from "./protocol.ts";
import { defNames, isName, refs, rename, renamedTexts, renameUses, usesOf } from "./names.ts";

const names = (code: string) => refs(code).map((r) => r.name);
const project = (example: unknown) => parseProject(structuredClone(example));

test("the tokenizer gives the names of an expression, and nothing that only looks like one", () => {
  assert.deepEqual(names("sum(weight * take)"), ["sum", "weight", "take"]);
  // a longer name that holds a shorter one is another name
  assert.deepEqual(names("weight_limit - weight2 + _weight + weightweight"), ["weight_limit", "weight2", "_weight", "weightweight"]);
  // a comment is not code, to the end of its line
  assert.deepEqual(names("a + b  # weight is not used here\n+ c"), ["a", "b", "c"]);
  assert.deepEqual(names("# weight"), []);
  // numbers: the e of an exponent is not a name
  assert.deepEqual(names("1e3 * x + 2.5e-3 * e + 1E+2 + .5 + 3"), ["x", "e"]);
  assert.deepEqual(names("x2e - 3"), ["x2e"]);
  // a name after a dot belongs to ops, and a keyword of a call is not a name of the project
  assert.deepEqual(names("ops.roll(route, -1) + roll"), ["ops", "route", "roll"]);
  assert.deepEqual(names("ops.sum(table, axis=0) + axis"), ["ops", "table", "axis"]);
  assert.deepEqual(names("ops.where(a == b, a, b)"), ["ops", "a", "b", "a", "b"]);
  // places are exact
  const [first, second] = refs("  gain*gain");
  assert.deepEqual([first, second], [{ name: "gain", start: 2, end: 6 }, { name: "gain", start: 7, end: 11 }]);
  assert.deepEqual([isName("weight_2"), isName("2weight"), isName("wei ght"), isName("")], [true, false, false, false]);
});

test("a rename changes the name and leaves longer names, comments and numbers alone", () => {
  assert.equal(rename("sum(weight * take) + weight_limit  # weight in kg", "weight", "mass"), "sum(mass * take) + weight_limit  # weight in kg");
  assert.equal(rename("e * 1e3 + ops.e", "e", "energy"), "energy * 1e3 + ops.e");
  assert.equal(rename("x + xx + x", "x", "position"), "position + xx + position");
  assert.equal(rename("ops.sum(t, axis=0)", "axis", "other"), "ops.sum(t, axis=0)");
  assert.equal(rename("no use here", "weight", "mass"), "no use here");
});

test("the uses of a data column are found in every place that can hold one", () => {
  const sack = project(knapsack);
  assert.deepEqual(usesOf(sack, "weight", "data"), [
    { where: "constraint.0", place: 'The constraint "Total weight"' },
    { where: "view", place: "The drawing" },
  ]);
  assert.deepEqual(usesOf(sack, "value", "data"), [{ where: "objective", place: "The objective" }]);
  // a name inside a longer name is not a use
  const longer = { ...sack, objective: { ...sack.objective, source: "sum(value_per_kg * take)  # value" } };
  assert.deepEqual(usesOf(longer, "value", "data"), []);
  // the columns of a drawing, and the expression of a fitted line
  const fit = project(linefit);
  assert.deepEqual(usesOf(fit, "voltage", "data").map((use) => use.where), ["objective", "view"]);
  assert.deepEqual(usesOf({ ...fit, objective: { ...fit.objective, source: "0" } }, "voltage", "data").map((use) => use.where), ["view"]);
  // a matrix by the name of its table, inside the functions: the function is named
  const routes = project(vrp);
  // and as the table of distances of the drawing
  assert.deepEqual(usesOf(routes, "distance", "data"), [{ where: "functions", place: "The function route_length" }, { where: "view", place: "The drawing" }]);
  assert.deepEqual(usesOf(routes, "demand", "data"), [{ where: "functions", place: "The function heaviest_load" }]);
});

/** The knapsack with a baseline that takes nothing. */
const withBaseline = (): Project => {
  const sack = project(knapsack);
  return { ...sack, baseline: { label: "Empty", solution: { take: Array.from({ length: 20 }, () => 0) } } };
};

test("the uses of a variable are the expressions, the drawing, the candidate and the stored solutions, never the functions", () => {
  const sack = withBaseline();
  assert.deepEqual(usesOf(sack, "take", "variable", { take: "0, 1" }).map((use) => use.where), ["objective", "constraint.0", "view", "candidate", "baseline"]);
  assert.deepEqual(usesOf(sack, "take", "variable", { take: "  " }).map((use) => use.where), ["objective", "constraint.0", "view", "baseline"]);
  const route = project(tsp);
  assert.ok(usesOf(route, "route", "variable").some((use) => use.where === "view"));
  // a function cannot see the variables, so the same word inside it is a name of its own
  const hidden = { ...sack, functions: "def twice(take):\n    return 2 * take\n" };
  assert.equal(usesOf(hidden, "take", "variable").some((use) => use.where === "functions"), false);
  assert.deepEqual(usesOf(sack, "nothing", "variable"), []);
  // a known solution counts too
  assert.deepEqual(usesOf({ ...sack, reference: { solution: { take: [1] } } }, "take", "variable").at(-1), { where: "reference", place: "The known solution" });
});

test("inside a function, its own parameters and names hide a data name", () => {
  const functions = [
    "def shadowed(weight):",
    "    return sum(weight)",
    "",
    "def local():",
    "    weight = 3",
    "    return weight",
    "",
    "def looped(groups):",
    "    total = 0",
    "    for weight in groups:",
    "        total += weight",
    "    return total",
    "",
    "def real(g):  # uses the weight column",
    "    if len(g) == 0:",
    "        return 0",
    "    return sum(weight[g]) + weight_limit",
    "",
  ].join("\n");
  const sack = { ...project(knapsack), functions, objective: { sense: "max", source: "real(take)" } } as Project;
  assert.deepEqual(usesOf(sack, "weight", "data").map((use) => use.place), ['The constraint "Total weight"', "The function real", "The drawing"]);
  const renamed = renameUses(sack, "weight", "mass", "data");
  assert.equal(renamed.functions, functions.replace("sum(weight[g])", "sum(mass[g])"));
  assert.equal(renamed.constraints![0].left, "sum(mass * take)");
  assert.deepEqual((renamed.view as { size?: string }).size, "mass");
  assert.deepEqual(defNames(functions), ["shadowed", "local", "looped", "real"]);
  assert.deepEqual(defNames(undefined), []);
});

test("a function is used where it is called, and its own definition is not a use", () => {
  const routes = project(vrp);
  assert.deepEqual(usesOf(routes, "route_length", "function"), [{ where: "functions", place: "The function total_length" }]);
  assert.deepEqual(usesOf(routes, "total_length", "function"), [{ where: "objective", place: "The objective" }]);
  assert.deepEqual(usesOf(routes, "heaviest_load", "function").map((use) => use.where), ["constraint.0"]);
  // the definition was renamed by hand, and the calls follow
  const edited = { ...routes, functions: routes.functions!.replace("def route_length(", "def leg_length(") };
  const followed = renameUses(edited, "route_length", "leg_length", "function");
  assert.equal(followed.functions, routes.functions!.replaceAll("route_length", "leg_length"));
  assert.deepEqual(checkProject(followed), []);
  // a matrix is used by the name of its table, here inside a function
  const moved = { ...routes, data: routes.data!.map((t) => (t.name === "distance" ? { ...t, name: "dist" } : t)) };
  assert.notDeepEqual(checkProject(moved), []);
  const carried = renameUses(moved, "distance", "dist", "data");
  assert.equal(refs(carried.functions!).some((r) => r.name === "distance"), false);
  assert.deepEqual(checkProject(carried), []);
});

test("a renamed variable is followed in the expressions, the drawing and the stored solutions, and the project still runs", () => {
  const sack = withBaseline();
  assert.deepEqual(checkProject(sack), []);
  const renamed = { ...sack, variables: sack.variables.map((v) => ({ ...v, name: "pick" })) };
  // before the uses follow, the check finds the old name
  assert.notDeepEqual(checkProject(renamed), []);
  const followed = renameUses(renamed, "take", "pick", "variable");
  assert.equal(followed.objective.source, "sum(value * pick)");
  assert.equal(followed.constraints![0].left, "sum(weight * pick)");
  assert.equal((followed.view as { variable: string }).variable, "pick");
  assert.deepEqual(Object.keys(followed.baseline!.solution), ["pick"]);
  assert.deepEqual(followed.baseline!.solution.pick, sack.baseline!.solution.take);
  assert.deepEqual(checkProject(followed), []);
  // the project that was given is not changed
  assert.equal(sack.objective.source, "sum(value * take)");

  // a column: the drawing names it as a plain name, and the functions and the variables keep theirs
  const fit = project(linefit);
  const moved = renameUses({ ...fit, data: [{ ...fit.data![0], columns: (fit.data![0] as any).columns.map((c: any) => (c.name === "voltage" ? { ...c, name: "volts" } : c)) }] } as Project, "voltage", "volts", "data");
  assert.deepEqual(checkProject(moved), []);
  assert.equal((moved.view as { x: string }).x, "volts");
  assert.ok(!moved.objective.source.includes("voltage") && moved.objective.source.includes("volts"));
});

test("the typed candidate keeps its text under the new name, and under the old one for an undo", () => {
  assert.deepEqual(renamedTexts({ take: "1, 0", other: "2" }, "take", "pick"), { take: "1, 0", other: "2", pick: "1, 0" });
  const texts = { other: "2" };
  assert.equal(renamedTexts(texts, "take", "pick"), texts);
});
