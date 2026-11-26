// Parity on the rule for constraints: tolerances of an == constraint, and constraints that are
// turned off. The runs are in spec/parity/methods/tolerances.json, and real Python inside ypea
// is the judge, as for every other parity run.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { METHODS } from "./methods/index.ts";
import { assertSameTrace, readTrace, runTrace } from "./methods/parity.ts";
import { parseProject } from "./project.ts";
import { runProject } from "./run.ts";

const { runs } = JSON.parse(readFileSync(new URL("../spec/parity/methods/tolerances.json", import.meta.url), "utf8"));
const named = (name: string) => runs.find((r: any) => r.name === name);
const run = (r: any, change: (project: any) => void = () => {}) => {
  const project = structuredClone(r.project);
  change(project);
  return runProject(parseProject(project), { scales: r.scales });
};
/** What a run found, without the parts that say how the project was written. */
const path = (result: ReturnType<typeof runProject>) => ({ trace: result.trace, codes: result.best.codes, objective: result.best.objective, violation: result.best.violation, used: result.evaluations.used });

for (const r of runs) {
  test(`${r.name} follows ypea bit for bit`, () => assertSameTrace(r.name, METHODS[r.project.run.method]));
}

test("the runs with a constraint that is on start infeasible and end feasible", () => {
  for (const r of runs.filter((r: any) => !r.name.startsWith("only_off"))) {
    const trace = readTrace(r.name);
    assert.ok(trace.traceV[0] !== 0, `${r.name} starts infeasible`);
    assert.equal(trace.traceV.at(-1), 0, `${r.name} ends feasible`);
  }
});

test("a relative tolerance alone, and both tolerances together, decide what holds", () => {
  for (const name of ["relative_only_sa", "relative_only_ga", "both_tolerances_de", "both_tolerances_sa"]) {
    const tie = run(named(name)).best.checks[2];
    const allowed = tie.tolerance + tie.relativeTolerance * Math.abs(tie.right);
    // the two sides are not equal, and the constraint holds only because of the tolerance
    assert.ok(tie.satisfied && tie.difference !== 0 && Math.abs(tie.difference!) <= allowed, name);
    assert.equal(tie.excess, Math.abs(tie.left - tie.right) - allowed);
    assert.ok(tie.relativeTolerance > 0 && (tie.tolerance > 0) === name.startsWith("both"));
    // without the relative part the same run ends on another solution
    assert.notDeepEqual(run(named(name), (p) => delete p.constraints[2].relative_tolerance).best.codes, run(named(name)).best.codes, name);
  }
});

test("a relative tolerance on a right side of zero has no effect: the run is the one of the exact constraint", () => {
  for (const name of ["zero_right_ga", "zero_right_sa"]) {
    const loose = run(named(name)), exact = run(named(name), (p) => delete p.constraints[1].relative_tolerance);
    assert.deepEqual(path(loose), path(exact), name);
    const five = loose.best.checks[1];
    assert.deepEqual([five.right, five.left, five.satisfied, five.relativeTolerance, five.differencePercent], [0, 0, true, 0.5, undefined]);
  }
});

test("a constraint that is off takes no part in the run, and the result says that it was off", () => {
  for (const name of ["one_off_pso", "one_off_sa"]) {
    const r = named(name), result = run(r), [sum, floor, tie] = result.best.checks;
    assert.deepEqual(result.scales, [1.75, null, 0.6]);
    assert.deepEqual(result.best.checks.map((c) => c.applied), [true, false, true]);
    // both sides of the constraint that was off are there, and nothing that reads as a verdict
    assert.deepEqual(Object.keys(floor).sort(), ["applied", "left", "name", "op", "relativeTolerance", "right", "tolerance", "unit"]);
    assert.ok(Number.isFinite(floor.left) && Number.isFinite(floor.right));
    assert.deepEqual(result.best.constraints.map((c) => c.name), [sum.name, tie.name]);
    assert.equal(result.best.feasible, true);
    // the run is the one of the project without that constraint, and not the one with it switched on
    const without = run({ ...r, scales: [1.75, 0.6] }, (p) => p.constraints.splice(1, 1));
    assert.deepEqual(path(result), path(without), name);
    assert.notDeepEqual(run({ ...r, scales: [1.75, 120, 0.6] }, (p) => delete p.constraints[1].enabled).trace, result.trace, name);
  }
});

test("a project whose only constraint is off runs exactly as the project without it, in ypea and in the app", () => {
  for (const [name, twin] of [["only_off_ga", "route_ga"], ["only_off_sa", "route_sa"]]) {
    const { project: _, scales: __, ...off } = readTrace(name), { project: ___, scales: ____, ...plain } = readTrace(twin);
    assert.deepEqual(off, plain, `the ypea trace of ${name} is the one of ${twin}`);
    const r = named(name), result = run(r);
    assert.deepEqual(path(result), path(run({ ...r, scales: [] }, (p) => delete p.constraints)), name);
    assert.deepEqual(path(result), path(runTrace(readTrace(twin), METHODS[r.project.run.method])), name);
    assert.deepEqual([result.status, result.best.feasible, result.best.violation, result.scales, result.best.constraints], ["Best feasible solution found", true, 0, [null], []]);
    // the constraint would be broken if it were on: a first leg is never 0 km long
    const [leg] = result.best.checks;
    assert.ok(leg.applied === false && leg.left > leg.right && !("satisfied" in leg) && !("excess" in leg));
    // the sample for the scales is not drawn for it either
    assert.deepEqual(runProject(parseProject(structuredClone(r.project))).scales, [null]);
  }
});
