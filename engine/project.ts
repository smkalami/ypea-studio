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
  /** For "==" only: how far apart the two sides may be and still count as equal. 0 when absent. */
  tolerance?: number;
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
  run: { method: string; settings: Settings; budget: number; seed: number };
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
  constraints: { name: string; op: Op; unit?: string; tolerance: number }[];
  /** Both sides of every constraint, in the constraints' own units: left of constraint i at 2i, right at 2i + 1. */
  sides(solution: Solution, out: Float64Array): Float64Array;
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
      }
    } else if (t.kind === "matrix") {
      optionalText(t, "unit", `table "${t.name}":`);
      const rows = t.values;
      const ok = Array.isArray(rows) && rows.length > 0 &&
        rows.every((r: unknown) => Array.isArray(r) && r.length === rows[0].length && r.length > 0 && r.every(isFinite));
      if (!ok) fail(`table "${t.name}": "values" must be rows of numbers of equal length`);
      dataValues += rows.length * rows[0].length;
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
    if (c.tolerance !== undefined && !(isFinite(c.tolerance) && c.tolerance >= 0 && c.op === "==")) {
      fail(`constraint "${c.name}": "tolerance" must be a number that is not negative, and only "==" can have one`);
    }
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

  const r = p.run;
  if (!isObject(r) || !isText(r.method)) fail(`"run.method" must be text`);
  const isSetting = (v: unknown) => isFinite(v) || isText(v) || typeof v === "boolean" || v === null;
  if (!isObject(r.settings) || !Object.values(r.settings).every(isSetting)) fail(`"run.settings" must hold numbers, text, true, false or null`);
  if (!isCount(r.budget, 1)) fail(`"run.budget" must be a positive whole number of evaluations`);
  if (!isCount(r.seed, 0) || r.seed > 0xffffffff) fail(`"run.seed" must be a whole number from 0 to 4294967295`);
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
    constraints: constraints.map((c) => ({ name: c.name, op: c.op, unit: c.unit, tolerance: c.tolerance ?? 0 })),
    sides(s, out) {
      for (let i = 0; i < sides.length; i++) out[i] = +sides[i](s);
      return out;
    },
    named: (s) => Object.fromEntries(variables.map((v) => [v.spec.name, toPlain(v, s[v.spec.name])])),
    fromPlain: (plain) => solutionFromPlain(variables, plain),
  };
}
