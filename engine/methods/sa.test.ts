import assert from "node:assert/strict";
import { test } from "node:test";
import { sa } from "./sa.ts";
import { assertSameTrace, readTrace, runTrace } from "./parity.ts";

const RUNS = [
  "sa_sphere",
  "sa_rosenbrock",
  "sa_sphere_classic",
  "sa_sphere_max",
  "sa_rosenbrock_flat",
];

for (const name of RUNS) test(`${name} follows ypea's SA bit for bit`, () => assertSameTrace(name, sa));

test("SA with default settings converges on the sphere", () => {
  const trace = readTrace("sa_sphere");
  const project = trace.project as { run: { settings: object; budget: number } };
  project.run.settings = {};
  project.run.budget = 20000;
  // ypea's SA ends between 0.2 and 0.5 here over eight seeds, because the default final temperature is 1
  assert.ok(runTrace(trace, sa).best.objective < 2);
});
