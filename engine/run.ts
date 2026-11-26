// One seeded run of a project, and the test of a single candidate. This file is the
// engine's interface for the command line runner and for the web app's worker.

import { gap, scaleOf, type Op } from "./constraints.ts";
import { Evaluator } from "./evaluator.ts";
import { METHODS, resolveSettings } from "./methods/index.ts";
import { buildProblem, type PlainSolution, type Problem, type Project, type Solution } from "./project.ts";
import { deriveSeed, philox, Rng } from "./rng.ts";

export const APP_VERSION = "0.1.0";
/** The ypea release that exports are tested with. Rerun the parity cases against a new release before moving it. */
export const YPEA_TESTED = "0.5.0";

const CHECKPOINTS = 100;
/** Number of random candidates that the constraint scales are taken from. */
const SCALE_SAMPLE = 100;

/** A candidate as the user reads it: the objective and both sides of every constraint, in their own units. */
export interface Inspection {
  objective: number;
  /** True when every constraint holds. */
  feasible: boolean;
  constraints: { name: string; op: Op; left: number; right: number; unit?: string; tolerance: number; satisfied: boolean }[];
}

/** The state of a run after an iteration, for the live preview. */
export interface Progress {
  evaluations: { used: number; budget: number };
  best: { objective: number; violation: number; solution: PlainSolution };
}

export interface RunOptions {
  /** Which run of the experiment this is. Run seeds derive from the base seed and this index. */
  runIndex?: number;
  /** Called after the first population and after every iteration. The caller limits how often it redraws. */
  onProgress?: (progress: Progress) => void;
  /** The constraint scales of an earlier run, to repeat it exactly. Without them, they are taken from a random sample. */
  scales?: number[];
}

function inspect(problem: Problem, solution: Solution): Inspection {
  const objective = problem.objective(solution);
  const sides = problem.sides(solution, new Float64Array(2 * problem.constraints.length));
  const constraints = problem.constraints.map((c, i) => {
    const left = sides[2 * i], right = sides[2 * i + 1];
    return { ...c, left, right, satisfied: gap(c.op, left, right, c.tolerance) <= 0 };
  });
  return { objective, feasible: constraints.every((c) => c.satisfied), constraints };
}

/**
 * The scale of every constraint, from both sides on a sample of random candidates. The sample
 * has its own generator stream, so it changes neither the run nor the evaluation count.
 */
function sampleScales(problem: Problem, baseSeed: number, runIndex: number): number[] {
  const count = problem.constraints.length;
  if (count === 0) return [];
  const rng = new Rng(philox(runIndex >>> 0, 0xfffffffe, baseSeed >>> 0)[0]);
  const codes = new Float64Array(problem.dim), sides = new Float64Array(2 * count);
  const lefts = problem.constraints.map(() => new Float64Array(SCALE_SAMPLE));
  const rights = problem.constraints.map(() => new Float64Array(SCALE_SAMPLE));
  for (let k = 0; k < SCALE_SAMPLE; k++) {
    problem.sides(problem.decode(rng.fill(codes), 0), sides);
    for (let c = 0; c < count; c++) {
      lefts[c][k] = sides[2 * c];
      rights[c][k] = sides[2 * c + 1];
    }
  }
  return problem.constraints.map((c, i) => scaleOf(c.op, lefts[i], rights[i], c.tolerance));
}

export function runProject(project: Project, options: RunOptions = {}) {
  const { runIndex = 0, onProgress } = options;
  const method = Object.hasOwn(METHODS, project.run.method) ? METHODS[project.run.method] : undefined;
  if (!method) throw new Error(`Unknown method "${project.run.method}". Available: ${Object.keys(METHODS).join(", ")}`);
  const settings = resolveSettings(method, project.run.settings);
  const problem = buildProblem(project);
  const { budget } = project.run;
  const seed = deriveSeed(project.run.seed, runIndex);
  const started = performance.now();
  const scales = options.scales ?? sampleScales(problem, project.run.seed, runIndex);
  const evaluator = new Evaluator(problem, budget, scales);

  const report = () => {
    if (!onProgress) return;
    onProgress({
      evaluations: { used: evaluator.nfe, budget },
      best: { objective: evaluator.bestF, violation: evaluator.bestV, solution: problem.named(problem.decode(evaluator.bestX!, 0)) },
    });
  };

  const iterate = method.start({ rng: new Rng(seed), evaluator, dim: problem.dim, settings, budget });
  report();
  while (!evaluator.done) {
    const before = evaluator.nfe;
    iterate();
    report();
    // settings that create no new solutions would loop forever (ypea stops the same way)
    if (evaluator.nfe === before) break;
  }

  // one fixed grid of checkpoints, so runs can be summarized point by point
  const count = Math.min(CHECKPOINTS, budget);
  const nfe = Array.from({ length: count }, (_, k) => Math.ceil(((k + 1) * budget) / count));
  const bestSolution = problem.decode(evaluator.bestX!, 0);
  const best = inspect(problem, bestSolution);
  // a baseline or reference solution, and how far the result is from it in objective units
  const compare = (other: { label?: string; solution?: PlainSolution; objective?: number } | undefined) => {
    if (!other) return undefined;
    const seen = other.solution ? inspect(problem, problem.fromPlain(other.solution)) : undefined;
    const objective = seen ? seen.objective : other.objective!;
    return { label: other.label, objective, feasible: seen?.feasible, difference: evaluator.bestF - objective };
  };
  return {
    // feasible means every constraint holds in its own unit, which is what the user is shown
    status: best.feasible ? "Best feasible solution found" : "No feasible solution found",
    best: {
      objective: evaluator.bestF,
      violation: evaluator.bestV,
      feasible: best.feasible,
      constraints: best.constraints,
      solution: problem.named(bestSolution),
      codes: Array.from(evaluator.bestX!),
    },
    baseline: compare(project.baseline),
    reference: compare(project.reference),
    evaluations: { used: evaluator.nfe, budget },
    history: { nfe, best: evaluator.bestAt(nfe) },
    // every improvement of the best solution, with the evaluation that found it
    trace: { nfe: evaluator.traceNfe, objective: evaluator.traceF, violation: evaluator.traceV },
    // what produced this result
    method: method.id,
    settings,
    seed: { base: project.run.seed, runIndex, run: seed },
    scales,
    versions: { app: APP_VERSION, ypeaTested: YPEA_TESTED },
    timeMs: performance.now() - started,
  };
}

export type RunResult = ReturnType<typeof runProject>;

/**
 * The Test step: the objective and every constraint of one candidate, in original units.
 * Throws a message for the user when the solution is not a valid value of the variables.
 */
export function testCandidate(project: Project, solution: PlainSolution): Inspection {
  const problem = buildProblem(project);
  return inspect(problem, problem.fromPlain(solution));
}

/** A random candidate to test, as a plain solution. */
export function randomCandidate(project: Project, seed: number): PlainSolution {
  const problem = buildProblem(project);
  return problem.named(problem.decode(new Rng(seed >>> 0).fill(new Float64Array(problem.dim)), 0));
}
