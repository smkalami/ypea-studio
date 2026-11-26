// Evaluation of codes for one run: clip, decode, call the objective, count, track the best.
// It follows ypea's Evaluator, so a seeded Python run takes the same path.

import { total, violation } from "./constraints.ts";
import type { Problem } from "./project.ts";

/** n solutions as flat arrays: codes X (n * dim), objective values F, total violations V. */
export interface Population {
  n: number;
  X: Float64Array;
  F: Float64Array;
  V: Float64Array;
}

export class Evaluator {
  nfe = 0;
  /** ypea's self.constrained: true when the problem has constraints. */
  readonly constrained: boolean;
  /** One scale per constraint, fixed for the run (constraints.ts). */
  readonly scales: number[];
  private readonly sides: Float64Array;
  private readonly violations: Float64Array;
  /** True once the budget is used up. */
  done = false;
  bestX: Float64Array | null = null;
  bestF = NaN;
  bestV = Infinity;
  /** Every improvement of the best: the evaluation count and the objective value. */
  traceNfe: number[] = [];
  traceF: number[] = [];
  traceV: number[] = [];
  private readonly worst: number;
  readonly problem: Problem;
  readonly budget: number;

  constructor(problem: Problem, budget: number, scales: number[] = problem.constraints.map(() => 1)) {
    if (scales.length !== problem.constraints.length) throw new Error("There must be one scale for every constraint.");
    this.problem = problem;
    this.budget = budget;
    this.scales = scales;
    this.constrained = scales.length > 0;
    this.sides = new Float64Array(2 * scales.length);
    this.violations = new Float64Array(scales.length);
    this.worst = problem.sign * Infinity;
  }

  /** Deb's rule: is solution 1 strictly better than solution 2? */
  better(f1: number, v1: number, f2: number, v2: number): boolean {
    return v1 < v2 || (v1 === v2 && this.problem.sign * f1 < this.problem.sign * f2);
  }

  /**
   * Evaluates n rows of X (clipped to [0, 1] in place). Rows past the budget are not
   * evaluated: they get the worst value and infinite violation, so they never win.
   */
  evaluate(X: Float64Array): Population {
    const { dim } = this.problem;
    const n = X.length / dim;
    const F = new Float64Array(n).fill(this.worst);
    const V = new Float64Array(n).fill(Infinity);
    for (let k = 0; k < X.length; k++) X[k] = Math.min(Math.max(X[k], 0), 1);
    const m = Math.max(0, Math.min(n, this.budget - this.nfe));
    for (let i = 0; i < m; i++) {
      const solution = this.problem.decode(X, i * dim);
      const f = this.problem.objective(solution);
      // a non-finite objective counts as the worst value
      F[i] = Number.isFinite(f) ? f : this.worst;
      V[i] = this.constrained ? this.violationOf(solution) : 0;
      this.nfe++;
      if (this.bestX === null || this.better(F[i], V[i], this.bestF, this.bestV)) {
        this.bestX = X.slice(i * dim, (i + 1) * dim);
        this.bestF = F[i];
        this.bestV = V[i];
        this.traceNfe.push(this.nfe);
        this.traceF.push(F[i]);
        this.traceV.push(V[i]);
      }
    }
    if (this.nfe >= this.budget) this.done = true;
    return { n, X, F, V };
  }

  /** The total scaled violation of a decoded solution: zero when every constraint holds. */
  private violationOf(solution: ReturnType<Problem["decode"]>): number {
    const { constraints } = this.problem, sides = this.problem.sides(solution, this.sides);
    for (let c = 0; c < constraints.length; c++) {
      this.violations[c] = violation(constraints[c].op, sides[2 * c], sides[2 * c + 1], this.scales[c], constraints[c].tolerance);
    }
    return total(this.violations);
  }

  /** Best objective value found within each number of evaluations in `points` (ascending). */
  bestAt(points: number[]): (number | null)[] {
    let k = -1;
    return points.map((p) => {
      while (k + 1 < this.traceNfe.length && this.traceNfe[k + 1] <= p) k++;
      return k < 0 ? null : this.traceF[k];
    });
  }
}
