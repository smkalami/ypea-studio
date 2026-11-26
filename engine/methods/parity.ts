// Test helpers shared by the method tests: compare a Studio run with the ypea trace of the
// same seeded run, stored in spec/parity/traces/ by spec/parity/make_cases.py.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProject } from "../project.ts";
import { runProject } from "../run.ts";
import type { Method } from "./common.ts";
import { METHODS } from "./index.ts";

export interface Trace {
  ypea: string;
  project: unknown;
  /** The constraint scales the ypea run used. */
  scales: number[];
  nfe: number;
  traceNfe: number[];
  traceF: number[];
  /** Violations of the improvements. An infinite one is stored as the text "inf". */
  traceV: (number | "inf")[];
  bestCodes: number[];
}

export function readTrace(name: string): Trace {
  return JSON.parse(readFileSync(new URL(`../../spec/parity/traces/${name}.json`, import.meta.url), "utf8"));
}

/** Runs the trace's project with `method`, which need not be in the registry yet. */
export function runTrace(trace: Trace, method: Method) {
  METHODS[method.id] = method;
  return runProject(parseProject(structuredClone(trace.project)), { scales: trace.scales });
}

/**
 * Level 3 parity, exact form: the same evaluations find the same improvements with the same
 * values, bit for bit, and the run ends on the same best position.
 */
export function assertSameTrace(name: string, method: Method): void {
  const trace = readTrace(name), result = runTrace(trace, method);
  assert.equal(result.evaluations.used, trace.nfe, "evaluations used");
  const violation = (i: number) => (trace.traceV[i] === "inf" ? Infinity : trace.traceV[i]);
  const first = result.trace.nfe.findIndex((n, i) =>
    n !== trace.traceNfe[i] || result.trace.objective[i] !== trace.traceF[i] || result.trace.violation[i] !== violation(i));
  assert.equal(first, -1, first < 0 ? "" :
    `${name}: improvement ${first} differs. Studio found ${result.trace.objective[first]} (violation ${result.trace.violation[first]}) at evaluation ${result.trace.nfe[first]}, ` +
    `ypea found ${trace.traceF[first]} (violation ${trace.traceV[first]}) at evaluation ${trace.traceNfe[first]} (${trace.traceNfe.length} improvements in all)`);
  assert.equal(result.trace.nfe.length, trace.traceNfe.length, "number of improvements");
  assert.deepEqual(result.best.codes, trace.bestCodes, "best position");
}
