// A comparison: several experiments, each run several times with one budget, and what is kept
// of it. The summary itself is the engine's (engine/compare.ts). This file plans the runs,
// puts their results in place whatever order they finish in, and guards what was stored.
// No browser code.

import { type ComparableRun, type ExperimentRuns, runSeeds } from "../../engine/compare.ts";
import type { Project, RunSetup } from "../../engine/project.ts";
import type { RunResult } from "../../engine/run.ts";
import { definitionOf, type Experiment, experimentsOf } from "./draft.ts";
import type { RunRequest } from "./protocol.ts";

/** The most runs of one experiment that the form accepts. */
export const MAX_RUNS = 100;
/** The solver that the reference uses, and the name it is shown under. */
export const REFERENCE = { method: "random", name: "Random Search (reference)" };

/** One experiment of a comparison: its setup, already with the budget of the comparison. */
export interface Compared {
  name: string;
  setup: RunSetup;
  /** True for the Random Search that the comparison added, which is no experiment of the project. */
  reference?: true;
}

export interface Plan {
  /** The definition every run starts from. Its own `run` is not used. */
  project: Project;
  runs: number;
  budget: number;
  experiments: Compared[];
}

/**
 * What a comparison will run: the chosen experiments in the order of the project, all with
 * one budget, and Random Search as a reference when asked for. The reference starts from the
 * base seed of the first chosen experiment.
 */
export function planComparison(project: Project, chosen: Experiment[], runs: number, budget: number, reference: boolean): Plan {
  const { experiments: _, ...definition } = project;
  const compared: Compared[] = chosen.map((e) => ({ name: e.name, setup: { method: e.method, settings: e.settings, budget, seed: e.seed } }));
  if (reference && chosen.length > 0) compared.push({ name: REFERENCE.name, setup: { method: REFERENCE.method, settings: {}, budget, seed: chosen[0].seed }, reference: true });
  return { project: definition, runs, budget, experiments: compared };
}

/** The definition with one compared experiment as its `run`. */
const projectOf = (project: Project, e: Compared): Project => ({ ...project, run: { ...e.setup, name: e.name } });

/**
 * One request for each run, and where its result belongs. Run indices are 0, 1, 2 and so on,
 * so run 0 is the quick run of the experiment. The first runs of all experiments come first.
 */
export function jobsOf(plan: Plan): { experiment: number; runIndex: number; request: RunRequest }[] {
  return runSeeds(0, plan.runs).flatMap(({ runIndex }) =>
    plan.experiments.map((e, experiment) => ({ experiment, runIndex, request: { type: "run" as const, project: projectOf(plan.project, e), runIndex, quiet: true } })));
}

/** How many workers run a comparison: one core is left to the page, and eight are plenty. */
export const poolSize = (cores: number | undefined, jobs: number) => Math.max(1, Math.min((cores || 2) - 1, 8, jobs));

/**
 * What a comparison keeps of one run: what the summary reads, and the seed. The trace of
 * improvements is cut after its first feasible entry, which is the only one the summary needs.
 */
export function comparableRun(r: RunResult): ComparableRun {
  const first = r.trace.violation.findIndex((v) => v === 0), end = first < 0 ? 0 : first + 1;
  return {
    best: { objective: r.best.objective, feasible: r.best.feasible },
    evaluations: r.evaluations,
    history: r.history,
    trace: { nfe: Array.from(r.trace.nfe.slice(0, end)), violation: Array.from(r.trace.violation.slice(0, end)) },
    seed: r.seed, method: r.method, settings: r.settings,
  };
}

/** True when two snapshots hold the same problem, whatever their experiments are. */
export function sameProblem(a: Project, b: Project): boolean {
  const run: RunSetup = { method: "", settings: {}, budget: 1, seed: 0 };
  return definitionOf({ ...a, run }) === definitionOf({ ...b, run });
}

/** The version of stored comparisons. A stored one with another version counts as "no comparison yet". */
export const COMPARISON_VERSION = 1;

/** A finished comparison with the definition it ran, so later edits never change what it refers to. */
export interface StoredComparison {
  v: typeof COMPARISON_VERSION;
  projectId: string;
  finished: number;
  /** The app and the ypea release its exports are tested with, at the time of the runs. */
  versions: { app: string; ypeaTested: string };
  /** The project as it was when the comparison started. Its own `run` is not used. */
  project: Project;
  experiments: (Compared & { results: ComparableRun[] })[];
}

/** The stored runs in the form the engine summarizes. Check them with `checkComparable` first. */
export function runsOf(stored: Pick<StoredComparison, "project" | "experiments">): ExperimentRuns[] {
  return stored.experiments.map((e) => ({ name: e.name, project: projectOf(stored.project, e), results: e.results }));
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const numbers = (v: unknown, nullable = false) => Array.isArray(v) && v.every((x) => typeof x === "number" || (nullable && x === null));

/**
 * A stored record as a comparison this build can show, or undefined. Only the shape is
 * checked here. Whether the runs can be compared is the question of `checkComparable`.
 */
export function readComparison(record: any, projectId: string): StoredComparison | undefined {
  const p = record?.project;
  const run = (r: any) =>
    isObject(r) && isObject(r.best) && typeof r.best.feasible === "boolean" && (r.best.objective === null || typeof r.best.objective === "number") &&
    typeof r.evaluations?.used === "number" && typeof r.evaluations.budget === "number" &&
    numbers(r.history?.nfe) && numbers(r.history.best, true) && r.history.nfe.length === r.history.best.length &&
    numbers(r.trace?.nfe) && numbers(r.trace.violation, true) &&
    typeof r.seed?.base === "number" && typeof r.seed.runIndex === "number" && typeof r.seed.run === "number" &&
    typeof r.method === "string" && isObject(r.settings);
  const ok =
    record?.v === COMPARISON_VERSION && typeof record.finished === "number" && Number.isFinite(record.finished) &&
    typeof record.versions?.app === "string" && typeof record.versions.ypeaTested === "string" &&
    isObject(p) && isObject(p.objective) && (p.objective.sense === "min" || p.objective.sense === "max") && Array.isArray(p.variables) &&
    Array.isArray(record.experiments) && record.experiments.length > 0 &&
    record.experiments.every((e: any) =>
      isObject(e) && typeof e.name === "string" && isObject(e.setup) && typeof e.setup.method === "string" && isObject(e.setup.settings) &&
      typeof e.setup.budget === "number" && typeof e.setup.seed === "number" && (e.reference === undefined || e.reference === true) &&
      Array.isArray(e.results) && e.results.length > 0 && e.results.every(run));
  return ok ? { ...record, projectId } : undefined;
}

/**
 * True when the project is no longer what a stored comparison ran: the problem has changed, or
 * one of the compared experiments is no longer among the experiments of the project with the
 * same solver, settings and seed. Names and budgets do not count, because a comparison has its
 * own budget, and neither do ids, which move when the first experiment is deleted.
 */
export function comparisonChanged(stored: StoredComparison, project: Project): boolean {
  const same = (setup: RunSetup) => definitionOf({ ...stored.project, run: { ...setup, budget: 1 } });
  const live = new Set(experimentsOf(project).map((e) => definitionOf({ ...project, run: { ...e, budget: 1 } })));
  return stored.experiments.some((e) => !e.reference && !live.has(same(e.setup)));
}
