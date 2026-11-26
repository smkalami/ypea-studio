// The descriptive summary of several experiments, each run several times with the same budget.
// It describes and never judges: there is no winner, no order of merit and no statistical test
// here, because a test against a best solver picked from the same runs overstates the evidence.
// The experiments stay in the order they were given.
//
// Quartiles. Linear interpolation between the sorted values (NumPy's default, type 7 of Hyndman
// and Fan): the quantile p of n sorted values is at position (n - 1) * p, counted from 0, and a
// position between two values is the weighted mean of the two. A script that calls
// numpy.percentile gets the same numbers. With one value, all three quartiles are that value.
//
// The rule for numbers. Only the runs that are feasible at the end are summarized, and the
// count of those runs out of all runs belongs next to every number. An experiment with no
// feasible run gets no numbers at all.
//
// The same rule for the curve. The best value in the history of a run may belong to a candidate
// that breaks a constraint, early in the run. Such a value is not a result. So:
//   1. Only the runs that are feasible at the end take part, the same runs as in the table.
//   2. A run takes part with its best value from the first evaluation at which its best candidate
//      is feasible. This is read from the trace of improvements: the first entry with a violation
//      of zero. Feasible beats infeasible, so from there on the best candidate stays feasible.
//   3. Before that point the run counts as worse than every value (plus infinity when minimizing,
//      minus infinity when maximizing). It is still one of the runs, so the median does not jump
//      when a late run joins.
//   4. A quartile that is not a finite number is left out (null). The median therefore starts
//      where more than half of the feasible runs have a feasible candidate.
// The curve at the last checkpoint equals the numbers of the table, and each line only improves.

import type { Project } from "./project.ts";
import { deriveSeed } from "./rng.ts";

/** How many times an experiment is run for a comparison, unless the user chooses otherwise. */
export const DEFAULT_RUNS = 10;

/** The parts of a run result that the summary reads. A result of `runProject` fits, also after it was stored as JSON. */
export interface ComparableRun {
  best: { objective: number | null; feasible: boolean };
  evaluations: { used: number; budget: number };
  history: { nfe: number[]; best: (number | null)[] };
  trace: { nfe: number[]; violation: (number | null)[] };
  seed: { base: number; runIndex: number; run: number };
  method: string;
  settings: Record<string, unknown>;
}

/** One experiment: the definition it ran (with the experiment as its `run`) and the results of its runs. */
export interface ExperimentRuns {
  name: string;
  project: Project;
  results: ComparableRun[];
}

export interface ExperimentSummary {
  name: string;
  /** The id of the solver. */
  method: string;
  runs: number;
  feasibleRuns: number;
  /** The budget of every run, and the fewest and the most evaluations a run used. */
  evaluations: { budget: number; usedMin: number; usedMax: number };
  /** Over the feasible runs only. Absent when no run is feasible. */
  objective?: { median: number; q1: number; q3: number; best: number };
  /**
   * For the chart, at each checkpoint: how many runs have a feasible best candidate by then, and
   * the median and quartiles of the best value so far. Null where the value is not defined.
   */
  curve: { nfe: number[]; feasibleRuns: number[]; median: (number | null)[]; q1: (number | null)[]; q3: (number | null)[] };
}

export interface Comparison {
  sense: "min" | "max";
  /** The unit label of the objective. */
  unit?: string;
  /** Evaluations allowed in every run of every experiment. */
  budget: number;
  experiments: ExperimentSummary[];
}

/** The run indices and the seeds of an experiment that is run `runs` times from one base seed. */
export function runSeeds(baseSeed: number, runs: number = DEFAULT_RUNS): { runIndex: number; seed: number }[] {
  return Array.from({ length: runs }, (_, runIndex) => ({ runIndex, seed: deriveSeed(baseSeed, runIndex) }));
}

/**
 * The number of evaluations from which the best candidate of a run is feasible, or Infinity
 * for a run that is not feasible at the end.
 */
export function feasibleFrom(run: ComparableRun): number {
  if (!run.best.feasible) return Infinity;
  const k = run.trace.violation.findIndex((v) => v === 0);
  // a feasible run whose trace does not say when it became feasible counts from its last checkpoint only
  return k >= 0 ? run.trace.nfe[k] : (run.history.nfe.at(-1) ?? Infinity);
}

/** For each checkpoint of a run: whether its best candidate so far is feasible. */
export function feasibleAt(run: ComparableRun): boolean[] {
  const from = feasibleFrom(run);
  return run.history.nfe.map((n) => n >= from);
}

/** The quantile p of values sorted in ascending order, by linear interpolation. The values may be infinite. */
export function quantile(sorted: number[], p: number): number {
  const h = (sorted.length - 1) * p, low = Math.floor(h), part = h - low;
  // without this, infinity times zero would give NaN
  if (part === 0) return sorted[low];
  const a = sorted[low], b = sorted[low + 1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b ? a : Number.isFinite(a) ? b : Number.isFinite(b) ? a : NaN;
  return a + (b - a) * part;
}

const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

/** A value as text in which the order of keys and empty optional parts do not matter. */
function canonical(value: unknown): string {
  const tidy = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(tidy);
    if (typeof v !== "object" || v === null) return v;
    const entries = Object.keys(v).sort().map((key) => [key, tidy((v as Record<string, unknown>)[key])] as const);
    return Object.fromEntries(entries.filter(([, x]) => x !== undefined && x !== "" && !(Array.isArray(x) && x.length === 0)));
  };
  return JSON.stringify(tidy(value));
}

/** The problem a project defines, without its names and without its experiments. */
function definitionOf(project: Project): string {
  const { name, description, run, experiments, ...rest } = project;
  return canonical(rest);
}

/**
 * Why these runs cannot be compared, one sentence for each reason. An empty list means that they
 * can: one problem definition, one budget, and in each experiment one setup with distinct runs.
 */
export function checkComparable(experiments: ExperimentRuns[]): string[] {
  const problems: string[] = [];
  if (experiments.length === 0) return ["There is no experiment to summarize."];
  const first = experiments[0];
  const budget = first.project.run.budget, definition = definitionOf(first.project);
  const grid = first.results[0]?.history.nfe;
  for (const e of experiments) {
    const say = (text: string) => problems.push(`Experiment "${e.name}": ${text}`);
    if (e.results.length === 0) say("it has no runs.");
    if (definitionOf(e.project) !== definition) say(`its problem definition is not the one of "${first.name}".`);
    if (e.project.run.budget !== budget) say(`its budget is ${e.project.run.budget} evaluations, and "${first.name}" has ${budget}.`);
    const settings = e.results[0] && canonical(e.results[0].settings);
    const seen = new Set<number>();
    for (const r of e.results) {
      const run = `run ${r.seed.runIndex}`;
      if (r.evaluations.budget !== e.project.run.budget) say(`${run} had a budget of ${r.evaluations.budget} evaluations, not ${e.project.run.budget}.`);
      if (r.method !== e.project.run.method) say(`${run} used the solver "${r.method}", not "${e.project.run.method}".`);
      if (canonical(r.settings) !== settings) say(`${run} used other settings than the first run.`);
      if (r.seed.base !== e.project.run.seed) say(`${run} started from the base seed ${r.seed.base}, not ${e.project.run.seed}.`);
      else if (r.seed.run !== deriveSeed(r.seed.base, r.seed.runIndex)) say(`the seed of ${run} does not follow from the base seed.`);
      if (seen.has(r.seed.runIndex)) say(`${run} is there twice.`);
      seen.add(r.seed.runIndex);
      if (canonical(r.history.nfe) !== canonical(grid)) say(`${run} recorded its history at other evaluation counts.`);
    }
  }
  return problems;
}

/**
 * The descriptive summary of the experiments, in the order given. Throws when the runs cannot
 * be compared, with every reason that `checkComparable` gives.
 */
export function summarize(experiments: ExperimentRuns[]): Comparison {
  const problems = checkComparable(experiments);
  if (problems.length > 0) throw new Error(`These runs cannot be compared. ${problems.join(" ")}`);
  const { objective, run } = experiments[0].project;
  const sign = objective.sense === "min" ? 1 : -1, worst = sign * Infinity;
  const finite = (v: number) => (Number.isFinite(v) ? v : null);

  return {
    sense: objective.sense,
    unit: objective.unit,
    budget: run.budget,
    experiments: experiments.map((e) => {
      const feasible = e.results.filter((r) => r.best.feasible);
      const used = e.results.map((r) => r.evaluations.used);
      const nfe = [...e.results[0].history.nfe];
      const starts = feasible.map(feasibleFrom);
      // a best value that is not a number counts as the worst value, as it does during a run
      const value = (v: number | null) => (typeof v === "number" && !Number.isNaN(v) ? v : worst);
      const points = nfe.map((n, k) => ascending(feasible.map((r, i) => (n >= starts[i] ? value(r.history.best[k]) : worst))));
      const at = (p: number) => points.map((sorted) => (sorted.length ? finite(quantile(sorted, p)) : null));
      const finals = ascending(feasible.map((r) => value(r.best.objective)));
      return {
        name: e.name,
        method: e.project.run.method,
        runs: e.results.length,
        feasibleRuns: feasible.length,
        evaluations: { budget: run.budget, usedMin: Math.min(...used), usedMax: Math.max(...used) },
        ...(finals.length > 0 && {
          objective: { median: quantile(finals, 0.5), q1: quantile(finals, 0.25), q3: quantile(finals, 0.75), best: sign > 0 ? finals[0] : finals.at(-1)! },
        }),
        curve: { nfe, feasibleRuns: nfe.map((n) => starts.filter((s) => n >= s).length), median: at(0.5), q1: at(0.25), q3: at(0.75) },
      };
    }),
  };
}
