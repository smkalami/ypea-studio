// The helper worker's side of the protocol: the check of a project, the test of a candidate,
// and the time limit. Run from web/ with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import assignment from "../../examples/assignment.json" with { type: "json" };
import benchmark from "../../examples/benchmark.json" with { type: "json" };
import knapsack from "../../examples/knapsack.json" with { type: "json" };
import linefit from "../../examples/linefit.json" with { type: "json" };
import tsp from "../../examples/tsp.json" with { type: "json" };
import { ask, checkProject, handleHelp, handleRun, locate, type RunMessage, tooLong, type WorkerLike } from "./protocol.ts";

test("every worked example passes the check", () => {
  for (const example of [benchmark, linefit, knapsack, tsp, assignment]) {
    assert.deepEqual(handleHelp({ type: "check", project: example }), { type: "checked", issues: [] });
  }
});

test("a language problem names its field, line and column, and every field shows its own", () => {
  const project: any = structuredClone(knapsack);
  project.objective.source = "sum(value * take";
  project.constraints.push({ name: "Count", left: "sum(take)", op: ">=", right: "few" });
  project.constraints[0].left = "sum(weight *\n   nothing)";
  const issues = checkProject(project);
  assert.deepEqual(issues.map((i) => [i.where, i.line]), [["objective", 1], ["constraint.0.left", 2], ["constraint.1.right", 1]]);
  assert.ok(issues.every((i) => i.column! >= 1 && !/^In /.test(i.message)));
  assert.match(issues[2].message, /few/);
  // the project given to the check is not changed by it
  assert.equal(project.objective.source, "sum(value * take");

  // a problem in the functions is one problem, with its line
  const withFunctions: any = structuredClone(knapsack);
  withFunctions.functions = "def total(a):\n    return sum(a)\n\ndef broken(a):\n    while True:\n        return 1\n";
  const [only, ...rest] = checkProject(withFunctions);
  assert.deepEqual([only.where, only.line, rest.length], ["functions", 5, 0]);

  // the expression of the drawing is code too
  const fit: any = structuredClone(linefit);
  fit.view.expression = "offset + gain";
  assert.deepEqual(checkProject(fit).map((i) => i.where), ["view"]);
});

test("a problem of the project file is placed on the part of the editor it belongs to", () => {
  const where = (example: object, change: (p: any) => void) => {
    const p: any = structuredClone(example);
    change(p);
    const issues = checkProject(p);
    assert.equal(issues.length, 1);
    assert.ok(!issues[0].message.startsWith("Project file"));
    return issues[0].where;
  };
  assert.equal(where(linefit, (p) => (p.variables[1].lb = "low")), "variable.1.lb");
  assert.equal(where(linefit, (p) => (p.variables[1].ub = -1)), "variable.1");
  assert.equal(where(linefit, (p) => (p.variables[1].name = "voltage")), "variable.1.name");
  assert.equal(where(linefit, (p) => (p.variables[0].name = "sum")), "variable.0.name");
  assert.equal(where(linefit, (p) => (p.variables[0].name = "my offset")), "variable.0.name");
  assert.equal(where(linefit, (p) => (p.variables[1].name = "offset")), "variable.1.name");
  assert.equal(where(linefit, (p) => (p.data[0].columns[1].name = "voltage")), "data.0.column.1");
  assert.equal(where(linefit, (p) => (p.data[0].columns[1].name = "")), "data.0.column.1");
  assert.equal(where(linefit, (p) => (p.data[0].name = "class")), "data.0");
  assert.equal(where(linefit, (p) => p.data[0].columns[1].values.pop()), "data.0");
  assert.equal(where(linefit, (p) => (p.data[0].columns[1].values[0] = "x")), "data.0.column.1");
  assert.equal(where(linefit, (p) => (p.data[0].columns[0].unit = 1)), "data.0.column.0");
  assert.equal(where(linefit, (p) => (p.objective.unit = 5)), "objective");
  assert.equal(where(linefit, (p) => (p.baseline.solution.gain = 500)), "baseline");
  assert.equal(where(linefit, (p) => p.variables.pop()), "baseline");
  assert.equal(where(linefit, (p) => (p.reference = { objective: "0" })), "reference");
  assert.equal(where(linefit, (p) => (p.view.x = "offset")), "view");
  assert.equal(where(linefit, (p) => (p.run.budget = 1.5)), "experiment.");
  assert.equal(where(linefit, (p) => (p.experiments = [{ id: "e2", name: "More", method: "de", settings: {}, budget: 10, seed: "1" }])), "experiment.e2");
  assert.equal(where(knapsack, (p) => (p.constraints[0].tolerance = 1)), "constraint.0");
  assert.equal(where(knapsack, (p) => (p.variables[0].type = "magic")), "variable.0");
  assert.equal(where(knapsack, (p) => (p.version = 9)), "overview");
  assert.equal(locate("something new", null), "overview");
});

test("a candidate is tested and a random one is drawn, with messages for the user", () => {
  const tested = handleHelp({ type: "test", project: linefit, solution: { offset: 1, gain: 2 } });
  assert.ok(tested.type === "tested");
  assert.equal(tested.curve!.length, 12);
  assert.deepEqual([tested.curve![0], tested.curve![11]], [2, 10]);
  assert.ok(tested.inspection.objective > 1000 && tested.inspection.feasible);
  assert.deepEqual(structuredClone(tested), tested);

  const all = handleHelp({ type: "test", project: knapsack, solution: { take: new Array(20).fill(1) } });
  assert.ok(all.type === "tested" && !("curve" in all));
  assert.equal(all.inspection.constraints[0].satisfied, false);
  assert.deepEqual(handleHelp({ type: "test", project: knapsack, solution: { take: [1] } }), { type: "error", message: '"take" must be a list of 20 numbers' });
  assert.deepEqual(handleHelp({ type: "test", project: { format: "no" }, solution: {} }), { type: "error", message: 'Project file: "format" must be "ypea-studio-project"' });

  const drawn = handleHelp({ type: "random", project: tsp, seed: 5 });
  assert.ok(drawn.type === "candidate");
  assert.deepEqual(drawn, handleHelp({ type: "random", project: tsp, seed: 5 }));
  assert.equal(new Set(drawn.solution.route as number[]).size, 30);
});

test("a run of a line fit carries the fitted line with its progress and its result", () => {
  const collect = (project: unknown) => {
    const messages: RunMessage[] = [];
    handleRun({ type: "run", project }, (m) => messages.push(m), 0);
    return messages;
  };
  assert.ok(collect(linefit).every((m) => m.type !== "error" && m.curve?.length === 12));
  assert.ok(collect(benchmark).every((m) => !("curve" in m)));
});

test("an answer in time is passed on, and the worker is ended", async () => {
  let ended = 0;
  const worker: WorkerLike = {
    onmessage: null, onerror: null, terminate: () => ended++,
    postMessage(request) {
      setTimeout(() => this.onmessage!({ data: handleHelp(request as any) }), 5);
    },
  };
  assert.deepEqual(await ask(worker, { type: "check", project: benchmark }, 1000), { type: "checked", issues: [] });
  assert.equal(ended, 1);

  const failing: WorkerLike = {
    onmessage: null, onerror: null, terminate: () => ended++,
    postMessage() {
      setTimeout(() => this.onerror!({ message: "It broke." }), 5);
    },
  };
  assert.deepEqual(await ask(failing, { type: "check", project: benchmark }, 1000), { type: "error", message: "The check could not run. It broke." });
  assert.equal(ended, 2);
});

test("code that never ends is stopped at the time limit, by ending a real worker", async () => {
  // a real thread in a loop that nothing but terminate() can stop
  const thread = new Worker("for (;;) {}", { eval: true });
  let exited = false;
  const gone = new Promise<void>((resolve) => thread.once("exit", () => resolve(void (exited = true))));
  await new Promise((resolve) => thread.once("online", resolve));
  const worker: WorkerLike = { onmessage: null, onerror: null, terminate: () => thread.terminate(), postMessage: (message) => thread.postMessage(message) };
  const started = performance.now();
  const reply = await ask(worker, { type: "check", project: benchmark }, 200);
  const took = performance.now() - started;
  assert.deepEqual(reply, { type: "error", message: tooLong(200) });
  assert.match(tooLong(200), /stopped after 0.2 seconds/);
  assert.ok(took >= 190 && took < 2000, `${took} ms`);
  await gone;
  assert.ok(exited);
});
