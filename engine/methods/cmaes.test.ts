// CMA-ES cannot follow ypea's trace bit for bit past the first iteration: ypea samples with
// LAPACK's eigenvectors, whose signs (and basis, for a repeated eigenvalue) no rule reproduces.
// These tests assert exactly
// what is exact, and compare the rest as distributions.

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

// Level 4: the median final value of 20 seeded runs against ypea's 20 runs with the same seeds,
// as |log10 of the ratio of the medians|. The tolerance is not chosen to pass. It is the 95th
// percentile of the same number between two random halves of 40 ypea runs (ypea against
// itself), so it says "no further apart than two sets of ypea runs usually are". It is
// provisional until the owner sets it.
const LEVEL4 = [
  { problem: "sphere", tolerance: 0.361 }, // 1000 evaluations. Measured: 0.243
  { problem: "rosenbrock", tolerance: 0.1 }, // 2000 evaluations. Measured: 0.020
];
const median = (v: number[]) => {
  const s = v.toSorted((a, b) => a - b);
  return (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const { problem, tolerance } of LEVEL4) {
  test(`CMA-ES ${problem}: median of 20 final values close to ypea's`, () => {
    const studio: number[] = [], ypea: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const trace = readTrace(`cmaes_${problem}_s${String(seed).padStart(2, "0")}`);
      studio.push(runTrace(trace, cmaes).best.objective);
      ypea.push(trace.traceF.at(-1)!);
    }
    const distance = Math.abs(Math.log10(median(studio) / median(ypea)));
    assert.ok(distance <= tolerance, `medians ${median(studio)} (Studio) and ${median(ypea)} (ypea): |log10 ratio| ${distance} is above ${tolerance}`);
  });
}

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
