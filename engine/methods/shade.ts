// SHADE (Success History based Adaptive DE), from ypea/algorithms/adaptive_de.py: the classes
// _AdaptiveDE, _HistoryDE and SHADE. The L-SHADE parts of _HistoryDE (the terminal value of
// M_CR and the population resize) cannot occur in SHADE and are left out.

import { npSum } from "../numpy.ts";
import { argsort, copyRow, type Method, randomPopulation } from "./common.ts";

/** Python's round() and np.round(): halves go to the even neighbor. For x >= 0. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export const shade: Method = {
  id: "shade",
  name: "Success History based Adaptive Differential Evolution",
  ypea: "SHADE",
  suits: ["real"],
  params: {
    pop_size: { kind: "number", default: 100, min: 4, max: 1e6, integer: true, help: "Number of candidates per iteration." },
    memory_size: { kind: "number", default: 100, min: 1, max: 1e6, integer: true, help: "Number of memory slots H." },
    archive_rate: { kind: "number", default: 1, min: 0, max: 10, help: "The archive holds at most this many times the population size." },
    p_best_max: { kind: "number", default: 0.2, min: 1e-9, max: 1, help: "Upper limit of the fraction of best members that guide a trial vector." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim: d } = ctx;
    const { pop_size: n, memory_size: H, archive_rate, p_best_max } = ctx.settings as Record<string, number>;
    const sign = ev.problem.sign;
    const pop = randomPopulation(ctx, n);
    let archive: Float64Array[] = [];
    const mF = new Float64Array(H).fill(0.5), mCR = new Float64Array(H).fill(0.5);
    let k = 0;
    const archiveSize = roundHalfEven(archive_rate * n);
    const low = 2 / n, high = Math.max(low, p_best_max);

    /** Draws out[i] for the listed rows, then again for those that `bad` rejects, round after round. */
    function drawUntilGood(out: { [i: number]: number }, draw: (i: number) => number, bad: (i: number) => boolean): void {
      let todo = Array.from({ length: n }, (_, i) => i);
      while (todo.length) {
        for (const i of todo) out[i] = draw(i);
        todo = todo.filter(bad);
      }
    }

    return () => {
      const X = pop.X;
      // draw order: slots, CR, F, pbest rates, pbest picks, r1, r2, crossover, each for all rows
      const slot = Int32Array.from({ length: n }, () => rng.integers(0, H));
      const CR = Float64Array.from(slot, (r) => Math.min(Math.max(mCR[r] + 0.1 * rng.standardNormal(), 0), 1));
      const F = new Float64Array(n);
      drawUntilGood(F, (i) => mF[slot[i]] + 0.1 * rng.standardCauchy(), (i) => F[i] <= 0);
      for (let i = 0; i < n; i++) F[i] = Math.min(F[i], 1);

      const top = Int32Array.from({ length: n }, () => Math.min(Math.max(roundHalfEven(rng.uniform(low, high) * n), 2), n));
      const order = argsort(ev, pop);
      const pbest = top.map((t) => order[Math.trunc(rng.random() * t)]);
      const r1 = Int32Array.from({ length: n }, (_, i) => (i + 1 + rng.integers(0, n - 1)) % n);
      const poolSize = n + archive.length;
      const r2 = new Int32Array(n);
      drawUntilGood(r2, () => rng.integers(0, poolSize), (i) => r2[i] === i || r2[i] === r1[i]);

      const u = rng.fill(new Float64Array(n * d));
      const trial = new Float64Array(n * d);
      for (let i = 0, e = 0; i < n; i++) {
        const forced = rng.integers(0, d), f = F[i];
        const other = r2[i] < n ? X.subarray(r2[i] * d, (r2[i] + 1) * d) : archive[r2[i] - n];
        for (let j = 0; j < d; j++, e++) {
          const x = X[e];
          let v = x + f * (X[pbest[i] * d + j] - x) + f * (X[r1[i] * d + j] - other[j]);
          // outside [0, 1]: the midpoint between the parent and the violated bound
          if (v < 0) v = x / 2;
          if (v > 1) v = (x + 1) / 2;
          trial[e] = u[e] < CR[i] || j === forced ? v : x;
        }
      }
      const fresh = ev.evaluate(trial);

      // rows cut by the budget have infinite violation and never count
      const success: number[] = [];
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(fresh.V[i]) && ev.better(fresh.F[i], fresh.V[i], pop.F[i], pop.V[i])) success.push(i);
      }
      if (success.length) {
        for (const i of success) archive.push(X.slice(i * d, (i + 1) * d));
        const w = Float64Array.from(success, (i) => {
          const fo = sign * pop.F[i], fn = sign * fresh.F[i];
          const useF = pop.V[i] <= 0 && fresh.V[i] <= 0 && Number.isFinite(fo) && Number.isFinite(fn);
          return useF ? Math.abs(fo - fn) : Math.abs(pop.V[i] - fresh.V[i]);
        });
        const total = npSum(w);
        const equal = !(Number.isFinite(total) && total > 0);
        for (let q = 0; q < w.length; q++) w[q] = equal ? 1 / w.length : w[q] / total;
        // weighted Lehmer mean of F, weighted mean of CR
        mF[k] = npSum(w.map((x, q) => x * (F[success[q]] * F[success[q]]))) / npSum(w.map((x, q) => x * F[success[q]]));
        mCR[k] = npSum(w.map((x, q) => x * CR[success[q]]));
        k = (k + 1) % H;
      }
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(fresh.V[i]) && !ev.better(pop.F[i], pop.V[i], fresh.F[i], fresh.V[i])) copyRow(pop, i, fresh, i, d);
      }
      if (archive.length > archiveSize) {
        const keep = rng.permutation(archive.length).subarray(0, archiveSize).sort();
        archive = Array.from(keep, (i) => archive[i]);
      }
    };
  },
};
