// The project file: its shape, its validation, and the problem the engine runs.
// The format is described for people in spec/project-format.md.

import type { Op } from "./constraints.ts";
import { compile, dataInputs, type InputSpec, LanguageError } from "./lang/index.ts";
import type { Settings } from "./methods/common.ts";
import { fromPlain, makeVariable, toPlain, type Value, type Variable, type VariableSpec } from "./variables.ts";

export const FORMAT = "ypea-studio-project";
export const FORMAT_VERSION = 1;

/** A table of named columns of equal length, or one matrix. Names are usable in expressions. */
export type DataTable =
  | { name: string; kind: "columns"; columns: { name: string; unit?: string; values: number[] }[] }
  | { name: string; kind: "matrix"; unit?: string; values: number[][] };

export interface Constraint {
  name: string;
  left: string;
  op: Op;
  right: string;
  unit?: string;
  /** For "==" only: a fixed amount, in the constraint's unit, that the two sides may differ by. 0 when absent. */
  tolerance?: number;
  /** For "==" only: a fraction of the size of the right side that the two sides may differ by, on top of `tolerance`. 0 when absent. */
  relative_tolerance?: number;
  /** False turns the constraint off: it stays in the project and is not checked. True when absent. */
  enabled?: boolean;
}

/** How a solution is drawn. The names are data columns and variables of the project. */
export type View =
  /**
   * A closed tour through points whose coordinates are two data columns. `distance` is a square
   * data table with the distance from every row to every row, which gives the length of the tour.
   */
  | { kind: "route"; variable: string; x: string; y: string; distance?: string }
  /**
   * One closed tour per group, each from the depot through its stops and back. The two columns
   * hold every node: the depot at row `depot`, and the items in the other rows, in their order.
   * `distance` is a square data table over the same rows, which gives the length of each tour.
   */
  | { kind: "routes"; variable: string; x: string; y: string; depot: number; distance?: string }
  /** The data points, and the curve that the expression gives over the x column. */
  | { kind: "line"; x: string; y: string; expression: string }
  /** Which items are chosen. `size` is a data column that sets the size of each item. */
  | { kind: "selection"; variable: string; size?: string };

/** A solver setup: the method, its settings, the budget in evaluations and the seed. */
export interface RunSetup {
  method: string;
  settings: Settings;
  budget: number;
  seed: number;
}

/** Values of the variables, keyed by name, in the shape `toPlain` gives. */
export type PlainSolution = Record<string, unknown>;

export interface Project {
  format: typeof FORMAT;
  version: number;
  name: string;
  description?: string;
  data?: DataTable[];
  variables: VariableSpec[];
  /** Function definitions in limited Python syntax, shared by the objective and the constraints. */
  functions?: string;
  objective: {
    sense: "min" | "max";
    unit?: string;
    /** An expression in the limited Python syntax (spec/language.md) that gives one number. */
    source: string;
  };
  constraints?: Constraint[];
  /** The solution in use today. */
  baseline?: { label: string; solution: PlainSolution };
  /** A known answer: a known optimum value, or a known solution. */
  reference?: { label?: string; objective?: number; solution?: PlainSolution };
  /** The drawing of a solution. Without one, a solution is shown as a table only. */
  view?: View;
  /** The project's first experiment, and the one the command line runs. */
  run: RunSetup & { name?: string };
  /** More experiments. To run one, run a copy of the project whose `run` is that experiment. */
  experiments?: (RunSetup & { id: string; name: string })[];
}

export type Solution = Record<string, Value>;

export interface Problem {
  /** Total number of codes. */
  dim: number;
  /** 1 for min, -1 for max. */
  sign: number;
  variables: Variable[];
  /** Decodes one row of codes. The values are valid until the next call. */
  decode(codes: Float64Array, offset: number): Solution;
  objective(solution: Solution): number;
  /** Every constraint of the project, in its order. One with `enabled` false is not checked. */
  constraints: { name: string; op: Op; unit?: string; tolerance: number; relativeTolerance: number; enabled: boolean }[];
  /**
   * Both sides of the constraints, in the constraints' own units: left of constraint i at 2i, right
   * at 2i + 1. The places of a constraint that is off are left alone, unless `all` is true.
   */
  sides(solution: Solution, out: Float64Array, all?: boolean): Float64Array;
  /** A decoded solution as plain JSON, for results. */
  named(solution: Solution): PlainSolution;
  /** The reverse of `named`, for a solution that a person typed. Throws a message for the user when it is not valid. */
  fromPlain(plain: PlainSolution): Solution;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Largest number of data values in a project (about 2 MB as text). */
const MAX_DATA_VALUES = 200_000;

// Names that mean something in the limited Python syntax, in real Python, or in the JavaScript
// the translator generates. A data table, data column or variable must not take one of them.
// Names that start with two underscores are refused too.
const RESERVED = new Set(`
  ops sum min max abs len range round int float bool pi e inf nan True False None
  and as assert async await break class continue def del elif else except finally for from global if import in is
  lambda nonlocal not or pass raise return try while with yield print np numpy ypea math data sol self
  arguments case catch const constructor debugger default delete do enum eval export extends function hasOwnProperty
  implements instanceof interface isPrototypeOf let new null package private propertyIsEnumerable protected prototype
  public static super switch this throw toLocaleString toString typeof undefined valueOf var void
  Infinity NaN Object Array Math Number String Function globalThis window document fetch
`.trim().split(/\s+/));

const fail = (message: string): never => {
  throw new Error(`Project file: ${message}`);
};
const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown, low: number): v is number => Number.isInteger(v) && (v as number) >= low;
const isText = (v: unknown): v is string => typeof v === "string";
const optionalText = (owner: Record<string, any>, key: string, where: string) => {
  if (owner[key] !== undefined && !isText(owner[key])) fail(`${where} "${key}" must be text`);
};

/** Checks everything the engine relies on. A shared project file is untrusted input. */
export function parseProject(json: unknown): Project {
  if (!isObject(json) || json.format !== FORMAT) fail(`"format" must be "${FORMAT}"`);
  const p = json as Record<string, any>;
  if (p.version !== FORMAT_VERSION) fail(`version ${p.version} is not supported (this engine reads version ${FORMAT_VERSION})`);
  if (!isText(p.name)) fail(`"name" must be text`);
  optionalText(p, "description", "the project's");
  optionalText(p, "functions", "the project's");

  // every name that an expression can use must be unique
  const names = new Set<string>();
  const claim = (name: unknown, what: string) => {
    if (!isText(name) || !NAME.test(name)) fail(`every ${what} needs a "name" made of letters, digits and underscores`);
    if (RESERVED.has(name as string) || (name as string).startsWith("__")) fail(`the name "${name}" is reserved, please choose another`);
    if (names.has(name as string)) fail(`the name "${name}" is used twice`);
    names.add(name as string);
  };

  let dataValues = 0;
  /** Length of every data column, and the number of rows of every square table, for the drawing. */
  const columns = new Map<string, number>(), squares = new Map<string, number>();
  if (p.data !== undefined && !Array.isArray(p.data)) fail(`"data" must be a list`);
  for (const t of p.data ?? []) {
    if (!isObject(t)) fail(`every data table must be an object`);
    claim(t.name, "data table");
    if (t.kind === "columns") {
      if (!Array.isArray(t.columns) || t.columns.length === 0) fail(`table "${t.name}": "columns" must be a non-empty list`);
      for (const c of t.columns) {
        if (!isObject(c)) fail(`table "${t.name}": every column must be an object`);
        claim(c.name, "data column");
        optionalText(c, "unit", `column "${c.name}":`);
        if (!Array.isArray(c.values) || !c.values.every(isFinite)) fail(`column "${c.name}": "values" must be a list of numbers`);
        if (c.values.length !== t.columns[0].values.length) fail(`table "${t.name}": all columns must have the same length`);
        dataValues += c.values.length;
        columns.set(c.name, c.values.length);
      }
    } else if (t.kind === "matrix") {
      optionalText(t, "unit", `table "${t.name}":`);
      const rows = t.values;
      const ok = Array.isArray(rows) && rows.length > 0 &&
        rows.every((r: unknown) => Array.isArray(r) && r.length === rows[0].length && r.length > 0 && r.every(isFinite));
      if (!ok) fail(`table "${t.name}": "values" must be rows of numbers of equal length`);
      dataValues += rows.length * rows[0].length;
      if (rows.length === rows[0].length) squares.set(t.name, rows.length);
    } else {
      fail(`table "${t.name}": "kind" must be "columns" or "matrix"`);
    }
    if (dataValues > MAX_DATA_VALUES) fail(`the data is too large (the limit is ${MAX_DATA_VALUES} values)`);
  }

  if (!Array.isArray(p.variables) || p.variables.length === 0) fail(`"variables" must be a non-empty list`);
  const variables: Variable[] = [];
  for (const v of p.variables) {
    try {
      variables.push(makeVariable(v));
    } catch (error) {
      fail((error as Error).message);
    }
    claim(v.name, "variable");
    optionalText(v, "unit", `variable "${v.name}":`);
  }

  const o = p.objective;
  if (!isObject(o) || (o.sense !== "min" && o.sense !== "max")) fail(`"objective.sense" must be "min" or "max"`);
  if (!isText(o.source)) fail(`"objective.source" must be text`);
  optionalText(o, "unit", "the objective's");

  if (p.constraints !== undefined && !Array.isArray(p.constraints)) fail(`"constraints" must be a list`);
  for (const c of p.constraints ?? []) {
    if (!isObject(c) || !isText(c.name)) fail(`every constraint needs a "name"`);
    if (!isText(c.left) || !isText(c.right)) fail(`constraint "${c.name}": "left" and "right" must be text`);
    if (!["<=", ">=", "=="].includes(c.op)) fail(`constraint "${c.name}": "op" must be "<=", ">=" or "=="`);
    optionalText(c, "unit", `constraint "${c.name}":`);
    for (const key of ["tolerance", "relative_tolerance"]) {
      if (c[key] !== undefined && !(isFinite(c[key]) && c[key] >= 0 && c.op === "==")) {
        fail(`constraint "${c.name}": "${key}" must be a number that is not negative, and only "==" can have one`);
      }
    }
    if (c.enabled !== undefined && typeof c.enabled !== "boolean") fail(`constraint "${c.name}": "enabled" must be true or false`);
  }

  const checkSolution = (owner: unknown, what: string) => {
    if (!isObject(owner) || !isObject(owner.solution)) return fail(`"${what}.solution" must give a value for every variable`);
    try {
      solutionFromPlain(variables, owner.solution);
    } catch (error) {
      fail(`"${what}.solution": ${(error as Error).message}`);
    }
  };
  if (p.baseline !== undefined) {
    checkSolution(p.baseline, "baseline");
    if (!isText(p.baseline.label)) fail(`"baseline.label" must be text`);
  }
  if (p.reference !== undefined) {
    if (!isObject(p.reference)) fail(`"reference" must be an object`);
    optionalText(p.reference, "label", "the reference's");
    if (p.reference.objective !== undefined && !isFinite(p.reference.objective)) fail(`"reference.objective" must be a number`);
    if (p.reference.solution !== undefined) checkSolution(p.reference, "reference");
    if (p.reference.objective === undefined && p.reference.solution === undefined) fail(`"reference" needs an "objective" or a "solution"`);
  }

  if (p.view !== undefined) {
    const w = p.view;
    if (!isObject(w)) fail(`"view" must be an object`);
    const column = (key: string): number => {
      if (!isText(w[key]) || !columns.has(w[key])) fail(`"view.${key}" must be the name of a data column`);
      return columns.get(w[key])!;
    };
    const variable = (types: string[], what: string): Variable => {
      const found = variables.find((v) => v.spec.name === w.variable);
      if (!found || !types.includes(found.spec.type) || found.shape.length !== 1) fail(`"view.variable" must be the name of ${what}`);
      return found!;
    };
    // the table of distances is optional: square, with a row for every row of the coordinates
    const distance = () => {
      if (w.distance !== undefined && !(isText(w.distance) && squares.get(w.distance)! >= column("x"))) {
        fail(`"view.distance" must be the name of a square data table with a row and a column for every row of "${w.x}"`);
      }
    };
    if (w.kind === "route") {
      const n = variable(["permutation"], "a permutation variable").shape[0];
      if (column("x") !== column("y") || column("x") < n) fail(`"view.x" and "view.y" must have the same length, with a row for every position of "${w.variable}"`);
      distance();
    } else if (w.kind === "routes") {
      const n = (variable(["partition"], "a partition variable").spec as { n: number }).n;
      if (column("x") !== column("y") || column("x") < n + 1) fail(`"view.x" and "view.y" must have the same length, with a row for the depot and one for every item of "${w.variable}"`);
      if (!isCount(w.depot, 0) || w.depot > n) fail(`"view.depot" must be the row of the depot, a whole number from 0 to ${n}`);
      distance();
    } else if (w.kind === "line") {
      if (column("x") !== column("y")) fail(`"view.x" and "view.y" must have the same length`);
      if (!isText(w.expression)) fail(`"view.expression" must be text`);
    } else if (w.kind === "selection") {
      const n = variable(["binary", "binary_selection"], "a list of 0 or 1 values").shape[0];
      if (w.size !== undefined && column("size") !== n) fail(`"view.size" must have one value for every item of "${w.variable}"`);
    } else {
      fail(`"view.kind" must be "route", "routes", "line" or "selection"`);
    }
  }

  // `run` and every entry of `experiments` are checked in the same way
  const isSetting = (v: unknown) => isFinite(v) || isText(v) || typeof v === "boolean" || v === null;
  const checkSetup = (r: unknown, key: (field: string) => string): Record<string, any> => {
    if (!isObject(r) || !isText(r.method)) return fail(`${key("method")} must be text`);
    if (!isObject(r.settings) || !Object.values(r.settings).every(isSetting)) fail(`${key("settings")} must hold numbers, text, true, false or null`);
    if (!isCount(r.budget, 1)) fail(`${key("budget")} must be a positive whole number of evaluations`);
    if (!isCount(r.seed, 0) || r.seed > 0xffffffff) fail(`${key("seed")} must be a whole number from 0 to 4294967295`);
    return r;
  };
  optionalText(checkSetup(p.run, (field) => `"run.${field}"`), "name", "the run's");
  if (p.experiments !== undefined && !Array.isArray(p.experiments)) fail(`"experiments" must be a list`);
  const ids = new Set<string>();
  for (const e of p.experiments ?? []) {
    if (!isObject(e) || !isText(e.id) || !/^[A-Za-z0-9_-]+$/.test(e.id)) fail(`every experiment needs an "id" made of letters, digits, underscores and hyphens`);
    if (ids.has(e.id)) fail(`the experiment id "${e.id}" is used twice`);
    ids.add(e.id);
    if (!isText(e.name)) fail(`experiment "${e.id}": "name" must be text`);
    checkSetup(e, (field) => `experiment "${e.id}": "${field}"`);
  }
  return p as Project;
}

/** A typed-in solution in the engine's form. Throws a message for the user when it is not valid. */
function solutionFromPlain(variables: Variable[], plain: PlainSolution): Solution {
  const keys = Object.keys(plain);
  if (keys.length !== variables.length || !variables.every((v) => Object.hasOwn(plain, v.spec.name))) {
    throw new Error("it must give a value for every variable, and for nothing else");
  }
  return Object.fromEntries(variables.map((v) => [v.spec.name, fromPlain(v, plain[v.spec.name])]));
}

/** The translator, with errors that say where in the project the problem is. */
function translate(source: Parameters<typeof compile>[0]) {
  try {
    return compile(source);
  } catch (error) {
    if (error instanceof LanguageError) error.message = `In ${error.field}, line ${error.line}, column ${error.column}: ${error.message}`;
    throw error;
  }
}

/** How the translator sees a variable: decimal or whole numbers, or the groups of a partition. */
function inputOf(v: Variable): InputSpec {
  const t = v.spec.type;
  const kind = t === "partition" ? "groups" : t === "real" || t.startsWith("fixed") ? "float" : "int";
  return { name: v.spec.name, kind, shape: v.shape };
}

/**
 * Builds what a run needs from a project. Translates the objective and the constraints, and
 * throws a LanguageError, with the field and the line, when their text is outside the language.
 * A constraint that is off is translated too, so a mistake in its text is still reported.
 */
export function buildProblem(project: Project): Problem {
  const variables = project.variables.map(makeVariable);
  const offsets: number[] = [];
  let dim = 0;
  for (const v of variables) {
    offsets.push(dim);
    dim += v.codeSize;
  }
  const solution: Solution = {};
  const constraints = project.constraints ?? [];
  const program = translate({
    functions: project.functions,
    data: dataInputs(project.data),
    variables: variables.map(inputOf),
    expressions: [
      { label: "the objective", source: project.objective.source },
      ...constraints.flatMap((c) => [
        { label: `the left side of "${c.name}"`, source: c.left },
        { label: `the right side of "${c.name}"`, source: c.right },
      ]),
    ],
  });
  const [objective, ...sides] = program.expressions.map((e) => e.number);

  return {
    dim,
    sign: project.objective.sense === "min" ? 1 : -1,
    variables,
    decode(codes, offset) {
      variables.forEach((v, i) => (solution[v.spec.name] = v.decode(codes, offset + offsets[i])));
      return solution;
    },
    // "+" because a comparison gives true or false, which counts as 1 or 0
    objective: (s) => +objective(s),
    constraints: constraints.map((c) => ({
      name: c.name, op: c.op, unit: c.unit, tolerance: c.tolerance ?? 0, relativeTolerance: c.relative_tolerance ?? 0, enabled: c.enabled !== false,
    })),
    sides(s, out, all = false) {
      for (let i = 0; i < sides.length; i++) if (all || constraints[i >> 1].enabled !== false) out[i] = +sides[i](s);
      return out;
    },
    named: (s) => Object.fromEntries(variables.map((v) => [v.spec.name, toPlain(v, s[v.spec.name])])),
    fromPlain: (plain) => solutionFromPlain(variables, plain),
  };
}

/**
 * For a project whose view is a fitted line: a function that gives the curve of a solution, one
 * value for each row of the x column. Undefined for every other project. Throws a LanguageError
 * when the view's expression is outside the language or does not give such a list.
 */
export function buildCurve(project: Project): ((plain: PlainSolution) => number[]) | undefined {
  const view = project.view;
  if (view?.kind !== "line") return undefined;
  const variables = project.variables.map(makeVariable);
  const [curve] = translate({
    functions: project.functions,
    data: dataInputs(project.data),
    variables: variables.map(inputOf),
    expressions: [{ label: "the drawing", source: view.expression, any: true }],
  }).expressions;
  const length = project.data?.flatMap((t) => (t.kind === "columns" ? t.columns : [])).find((c) => c.name === view.x)?.values.length;
  const wrong = (): never => {
    throw new LanguageError(`In the drawing, line 1, column 1: This must give a list with one value for each row of "${view.x}".`, "the drawing", 1, 1);
  };
  if (curve.shape !== "list") wrong();
  return (plain) => {
    const y = curve.value(solutionFromPlain(variables, plain)) as number[];
    if (y.length !== length) wrong();
    return y;
  };
}
