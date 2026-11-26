import assert from "node:assert/strict";
import { test } from "node:test";
import { ga } from "./ga.ts";
import { assertSameTrace, readTrace, runTrace } from "./parity.ts";

const RUNS = [
  "ga_sphere_roulette",
  "ga_rosenbrock_roulette",
  "ga_rosenbrock_tournament",
  "ga_sphere_random",
  "ga_sphere_max",
  "ga_sphere_crossover_only",
  "ga_sphere_mutation_only",
  "ga_rosenbrock_rate_zero",
];

for (const name of RUNS) test(`${name} follows ypea's GA bit for bit`, () => assertSameTrace(name, ga));

test("GA with default settings converges on the sphere", () => {
  const trace = readTrace("ga_sphere_roulette");
  const project = trace.project as { run: { settings: object; budget: number } };
  project.run.settings = {};
  project.run.budget = 20000;
  // ypea's GA reaches 2e-7 to 4e-5 here over eight seeds
  assert.ok(runTrace(trace, ga).best.objective < 1e-3);
});
