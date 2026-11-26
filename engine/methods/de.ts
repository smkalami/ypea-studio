// Differential Evolution, from ypea/algorithms/de.py.

import { copyRow, type Method, popSize, randomPopulation } from "./common.ts";

export const de: Method = {
  id: "de",
  name: "Differential Evolution",
  ypea: "DE",
  suits: ["real"],
  params: {
    pop_size: popSize,
    base_vector: {
      kind: "choice", default: "rand", options: ["rand", "best", "current-to-best", "rand-to-best"],
      help: "The vector that the differences are added to.",
    },
    diff_vectors_count: { kind: "number", default: 1, min: 1, max: 1e6, integer: true, help: "Number of difference vectors." },
    crossover_method: { kind: "choice", default: "bin", options: ["bin", "exp"], help: "Binomial or exponential crossover." },
    crossover_prob: { kind: "number", default: 0.2, min: 0, max: 1, help: "Crossover rate CR." },
    beta_min: { kind: "number", default: 0.2, min: 0, max: 10, help: "Lower limit of the scale factor, drawn anew for every component." },
    beta_max: { kind: "number", default: 0.9, min: 0, max: 10, help: "Upper limit of the scale factor." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim: d } = ctx;
    const s = ctx.settings;
    const n = s.pop_size as number, k = s.diff_vectors_count as number, cr = s.crossover_prob as number;
    const betaMin = s.beta_min as number, betaMax = s.beta_max as number, base = s.base_vector;
    const usesRand = base === "rand" || base === "rand-to-best" ? 1 : 0;
    const m = 2 * k + usesRand;
    if (betaMin > betaMax) throw new Error("Differential Evolution: beta_min must not exceed beta_max");
    if (n < m + 1) throw new Error(`Differential Evolution: DE/${base}/${k}/${s.crossover_method} needs pop_size >= ${m + 1}`);

    const pop = randomPopulation(ctx, n);
    const keys = new Float64Array(n), idx = new Int32Array(n * m), mask = new Uint8Array(n * d);
    const beta = () => Float64Array.from({ length: n * d }, () => rng.uniform(betaMin, betaMax));

    return () => {
      const X = pop.X, best = ev.bestX!;
      // Distinct partners for target i: the first m of the other indices, ordered by random keys.
      // NumPy's argsort is not stable here, which shows only if two 53-bit keys are equal.
      for (let i = 0; i < n; i++) {
        rng.fill(keys)[i] = Infinity;
        const order = Int32Array.from(keys, (_, a) => a).sort((a, b) => keys[a] - keys[b] || a - b);
        idx.set(order.subarray(0, m), i * m);
      }

      const mutant = new Float64Array(n * d);
      const b0 = base === "current-to-best" || base === "rand-to-best" ? beta() : null;
      for (let i = 0, e = 0; i < n; i++) {
        for (let j = 0; j < d; j++, e++) {
          const r = usesRand ? X[idx[i * m] * d + j] : X[e];
          mutant[e] = base === "rand" ? r : base === "best" ? best[j] : r + b0![e] * (best[j] - r);
        }
      }
      for (let q = 0; q < k; q++) {
        const b = beta();
        for (let i = 0, e = 0; i < n; i++) {
          const p1 = idx[i * m + usesRand + 2 * q] * d, p2 = idx[i * m + usesRand + 2 * q + 1] * d;
          for (let j = 0; j < d; j++, e++) mutant[e] += b[e] * (X[p1 + j] - X[p2 + j]);
        }
      }

      if (s.crossover_method === "bin") {
        const u = rng.fill(new Float64Array(n * d));
        for (let e = 0; e < n * d; e++) mask[e] = u[e] <= cr ? 1 : 0;
        for (let i = 0; i < n; i++) mask[i * d + rng.integers(0, d)] = 1;
      } else {
        // from a random start, L consecutive components (cyclic), L from 1 to d
        const from = Int32Array.from({ length: n }, () => rng.integers(0, d));
        for (let i = 0; i < n; i++) {
          const length = cr >= 1 ? d : Math.min(rng.geometric(1 - cr), d);
          for (let j = 0; j < d; j++) mask[i * d + j] = (j - from[i] + d) % d < length ? 1 : 0;
        }
      }

      const fresh = ev.evaluate(mutant.map((v, e) => (mask[e] ? v : X[e])));
      for (let i = 0; i < n; i++) {
        // a trial replaces its target when it is at least as good
        if (!ev.better(pop.F[i], pop.V[i], fresh.F[i], fresh.V[i])) copyRow(pop, i, fresh, i, d);
      }
    };
  },
};
