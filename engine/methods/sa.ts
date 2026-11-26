// Simulated Annealing, from ypea/algorithms/sa.py.

import { NativeOperators } from "../operators.ts";
import { copyRow, type Method, plannedIterations, popSize, randomPopulation, ranks } from "./common.ts";

export const sa: Method = {
  id: "sa",
  name: "Simulated Annealing",
  ypea: "SA",
  suits: ["real", "integer", "binary", "ordering"],
  params: {
    pop_size: { ...popSize, default: 10, help: "Number of current solutions." },
    max_sub_iter: { kind: "number", default: 10, min: 1, max: 1e6, integer: true, help: "Sub-iterations at a fixed temperature." },
    initial_temp: { kind: "number", default: 1000, min: 1e-9, max: 1e100, help: "Temperature at the start, in objective units." },
    final_temp: { kind: "number", default: 1, min: 1e-9, max: 1e100, help: "Temperature at the end of the run. Not above the initial temperature." },
    move_count: { kind: "number", default: 5, min: 1, max: 1e6, integer: true, help: "Moves per solution in each sub-iteration." },
    mutation_rate: { kind: "number", default: 0.1, min: 0, max: 1, help: "Probability that a component changes in a move. At least one changes." },
    mutation_step_size: { kind: "number", default: 0.1, min: 0, max: 10, help: "Standard deviation of the Gaussian move, in code units." },
    mutation_step_size_damp: { kind: "number", default: 0.99, min: 1e-9, max: 10, help: "The step size is multiplied by this after every iteration." },
    space: { kind: "choice", default: "encoded", options: ["encoded", "native"], help: "What a move changes: the codes in [0, 1], or the values themselves (an ordering stays an ordering). Types without moves of their own keep the Gaussian move on their codes." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim } = ctx;
    const s = ctx.settings as Record<string, number>;
    const n = s.pop_size, m = s.move_count, sign = ev.problem.sign;
    const pop = randomPopulation(ctx, n);
    let temp = s.initial_temp, sigma = s.mutation_step_size;
    // The temperature reaches final_temp when the budget ends. A power with a fraction as
    // exponent is not guaranteed to match Python's in the last digit.
    const tempDamp = (s.final_temp / s.initial_temp) ** (1 / plannedIterations(ctx, n * m * s.max_sub_iter));
    const native = ctx.settings.space === "native"
      ? new NativeOperators(ev.problem.variables, { rate: s.mutation_rate, sigma }) : null;

    // The Gaussian move on `rows` rows of `d` codes: whole solutions, or with native operators
    // the slice of one variable that has no move of its own.
    const mutate = ([x]: Float64Array[], rows: number, d: number): Float64Array[] => {
      // draw order: all flags, the forced component of each move, then a normal for every component
      const flag = new Uint8Array(rows * d), y = new Float64Array(rows * d);
      for (let k = 0; k < y.length; k++) flag[k] = rng.random() <= s.mutation_rate ? 1 : 0;
      for (let r = 0; r < rows; r++) flag[r * d + rng.integers(0, d)] = 1;
      for (let k = 0; k < y.length; k++) y[k] = x[k] + (flag[k] ? sigma : 0) * rng.standardNormal();
      return [y];
    };

    return () => {
      for (let sub = 0; sub < s.max_sub_iter; sub++) {
        const x = new Float64Array(n * m * dim);
        for (let r = 0; r < n * m; r++) x.set(pop.X.subarray(Math.floor(r / m) * dim, (Math.floor(r / m) + 1) * dim), r * dim);
        native?.setSigma(sigma);
        const X = (native ? native.apply("mutate", [x], n * m, rng, mutate) : mutate([x], n * m, dim))[0];
        const moves = ev.evaluate(X), rank = ranks(ev, moves);
        for (let i = 0; i < n; i++) {
          let c = i * m;
          for (let j = c + 1; j < (i + 1) * m; j++) if (rank[j] < rank[c]) c = j;
          // delta is the difference in violation, or in objective when the violations are equal
          let delta = moves.V[c] === pop.V[i] ? sign * moves.F[c] - sign * pop.F[i] : moves.V[c] - pop.V[i];
          // np.nan_to_num: inf - inf counts as infinitely worse, and -inf becomes the lowest finite number
          if (Number.isNaN(delta)) delta = Infinity;
          else if (delta === -Infinity) delta = -Number.MAX_VALUE;
          // Math.exp can differ from NumPy's exp in the last digit, so a draw within one unit
          // in the last place of p can decide differently
          const p = Math.exp(-delta / temp), u = rng.random();
          if (ev.better(moves.F[c], moves.V[c], pop.F[i], pop.V[i]) || u < p) copyRow(pop, i, moves, c, dim);
        }
      }
      temp = Math.max(temp * tempDamp, s.final_temp);
      sigma *= s.mutation_step_size_damp;
    };
  },
};
