// The undo history: steps, the grouping of typing, and what it can never undo.

import assert from "node:assert/strict";
import { test } from "node:test";
import benchmark from "../../examples/benchmark.json" with { type: "json" };
import type { Project } from "../../engine/project.ts";
import { experimentsOf, projectFor, withExperiment } from "./draft.ts";
import { GROUP_MS, LIMIT, record, redo, startHistory, undo } from "./history.ts";

test("every edit is a step that can be undone and redone", () => {
  let h = startHistory("a");
  assert.equal(undo(h), h); // nothing to undo
  assert.equal(redo(h), h); // nothing to redo
  h = record(h, "b", undefined, 0);
  h = record(h, "c", undefined, 1);
  assert.deepEqual([h.past, h.present, h.future], [["a", "b"], "c", []]);
  h = undo(h);
  assert.deepEqual([h.past, h.present, h.future], [["a"], "b", ["c"]]);
  h = undo(h);
  assert.deepEqual([h.past, h.present, h.future], [[], "a", ["b", "c"]]);
  h = redo(redo(h));
  assert.deepEqual([h.past, h.present, h.future], [["a", "b"], "c", []]);
  // a new edit after an undo ends what could be redone
  h = record(undo(h), "d", undefined, 2);
  assert.deepEqual([h.past, h.present, h.future], [["a", "b"], "d", []]);
  assert.equal(redo(h), h);
});

test("a burst of typing in one field is one step", () => {
  let h = startHistory("");
  let now = 1000;
  for (const text of ["w", "we", "wei", "weight"]) h = record(h, text, "name-field", (now += 200));
  assert.deepEqual([h.past, h.present], [[""], "weight"]);
  assert.equal(undo(h).present, "");

  // a pause starts a new step
  h = record(h, "weight_", "name-field", (now += GROUP_MS + 1));
  assert.deepEqual(h.past, ["", "weight"]);
  // another field starts a new step, however soon
  h = record(h, "weight_ kg", "unit-field", now + 1);
  assert.deepEqual(h.past, ["", "weight", "weight_"]);
  // an edit that is not typing is always a step of its own, and typing after it starts a new one
  h = record(h, "removed", undefined, now + 2);
  h = record(h, "removed too", undefined, now + 3);
  h = record(h, "typed", "unit-field", now + 4);
  assert.deepEqual(h.past.slice(-3), ["weight_ kg", "removed", "removed too"]);

  // typing after an undo does not join the step that was undone
  let again = startHistory("");
  again = record(again, "a", "f", 0);
  again = record(undo(again), "b", "f", 1);
  assert.deepEqual([again.past, again.present], [[""], "b"]);
  assert.equal(undo(again).present, "");
});

test("the history forgets its oldest steps", () => {
  let h = startHistory(0);
  for (let n = 1; n <= LIMIT + 20; n++) h = record(h, n, undefined, n);
  assert.equal(h.past.length, LIMIT);
  assert.equal(h.past[0], 20);
});

test("a run and a stored result are never undone: the history holds the definition and nothing else", () => {
  // what the workspace keeps: the definition in the history, and the results beside it
  const project = structuredClone(benchmark) as unknown as Project;
  let h = startHistory({ project, following: [] as string[] });
  const results: Record<string, { ran: Project; objective: number }> = {};

  // "Run again with a new seed" writes the seed into the experiment, which is an edit, and then stores a result
  const bumped = withExperiment(project, { ...experimentsOf(project)[0], seed: 2 });
  h = record(h, { project: bumped, following: [] }, undefined, 0);
  results[""] = { ran: projectFor(bumped, experimentsOf(bumped)[0]), objective: 1.5 };
  const stored = structuredClone(results);

  h = undo(h);
  // the setup went back, and the result is still the one of the run that happened
  assert.equal(h.present.project.run.seed, 1);
  assert.deepEqual(results, stored);
  assert.equal(results[""].ran.run.seed, 2);
  h = redo(h);
  assert.equal(h.present.project.run.seed, 2);
  assert.deepEqual(results, stored);
  // nothing in any state of the history is a result
  for (const state of [...h.past, h.present, ...h.future]) assert.deepEqual(Object.keys(state), ["project", "following"]);
});
