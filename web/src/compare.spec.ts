// A comparison: its plan, its runs in any order of finishing, what is stored of it, and the
// files that carry results. Run from web/ with `npm test`.

import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import knapsackJson from "../../examples/knapsack.json" with { type: "json" };
import linefitJson from "../../examples/linefit.json" with { type: "json" };
import { checkComparable, summarize } from "../../engine/compare.ts";
import { parseProject, type Project } from "../../engine/project.ts";
import { deriveSeed } from "../../engine/rng.ts";
import { runProject, type RunResult } from "../../engine/run.ts";
import { comparisonFigures, historyFigure } from "../../export/figures/build.ts";
import { figureSvg } from "../../export/figures/figure.ts";
import { comparisonCharts } from "../../export/report-drawings.ts";
import { comparableRun, comparisonChanged, jobsOf, planComparison, poolSize, readComparison, REFERENCE, runsOf, type StoredComparison } from "./compare.ts";
import { experimentsOf, projectFor, withExperiment, withoutExperiment } from "./draft.ts";
import { handleHelp, handleRun, runJobs, type RunMessage, type RunRequest, type WorkerLike } from "./protocol.ts";
import { comparisonSvg, fileName } from "./share.ts";
import {
  deleteProject, loadComparison, loadResults, projectWithResults, readProjectFile, RESULT_VERSION, saveComparison, saveProject, saveResult, type StoredResult,
} from "./storage.ts";

// a small knapsack with two experiments, so that the runs are quick
const base = parseProject(knapsackJson);
const project: Project = withExperiment({ ...base, run: { ...base.run, budget: 600, name: "GA" } }, { id: "e2", name: "PSO", method: "pso", settings: { pop_size: 20 }, budget: 900, seed: 7 });
const chosen = experimentsOf(project);
const plan = planComparison(project, chosen, 4, 600, true);

/** A worker that answers each request after a delay of its own, the way a real one would. */
function fakeWorker(delay: () => number, log: { ended: number }): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null, onerror: null,
    postMessage(request) {
      setTimeout(() => handleRun(request as RunRequest, (data: RunMessage) => worker.onmessage?.({ data })), delay());
    },
    terminate: () => void log.ended++,
  };
  return worker;
}

/** Runs a plan in fake workers and gives the stored comparison. */
function compare(size: number, delay: () => number): Promise<StoredComparison> {
  const jobs = jobsOf(plan), slots = plan.experiments.map(() => [] as ReturnType<typeof comparableRun>[]);
  let done = 0;
  return new Promise((resolve, reject) => {
    runJobs(jobs.map((job) => job.request), size, () => fakeWorker(delay, { ended: 0 }), {
      error: (message) => reject(new Error(message)),
      result(index, result) {
        slots[jobs[index].experiment][jobs[index].runIndex] = comparableRun(result);
        if (++done < jobs.length) return;
        resolve({ v: 1, projectId: "p", finished: 5, versions: result.versions, project: plan.project, experiments: plan.experiments.map((e, n) => ({ ...e, results: slots[n] })) });
      },
    });
  });
}

test("a plan gives every experiment the budget of the comparison, keeps their order, and adds the reference last", () => {
  assert.deepEqual(plan.experiments.map((e) => [e.name, e.setup.method, e.setup.budget, e.setup.seed, e.reference]), [
    ["GA", "ga", 600, base.run.seed, undefined], ["PSO", "pso", 600, 7, undefined], [REFERENCE.name, "random", 600, base.run.seed, true],
  ]);
  assert.equal(plan.project.experiments, undefined);
  // the experiments of the project keep their own budgets
  assert.deepEqual(experimentsOf(project).map((e) => e.budget), [600, 900]);
  const jobs = jobsOf(plan);
  assert.equal(jobs.length, 12);
  assert.deepEqual(jobs.slice(0, 4).map((job) => [job.experiment, job.runIndex]), [[0, 0], [1, 0], [2, 0], [0, 1]]);
  assert.ok(jobs.every((job) => job.request.quiet && job.request.runIndex === job.runIndex && (job.request.project as Project).run.budget === 600));
  assert.equal(planComparison(project, [], 4, 600, true).experiments.length, 0);
});

test("the number of workers leaves a core to the page and never passes eight or the number of runs", () => {
  assert.deepEqual([poolSize(undefined, 30), poolSize(1, 30), poolSize(4, 30), poolSize(32, 30), poolSize(16, 3)], [1, 1, 3, 8, 3]);
});

test("the summary does not depend on the number of workers or on the order in which they finish", async () => {
  const direct = summarize(plan.experiments.map((e) => ({
    name: e.name, project: { ...plan.project, run: e.setup },
    results: Array.from({ length: plan.runs }, (_, runIndex) => runProject({ ...plan.project, run: e.setup }, { runIndex })),
  })));
  let turn = 0;
  for (const [size, delay] of [[1, () => 0], [3, () => (turn++ * 7) % 5], [8, () => 12 - (turn++ % 12)]] as const) {
    const stored = await compare(size, delay);
    assert.deepEqual(checkComparable(runsOf(stored)), []);
    // what is kept of a run, with its trace cut short, gives the summary of the whole runs
    assert.deepEqual(summarize(runsOf(stored)), direct);
    // run 0 is the quick run of the experiment, and every seed follows from the base seed
    for (const e of stored.experiments) assert.deepEqual(e.results.map((r) => r.seed), [0, 1, 2, 3].map((runIndex) => ({ base: e.setup.seed, runIndex, run: deriveSeed(e.setup.seed, runIndex) })));
    assert.deepEqual(readComparison(structuredClone(stored), "p"), stored);
  }
  assert.equal(direct.experiments[0].feasibleRuns <= 4 && direct.experiments.length === 3, true);
});

test("an error in one run ends every worker, and stopping tells nothing more", async () => {
  const broken = { ...plan, project: { ...plan.project, objective: { ...plan.project.objective, source: "sum(value *" } } };
  const log = { ended: 0 }, results: number[] = [];
  const message = await new Promise<string>((resolve) => runJobs(jobsOf(broken).map((job) => job.request), 3, () => fakeWorker(() => 1, log), { result: (i) => results.push(i), error: resolve }));
  assert.match(message, /In the objective, line 1/);
  assert.equal(log.ended, 3);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(results, []);

  const quiet = { ended: 0 };
  const stop = runJobs(jobsOf(plan).map((job) => job.request), 2, () => fakeWorker(() => 5, quiet), { result: (i) => results.push(i), error: () => results.push(-1) });
  stop();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual([results, quiet.ended], [[], 2]);
});

test("a stored comparison goes with its project, and one from another build reads as none", async () => {
  const stored = await compare(2, () => 0);
  const { id } = await saveProject(project);
  assert.equal(await loadComparison(id), undefined);
  await saveComparison({ ...stored, projectId: id });
  assert.deepEqual(await loadComparison(id), { ...stored, projectId: id });
  // it is not taken for the result of an experiment
  assert.deepEqual(await loadResults(id), []);
  await deleteProject(id);
  assert.equal(await loadComparison(id), undefined);

  const without = (change: (c: any) => void) => {
    const copy: any = structuredClone(stored);
    change(copy);
    return readComparison(copy, "p");
  };
  assert.equal(without((c) => (c.v = 2)), undefined);
  assert.equal(without((c) => delete c.v), undefined);
  assert.equal(without((c) => delete c.project), undefined);
  assert.equal(without((c) => (c.experiments = [])), undefined);
  assert.equal(without((c) => delete c.experiments[1].setup), undefined);
  assert.equal(without((c) => (c.experiments[0].results = [])), undefined);
  assert.equal(without((c) => delete c.experiments[0].results[2].trace), undefined);
  assert.equal(without((c) => (c.experiments[0].results[0].history.best = "x")), undefined);
  assert.equal(without((c) => delete c.experiments[2].results[1].seed.run), undefined);
  assert.equal(without((c) => delete c.versions), undefined);
  for (const nothing of [undefined, null, 5, "text", []]) assert.equal(readComparison(nothing, "p"), undefined);
});

test("a comparison says when the project is no longer what it ran, and deleting the first experiment is no change", async () => {
  const stored = await compare(2, () => 0);
  assert.equal(comparisonChanged(stored, project), false);
  // names, budgets and other experiments do not count
  assert.equal(comparisonChanged(stored, { ...project, name: "Renamed", run: { ...project.run, budget: 5, name: "Other name" } }), false);
  assert.equal(comparisonChanged(stored, withExperiment(project, { id: "e3", name: "More", method: "de", settings: {}, budget: 10, seed: 1 })), false);
  assert.equal(comparisonChanged(stored, { ...project, objective: { ...project.objective, source: "sum(value * take) + 0" } }), true);
  assert.equal(comparisonChanged(stored, { ...project, run: { ...project.run, seed: 99 } }), true);
  assert.equal(comparisonChanged(stored, withExperiment(project, { ...chosen[1], settings: { pop_size: 21 } })), true);
  // without the first experiment, the second takes its place and its id, and that one is gone
  const promoted = withoutExperiment(project, "");
  assert.equal(comparisonChanged({ ...stored, experiments: stored.experiments.slice(1) }, promoted), false);
  assert.equal(comparisonChanged(stored, promoted), true);
});

const stored = (experiment: string, of: Project, result: RunResult, curve?: number[]): StoredResult => ({ v: RESULT_VERSION, projectId: "p", experiment, finished: 1_795_000_000_000, project: of, result, curve });

test("a project file with results reads back as the project, its results and its comparison", async () => {
  const comparison = await compare(2, () => 0);
  const first = projectFor(project, chosen[0]), second = projectFor(project, chosen[1]);
  const results = [stored("", first, runProject(first)), stored("e2", second, runProject(second), [1, 2, 3])];
  const { file, leftOut } = projectWithResults(project, results, comparison);
  assert.equal(leftOut, 0);
  const [read] = readProjectFile(JSON.stringify(file));
  assert.deepEqual(read.project, project);
  assert.deepEqual(read.results.map((r) => [r.experiment, r.finished, r.v, r.curve]), [["", 1_795_000_000_000, RESULT_VERSION, undefined], ["e2", 1_795_000_000_000, RESULT_VERSION, [1, 2, 3]]]);
  assert.deepEqual(read.results[1].result, JSON.parse(JSON.stringify(results[1].result)));
  assert.deepEqual(read.results[1].project, second);
  assert.deepEqual(summarize(runsOf(read.comparison!)), summarize(runsOf(comparison)));
  assert.equal(read.comparison!.finished, 5);
  // a build that knows no results in a file reads the same file as the project alone
  assert.deepEqual(file.projects, [project]);
  // stored, the results read back as the app's own
  const { id } = await saveProject(read.project);
  for (const r of read.results) await saveResult({ ...r, projectId: id });
  await saveComparison({ ...read.comparison!, projectId: id });
  assert.deepEqual((await loadResults(id)).map((r) => r.experiment), ["", "e2"]);
  assert.equal((await loadComparison(id))!.experiments.length, 3);
  await deleteProject(id);

  // a result that a file cannot carry is left out and counted, so the file always reads back
  const broken = structuredClone(results[0]);
  broken.result.best.objective = Infinity;
  const partial = projectWithResults(project, [broken, results[1]], comparison);
  assert.equal(partial.leftOut, 1);
  assert.deepEqual(readProjectFile(JSON.stringify(partial.file))[0].results.map((r) => r.experiment), ["e2"]);
});

test("a file with results is untrusted: one bad part refuses the whole file", async () => {
  const comparison = await compare(2, () => 0);
  const first = projectFor(project, chosen[0]);
  const { file } = projectWithResults(project, [stored("", first, runProject(first))], comparison);
  const bad = (change: (f: any) => void, message: RegExp) => {
    const copy: any = JSON.parse(JSON.stringify(file));
    change(copy);
    assert.throws(() => readProjectFile(JSON.stringify(copy)), message);
  };
  bad((f) => (f.results = {}), /holds results that cannot be read/);
  bad((f) => (f.results[0].project = 1), /holds a result that cannot be read/);
  bad((f) => (f.results[0].experiment = "nobody"), /holds a result that cannot be read/);
  bad((f) => f.results.push(f.results[0]), /holds a result that cannot be read/);
  bad((f) => (f.results[0].curve = ["a"]), /holds a result that cannot be read/);
  bad((f) => (f.results[0].file.format = "x"), /Result file: "format"/);
  bad((f) => (f.results[0].file.project.run.budget = 0), /run\.budget/);
  bad((f) => delete f.results[0].file.finished, /holds a result that cannot be read/);
  bad((f) => delete f.results[0].file.result.scales, /holds a result that cannot be read/);
  bad((f) => (f.results[0].file.result.best.objective = null), /holds a result that cannot be read/);
  bad((f) => (f.comparisons[0].finished = "soon"), /holds a comparison that cannot be read/);
  bad((f) => (f.comparisons[0].experiments[0].results[0].history = 1), /holds a comparison that cannot be read/);
  bad((f) => (f.comparisons[0].definition.variables = []), /"variables" must be a non-empty list/);
  bad((f) => (f.comparisons[0].experiments[1].setup.seed = -1), /seed/);
  // runs that are not what they say they are: another budget, a seed that does not follow, a run twice
  bad((f) => (f.comparisons[0].experiments[0].results[1].evaluations.budget = 5), /Experiment "GA": run 1 had a budget of 5/);
  bad((f) => (f.comparisons[0].experiments[0].results[1].seed.run = 1), /the seed of run 1 does not follow/);
  bad((f) => (f.comparisons[0].experiments[2].results[3] = f.comparisons[0].experiments[2].results[0]), /run 0 is there twice/);
  bad((f) => f.comparisons.push(f.comparisons[0]), /holds a comparison that cannot be read/);
});

test("the helper writes the script, the report and the drawing of a stored result", () => {
  const linefit = parseProject(linefitJson), result = runProject(linefit);
  const python = handleHelp({ type: "python", project: linefit, result });
  assert.ok(python.type === "text" && python.text.startsWith("# Exported from YPEA Studio ") && python.text.includes("import ypea"));
  const report = handleHelp({ type: "report", input: { project: linefit, result, finished: 0, experiment: "Quick run" } });
  assert.ok(report.type === "text" && report.text.startsWith("<!doctype html>") && !/<script/i.test(report.text));
  const drawing = handleHelp({ type: "drawing", project: linefit, solution: result.best.solution });
  assert.ok(drawing.type === "text" && drawing.text.startsWith("<svg xmlns=") && drawing.text.includes("with the fitted line"));
  const none = handleHelp({ type: "drawing", project: { ...linefit, view: undefined }, solution: result.best.solution });
  assert.deepEqual(none, { type: "text", text: "" });
  // a project that the engine refuses gives its message, not a file
  assert.deepEqual(handleHelp({ type: "python", project: { ...linefit, version: 9 }, result }), { type: "error", message: "Project file: version 9 is not supported (this engine reads version 1)" });
});

test("a chart as a file of its own: colors written out, a background, a title and a description", async () => {
  const result = runProject(project), history = figureSvg(historyFigure(result, "$")!, "file", "history");
  assert.match(history, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 440 338" width="440" height="338" role="img" aria-labelledby="history-title history-desc" font-size="12" font-family="system-ui, [^"]+"><title id="history-title">Best value against evaluations<\/title><desc id="history-desc">The best value went from /);
  assert.match(history, /<\/desc><rect width="440" height="338" fill="#ffffff"\/>/);
  assert.doesNotMatch(history, /var\(|class=|<style|style=|currentColor|<script|href|<figure|<figcaption/);
  // the helper writes the drawing of a solution as such a file too
  const drawing = handleHelp({ type: "drawing", project, solution: result.best.solution });
  assert.ok(drawing.type === "text" && /^<svg xmlns="[^"]+" viewBox="0 0 440 \d+" width="440" height="\d+" role="img" aria-labelledby="drawing-title drawing-desc"/.test(drawing.text));

  const comparison = summarize(runsOf(await compare(2, () => 0)));
  const charts = comparisonSvg(comparison)!;
  // one picture, with each chart moved down under the one before
  assert.equal((charts.match(/<svg /g) ?? []).length, 1);
  assert.equal((charts.match(/<g transform="translate\(0 \d+\)">/g) ?? []).length, 3);
  assert.equal((charts.match(/<title/g) ?? []).length, 1);
  assert.match(charts, /<desc id="comparison-desc">[^<]*Feasible runs: /);
  assert.doesNotMatch(charts, /var\(|class=|<style|<figure|<strong/);
  for (const e of comparison.experiments) assert.ok(charts.includes(`${e.name.replace("(", "(")}: ${e.feasibleRuns} of ${e.runs} runs feasible`));
  assert.equal(Number(charts.match(/ height="(\d+)"/)![1]), 12 + 3 * (20 + 260 + 12));
  // the app and the report draw the same charts, one for each experiment
  assert.equal(comparisonFigures(comparison)!.length, comparison.experiments.length);
  assert.equal(comparisonCharts(comparison, "c").text.split("<figure>").length - 1, comparison.experiments.length);
  // an experiment with no feasible run has a sentence in place of its chart, and no chart at all is no file
  const none = { ...comparison, experiments: comparison.experiments.map((e, n) => (n ? e : { ...e, feasibleRuns: 0, objective: undefined, curve: { ...e.curve, median: e.curve.median.map(() => null), q1: e.curve.q1.map(() => null), q3: e.curve.q3.map(() => null) } })) };
  assert.match(comparisonSvg(none)!, /GA: 0 of 4 runs feasible<\/text><text fill="#475569" x="8" y="\d+">No run was feasible/);
  assert.equal(comparisonSvg({ ...none, experiments: [none.experiments[0]] }), undefined);
  // a name from a shared file cannot become markup
  assert.ok(comparisonSvg({ ...comparison, experiments: [{ ...comparison.experiments[0], name: "<svg onload=x>" }] })!.includes("&lt;svg onload=x&gt;: "));
});

test("file names hold no character that a file system refuses", () => {
  assert.equal(fileName("My knapsack", "GA run"), "My-knapsack-GA-run");
  assert.equal(fileName('a/b\\c:d*e?f"g<h>i|j', "  "), "a-b-c-d-e-f-g-h-i-j");
  assert.equal(fileName("", "?"), "ypea-studio");
});
