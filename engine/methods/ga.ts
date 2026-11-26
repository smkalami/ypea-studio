// Genetic Algorithm, from ypea/algorithms/ga.py.

import type { Population } from "../evaluator.ts";
import { argsort, concat, type Method, popSize, randomPopulation, selectionProbs, take } from "./common.ts";

/** Python's round() for a non-negative number: halves go to the even neighbor. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 || (d === 0.5 && f % 2 === 0) ? f : f + 1;
}

export const ga: Method = {
  id: "ga",
  name: "Genetic Algorithm",
  ypea: "GA",
  suits: ["real", "integer", "binary", "ordering"],
  params: {
    pop_size: popSize,
    crossover_prob: { kind: "number", default: 0.7, min: 0, max: 10, help: "Fraction of the population size produced by crossover." },
    crossover_inflation: { kind: "number", default: 0.1, min: 0, max: 10, help: "Gamma of blend crossover: the mixing weight is drawn from [-gamma, 1 + gamma]." },
    mutation_prob: { kind: "number", default: 0.3, min: 0, max: 10, help: "Fraction of the population size produced by mutation." },
    mutation_rate: { kind: "number", default: 0.1, min: 0, max: 1, help: "Fraction of components changed in a mutant." },
    mutation_step_size: { kind: "number", default: 0.1, min: 0, max: 10, help: "Standard deviation of the Gaussian mutation, in code units." },
    mutation_step_size_damp: { kind: "number", default: 0.99, min: 1e-9, max: 10, help: "The step size is multiplied by this after every iteration." },
    selection: { kind: "choice", default: "roulettewheel", options: ["roulettewheel", "tournament", "random"], help: "How parents are chosen for crossover." },
    selection_pressure: { kind: "number", default: 5, min: 0, max: 100, help: "Pressure of roulette wheel selection." },
    tournament_size: { kind: "number", default: 3, min: 1, max: 1e6, integer: true, help: "Number of competitors in tournament selection." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim } = ctx;
    const s = ctx.settings as Record<string, number>;
    const n = s.pop_size, g = s.crossover_inflation, size = s.tournament_size;
    const selection = ctx.settings.selection as string;
    const nc = 2 * roundHalfEven((s.crossover_prob * n) / 2), nm = roundHalfEven(s.mutation_prob * n);
    const k = Math.ceil(s.mutation_rate * dim);
    const sorted = (p: Population, keep = p.n) => take(p, argsort(ev, p).subarray(0, keep), dim);
    let pop = sorted(randomPopulation(ctx, n));
    let sigma = s.mutation_step_size;

    const select = (count: number): Int32Array => {
      const out = new Int32Array(count);
      if (selection === "random") {
        for (let i = 0; i < count; i++) out[i] = rng.integers(0, pop.n);
      } else if (selection === "roulettewheel") {
        const p = selectionProbs(ev, pop, s.selection_pressure);
        for (let i = 0; i < count; i++) out[i] = rng.choice(p);
      } else {
        // the population is sorted, so the smallest index wins
        for (let i = 0; i < count; i++) {
          let best = pop.n;
          for (let j = 0; j < size; j++) best = Math.min(best, rng.integers(0, pop.n));
          out[i] = best;
        }
      }
      return out;
    };

    return () => {
      const children: Population[] = [];
      if (nc) {
        const p = select(nc), half = nc / 2, Y = new Float64Array(nc * dim);
        for (let i = 0; i < half; i++) {
          for (let j = 0; j < dim; j++) {
            const a = rng.uniform(-g, 1 + g), x1 = pop.X[p[2 * i] * dim + j], x2 = pop.X[p[2 * i + 1] * dim + j];
            Y[i * dim + j] = a * x1 + (1 - a) * x2;
            Y[(half + i) * dim + j] = a * x2 + (1 - a) * x1;
          }
        }
        children.push(ev.evaluate(Y));
      }
      if (nm && s.mutation_rate > 0) {
        // draw order: the parents, all sorting keys, then all normals
        const parents = new Int32Array(nm);
        for (let i = 0; i < nm; i++) parents[i] = rng.integers(0, pop.n);
        const Y = take(pop, parents, dim).X, keys = rng.fill(new Float64Array(nm * dim));
        for (let i = 0; i < nm; i++) {
          const row = i * dim;
          const cols = Int32Array.from({ length: dim }, (_, j) => j).sort((a, b) => keys[row + a] - keys[row + b] || a - b);
          for (let j = 0; j < k; j++) Y[row + cols[j]] += sigma * rng.standardNormal();
        }
        children.push(ev.evaluate(Y));
      }
      const merged = concat(pop, ...children);
      pop = sorted(merged, Math.min(n, merged.n));
      sigma *= s.mutation_step_size_damp;
    };
  },
};
