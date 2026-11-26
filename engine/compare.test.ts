import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { checkComparable, type ComparableRun, DEFAULT_RUNS, type ExperimentRuns, feasibleAt, quantile, runSeeds, summarize } from "./compare.ts";
import { parseProject, type Project } from "./project.ts";
import { deriveSeed } from "./rng.ts";
import { runProject } from "./run.ts";

const examples = new URL("../examples/", import.meta.url);
const names = readdirSync(examples).filter((f) => f.endsWith(".json"));
const example = (file: string) => parseProject(JSON.parse(readFileSync(new URL(file, examples), "utf8")));
const withRun = (project: Project, method: string, budget: number, seed = 1): Project => ({ ...project, run: { method, settings: method === project.run.method ? project.run.settings : {}, budget, seed } });
const runs = (name: string, project: Project, count: number): ExperimentRuns => ({
  name, project, results: Array.from({ length: count }, (_, runIndex) => runProject(project, { runIndex })),
});

// Hand-made runs on a grid of four checkpoints, for cases that are worked out on paper.
const GRID = [10, 20, 30, 40];
const small = (sense: "min" | "max" = "min"): Project => ({ ...withRun(example("benchmark.json"), "pso", 40, 5), objective: { sense, source: "sum(x * x)" } });
/** A run whose best candidate has the given violations at the given evaluations, and the given history. */
function made(runIndex: number, traceNfe: number[], violation: number[], best: number[]): ComparableRun {
  return {
    best: { objective: best.at(-1)!, feasible: violation.at(-1) === 0 },
    evaluations: { used: 40, budget: 40 },
    history: { nfe: GRID, best },
    trace: { nfe: traceNfe, violation },
    seed: { base: 5, runIndex, run: deriveSeed(5, runIndex) },
    method: "pso",
    settings: {},
  };
}
const fourRuns = () => [
  made(0, [1, 15], [0, 0], [9, 5, 5, 4]),
  // the early values 1 and 0.5 below belong to candidates that break a constraint
  made(1, [1, 25], [2, 0], [1, 1, 6, 6]),
  made(2, [1, 35], [1, 0], [0.5, 0.5, 0.5, 8]),
  // never feasible, with values that would look like the best results of all
  made(3, [1, 12], [3, 1], [0, 0, 0, 0]),
];

test("quartiles by linear interpolation, worked out by hand", () => {
  // sorted: 1, 3, 7, 10. Positions (n - 1) p are 0.75, 1.5 and 2.25.
  const sorted = [1, 3, 7, 10];
  assert.equal(quantile(sorted, 0.25), 2.5); // 1 + 0.75 * (3 - 1)
  assert.equal(quantile(sorted, 0.5), 5); // 3 + 0.5 * (7 - 3)
  assert.equal(quantile(sorted, 0.75), 7.75); // 7 + 0.25 * (10 - 7)
  assert.equal(quantile([4], 0.25), 4);
  assert.equal(quantile([4], 0.75), 4);
  assert.equal(quantile([1, 2, 3, 4, 10], 0.25), 2);
  // infinite values never give NaN
  assert.equal(quantile([1, Infinity], 0), 1);
  assert.equal(quantile([1, Infinity], 0.5), Infinity);
  assert.equal(quantile([Infinity, Infinity], 0.5), Infinity);
  assert.equal(quantile([-Infinity, 2], 0.5), -Infinity);
});

test("the numbers come from the feasible runs only, with their count", () => {
  const [e] = summarize([{ name: "A", project: small(), results: fourRuns() }]).experiments;
  assert.equal(e.runs, 4);
  assert.equal(e.feasibleRuns, 3);
  assert.deepEqual(e.evaluations, { budget: 40, usedMin: 40, usedMax: 40 });
  // final values of the feasible runs: 4, 6, 8. The infeasible 0 takes no part.
  assert.deepEqual(e.objective, { median: 6, q1: 5, q3: 7, best: 4 });
});

test("the curve never shows a value of a candidate that breaks a constraint", () => {
  const [e] = summarize([{ name: "A", project: small(), results: fourRuns() }]).experiments;
  assert.deepEqual(e.curve.nfe, GRID);
  assert.deepEqual(e.curve.feasibleRuns, [1, 1, 2, 3]);
  // at 30 evaluations the three feasible runs stand at 5, 6 and "not feasible yet"
  assert.deepEqual(e.curve.q1, [null, null, 5.5, 5]);
  assert.deepEqual(e.curve.median, [null, null, 6, 6]);
  assert.deepEqual(e.curve.q3, [null, null, null, 7]);
  assert.deepEqual(feasibleAt(fourRuns()[1]), [false, false, true, true]);
  assert.deepEqual(feasibleAt(fourRuns()[3]), [false, false, false, false]);
});

test("a maximized objective: the best is the largest, and a run that is not feasible yet counts as the smallest", () => {
  const results = [made(0, [1], [0], [1, 2, 3, 4]), made(1, [1, 25], [1, 0], [50, 50, 6, 6]), made(2, [1], [0], [2, 2, 2, 8])];
  const [e] = summarize([{ name: "A", project: small("max"), results }]).experiments;
  assert.deepEqual(e.objective, { median: 6, q1: 5, q3: 7, best: 8 });
  // at 10 evaluations: minus infinity, 1 and 2
  assert.deepEqual([e.curve.q1[0], e.curve.median[0], e.curve.q3[0]], [null, 1, 1.5]);
});

test("an experiment with no feasible run gets no numbers", () => {
  const results = [made(0, [1], [2], [1, 1, 1, 1]), made(1, [1], [3], [0, 0, 0, 0])];
  const [e] = summarize([{ name: "A", project: small(), results }]).experiments;
  assert.equal(e.feasibleRuns, 0);
  assert.equal(e.runs, 2);
  assert.equal("objective" in e, false);
  assert.deepEqual(e.curve.median, [null, null, null, null]);
  assert.deepEqual(e.curve.feasibleRuns, [0, 0, 0, 0]);
});

test("a result that was stored as JSON gives the same summary", () => {
  const live = [{ name: "A", project: small(), results: fourRuns() }];
  assert.deepEqual(summarize(JSON.parse(JSON.stringify(live))), summarize(live));
});

test("no winner, no order of merit and no test result", () => {
  const worse = fourRuns().map((r) => ({ ...r, history: { ...r.history, best: r.history.best.map((v) => v + 100) }, best: { ...r.best, objective: r.best.objective! + 100 } }));
  const summary = summarize([
    { name: "Worse, given first", project: small(), results: worse },
    { name: "Better, given second", project: small(), results: fourRuns() },
  ]);
  // the order given is kept, whatever the numbers say
  assert.deepEqual(summary.experiments.map((e) => e.name), ["Worse, given first", "Better, given second"]);
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (!Array.isArray(value)) keys.add(key);
      walk(inner);
    }
  };
  walk(summary);
  assert.deepEqual([...keys].sort(), ["best", "budget", "curve", "evaluations", "experiments", "feasibleRuns", "median", "method", "name", "nfe", "objective", "q1", "q3", "runs", "sense", "unit", "usedMax", "usedMin"].sort());
  for (const key of keys) assert.doesNotMatch(key, /winner|rank|order|score|signif|pvalue|p_value|test|bestSolver|bestMethod|bestExperiment/i);
});

test("runs that cannot be compared are refused, with the reason", () => {
  const good = (): ExperimentRuns => ({ name: "A", project: small(), results: fourRuns() });
  assert.deepEqual(checkComparable([good(), { ...good(), name: "B" }]), []);
  assert.deepEqual(checkComparable([]), ["There is no experiment to summarize."]);

  const otherBudget: ExperimentRuns = { name: "B", project: { ...small(), run: { ...small().run, budget: 80 } }, results: fourRuns().map((r) => ({ ...r, evaluations: { used: 80, budget: 80 } })) };
  assert.match(checkComparable([good(), otherBudget]).join(" "), /"B": its budget is 80 evaluations, and "A" has 40/);
  assert.throws(() => summarize([good(), otherBudget]), /cannot be compared.*budget/);

  const otherProblem: ExperimentRuns = { ...good(), name: "B", project: { ...small(), objective: { sense: "min", source: "sum(x)" } } };
  assert.match(checkComparable([good(), otherProblem]).join(" "), /"B": its problem definition is not the one of "A"/);

  const twice = good();
  twice.results[1] = { ...twice.results[1], seed: twice.results[0].seed };
  assert.match(checkComparable([twice]).join(" "), /run 0 is there twice/);

  const wrongSeed = good();
  wrongSeed.results[2] = { ...wrongSeed.results[2], seed: { base: 5, runIndex: 2, run: 123 } };
  assert.match(checkComparable([wrongSeed]).join(" "), /seed of run 2 does not follow/);

  const otherBase = good();
  otherBase.results[0] = { ...otherBase.results[0], seed: { base: 6, runIndex: 0, run: deriveSeed(6, 0) } };
  assert.match(checkComparable([otherBase]).join(" "), /run 0 started from the base seed 6, not 5/);

  const otherSolver = good();
  otherSolver.results[3] = { ...otherSolver.results[3], method: "de" };
  assert.match(checkComparable([otherSolver]).join(" "), /run 3 used the solver "de", not "pso"/);

  const otherSettings = good();
  otherSettings.results[3] = { ...otherSettings.results[3], settings: { w: 0.1 } };
  assert.match(checkComparable([otherSettings]).join(" "), /run 3 used other settings/);

  const otherGrid = good();
  otherGrid.results[1] = { ...otherGrid.results[1], history: { nfe: [5, 10, 20, 40], best: [1, 1, 1, 1] } };
  assert.match(checkComparable([otherGrid]).join(" "), /run 1 recorded its history at other evaluation counts/);

  assert.match(checkComparable([{ ...good(), results: [] }]).join(" "), /it has no runs/);
  // names and descriptions are not part of the problem
  assert.deepEqual(checkComparable([good(), { ...good(), name: "B", project: { ...small(), name: "Another name", description: "Other words" } }]), []);
});

test("run indices and seeds of an experiment", () => {
  assert.equal(DEFAULT_RUNS, 10);
  const seeds = runSeeds(7);
  assert.equal(seeds.length, 10);
  assert.deepEqual(seeds.map((s) => s.runIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(seeds.map((s) => s.seed), seeds.map((s) => deriveSeed(7, s.runIndex)));
  assert.equal(new Set(seeds.map((s) => s.seed)).size, 10);
  assert.equal(runSeeds(7, 3).length, 3);
  // the engine runs with exactly these seeds
  const project = withRun(example("benchmark.json"), "pso", 200, 7);
  for (const { runIndex, seed } of runSeeds(7, 3)) assert.equal(runProject(project, { runIndex }).seed.run, seed);
});

for (const file of names) {
  test(`real runs of ${file}: two experiments, three runs each`, () => {
    const project = example(file), budget = 300;
    const own = withRun(project, project.run.method, budget), random = withRun(project, "random", budget, 2);
    const summary = summarize([runs("Own solver", own, 3), runs("Random search", random, 3)]);
    assert.equal(summary.budget, budget);
    assert.equal(summary.sense, project.objective.sense);
    const sign = summary.sense === "min" ? 1 : -1;
    for (const e of summary.experiments) {
      assert.equal(e.runs, 3);
      assert.ok(e.feasibleRuns >= 0 && e.feasibleRuns <= 3);
      assert.ok(e.evaluations.usedMax <= budget);
      assert.equal(e.curve.nfe.at(-1), budget);
      assert.equal(e.curve.feasibleRuns.at(-1), e.feasibleRuns);
      if (e.feasibleRuns === 0) {
        assert.equal(e.objective, undefined);
        continue;
      }
      const o = e.objective!;
      assert.ok(o.q1 <= o.median && o.median <= o.q3);
      assert.ok(sign * o.best <= sign * o.median);
      // the last point of the curve is the table
      assert.deepEqual([e.curve.q1.at(-1), e.curve.median.at(-1), e.curve.q3.at(-1)], [o.q1, o.median, o.q3]);
      // each line only improves, and once it has started it does not stop
      for (const line of [e.curve.q1, e.curve.median, e.curve.q3]) {
        const drawn = line.filter((v): v is number => v !== null);
        assert.deepEqual(line.slice(line.length - drawn.length), drawn);
        for (let k = 1; k < drawn.length; k++) assert.ok(sign * drawn[k] <= sign * drawn[k - 1]);
      }
    }
  });
}

test("real runs with a constraint that cannot hold: counts, and no numbers", () => {
  const knapsack = example("knapsack.json");
  const impossible = withRun({ ...knapsack, constraints: [...knapsack.constraints!, { name: "Impossible", left: "sum(take)", op: "<=", right: "-1" }] }, "ga", 300);
  const [e] = summarize([runs("GA", impossible, 3)]).experiments;
  assert.equal(e.feasibleRuns, 0);
  assert.equal(e.objective, undefined);
  assert.ok(e.curve.median.every((v) => v === null));
});

test("real runs where only some are feasible: the table and the curve count the same runs", () => {
  // a project of its own, so that the tuning of an example cannot change the mix: at most 4 of 10
  // switches may be on, which a random candidate meets about 4 times in 10, and each run has 3 tries
  const project = parseProject({
    format: "ypea-studio-project", version: 1, name: "Few switches",
    variables: [{ name: "on", type: "binary", shape: [10] }],
    objective: { sense: "max", source: "sum(on)" },
    constraints: [{ name: "At most four", left: "sum(on)", op: "<=", right: "4" }],
    run: { method: "random", settings: {}, budget: 3, seed: 1 },
  });
  const [e] = summarize([runs("Random search", project, 40)]).experiments;
  assert.ok(e.feasibleRuns > 0 && e.feasibleRuns < e.runs, `${e.feasibleRuns} of ${e.runs} runs are feasible`);
  assert.equal(e.curve.feasibleRuns.at(-1), e.feasibleRuns);
  assert.deepEqual([e.curve.q1.at(-1), e.curve.median.at(-1), e.curve.q3.at(-1)], [e.objective!.q1, e.objective!.median, e.objective!.q3]);
  assert.ok(e.objective!.best <= 4);
});
