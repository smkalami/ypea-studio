// The suggested starting solver: the table of the rule, and when an experiment follows it.

import assert from "node:assert/strict";
import { test } from "node:test";
import knapsack from "../../examples/knapsack.json" with { type: "json" };
import tsp from "../../examples/tsp.json" with { type: "json" };
import vrp from "../../examples/vrp.json" with { type: "json" };
import { METHODS, resolveSettings } from "../../engine/methods/index.ts";
import type { Project } from "../../engine/project.ts";
import { blankProject, DEFAULT_SETUP, experimentsOf, FIRST, withExperiment } from "./draft.ts";
import { follow, sameSetup, suggest, suggestionSentence } from "./suggest.ts";

const CMAES = { method: "cmaes", settings: {} };
const SA = { method: "sa", settings: { space: "native", initial_temp: 10, final_temp: 0.01, mutation_step_size: 0.3, mutation_step_size_damp: 1 } };
const GA_CODES = { method: "ga", settings: { mutation_step_size: 0.3, mutation_step_size_damp: 1 } };
const GA_VALUES = { method: "ga", settings: { space: "native" } };

// The whole rule, as it was measured. A change of the rule changes this table and nothing else.
const TABLE: [types: string[], expected: { method: string; settings: object }][] = [
  [[], CMAES],
  [["real"], CMAES],
  [["fixed_sum"], CMAES],
  [["fixed_row_sum"], CMAES],
  [["fixed_column_sum"], CMAES],
  [["real", "fixed_sum", "fixed_row_sum", "fixed_column_sum"], CMAES],
  [["permutation"], SA],
  [["selection"], SA],
  [["binary_selection"], SA],
  [["partition"], SA],
  [["binary_partition"], SA],
  [["permutation", "partition", "selection"], SA],
  [["binary"], GA_CODES],
  [["integer"], GA_CODES],
  [["binary", "integer"], GA_CODES],
  [["binary", "real"], GA_CODES],
  [["integer", "fixed_sum"], GA_CODES],
  [["permutation", "real"], GA_VALUES],
  [["permutation", "binary"], GA_VALUES],
  [["partition", "integer"], GA_VALUES],
  [["binary_selection", "real", "binary"], GA_VALUES],
];

test("the suggestion follows the table, with 20,000 evaluations in every case", () => {
  for (const [types, expected] of TABLE) {
    const { method, settings, budget, why } = suggest(types.map((type) => ({ type })));
    assert.deepEqual({ method, settings }, expected, types.join(", ") || "no variables");
    assert.equal(budget, 20000);
    // the engine accepts every suggested setup
    resolveSettings(METHODS[method], settings);
    assert.match(why, /^(because|as a start)/);
  }
  // a type that is not known counts for nothing, and the order of the variables does not matter
  assert.equal(suggest([{ type: "magic" }, {}, { type: "real" }]).method, "cmaes");
  assert.deepEqual(suggest([{ type: "real" }, { type: "permutation" }]), suggest([{ type: "permutation" }, { type: "real" }]));
});

test("the worked examples with orderings and yes or no values hold the settings that the rule suggests", () => {
  for (const example of [tsp, vrp, knapsack]) {
    const suggested = suggest(example.variables);
    assert.deepEqual([example.run.method, example.run.settings], [suggested.method, suggested.settings], example.name);
  }
});

test("the sentence names the solver and the reason, and says that it can be changed", () => {
  assert.equal(suggestionSentence([{ type: "real" }]), `${METHODS.cmaes.name} is suggested for this project because it holds only decimal numbers. You can change it.`);
  assert.equal(suggestionSentence([{ type: "permutation" }]), "Simulated Annealing is suggested for this project because its variables are orderings, selections or groups. You can change it.");
  assert.equal(suggestionSentence([{ type: "binary" }]), "Genetic Algorithm is suggested for this project because it holds yes or no values or whole numbers. You can change it.");
  assert.match(suggestionSentence([{ type: "permutation" }, { type: "real" }]), /^Genetic Algorithm is suggested for this project because it mixes orderings/);
  assert.match(suggestionSentence([]), / is suggested for this project as a start, and the suggestion will follow the variables you add\. You can change it\.$/);
});

const withVariables = (project: Project, ...types: string[]): Project =>
  ({ ...project, variables: types.map((type, n) => ({ name: `v${n}`, type })) as unknown as Project["variables"] });
const first = (project: Project) => experimentsOf(project)[0];

test("a blank project starts as the suggestion, and its first experiment follows the variables", () => {
  const blank = blankProject();
  assert.ok(sameSetup(first(blank), suggest([])));

  let step = follow(blank, withVariables(blank, "real"), [FIRST]);
  assert.deepEqual([step.following, step.changed.length, first(step.project).method], [[FIRST], 0, "cmaes"]);

  const ordered = follow(step.project, withVariables(step.project, "real", "permutation"), step.following);
  assert.deepEqual([ordered.following, ordered.changed.map((e) => e.method)], [[FIRST], ["ga"]]);
  assert.deepEqual(first(ordered.project).settings, { space: "native" });
  // the name and the seed stay as they were
  assert.deepEqual([first(ordered.project).name, first(ordered.project).seed], [first(blank).name, first(blank).seed]);

  step = follow(ordered.project, withVariables(ordered.project, "permutation"), ordered.following);
  assert.deepEqual([first(step.project).method, first(step.project).settings.space, first(step.project).budget], ["sa", "native", 20000]);
});

test("an experiment that the user changed is theirs, and never changes again on its own", () => {
  const blank = withVariables(blankProject(), "real");
  for (const change of [{ method: "pso" }, { budget: 500 }, { settings: { sigma0: 0.5 } }]) {
    const touched = withExperiment(blank, { ...first(blank), ...change });
    const step = follow(blank, touched, [FIRST]);
    assert.deepEqual([step.following, step.changed, step.project], [[], [], touched]);
    // later changes of the variables leave it alone
    const later = follow(step.project, withVariables(step.project, "permutation"), step.following);
    assert.deepEqual(first(later.project), first(touched));
  }
  // a new name or a new seed is not a change of the solver
  const renamed = withExperiment(blank, { ...first(blank), name: "Mine", seed: 9 });
  assert.deepEqual(follow(blank, renamed, [FIRST]).following, [FIRST]);
});

test("only the experiments on the list follow: an example and a copy keep what they hold", () => {
  const example = structuredClone(knapsack) as unknown as Project;
  const changed = withVariables(example, "permutation");
  assert.equal(follow(example, changed, []).project, changed);

  // a second experiment that started from the suggestion follows too, beside a first one that is the user's own
  let project = withVariables(blankProject(), "real");
  project = withExperiment(project, { ...DEFAULT_SETUP, id: FIRST, name: "Mine" });
  project = withExperiment(project, { ...suggest(project.variables), seed: 1, id: "e2", name: "Experiment 2" } as never);
  const step = follow(project, withVariables(project, "binary"), ["e2", "gone"]);
  assert.deepEqual(step.following, ["e2"]);
  assert.deepEqual(experimentsOf(step.project).map((e) => e.method), ["pso", "ga"]);
});
