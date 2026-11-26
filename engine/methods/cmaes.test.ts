// CMA-ES follows ypea within a tolerance, not bit for bit. Both sides sample with the symmetric
// root B D B^T z, so a run does not depend on which eigenvectors a decomposition returns. What
// remains is rounding: this decomposition and its sums against LAPACK and BLAS, and log and
// exp in the last digit. These tests assert exactly what is exact and bound the rest.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "../rng.ts";
import { cmaes, eigh } from "./cmaes.ts";
import { readTrace, runTrace, type Trace } from "./parity.ts";

// the parity runs of spec/parity/methods/cmaes.json with their population size (lambda)
const RUNS = { cmaes_sphere: 10, cmaes_rosenbrock: 10, cmaes_sphere_pop30: 30, cmaes_rosenbrock_mu: 24, cmaes_sphere_max: 10 };

for (const [name, lam] of Object.entries(RUNS)) {
  test(`CMA-ES ${name}: ypea's evaluation count, and its trace bit for bit through the first iteration`, () => {
    const trace = readTrace(name), result = runTrace(trace, cmaes);
    assert.equal(result.evaluations.used, trace.nfe, "evaluations used");
    // The initial mean and the first lambda samples use only the generator and exact
    // arithmetic (B is the identity and D is 1), so their improvements must be identical.
    const head = (nfe: number[], f: number[]) => nfe.map((e, i) => [e, f[i]]).filter(([e]) => e <= 1 + lam);
    assert.deepEqual(head(result.trace.nfe, result.trace.objective), head(trace.traceNfe, trace.traceF));
  });
}

// Level 3: the best value so far at fixed evaluation counts, as a relative difference from
// ypea's, over all 45 stored runs (5 parity runs and 20 seeds each on two problems).
// Measured largest values on Node 26 against ypea 0.4.0: 1.7e-13 at 500 evaluations, 1.5e-11
// at 1000 and 2.5e-9 at 2000. Each bound leaves a factor of a few hundred for other computers.
// The difference grows with the run, because rounding compounds: at 3000 evaluations it was 1e-4.
const BOUNDS = [[500, 1e-10], [1000, 1e-8], [2000, 1e-6]];
const SEEDS = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"));
const ALL = [...Object.keys(RUNS), ...["sphere", "rosenbrock"].flatMap((p) => SEEDS.map((n) => `cmaes_${p}_s${n}`))];

test("CMA-ES follows ypea's best value within a tight tolerance for the first 2000 evaluations", () => {
  const bestAt = (nfe: number[], f: number[], point: number) => {
    let k = -1;
    while (k + 1 < nfe.length && nfe[k + 1] <= point) k++;
    return f[k];
  };
  for (const name of ALL) {
    const trace = readTrace(name), result = runTrace(trace, cmaes);
    for (const [point, bound] of BOUNDS) {
      if (point > trace.nfe) continue;
      const a = bestAt(trace.traceNfe, trace.traceF, point), b = bestAt(result.trace.nfe, result.trace.objective, point);
      const difference = a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
      assert.ok(difference <= bound, `${name} at ${point} evaluations: ypea ${a}, Studio ${b}, relative difference ${difference} is above ${bound}`);
    }
  }
});

test("CMA-ES with default settings converges on the 10 variable sphere within 20000 evaluations", () => {
  const project = { ...(readTrace("cmaes_sphere").project as object), run: { method: "cmaes", settings: {}, budget: 20000, seed: 1 } };
  const result = runTrace({ project } as Trace, cmaes);
  assert.deepEqual(result.settings, { pop_size: null, mu: null, sigma0: 0.3 });
  assert.equal(result.evaluations.used, 20000);
  // Measured: exactly 0 with this seed (3.2e-30 with seed 2), last improved at evaluation 5283.
  assert.ok(result.best.objective < 1e-20, `best value ${result.best.objective}`);
});

test("CMA-ES refuses more parents than samples", () => {
  const project = { ...(readTrace("cmaes_sphere").project as object), run: { method: "cmaes", settings: { mu: 11 }, budget: 100, seed: 1 } };
  assert.throws(() => runTrace({ project } as Trace, cmaes), /must not exceed/);
});

test("eigh: ascending eigenvalues and orthonormal eigenvectors that rebuild the matrix", () => {
  const rng = new Rng(3);
  for (const n of [1, 2, 5, 10, 30]) {
    // G G^T / n, and for the second matrix the identity plus a matrix of rank 2, which has a repeated eigenvalue
    for (const rank of [n, 2]) {
      const G = Array.from({ length: n * rank }, () => rng.standardNormal());
      const A = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          for (let k = 0; k < rank; k++) A[i * n + j] += (G[i * rank + k] * G[j * rank + k]) / n;
          if (rank < n && i === j) A[i * n + j] += 1;
        }
      }
      const { values, vectors: V } = eigh(A, n);
      let worst = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) assert.ok(values[i - 1] <= values[i], "ascending");
        for (let j = 0; j < n; j++) {
          let dot = 0, back = 0;
          for (let k = 0; k < n; k++) {
            dot += V[k * n + i] * V[k * n + j];
            back += V[i * n + k] * values[k] * V[j * n + k];
          }
          worst = Math.max(worst, Math.abs(dot - (i === j ? 1 : 0)), Math.abs(back - A[i * n + j]));
        }
      }
      // Measured: at most 9.5e-15 over these matrices.
      assert.ok(worst < 1e-12, `n=${n}, rank ${rank}: error ${worst}`);
    }
  }
});
