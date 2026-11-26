import assert from "node:assert/strict";
import { test } from "node:test";
import { nelderMead } from "./nelder_mead.ts";
import { assertSameTrace, readTrace, runTrace } from "./parity.ts";

for (const name of ["sphere", "rosenbrock", "sphere_2", "restart", "shrink", "max"]) {
  test(`Nelder-Mead follows ypea's NelderMead bit for bit: ${name}`, () => assertSameTrace(`nelder_mead_${name}`, nelderMead));
}

test("Nelder-Mead with default settings converges on the sphere", () => {
  const { project } = structuredClone(readTrace("nelder_mead_sphere")) as { project: { run: { budget: number } } };
  project.run.budget = 20000;
  const result = runTrace({ project } as never, nelderMead);
  assert.ok(result.best.objective < 1e-15, `best ${result.best.objective}`);
});
