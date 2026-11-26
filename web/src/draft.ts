// A project while it is being edited, and the small rules of the screens: experiments,
// which solvers suit which variables, comparisons and number formats. No browser code.

import { METHODS } from "../../engine/methods/index.ts";
import type { VariableKind } from "../../engine/methods/common.ts";
import { FORMAT, FORMAT_VERSION, type Project, type RunSetup } from "../../engine/project.ts";
import type { VariableSpec } from "../../engine/variables.ts";

/**
 * The solver setup of a blank project and of a new experiment.
 * Provisional: the owner decides the default solver and budget later.
 */
export const DEFAULT_SETUP: RunSetup = { method: "pso", settings: {}, budget: 20000, seed: 1 };

/** A blank project. It has no variables yet, so it cannot run until the user adds one. */
export function blankProject(): Project {
  return {
    format: FORMAT, version: FORMAT_VERSION, name: "Untitled project",
    variables: [], objective: { sense: "min", source: "" }, run: { ...DEFAULT_SETUP },
  };
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const objects = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter(isObject) : []);

/**
 * A stored project in a shape the forms can show. A project that the app itself stored comes
 * back unchanged. Anything else keeps what can be kept, and the check then says what is wrong.
 */
export function tidy(raw: unknown): Project {
  const p = isObject(raw) ? raw : {};
  const setup = (r: unknown) => ({ ...(isObject(r) ? r : DEFAULT_SETUP), settings: isObject(r) && isObject(r.settings) ? r.settings : {} });
  const safe =
    isObject(raw) && typeof p.name === "string" && Array.isArray(p.variables) && p.variables.every(isObject) &&
    (p.data === undefined || (Array.isArray(p.data) && p.data.every((t) => isObject(t) && (t.kind === "matrix"
      ? Array.isArray(t.values) && t.values.every(Array.isArray)
      : Array.isArray(t.columns) && t.columns.every((c: unknown) => isObject(c) && Array.isArray(c.values)))))) &&
    isObject(p.objective) && typeof p.objective.source === "string" &&
    (p.constraints === undefined || (Array.isArray(p.constraints) && p.constraints.every(isObject))) &&
    isObject(p.run) && isObject(p.run.settings) &&
    (p.experiments === undefined || (Array.isArray(p.experiments) && p.experiments.every((e) => isObject(e) && isObject(e.settings) && typeof e.id === "string"))) &&
    (p.view === undefined || isObject(p.view)) && (p.baseline === undefined || isObject(p.baseline)) && (p.reference === undefined || isObject(p.reference));
  if (safe) return raw as Project;
  return {
    ...p,
    name: typeof p.name === "string" ? p.name : "Unnamed project",
    variables: objects(p.variables),
    data: objects(p.data).map((t) => (t.kind === "matrix"
      ? { ...t, values: Array.isArray(t.values) ? t.values.filter(Array.isArray) : [] }
      : { ...t, columns: objects(t.columns).map((c) => ({ ...c, values: Array.isArray(c.values) ? c.values : [] })) })),
    objective: { sense: "min", ...(isObject(p.objective) ? p.objective : {}), source: typeof p.objective?.source === "string" ? p.objective.source : "" },
    constraints: objects(p.constraints),
    run: setup(p.run),
    experiments: objects(p.experiments).filter((e) => typeof e.id === "string").map(setup),
    view: isObject(p.view) ? p.view : undefined,
    baseline: isObject(p.baseline) ? p.baseline : undefined,
    reference: isObject(p.reference) ? p.reference : undefined,
  } as unknown as Project;
}

// Experiments. The project's `run` is the first one, and its id on screen is empty.

export type Experiment = RunSetup & { id: string; name: string };
export const FIRST = "";
export const FIRST_NAME = "Quick run";

const setupOf = ({ method, settings, budget, seed }: RunSetup): RunSetup => ({ method, settings, budget, seed });

export function experimentsOf(project: Project): Experiment[] {
  return [{ ...setupOf(project.run), id: FIRST, name: project.run.name ?? FIRST_NAME }, ...(project.experiments ?? [])];
}

/** The project with one experiment changed, or added at the end when its id is new. */
export function withExperiment(project: Project, experiment: Experiment): Project {
  const { id, name, ...setup } = experiment;
  if (id === FIRST) return { ...project, run: { ...setupOf(setup), name } };
  const others = project.experiments ?? [];
  const entry = { id, name, ...setupOf(setup) };
  return { ...project, experiments: others.some((e) => e.id === id) ? others.map((e) => (e.id === id ? entry : e)) : [...others, entry] };
}

/** The project without one experiment. When the first one goes, the next takes its place as `run`. */
export function withoutExperiment(project: Project, id: string): Project {
  const others = project.experiments ?? [];
  if (id !== FIRST) return { ...project, experiments: others.filter((e) => e.id !== id) };
  const [next, ...rest] = others;
  return next ? { ...project, run: { ...setupOf(next), name: next.name }, experiments: rest } : project;
}

/** What one experiment runs: a copy of the project whose `run` is that experiment's setup. */
export function projectFor(project: Project, experiment: Experiment): Project {
  const { experiments, ...rest } = project;
  return { ...rest, run: { ...setupOf(experiment), name: experiment.name } };
}

export function newExperimentId(project: Project): string {
  const taken = new Set((project.experiments ?? []).map((e) => e.id));
  for (let n = taken.size + 2; ; n++) if (!taken.has(`e${n}`)) return `e${n}`;
}

/**
 * The definition as one text, to tell whether a project still is what a result ran. Names,
 * the description, the other experiments and empty optional parts do not count.
 */
export function definitionOf(project: Project): string {
  const { name, description, experiments, run, ...rest } = project;
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (!isObject(value)) return value;
    const entries = Object.keys(value).sort().map((key) => [key, sorted(value[key])] as const);
    return Object.fromEntries(entries.filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
  };
  return JSON.stringify(sorted({ ...rest, run: setupOf(run ?? DEFAULT_SETUP) }));
}

// Solvers and the kinds of variables they suit.

export const KIND_OF: Record<VariableSpec["type"], VariableKind> = {
  real: "real", fixed_sum: "real", fixed_row_sum: "real", fixed_column_sum: "real",
  integer: "integer",
  binary: "binary", binary_selection: "binary", binary_partition: "binary",
  permutation: "ordering", selection: "ordering", partition: "ordering",
};

export const KIND_WORDS: Record<VariableKind, string> = {
  real: "decimal numbers", integer: "whole numbers", binary: "yes or no values", ordering: "orderings and groups",
};

/** The kinds of variables in the project that the solver is not made for. */
export function unsuited(project: Project, methodId: string): VariableKind[] {
  const method = Object.hasOwn(METHODS, methodId) ? METHODS[methodId] : undefined;
  if (!method) return [];
  const kinds = new Set((project.variables ?? []).map((v) => KIND_OF[v.type]).filter(Boolean));
  return [...kinds].filter((kind) => !method.suits.includes(kind));
}

// Comparisons and numbers.

/**
 * The percent change of a result against a comparison value. Only when it means something:
 * the comparison value is not zero and both values have the same sign.
 */
export function percentChange(value: number, comparison: number): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(comparison) || comparison === 0 || Math.sign(value) !== Math.sign(comparison)) return undefined;
  return ((value - comparison) / Math.abs(comparison)) * 100;
}

/** A number with at most six significant digits, or a list of them in brackets. */
export function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  return typeof value === "number" && !Number.isInteger(value) ? String(Number(value.toPrecision(6))) : String(value);
}

export const count = (n: number) => n.toLocaleString("en-US");
export const withUnit = (value: unknown, unit?: string) => `${show(value)}${unit ? ` ${unit}` : ""}`;
