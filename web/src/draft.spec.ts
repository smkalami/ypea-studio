// The rules of the screens that need no browser. Run from web/ with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import benchmark from "../../examples/benchmark.json" with { type: "json" };
import knapsack from "../../examples/knapsack.json" with { type: "json" };
import tsp from "../../examples/tsp.json" with { type: "json" };
import { METHODS } from "../../engine/methods/index.ts";
import { parseProject, type Project } from "../../engine/project.ts";
import { runProject } from "../../engine/run.ts";
import { checkProject } from "./protocol.ts";
import {
  blankProject, DEFAULT_SETUP, definitionOf, experimentsOf, FIRST, KIND_OF, newExperimentId, percentChange, projectFor,
  tidy, unsuited, withExperiment, withoutExperiment,
} from "./draft.ts";

test("a blank project asks for a variable, and runs once it has one and an objective", () => {
  const blank = blankProject();
  assert.deepEqual(blank.run, { method: "pso", settings: {}, budget: 20000, seed: 1 });
  assert.deepEqual(checkProject(blank), [{ where: "variables", message: "Add at least one variable." }]);
  blank.variables.push({ name: "x", type: "real", shape: [], lb: 0, ub: 1 });
  assert.deepEqual(checkProject(blank), [{ where: "objective", message: "Write what to minimize or maximize, or use a preset." }]);
  blank.objective.source = "x";
  assert.deepEqual(checkProject(blank), []);
});

test("the run is the first experiment, and the others follow", () => {
  let project = parseProject(structuredClone(benchmark));
  assert.deepEqual(experimentsOf(project), [{ id: FIRST, name: "Quick run", method: "pso", settings: {}, budget: 20000, seed: 1 }]);
  // a rename of the first experiment is stored in the run
  project = withExperiment(project, { ...experimentsOf(project)[0], name: "PSO quick run" });
  assert.equal(project.run.name, "PSO quick run");
  const id = newExperimentId(project);
  project = withExperiment(project, { ...DEFAULT_SETUP, id, name: "DE 20k", method: "de", seed: 7 });
  project = withExperiment(project, { ...DEFAULT_SETUP, id: newExperimentId(project), name: "Third" });
  assert.deepEqual(experimentsOf(project).map((e) => [e.id, e.name, e.method]), [["", "PSO quick run", "pso"], ["e2", "DE 20k", "de"], ["e3", "Third", "pso"]]);
  assert.deepEqual(checkProject(project), []);
  parseProject(structuredClone(project));

  // what an experiment runs is the project with that setup as its run, and nothing of the others
  const second = projectFor(project, experimentsOf(project)[1]);
  assert.deepEqual(second.run, { method: "de", settings: {}, budget: 20000, seed: 7, name: "DE 20k" });
  assert.equal("experiments" in second, false);
  assert.equal(runProject(parseProject(second)).method, "de");

  // a change of one experiment leaves the others alone
  project = withExperiment(project, { ...experimentsOf(project)[1], budget: 500 });
  assert.deepEqual(experimentsOf(project).map((e) => e.budget), [20000, 500, 20000]);
  // without the first, the next one becomes the run
  const promoted = withoutExperiment(project, FIRST);
  assert.deepEqual(experimentsOf(promoted).map((e) => [e.id, e.name]), [["", "DE 20k"], ["e3", "Third"]]);
  assert.equal(promoted.run.budget, 500);
  assert.deepEqual(experimentsOf(withoutExperiment(project, "e2")).map((e) => e.name), ["PSO quick run", "Third"]);
  // the only experiment stays
  assert.equal(experimentsOf(withoutExperiment(parseProject(structuredClone(benchmark)), FIRST)).length, 1);
});

test("a problem in the settings of an experiment is found by the check, and names the experiment", () => {
  const project: any = structuredClone(benchmark);
  project.experiments = [{ id: "a", name: "A", method: "de", settings: { w: 1 }, budget: 10, seed: 1 }, { id: "b", name: "B", method: "magic", settings: {}, budget: 10, seed: 1 }];
  project.run.settings = { w: -1 };
  assert.deepEqual(checkProject(project).map((i) => [i.where, i.message]), [
    ["experiment.", 'Particle Swarm Optimization: "w" must be a number from 0 to 10'],
    ["experiment.a", 'Differential Evolution has no setting "w"'],
    ["experiment.b", 'Unknown solver "magic".'],
  ]);
  project.experiments[0].budget = 0;
  assert.deepEqual(checkProject(project).map((i) => i.where), ["experiment.a"]);
  project.run.seed = -1;
  assert.deepEqual(checkProject(project).map((i) => i.where), ["experiment."]);
});

test("the definition changes with what a run uses, and with nothing else", () => {
  const project = parseProject(structuredClone(knapsack));
  const same = (change: (p: Project) => Project | void, expected: boolean) => {
    const copy = structuredClone(project);
    assert.equal(definitionOf(change(copy) ?? copy) === definitionOf(project), expected);
  };
  same((p) => void (p.name = "Other"), true);
  same((p) => void (p.description = "Other"), true);
  same((p) => void (p.run.name = "Other"), true);
  same((p) => withExperiment(p, { ...DEFAULT_SETUP, id: "e2", name: "More" }), true);
  same((p) => void (p.functions = ""), true);
  same((p) => ({ ...p, constraints: [...p.constraints!].map((c) => ({ unit: c.unit, right: c.right, op: c.op, left: c.left, name: c.name })) }), true);
  same((p) => void (p.run.seed = 2), false);
  same((p) => void (p.run.method = "ga"), false);
  same((p) => void (p.constraints![0].right = "51"), false);
  same((p) => void (p.objective.source += " "), false);
  same((p) => void ((p.data![0] as any).columns[0].values[0] += 1), false);
});

test("every type of variable has a kind, and a solver warns about the kinds it does not suit", () => {
  assert.equal(Object.keys(KIND_OF).length, 11);
  assert.deepEqual([KIND_OF.fixed_row_sum, KIND_OF.integer, KIND_OF.binary_partition, KIND_OF.partition], ["real", "integer", "binary", "ordering"]);
  assert.deepEqual(unsuited(parseProject(structuredClone(knapsack)), "pso"), ["binary"]);
  assert.deepEqual(unsuited(parseProject(structuredClone(knapsack)), "ga"), []);
  assert.deepEqual(unsuited(parseProject(structuredClone(tsp)), "de"), ["ordering"]);
  assert.deepEqual(unsuited(parseProject(structuredClone(benchmark)), "pso"), []);
  assert.deepEqual(unsuited(parseProject(structuredClone(benchmark)), "magic"), []);
  for (const method of Object.values(METHODS)) assert.ok(method.suits.includes("real"), method.id);
});

test("a percent change is given only when it means something", () => {
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(-150, -100), -50);
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(5, 0), undefined);
  assert.equal(percentChange(-5, 5), undefined);
  assert.equal(percentChange(0, 5), undefined);
  assert.equal(percentChange(NaN, 5), undefined);
  assert.equal(percentChange(5, Infinity), undefined);
});

test("a stored project comes back unchanged when it is sound, and repaired when it is not", () => {
  const project = parseProject(structuredClone(tsp));
  assert.equal(tidy(project), project);
  const blank = blankProject();
  assert.equal(tidy(blank), blank);
  for (const broken of [null, 7, [], {}, { variables: "x", data: [3, { kind: "columns" }, { kind: "matrix", values: 1 }], run: 5, experiments: [{}, { id: "a" }], constraints: [1] }]) {
    const repaired = tidy(broken);
    assert.ok(Array.isArray(repaired.variables) && typeof repaired.objective.source === "string" && typeof repaired.run.settings === "object");
    assert.ok(experimentsOf(repaired).every((e) => typeof e.id === "string" && typeof e.settings === "object"));
    assert.ok(repaired.data!.every((t) => (t.kind === "matrix" ? Array.isArray(t.values) : Array.isArray(t.columns))));
    // the check then says what is wrong, and does not throw
    assert.ok(checkProject(repaired).length > 0);
  }
});
