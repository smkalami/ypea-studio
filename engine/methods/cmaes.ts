// Covariance Matrix Adaptation Evolution Strategy, from ypea/algorithms/cmaes.py.
//
// Parity with ypea (measured): the random draws and everything up to the end of the first
// iteration's evaluations are the same bit for bit. After that the two sides agree within a
// tolerance that grows slowly with the run: the best value differs by about 1e-11 after 1000
// evaluations. Both sides sample with the symmetric root B D B^T z, so a run does not depend on
// which eigenvectors a decomposition returns (ypea takes them from LAPACK, this file from the
// Jacobi method below).
//
// The matrix products (ypea's @) and the norm go through BLAS in ypea. Here they are plain
// sums in index order.

import { npSum } from "../numpy.ts";
import { argsort, type Method } from "./common.ts";

/**
 * Eigenvalues (ascending) and eigenvectors of the symmetric n by n matrix A (row-major), by
 * the cyclic Jacobi method. Column k of `vectors` belongs to `values[k]`. Only + - * / and
 * sqrt are used, in a fixed order, so the same code in another language gives the same bits.
 * The signs of the eigenvectors are whatever the rotations leave. They are not normalized.
 */
export function eigh(A: ArrayLike<number>, n: number): { values: Float64Array; vectors: Float64Array } {
  const a = Float64Array.from(A), v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  // the sweeps end when one makes no rotation. 60 is only a guard against an endless loop
  for (let sweep = 0, rotated = true; rotated && sweep < 60; sweep++) {
    rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q], app = a[p * n + p], aqq = a[q * n + q];
        if (apq === 0) continue;
        const g = 100 * Math.abs(apq);
        a[p * n + q] = a[q * n + p] = 0;
        // an entry too small to change either diagonal value is dropped
        if (Math.abs(app) + g === Math.abs(app) && Math.abs(aqq) + g === Math.abs(aqq)) continue;
        rotated = true;
        const theta = (aqq - app) / (2 * apq);
        const t = (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        a[p * n + p] = app - t * apq;
        a[q * n + q] = aqq + t * apq;
        for (let k = 0; k < n; k++) {
          if (k !== p && k !== q) {
            const akp = a[k * n + p], akq = a[k * n + q];
            a[k * n + p] = a[p * n + k] = c * akp - s * akq;
            a[k * n + q] = a[q * n + k] = s * akp + c * akq;
          }
          const vkp = v[k * n + p], vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * n + i] - a[j * n + j] || i - j);
  const values = new Float64Array(n), vectors = new Float64Array(n * n);
  order.forEach((from, to) => {
    values[to] = a[from * n + from];
    for (let k = 0; k < n; k++) vectors[k * n + to] = v[k * n + from];
  });
  return { values, vectors };
}

/** np.mod(x, 2) folded at 1: mirrors a point back into [0, 1] (ypea's reflect). */
function reflect(x: number): number {
  let y = x % 2;
  if (y < 0) y += 2;
  return y > 1 ? 2 - y : y;
}

export const cmaes: Method = {
  id: "cmaes",
  name: "Covariance Matrix Adaptation Evolution Strategy",
  ypea: "CMAES",
  suits: ["real"],
  params: {
    pop_size: {
      kind: "number", default: null, min: 2, max: 1e6, integer: true, nullable: true,
      help: "Number of samples per iteration (lambda). Empty gives 4 + floor(3 ln n), with n the number of codes.",
    },
    mu: {
      kind: "number", default: null, min: 1, max: 1e6, integer: true, nullable: true,
      help: "Number of parents. Empty gives half the population size. It must not exceed the population size.",
    },
    sigma0: { kind: "number", default: 0.3, min: 1e-9, max: 1e6, help: "Initial step size, in code units (the search space is [0, 1] per code)." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim: n } = ctx;
    const lam = (ctx.settings.pop_size as number | null) ?? 4 + Math.floor(3 * Math.log(n));
    const muGiven = ctx.settings.mu as number | null;
    const mu = muGiven ?? Math.floor(lam / 2);
    if (mu > lam) throw new Error(`${cmaes.name}: "mu" must not exceed the population size (${lam})`);

    // Math.log differs from np.log in the last digit for some inputs (measured: for 3, so for
    // every mu of 3 or more), and then the weights differ from ypea's in the last digit too.
    const top = muGiven === null ? Math.log((lam + 1) / 2) : Math.log(mu + 0.5);
    const raw = Float64Array.from({ length: mu }, (_, i) => top - Math.log(i + 1));
    const total = npSum(raw);
    const weights = raw.map((x) => x / total);
    const me = 1 / npSum(weights.map((x) => x * x));
    const cc = (4 + me / n) / (n + 4 + (2 * me) / n);
    const cs = (me + 2) / (n + me + 5);
    const c1 = 2 / ((n + 1.3) * (n + 1.3) + me);
    const cmu = Math.min(1 - c1, (2 * (0.25 + me + 1 / me - 2)) / ((n + 2) * (n + 2) + me));
    const damps = 1 + 2 * Math.max(0, Math.sqrt((me - 1) / (n + 1)) - 1) + cs;
    const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

    let mean = rng.fill(new Float64Array(n));
    let sigma = ctx.settings.sigma0 as number;
    const C = new Float64Array(n * n), ps = new Float64Array(n), pc = new Float64Array(n);
    let B: Float64Array = new Float64Array(n * n), D: Float64Array = new Float64Array(n).fill(1);
    for (let i = 0; i < n; i++) C[i * n + i] = B[i * n + i] = 1;
    ev.evaluate(mean.slice()); // the initial mean, so a best exists
    let iter = 0;

    return () => {
      iter++;
      // X = reflect(mean + (sigma * ((Z @ B) * D)) @ B.T), read from the left as Python does. This
      // is the symmetric root B D B^T z, so a run does not depend on the signs or the basis of
      // the eigenvectors, which differ between this decomposition and NumPy's.
      const X = new Float64Array(lam * n), step = new Float64Array(n), z = new Float64Array(n);
      for (let i = 0; i < lam; i++) {
        for (let j = 0; j < n; j++) z[j] = rng.standardNormal();
        for (let k = 0; k < n; k++) {
          let w = 0;
          for (let j = 0; j < n; j++) w += z[j] * B[j * n + k];
          step[k] = sigma * (w * D[k]);
        }
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let k = 0; k < n; k++) s += step[k] * B[j * n + k];
          X[i * n + j] = reflect(mean[j] + s);
        }
      }
      const pop = ev.evaluate(X);
      const order = argsort(ev, pop).subarray(0, mu);

      // steps actually taken (after reflection), and their weighted mean
      const Y = new Float64Array(mu * n), yw = new Float64Array(n);
      for (let r = 0; r < mu; r++) {
        for (let j = 0; j < n; j++) {
          Y[r * n + j] = (pop.X[order[r] * n + j] - mean[j]) / sigma;
          yw[j] += weights[r] * Y[r * n + j];
        }
      }
      mean = mean.map((m, j) => m + sigma * yw[j]);

      // C^(-1/2) y_w = B D^-1 B^T y_w
      const t = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += B[j * n + k] * yw[j];
        t[k] = s / D[k];
      }
      const a = Math.sqrt(cs * (2 - cs) * me);
      let sq = 0;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += B[i * n + k] * t[k];
        ps[i] = (1 - cs) * ps[i] + a * s;
        sq += ps[i] * ps[i];
      }
      const psNorm = Math.sqrt(sq);
      const hsig = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * iter)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
      const b = hsig * Math.sqrt(cc * (2 - cc) * me);
      for (let j = 0; j < n; j++) pc[j] = (1 - cc) * pc[j] + b * yw[j];

      const keep = 1 - c1 - cmu + c1 * ((1 - hsig) * cc * (2 - cc));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let rankMu = 0;
          for (let r = 0; r < mu; r++) rankMu += weights[r] * Y[r * n + i] * Y[r * n + j];
          C[i * n + j] = keep * C[i * n + j] + c1 * (pc[i] * pc[j]) + cmu * rankMu;
        }
      }
      sigma = Math.min(sigma * Math.exp((cs / damps) * (psNorm / chiN - 1)), 1); // the whole search space is [0, 1]

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) C[i * n + j] = C[j * n + i] = (C[i * n + j] + C[j * n + i]) / 2;
      }
      const e = eigh(C, n);
      B = e.vectors;
      D = e.values.map((x) => Math.sqrt(Math.max(x, 1e-20)));
    };
  },
};
