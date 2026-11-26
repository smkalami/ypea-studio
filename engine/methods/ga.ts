// Genetic Algorithm, from ypea/algorithms/ga.py.

import type { Population } from "../evaluator.ts";
import { NativeOperators, roundHalfEven } from "../operators.ts";
import { argsort, concat, type Method, popSize, randomPopulation, selectionProbs, take } from "./common.ts";

export const ga: Method = {
  id: "ga",
  name: "Genetic Algorithm",
  ypea: "GA",
  suits: ["real", "integer", "binary", "ordering"],
  params: {
    pop_size: popSize,
    crossover_prob: { kind: "number", default: 0.7, min: 0, max: 10, help: "Fraction of the population size produced by crossover." },
    crossover_inflation: { kind: "number", default: 0.5, min: 0, max: 10, help: "Gamma of blend crossover: the mixing weight is drawn from [-gamma, 1 + gamma]." },
    mutation_prob: { kind: "number", default: 0.3, min: 0, max: 10, help: "Fraction of the population size produced by mutation." },
    mutation_rate: { kind: "number", default: 0.1, min: 0, max: 1, help: "Fraction of components changed in a mutant. 0 turns mutation off." },
    mutation_step_size: { kind: "number", default: 0.1, min: 0, max: 10, help: "Standard deviation of the Gaussian mutation, in code units." },
    mutation_step_size_damp: { kind: "number", default: 0.99, min: 1e-9, max: 10, help: "The step size is multiplied by this after every iteration." },
    selection: { kind: "choice", default: "roulettewheel", options: ["roulettewheel", "tournament", "random"], help: "How parents are chosen for crossover." },
    selection_pressure: { kind: "number", default: 5, min: 0, max: 100, help: "Pressure of roulette wheel selection." },
    tournament_size: { kind: "number", default: 3, min: 1, max: 1e6, integer: true, help: "Number of competitors in tournament selection." },
    space: { kind: "choice", default: "encoded", options: ["encoded", "native"], help: "What crossover and mutation work on: the codes in [0, 1], or the values themselves (an ordering stays an ordering). Types without operators of their own keep the code operators." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim } = ctx;
    const s = ctx.settings as Record<string, number>;
    const n = s.pop_size, g = s.crossover_inflation, size = s.tournament_size;
    const selection = ctx.settings.selection as string;
    const nc = 2 * roundHalfEven((s.crossover_prob * n) / 2), nm = roundHalfEven(s.mutation_prob * n);
    const sorted = (p: Population, keep = p.n) => take(p, argsort(ev, p).subarray(0, keep), dim);
    let pop = sorted(randomPopulation(ctx, n));
    let sigma = s.mutation_step_size;
    const native = ctx.settings.space === "native"
      ? new NativeOperators(ev.problem.variables, { alpha: g, rate: s.mutation_rate, sigma }) : null;

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

    // The two code operators work on `rows` rows of `d` codes: whole solutions, or with native
    // operators the slice of one variable that has none of its own.
    const crossover = ([x1, x2]: Float64Array[], rows: number, d: number): Float64Array[] => {
      const y1 = new Float64Array(rows * d), y2 = new Float64Array(rows * d);
      for (let i = 0; i < rows * d; i++) {
        const a = rng.uniform(-g, 1 + g);
        y1[i] = a * x1[i] + (1 - a) * x2[i];
        y2[i] = a * x2[i] + (1 - a) * x1[i];
      }
      return [y1, y2];
    };
    const mutate = ([x]: Float64Array[], rows: number, d: number): Float64Array[] => {
      // draw order: all sorting keys, then all normals
      const k = Math.ceil(s.mutation_rate * d), y = x.slice(), keys = rng.fill(new Float64Array(rows * d));
      for (let i = 0; i < rows; i++) {
        const row = i * d;
        const cols = Int32Array.from({ length: d }, (_, j) => j).sort((a, b) => keys[row + a] - keys[row + b] || a - b);
        for (let j = 0; j < k; j++) y[row + cols[j]] += sigma * rng.standardNormal();
      }
      return [y];
    };

    return () => {
      const children: Population[] = [];
      if (nc) {
        const p = select(nc), half = nc / 2;
        const parents = [take(pop, p.filter((_, i) => i % 2 === 0), dim).X, take(pop, p.filter((_, i) => i % 2 === 1), dim).X];
        const [y1, y2] = native ? native.apply("crossover", parents, half, rng, crossover) : crossover(parents, half, dim);
        const Y = new Float64Array(nc * dim);
        Y.set(y1);
        Y.set(y2, half * dim);
        children.push(ev.evaluate(Y));
      }
      if (nm && s.mutation_rate > 0) {
        const parents = new Int32Array(nm);
        for (let i = 0; i < nm; i++) parents[i] = rng.integers(0, pop.n);
        const x = [take(pop, parents, dim).X];
        native?.setSigma(sigma);
        children.push(ev.evaluate((native ? native.apply("mutate", x, nm, rng, mutate) : mutate(x, nm, dim))[0]));
      }
      const merged = concat(pop, ...children);
      pop = sorted(merged, Math.min(n, merged.n));
      sigma *= s.mutation_step_size_damp;
    };
  },
};
