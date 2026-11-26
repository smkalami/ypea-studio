// Imperialist Competitive Algorithm, from ypea/algorithms/ica.py.

import { npSum } from "../numpy.ts";
import { argsort, copyRow, type Method, popSize, randomPopulation, ranks, take } from "./common.ts";

export const ica: Method = {
  id: "ica",
  name: "Imperialist Competitive Algorithm",
  ypea: "ICA",
  suits: ["real"],
  params: {
    pop_size: popSize,
    empire_count: { kind: "number", default: 5, min: 2, max: 1e6, integer: true, help: "Number of empires at the start. Less than the number of countries." },
    selection_pressure: { kind: "number", default: 1, min: 0, max: 100, help: "Pressure of the power based probabilities." },
    assimilation_coeff: { kind: "number", default: 1.5, min: 0, max: 10, help: "Each colony moves toward its imperialist by up to this many times their distance." },
    revolution_prob: { kind: "number", default: 0.05, min: 0, max: 1, help: "Probability that a colony is revolved in an iteration." },
    revolution_rate: { kind: "number", default: 0.1, min: 0, max: 1, help: "Fraction of the components changed by a revolution." },
    revolution_step_size: { kind: "number", default: 0.1, min: 0, max: 10, help: "Initial standard deviation of the revolution, in code units." },
    revolution_step_size_damp: { kind: "number", default: 0.99, min: 1e-9, max: 10, help: "The revolution step size is multiplied by this after every iteration." },
    zeta: { kind: "number", default: 0.2, min: 0, max: 100, help: "Weight of the mean colony cost in the total cost of an empire." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim } = ctx;
    const {
      pop_size: n, empire_count, selection_pressure, assimilation_coeff, revolution_prob, revolution_rate,
      revolution_step_size_damp, zeta,
    } = ctx.settings as Record<string, number>;
    if (!(empire_count < n)) throw new Error("Imperialist Competitive Algorithm: \"empire_count\" must be less than \"pop_size\"");
    let sigma = ctx.settings.revolution_step_size as number;

    // Math.exp can differ from NumPy's exp in the last digit (see selectionProbs in common.ts)
    const probs = (x: Float64Array): Float64Array => {
      const top = x.reduce((a, b) => Math.max(a, b));
      const p = x.map((v) => Math.exp(-selection_pressure * (top > 0 ? v / top : v)));
      const total = npSum(p);
      return p.map((v) => v / total);
    };

    let pop = randomPopulation(ctx, n);
    pop = take(pop, argsort(ev, pop), dim);
    // imps[k] is the country that rules empire k, and empireOf[i] is the empire of country i
    const imps = Array.from({ length: empire_count }, (_, k) => k);
    const empireOf = new Int32Array(n);
    {
      // colony counts proportional to power, rounded by largest remainder
      const colonies = n - empire_count;
      const costs = ranks(ev, pop).map((r) => r / Math.max(n - 1, 1));
      const share = probs(costs.subarray(0, empire_count)).map((p) => p * colonies);
      const counts = share.map(Math.floor);
      const extra = colonies - counts.reduce((a, b) => a + b);
      const gap = counts.map((c, k) => c - share[k]);
      for (const k of Int32Array.from(imps).sort((a, b) => gap[a] - gap[b] || a - b).slice(0, extra)) counts[k]++;
      const perm = rng.permutation(colonies);
      for (let k = 0, j = 0; k < empire_count; k++) {
        empireOf[k] = k;
        for (let c = 0; c < counts[k]; c++) empireOf[empire_count + perm[j++]] = k;
      }
    }

    const rows = (X: Float64Array, index: number[]): Float64Array => {
      const out = new Float64Array(index.length * dim);
      index.forEach((i, k) => out.set(X.subarray(i * dim, (i + 1) * dim), k * dim));
      return out;
    };

    /** ypea's revolve(): all the uniforms of the batch first, then its normals. */
    const revolve = (X: Float64Array): Float64Array => {
      const m = Math.ceil(revolution_rate * dim), keys = rng.fill(new Float64Array(X.length)), Y = X.slice();
      const cols: Int32Array[] = [];
      for (let o = 0; o < X.length; o += dim) {
        cols.push(Int32Array.from({ length: dim }, (_, j) => j).sort((a, b) => keys[o + a] - keys[o + b] || a - b));
      }
      cols.forEach((order, i) => {
        for (let j = 0; j < m; j++) Y[i * dim + order[j]] += sigma * rng.standardNormal();
      });
      return Y;
    };

    const compete = (c: Float64Array) => {
      const k = imps.length;
      if (k === 1) return;
      // np.bincount adds every member in index order, the imperialist included
      const sum = new Float64Array(k), count = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        sum[empireOf[i]] += c[i];
        count[empireOf[i]]++;
      }
      const tc = sum.map((s, e) => c[imps[e]] + zeta * (count[e] > 1 ? (s - c[imps[e]]) / (count[e] - 1) : 0));
      let weakest = 0;
      for (let e = 1; e < k; e++) if (tc[e] > tc[weakest]) weakest = e;
      let p = probs(tc);
      p[weakest] = 0;
      const total = npSum(p);
      p = p.map((v) => v / total);
      let colonies = 0, last = -1;
      for (let i = 0; i < n; i++) {
        if (empireOf[i] !== weakest || i === imps[weakest]) continue;
        colonies++;
        if (last < 0 || c[i] > c[last]) last = i;
      }
      if (colonies) empireOf[last] = rng.choice(p);
      if (colonies <= 1) {
        // the weakest empire has no colonies left: its imperialist joins another empire
        empireOf[imps[weakest]] = rng.choice(p);
        imps.splice(weakest, 1);
        for (let i = 0; i < n; i++) if (empireOf[i] > weakest) empireOf[i]--;
      }
    };

    return () => {
      const X = pop.X, colony: number[] = [];
      for (let i = 0; i < n; i++) if (imps[empireOf[i]] !== i) colony.push(i);

      // draw order: assimilation for every country, the revolution mask, then the two revolutions
      const Xc = rng.fill(new Float64Array(n * dim));
      for (let i = 0; i < n; i++) {
        const ruler = imps[empireOf[i]] * dim;
        for (let j = 0; j < dim; j++) {
          const x = X[i * dim + j];
          Xc[i * dim + j] = x + assimilation_coeff * Xc[i * dim + j] * (X[ruler + j] - x);
        }
      }
      const mask = rng.fill(new Float64Array(n));
      const rev = colony.filter((i) => mask[i] < revolution_prob), revolved = revolve(rows(Xc, rev));
      rev.forEach((i, k) => Xc.set(revolved.subarray(k * dim, (k + 1) * dim), i * dim));
      const trialImp = revolve(rows(X, imps));

      const nc = colony.length, batch = new Float64Array((nc + imps.length) * dim);
      batch.set(rows(Xc, colony));
      batch.set(trialImp, nc * dim);
      const fresh = ev.evaluate(batch);
      colony.forEach((i, k) => copyRow(pop, i, fresh, k, dim));
      imps.forEach((i, k) => {
        if (ev.better(fresh.F[nc + k], fresh.V[nc + k], pop.F[i], pop.V[i])) copyRow(pop, i, fresh, nc + k, dim);
      });

      // exchange: the best country of each empire becomes its imperialist
      const r = ranks(ev, pop);
      for (let i = 0; i < n; i++) if (r[i] < r[imps[empireOf[i]]]) imps[empireOf[i]] = i;

      compete(r.map((v) => v / Math.max(n - 1, 1)));
      sigma *= revolution_step_size_damp;
    };
  },
};
