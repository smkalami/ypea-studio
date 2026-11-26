// What every method shares: its declaration, its context, and the helpers that mirror the
// helpers of ypea's Algorithm base class (algorithm.py). Each method is written from its ypea
// source with the same draws in the same order and the same order of arithmetic, because a
// seeded Python run must follow the app.

import type { Evaluator, Population } from "../evaluator.ts";
import { npSum } from "../numpy.ts";
import type { Rng } from "../rng.ts";

export type SettingValue = number | string | boolean | null;
export type Settings = Record<string, SettingValue>;

/** One setting of a method. Forms, checks and documentation are built from these. */
export type ParamSpec =
  | { kind: "number"; default: number | null; min: number; max: number; integer?: boolean; nullable?: boolean; help: string }
  | { kind: "choice"; default: string; options: string[]; help: string }
  | { kind: "boolean"; default: boolean; help: string };

export type VariableKind = "real" | "integer" | "binary" | "ordering";

export interface Context {
  rng: Rng;
  evaluator: Evaluator;
  /** Number of codes per solution. */
  dim: number;
  /** The method's settings: its defaults with the project's values on top, already checked. */
  settings: Settings;
  /** The evaluation budget of the run (ypea's max_nfe). */
  budget: number;
}

export interface Method {
  id: string;
  name: string;
  /** The ypea class this method must match. */
  ypea: string;
  /** Kinds of variables the method suits. Others get a warning in the app. */
  suits: VariableKind[];
  params: Record<string, ParamSpec>;
  /** ypea's initialize(): evaluates the first population. Returns ypea's iterate(). */
  start(ctx: Context): () => void;
}

export const popSize: Extract<ParamSpec, { kind: "number" }> = {
  kind: "number", default: 100, min: 1, max: 1e6, integer: true, help: "Number of candidates per iteration.",
};

/** ypea's random_population(): n rows of uniform codes, drawn row by row, then evaluated. */
export function randomPopulation(ctx: Context, n: number): Population {
  return ctx.evaluator.evaluate(ctx.rng.fill(new Float64Array(n * ctx.dim)));
}

/** ypea's argsort(): indices from best to worst by Deb's rule. Stable, so ties keep their order. */
export function argsort(ev: Evaluator, pop: Population): Int32Array {
  const sign = ev.problem.sign;
  return Int32Array.from({ length: pop.n }, (_, i) => i).sort((i, j) => pop.V[i] - pop.V[j] || sign * pop.F[i] - sign * pop.F[j] || i - j);
}

/** ypea's ranks(): 0 for the best solution, and tied solutions share the lowest rank. */
export function ranks(ev: Evaluator, pop: Population): Float64Array {
  const order = argsort(ev, pop), out = new Float64Array(pop.n);
  let first = 0;
  order.forEach((i, k) => {
    const prev = order[k - 1];
    if (k > 0 && !(pop.V[i] === pop.V[prev] && pop.F[i] === pop.F[prev])) first = k;
    out[i] = first;
  });
  return out;
}

/**
 * ypea's selection_probs(): p proportional to exp(-pressure * r), with r the rank scaled to
 * [0, 1]. Math.exp can differ from NumPy's exp in the last digit, so a draw that lands
 * within one unit in the last place of a boundary can pick a different index.
 */
export function selectionProbs(ev: Evaluator, pop: Population, pressure = 1): Float64Array {
  const p = ranks(ev, pop).map((r) => Math.exp(-pressure * (r / Math.max(pop.n - 1, 1))));
  const total = npSum(p);
  return p.map((x) => x / total);
}

/** ypea's min_keys(): objective values turned into "smaller is better". */
export function minKeys(ev: Evaluator, pop: Population): Float64Array {
  return pop.F.map((f) => ev.problem.sign * f);
}

/** ypea's planned_iterations() when only the budget limits the run. */
export function plannedIterations(ctx: Context, evalsPerIteration: number): number {
  return Math.max(Math.ceil(ctx.budget / Math.max(evalsPerIteration, 1)), 1);
}

/** The rows `index` of a population, copied (ypea's pop[index]). */
export function take(pop: Population, index: ArrayLike<number>, dim: number): Population {
  const n = index.length, X = new Float64Array(n * dim), F = new Float64Array(n), V = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    X.set(pop.X.subarray(index[k] * dim, (index[k] + 1) * dim), k * dim);
    F[k] = pop.F[index[k]];
    V[k] = pop.V[index[k]];
  }
  return { n, X, F, V };
}

/** Populations joined in order (ypea's Population.concat). */
export function concat(...pops: Population[]): Population {
  const join = (key: "X" | "F" | "V") => {
    const out = new Float64Array(pops.reduce((s, p) => s + p[key].length, 0));
    let k = 0;
    for (const p of pops) {
      out.set(p[key], k);
      k += p[key].length;
    }
    return out;
  };
  return { n: pops.reduce((s, p) => s + p.n, 0), X: join("X"), F: join("F"), V: join("V") };
}

/** Copies row `from` of `source` over row `to` of `target` (one row of ypea's Population.replace). */
export function copyRow(target: Population, to: number, source: Population, from: number, dim: number): void {
  target.X.set(source.X.subarray(from * dim, (from + 1) * dim), to * dim);
  target.F[to] = source.F[from];
  target.V[to] = source.V[from];
}
