// Nelder-Mead simplex method with restarts, from ypea/algorithms/nelder_mead.py.

import type { Population } from "../evaluator.ts";
import { npSum } from "../numpy.ts";
import { argsort, concat, type Method, take } from "./common.ts";

export const nelderMead: Method = {
  id: "nelder_mead",
  name: "Nelder-Mead Simplex",
  ypea: "NelderMead",
  suits: ["real"],
  params: {
    reflection: { kind: "number", default: 1, min: 1e-9, max: 10, help: "Reflection coefficient (rho)." },
    expansion: { kind: "number", default: 2, min: 1 + 1e-9, max: 100, help: "Expansion coefficient (chi). Greater than 1 and than the reflection coefficient." },
    contraction: { kind: "number", default: 0.5, min: 1e-9, max: 1 - 1e-9, help: "Contraction coefficient (gamma)." },
    shrink: { kind: "number", default: 0.5, min: 1e-9, max: 1 - 1e-9, help: "Shrink coefficient (sigma)." },
    initial_step: { kind: "number", default: 0.1, min: 1e-9, max: 1, help: "Size of the initial simplex, in code units." },
    restart_tol: { kind: "number", default: 1e-10, min: 0, max: 1, help: "The method restarts from a random point when the simplex is smaller than this." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim } = ctx;
    const { reflection, expansion, contraction, shrink, initial_step: step, restart_tol: tol } = ctx.settings as Record<string, number>;
    if (!(expansion > reflection)) throw new Error("Nelder-Mead Simplex: \"expansion\" must be greater than \"reflection\"");

    const begin = (): Population => {
      const x0 = rng.fill(new Float64Array(dim)), X = new Float64Array((dim + 1) * dim);
      for (let i = 0; i <= dim; i++) X.set(x0, i * dim);
      for (let i = 0; i < dim; i++) X[(i + 1) * dim + i] += x0[i] + step > 1 ? -step : step;
      return ev.evaluate(X);
    };
    // evaluate() clips in place, so the returned point is the clipped one, as in ypea
    const trial = (f: (k: number) => number) => ev.evaluate(Float64Array.from({ length: dim }, (_, k) => f(k)));
    const better = (a: Population, b: Population, i: number) => ev.better(a.F[0], a.V[0], b.F[i], b.V[i]);

    let pop = begin();
    return () => {
      const s = take(pop, argsort(ev, pop), dim), X = s.X;
      // np.linalg.norm(axis=1) is the square root of a pairwise sum of squares
      let size = -Infinity;
      const sq = new Float64Array(dim);
      for (let i = 1; i <= dim; i++) {
        for (let k = 0; k < dim; k++) sq[k] = (X[i * dim + k] - X[k]) * (X[i * dim + k] - X[k]);
        size = Math.max(size, Math.sqrt(npSum(sq)));
      }
      if (size < tol) {
        pop = begin();
        return;
      }
      // mean(axis=0) of all vertices but the worst: each column added in index order
      const c = new Float64Array(dim), x = X.subarray(dim * dim);
      for (let i = 0; i < dim; i++) for (let k = 0; k < dim; k++) c[k] += X[i * dim + k];
      for (let k = 0; k < dim; k++) c[k] /= dim;

      const r = trial((k) => c[k] + reflection * (c[k] - x[k]));
      let next: Population | null;
      if (better(r, s, 0)) {
        const e = trial((k) => c[k] + expansion * (r.X[k] - c[k]));
        next = better(e, r, 0) ? e : r;
      } else if (better(r, s, dim - 1)) {
        next = r;
      } else if (better(r, s, dim)) {
        const o = trial((k) => c[k] + contraction * (r.X[k] - c[k]));
        next = better(r, o, 0) ? null : o;
      } else {
        const i = trial((k) => c[k] - contraction * (c[k] - x[k]));
        next = better(i, s, dim) ? i : null;
      }

      if (next) {
        pop = concat({ n: dim, X: X.subarray(0, dim * dim), F: s.F.subarray(0, dim), V: s.V.subarray(0, dim) }, next);
      } else {
        const moved = new Float64Array(dim * dim);
        for (let k = 0; k < moved.length; k++) moved[k] = X[k % dim] + shrink * (X[dim + k] - X[k % dim]);
        pop = concat(take(s, [0], dim), ev.evaluate(moved));
      }
    };
  },
};
