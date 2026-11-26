// The limited Python syntax of YPEA Studio (spec/language.md): the public interface.
//
//   const program = compile({ functions, data: dataInputs(project.data), variables, expressions });
//   const objective = program.expressions[0].number;   // (solution) => number, the fast path
//   const anything = program.expressions[0].value(solution);   // any value as plain numbers and arrays
//
// Data is bound once, when the program is compiled. Variables arrive with every call, as the
// engine's Solution. A LanguageError means the text cannot be translated. A RuntimeError means
// a run hit an error that Python would also raise, such as a position out of range.

import type { DataTable, Solution } from "../project.ts";
import { checkFunctions } from "./check.ts";
import { Generator, type Input, type Ty } from "./generate.ts";
import { LanguageError, parseExpression, parseFunctions } from "./parse.ts";
import { runtime, RuntimeError, type Table } from "./runtime.ts";

export { LanguageError, RuntimeError };

/** A named input. `shape` is [] for one number, [n] for a list and [rows, columns] for a table. Groups have [k]. */
export interface InputSpec {
  name: string;
  /** Decimal numbers, whole numbers, or the groups of a partition (variables only). */
  kind: "float" | "int" | "groups";
  shape: number[];
}

/** A data value: a number, a list, or the rows of a table. */
export interface DataSpec extends InputSpec {
  kind: "float" | "int";
  values: number | number[] | number[][];
}

export interface ProgramSource {
  /** The text of the functions field. */
  functions?: string;
  data?: DataSpec[];
  variables: InputSpec[];
  /**
   * The expression fields: the objective and both sides of each constraint. The label names the
   * field in errors. An expression must give a single number, unless `any` is set.
   */
  expressions: { label: string; source: string; any?: boolean }[];
}

export interface CompileOptions {
  /** False turns off loop fusion and scratch buffers. For tests and benchmarks: the results are the same. */
  optimize?: boolean;
  /** Label of the functions field in errors. Default "functions". */
  functionsLabel?: string;
}

/** A value as plain data: a number (possibly NaN or infinite), or nested arrays of numbers. Truth values are 1 and 0. */
export type Plain = number | Plain[];

export interface CompiledExpression {
  label: string;
  /** What the expression gives. */
  shape: "number" | "list" | "table" | "groups";
  /** The fast path: the value for one solution. Only for an expression that gives a number. It does not check the solution. */
  number(solution: Solution): number;
  /** The general path: checks the solution, and returns any value as plain data. */
  value(solution: Solution): Plain;
}

export interface Program {
  /** One entry for each expression, in the order given. */
  expressions: CompiledExpression[];
  /** The generated JavaScript, for tests and for curious readers. */
  js: string;
}

let compiled = 0;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHAPES = ["number", "list", "table", "groups"] as const;
// Every identifier the generator may write. The check below is a second lock on the security rule of spec/language.md.
const VOCABULARY = /^(?:const|let|for|if|else|return|function|length|[DQdrc]|r_[A-Za-z0-9]+|[tlfeavdsq]\d+)$/;

/** Data tables of a project as inputs. Every value counts as a decimal number, as np.genfromtxt reads them. */
export function dataInputs(tables: DataTable[] = []): DataSpec[] {
  return tables.flatMap((t): DataSpec[] =>
    t.kind === "matrix"
      ? [{ name: t.name, kind: "float", shape: [t.values.length, t.values[0]?.length ?? 0], values: t.values }]
      : t.columns.map((c) => ({ name: c.name, kind: "float", shape: [c.values.length], values: c.values })),
  );
}

/**
 * Translates a project's code. Throws a LanguageError for text outside the language, with the
 * field label, line and column. Throws a plain Error for inputs that are not valid.
 */
export function compile(source: ProgramSource, options: CompileOptions = {}): Program {
  const functionsLabel = options.functionsLabel ?? "functions";
  const inputs = new Map<string, Input>();
  const bound: (number | Float64Array | Table | undefined)[] = [];
  const variables: Input[] = [];

  const declare = (spec: InputSpec, data: boolean): Input => {
    const { name, kind, shape } = spec;
    if (typeof name !== "string" || !NAME.test(name) || name.startsWith("__") || name in {}) throw new Error(`"${name}" cannot be the name of an input.`);
    if (inputs.has(name)) throw new Error(`The input name "${name}" is used twice.`);
    const groups = kind === "groups";
    const ok = Array.isArray(shape) && shape.length <= 2 && shape.every((n) => Number.isInteger(n) && n >= 0) &&
      (kind === "float" || kind === "int" || (groups && !data && shape.length === 1));
    if (!ok) throw new Error(`The input "${name}" has a kind or shape that is not supported.`);
    const ty: Ty = { r: groups ? 3 : shape.length, d: kind === "float" ? 32 : 16 };
    const input = { name, ty, data, index: data ? bound.length : variables.length, shape };
    inputs.set(name, input);
    return input;
  };

  for (const spec of source.data ?? []) {
    const input = declare(spec, true);
    const flat = [spec.values].flat(2) as number[];
    const rows = Array.isArray(spec.values) ? spec.values.length : -1;
    const size = spec.shape.reduce((a, b) => a * b, 1);
    const shaped = spec.shape.length === 0 ? rows === -1 : rows === spec.shape[0] && flat.length === size &&
      (spec.values as unknown[]).every((row) => (spec.shape.length === 2 ? Array.isArray(row) && row.length === spec.shape[1] : typeof row === "number"));
    if (!shaped || !flat.every((v) => typeof v === "number" && (spec.kind === "float" || Number.isInteger(v)))) {
      throw new Error(`The values of the data "${spec.name}" do not match its kind and shape.`);
    }
    // "+ 0" because a whole number has no negative zero
    const values = Float64Array.from(flat, (v) => (spec.kind === "int" ? v + 0 : v));
    bound.push(input.ty.r === 0 ? values[0] : input.ty.r === 1 ? values : { d: values, r: spec.shape[0], c: spec.shape[1] });
  }
  for (const spec of source.variables) variables.push(declare(spec, false));

  let generator: Generator;
  const kinds: { ty: Ty; used: number[] }[] = [];
  try {
    const defs = parseFunctions(source.functions ?? "", functionsLabel);
    const names = (data: boolean) => new Set([...inputs.values()].filter((input) => input.data === data).map((input) => input.name));
    const checkExpression = checkFunctions(defs, functionsLabel, names(true), names(false));
    generator = new Generator(inputs, defs, functionsLabel, options.optimize ?? true);
    source.expressions.forEach(({ label, source: text, any }, index) => {
      const tree = parseExpression(text, label);
      checkExpression(tree, label);
      const made = generator.expression(tree, label, index);
      if (made.ty.r !== 0 && !any) {
        throw new LanguageError(`This must give a single number, but it gives ${["", "a list", "a table", "the groups of a partition"][made.ty.r]}. Reduce it to one number, for example with sum(...).`, label, 1, 1);
      }
      kinds.push(made);
    });
  } catch (error) {
    // the depth limits should prevent this, but a stack overflow must still end as a clear message
    if (error instanceof RangeError) throw new LanguageError("This text is nested too deeply to translate. Split it into smaller steps.", functionsLabel, 1, 1);
    throw error;
  }

  // the library under fixed names, written from its own keys
  const prelude = Object.keys(runtime).map((name) => `const r_${name} = R.${name};`).join("\n");
  const js = [
    ...bound.map((_, k) => `const d${k} = D[${k}];`),
    ...generator.sites.map((_, k) => `const q${k} = Q[${k}];`),
    ...Array.from({ length: generator.scratch }, (_, k) => `let s${k} = r_f64(0);`),
    ...generator.functions,
    `return [${source.expressions.map((_, k) => `e${k}`).join(", ")}];`,
  ].join("\n");
  if (!/^[\w\s.,;:(){}[\]=+\-*/%<>!&|?]*$/.test(js) || !(js.match(/\d[\w.]*(?:e[+-]\d+)?|[A-Za-z_$][\w$]*/g) ?? []).every((word) => /^\d/.test(word) || VOCABULARY.test(word))) {
    throw new Error("internal: the generated code holds something it should not");
  }
  let made: ((...values: unknown[]) => unknown)[];
  try {
    // The number makes every source text different. V8 would otherwise reuse the compiled code
    // of an earlier program with the same text, and then both run about a third slower.
    made = new Function("R", "D", "Q", `"use strict"; // ${++compiled}\n${prelude}\n${js}`)(runtime, bound, generator.sites);
  } catch (error) {
    if (error instanceof RangeError) throw new LanguageError("This text is too large to translate. Please simplify it.", functionsLabel, 1, 1);
    throw error;
  }

  const expressions = source.expressions.map(({ label }, k): CompiledExpression => {
    const f = made[k], { ty, used } = kinds[k];
    const names = used.map((i) => variables[i].name), [n0, n1, n2] = names;
    const call = (
      names.length === 0 ? () => f() : names.length === 1 ? (s: Solution) => f(s[n0]) : names.length === 2 ? (s: Solution) => f(s[n0], s[n1]) :
      names.length === 3 ? (s: Solution) => f(s[n0], s[n1], s[n2]) : (s: Solution) => f(...names.map((name) => s[name]))
    ) as (solution: Solution) => unknown;

    const check = (solution: Solution) => {
      for (const i of used) {
        const { name, ty: { r }, shape } = variables[i], v = Object.hasOwn(solution, name) ? solution[name] : undefined;
        const typed = (a: unknown) => a instanceof Float64Array || a instanceof Int32Array;
        const good = r === 3 ? Array.isArray(v) && v.length === shape[0] && v.every(typed) : typed(v) && (v as Float64Array).length === shape.reduce((a, b) => a * b, 1);
        if (!good) throw new RuntimeError(`The solution has no value of the right shape for the variable "${name}".`, label, 0);
      }
    };
    const plain = (v: unknown): Plain => {
      if (typeof v === "number") return v;
      if (Array.isArray(v)) return v.map(plain);
      if (ArrayBuffer.isView(v)) return Array.from(v as Float64Array);
      const { d, r, c } = v as Table;
      return Array.from({ length: r }, (_, row) => Array.from(d.subarray(row * c, (row + 1) * c)));
    };
    return {
      label,
      shape: SHAPES[ty.r],
      number: ty.r === 0 ? (call as (solution: Solution) => number) : () => {
        throw new RuntimeError("This expression does not give a single number. Use value() instead.", label, 0);
      },
      value(solution) {
        check(solution);
        try {
          return plain(call(solution));
        } catch (error) {
          if (error instanceof RuntimeError) throw error;
          throw new RuntimeError(`The evaluation stopped: ${(error as Error).message}`, label, 0);
        }
      },
    };
  });
  return { expressions, js };
}
