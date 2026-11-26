import assert from "node:assert/strict";
import { test } from "node:test";
import { ica } from "./ica.ts";
import { assertSameTrace, readTrace, runTrace } from "./parity.ts";

for (const name of ["sphere", "rosenbrock", "collapse", "empty_empire", "max"]) {
  test(`ICA follows ypea's ICA bit for bit: ${name}`, () => assertSameTrace(`ica_${name}`, ica));
}

test("ICA with default settings converges on the sphere", () => {
  const { project } = structuredClone(readTrace("ica_sphere")) as { project: { run: { budget: number; settings: object } } };
  project.run.budget = 20000;
  project.run.settings = {};
  const result = runTrace({ project } as never, ica);
  assert.ok(result.best.objective < 1e-12, `best ${result.best.objective}`);
});
