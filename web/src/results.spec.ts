// Stored results: one for each experiment, and the guard against results that an older
// build stored. Run from web/ with `npm test`.

import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import benchmark from "../../examples/benchmark.json" with { type: "json" };
import { parseProject } from "../../engine/project.ts";
import { runProject } from "../../engine/run.ts";
import { deleteProject, deleteResult, loadResult, loadResults, readResult, RESULT_VERSION, saveProject, saveResult } from "./storage.ts";

const project = parseProject(benchmark);
const result = runProject(project);

test("each experiment keeps its own result, and all of them go with the project", async () => {
  const { id } = await saveProject(project);
  const other = await saveProject(project);
  await saveResult({ projectId: id, finished: 1, project, result });
  await saveResult({ projectId: id, experiment: "e2", finished: 2, project, result, curve: [1, 2] });
  await saveResult({ projectId: id, experiment: "e3", finished: 3, project, result });
  await saveResult({ projectId: other.id, experiment: "e2", finished: 9, project, result });

  assert.equal((await loadResult(id))!.finished, 1);
  const second = (await loadResult(id, "e2"))!;
  assert.deepEqual([second.finished, second.experiment, second.projectId, second.v, second.curve], [2, "e2", id, RESULT_VERSION, [1, 2]]);
  assert.deepEqual((await loadResults(id)).map((r) => [r.experiment, r.finished, r.projectId]), [["", 1, id], ["e2", 2, id], ["e3", 3, id]]);
  assert.equal(await loadResult(id, "e4"), undefined);

  // a new run replaces the result of its own experiment only
  await saveResult({ projectId: id, experiment: "e2", finished: 5, project, result });
  assert.deepEqual((await loadResults(id)).map((r) => r.finished), [1, 5, 3]);
  await deleteResult(id, "e3");
  await deleteResult(id, "");
  assert.deepEqual((await loadResults(id)).map((r) => r.experiment), ["e2"]);

  await deleteProject(id);
  assert.deepEqual(await loadResults(id), []);
  assert.deepEqual((await loadResults(other.id)).map((r) => r.finished), [9]);
  await deleteProject(other.id);
});

test("a result that an older build stored counts as no result yet", async () => {
  const good = { v: RESULT_VERSION, projectId: "p", experiment: "", finished: 1, project, result };
  assert.deepEqual(readResult(good, "p", ""), good);
  assert.deepEqual(readResult(structuredClone(good), "p", ""), good);

  const { v, ...unversioned } = good;
  assert.equal(readResult(unversioned, "p", ""), undefined);
  assert.equal(readResult({ ...good, v: 1 }, "p", ""), undefined);
  assert.equal(readResult({ ...good, v: RESULT_VERSION + 1 }, "p", ""), undefined);
  // the right version with parts missing, as a damaged record would be
  const without = (change: (r: any) => void) => {
    const copy: any = structuredClone(good);
    change(copy);
    return readResult(copy, "p", "");
  };
  assert.equal(without((r) => delete r.result), undefined);
  assert.equal(without((r) => delete r.result.best), undefined);
  assert.equal(without((r) => (r.result.best.solution = [1])), undefined);
  assert.equal(without((r) => delete r.result.best.constraints), undefined);
  // the list of every constraint, on or off, came later: a result without it is still shown, from the older list
  assert.ok(Array.isArray(good.result.best.checks));
  assert.notEqual(without((r) => delete r.result.best.checks), undefined);
  assert.equal(without((r) => delete r.result.history), undefined);
  assert.equal(without((r) => delete r.result.evaluations), undefined);
  assert.equal(without((r) => delete r.result.seed), undefined);
  // what the chart, the report and the Python script read: a record without it is not shown, so nothing can fail on it later
  assert.equal(without((r) => delete r.result.trace), undefined);
  assert.equal(without((r) => delete r.result.trace.violation), undefined);
  assert.equal(without((r) => delete r.result.scales), undefined);
  assert.equal(without((r) => delete r.result.settings), undefined);
  assert.equal(without((r) => delete r.result.seed.runIndex), undefined);
  assert.equal(without((r) => delete r.result.versions.ypeaTested), undefined);
  assert.equal(without((r) => delete r.project), undefined);
  assert.equal(without((r) => (r.curve = "line")), undefined);
  for (const nothing of [undefined, null, 5, "text", []]) assert.equal(readResult(nothing, "p", ""), undefined);
});

test("a record of the first public build, which had no version, reads as no result", async () => {
  const { id } = await saveProject(project);
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("ypea-studio");
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve) => {
    const tx = db.transaction("results", "readwrite");
    tx.objectStore("results").put({ projectId: id, finished: 1, project, result: { status: "Best solution", best: { objective: 1 } } });
    tx.oncomplete = resolve;
  });
  db.close();
  assert.equal(await loadResult(id), undefined);
  assert.deepEqual(await loadResults(id), []);
  // the next run stores a result that reads back
  await saveResult({ projectId: id, finished: 2, project, result });
  assert.equal((await loadResult(id))!.finished, 2);
  await deleteProject(id);
});
