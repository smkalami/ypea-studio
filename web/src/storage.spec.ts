// The storage module against an in-memory IndexedDB (the fake-indexeddb package).
// Run from web/ with `npm test`. See protocol.spec.ts for why the name ends in .spec.ts.

import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import benchmark from "../../examples/benchmark.json" with { type: "json" };
import tsp from "../../examples/tsp.json" with { type: "json" };
import { parseProject } from "../../engine/project.ts";
import { runProject } from "../../engine/run.ts";
import {
  bundleProjects, deleteProject, listProjects, loadResult, projectsFromFile, saveProject, saveResult,
} from "./storage.ts";

const project = parseProject(benchmark);

test("projects are stored, listed newest first, changed in place and deleted", async () => {
  assert.deepEqual(await listProjects(), []);
  const first = await saveProject(project);
  await new Promise((r) => setTimeout(r, 5));
  const second = await saveProject(parseProject(tsp));
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await listProjects()).map((p) => p.project.name), ["Traveling salesman", "Benchmark functions"]);

  // a rename keeps the id, and moves the project to the top
  await new Promise((r) => setTimeout(r, 5));
  await saveProject({ ...project, name: "Renamed" }, first.id);
  const listed = await listProjects();
  assert.deepEqual(listed.map((p) => p.project.name), ["Renamed", "Traveling salesman"]);
  assert.equal(listed[0].id, first.id);
  assert.deepEqual(listed[0].project, { ...project, name: "Renamed" });

  await deleteProject(first.id);
  await deleteProject(second.id);
  assert.deepEqual(await listProjects(), []);
});

test("a result is stored with its snapshot, replaced by the next run, and deleted with its project", async () => {
  const { id } = await saveProject(project);
  assert.equal(await loadResult(id), undefined);

  const result = runProject(project);
  await saveResult({ projectId: id, finished: 1, project, result });
  // a later change to the project does not change the snapshot
  await saveProject({ ...project, name: "Changed later" }, id);
  const loaded = (await loadResult(id))!;
  assert.equal(loaded.project.name, "Benchmark functions");
  assert.deepEqual(loaded.result, result);
  assert.deepEqual(loaded.result.seed, { base: 1, runIndex: 0, run: result.seed.run });
  assert.equal(loaded.result.method, "pso");
  assert.ok(loaded.result.versions.app);

  await saveResult({ projectId: id, finished: 2, project, result });
  assert.equal((await loadResult(id))!.finished, 2);

  // another project's result is untouched by a delete
  const other = await saveProject(project);
  await saveResult({ projectId: other.id, finished: 3, project, result });
  await deleteProject(id);
  assert.equal(await loadResult(id), undefined);
  assert.equal((await loadResult(other.id))!.finished, 3);
  await deleteProject(other.id);
});

test("the file of all projects reads back as the same projects", () => {
  const all = [project, parseProject(tsp)];
  assert.deepEqual(projectsFromFile(JSON.stringify(bundleProjects(all))), all);
  assert.deepEqual(projectsFromFile(JSON.stringify(bundleProjects([]))), []);
});

test("a single project file reads as one project", () => {
  assert.deepEqual(projectsFromFile(JSON.stringify(benchmark)), [project]);
});

test("a bad file gives a message for the user", () => {
  assert.throws(() => projectsFromFile("not json"), /not valid JSON/);
  assert.throws(() => projectsFromFile("null"), /Project file: "format" must be/);
  assert.throws(() => projectsFromFile(JSON.stringify({ ...benchmark, run: { ...benchmark.run, budget: 0 } })), /run\.budget/);
  // one bad project refuses the whole file of projects
  assert.throws(() => projectsFromFile(JSON.stringify(bundleProjects([project, { ...project, version: 99 }]))), /version 99 is not supported/);
  assert.throws(() => projectsFromFile(JSON.stringify({ format: "ypea-studio-projects", version: 2, projects: [] })), /damaged or comes from a newer version/);
});
