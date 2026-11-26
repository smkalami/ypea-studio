// The worker's side of the message protocol, without a worker.
// Run from web/ with `npm test`. The name ends in .spec.ts so that `node --test` at the
// repository root, which needs no installed packages, does not pick it up.

import assert from "node:assert/strict";
import { test } from "node:test";
import benchmark from "../../examples/benchmark.json" with { type: "json" };
import linefit from "../../examples/linefit.json" with { type: "json" };
import { runProject } from "../../engine/run.ts";
import { parseProject } from "../../engine/project.ts";
import { handleRun, type RunMessage } from "./protocol.ts";

const collect = (project: unknown, minIntervalMs?: number) => {
  const messages: RunMessage[] = [];
  handleRun({ type: "run", project }, (m) => messages.push(m), minIntervalMs);
  return messages;
};

test("a run posts progress, then one result as the last message", () => {
  const messages = collect(benchmark, 0);
  const last = messages.at(-1)!;
  assert.equal(last.type, "result");
  assert.equal(messages.filter((m) => m.type !== "progress").length, 1);
  const progress = messages.filter((m) => m.type === "progress");
  assert.ok(progress.length > 10);
  assert.equal(progress[0].progress.evaluations.budget, 20000);
  assert.ok(progress.at(-1)!.progress.best.objective <= progress[0].progress.best.objective);
  // the same seeded result as a direct call, apart from the time
  const direct = runProject(parseProject(benchmark));
  assert.ok(last.type === "result");
  assert.deepEqual({ ...last.result, timeMs: 0 }, { ...direct, timeMs: 0 });
});

test("every message survives the structured clone that postMessage and IndexedDB apply", () => {
  for (const message of collect(benchmark, 0)) assert.deepEqual(structuredClone(message), message);
});

test("progress is throttled, and the first progress is always posted", () => {
  const messages = collect(benchmark, 1e9);
  assert.deepEqual(messages.map((m) => m.type), ["progress", "result"]);
});

test("a project whose text is outside the language gives one error message, not an exception", () => {
  const broken = structuredClone(linefit);
  broken.objective.source = "sum((pressure - offset";
  const messages = collect(broken);
  assert.equal(messages.length, 1);
  assert.ok(messages[0].type === "error");
  assert.match(messages[0].message, /In the objective, line 1/);
});

test("an example with data, a baseline and a known answer runs to a result", () => {
  const last = collect(linefit).at(-1)!;
  assert.ok(last.type === "result");
  assert.equal(last.result.baseline?.label, "Current settings");
  assert.ok(last.result.reference!.difference < 0.05);
});

test("an invalid project gives the message of parseProject", () => {
  const messages = collect({ format: "something else" });
  assert.deepEqual(messages, [{ type: "error", message: 'Project file: "format" must be "ypea-studio-project"' }]);
});

test("the run index reaches the engine", () => {
  const messages: RunMessage[] = [];
  handleRun({ type: "run", project: benchmark, runIndex: 3 }, (m) => messages.push(m));
  const last = messages.at(-1)!;
  assert.ok(last.type === "result");
  assert.equal(last.result.seed.runIndex, 3);
});
