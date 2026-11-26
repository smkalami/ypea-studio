// Parity on whole projects: expressions translated by the app against the same text run by
// real Python, with constraints, their scales, a tolerance, and variables that are not real.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { METHODS } from "./index.ts";
import { assertSameTrace, readTrace } from "./parity.ts";

const { runs } = JSON.parse(readFileSync(new URL("../../spec/parity/methods/constrained.json", import.meta.url), "utf8"));

for (const run of runs) {
  test(`${run.name} follows ypea bit for bit`, () => assertSameTrace(run.name, METHODS[run.project.run.method]));
}

test("the constrained runs really are constrained", () => {
  for (const run of runs.filter((r: any) => r.project.constraints)) {
    const trace = readTrace(run.name);
    // every run starts infeasible and reaches a feasible solution, so both sides of Deb's rule are used
    assert.ok(trace.traceV[0] !== 0, `${run.name} starts infeasible`);
    assert.equal(trace.traceV.at(-1), 0, `${run.name} ends feasible`);
  }
});
