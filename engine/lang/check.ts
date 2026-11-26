// The checker: resolves every name against the allowed set and refuses everything else
// (spec/language.md, section 1). It needs no shapes, so it also covers functions that nothing
// calls. Shapes and kinds of values are checked later, in generate.ts.

import { LanguageError, type Expr, type FuncDef, type Stmt } from "./parse.ts";

/** The six built-ins with their smallest and largest number of arguments. */
export const BUILTINS = new Map<string, { min: number; max: number }>([
  ["sum", { min: 1, max: 1 }],
  ["min", { min: 1, max: Infinity }],
  ["max", { min: 1, max: Infinity }],
  ["abs", { min: 1, max: 1 }],
  ["len", { min: 1, max: 1 }],
  ["range", { min: 1, max: 3 }],
]);

export interface OpsEntry {
  /** Set for a constant such as ops.pi. */
  value?: number;
  /** Number of arguments of a function. */
  args?: number;
  /** True when the function takes axis=0 or axis=1. */
  axis?: boolean;
}

/** Everything in `ops`. A Map, so that ops.constructor and ops.__proto__ are simply unknown. */
export const OPS = new Map<string, OpsEntry>([
  ["pi", { value: Math.PI }], ["e", { value: Math.E }], ["inf", { value: Infinity }],
  ["array", { args: 1 }], ["zeros", { args: 1 }], ["ones", { args: 1 }], ["arange", { args: 1 }],
  ["sum", { args: 1, axis: true }], ["mean", { args: 1, axis: true }], ["prod", { args: 1, axis: true }],
  ["min", { args: 1, axis: true }], ["max", { args: 1, axis: true }],
  ["argmin", { args: 1 }], ["argmax", { args: 1 }], ["argsort", { args: 1 }], ["sort", { args: 1 }],
  ["cumsum", { args: 1 }], ["roll", { args: 2 }],
  ["sqrt", { args: 1 }], ["abs", { args: 1 }], ["floor", { args: 1 }], ["ceil", { args: 1 }], ["round", { args: 1 }],
  ["sign", { args: 1 }], ["minimum", { args: 2 }], ["maximum", { args: 2 }], ["clip", { args: 3 }], ["where", { args: 3 }],
  ["exp", { args: 1 }], ["log", { args: 1 }], ["sin", { args: 1 }], ["cos", { args: 1 }], ["tan", { args: 1 }],
  ["dot", { args: 2 }],
]);

// A function is module-level code in an exported script, so it must not hide a name that the
// script or Python itself uses there.
const RESERVED_FUNCTION_NAMES = new Set("np numpy ypea math data sol self print int float bool round pi e inf nan".split(" "));

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

class Checker {
  private field: string;
  private readonly data: ReadonlySet<string>;
  private readonly variables: ReadonlySet<string>;
  private readonly functions = new Map<string, { index: number; params: number }>();
  /** Index of the function being checked. Expressions come after all functions. */
  private current = 0;
  /** Names that surely have a value at this point of a function. Null in an expression field. */
  private scope: Set<string> | null = null;
  /** Every name the current function assigns somewhere. */
  private assigned = new Set<string>();

  constructor(field: string, data: ReadonlySet<string>, variables: ReadonlySet<string>) {
    this.field = field;
    this.data = data;
    this.variables = variables;
  }

  private fail(message: string, at: { line: number; col: number }): never {
    throw new LanguageError(message, this.field, at.line, at.col);
  }

  functionsField(defs: FuncDef[]): void {
    for (const def of defs) {
      this.newName(def.name, def, "function");
      if (RESERVED_FUNCTION_NAMES.has(def.name)) this.fail(`The name "${def.name}" is reserved. Please choose another name for the function.`, def);
      if (this.variables.has(def.name)) this.fail(`"${def.name}" is already the name of a variable. Please choose another name for the function.`, def);
      if (this.functions.has(def.name)) this.fail(`There are two functions named "${def.name}". Every function needs its own name.`, def);
      this.functions.set(def.name, { index: -1, params: def.params.length });
    }
    defs.forEach((def, index) => {
      this.functions.get(def.name)!.index = index;
      this.current = index;
      this.scope = new Set();
      this.assigned = new Set();
      for (const p of def.params) {
        this.newName(p.name, p, "parameter");
        if (this.scope.has(p.name)) this.fail(`The parameter "${p.name}" appears twice.`, p);
        this.scope.add(p.name);
      }
      this.collect(def.body);
      if (!this.block(def.body)) {
        this.fail(`The function "${def.name}" does not return a value on every path. Add a return at its end.`, def);
      }
    });
    this.current = defs.length;
    this.scope = null;
  }

  /** Call after `functionsField`, once for each expression field. */
  expression(e: Expr, field: string): void {
    this.field = field;
    this.expr(e);
  }

  /** Refuses a new function, parameter or local name that would hide something. */
  private newName(name: string, at: { line: number; col: number }, what: string): void {
    if (name.startsWith("__")) this.fail(`A name cannot start with two underscores ("${name}").`, at);
    if (name === "ops" || BUILTINS.has(name)) this.fail(`"${name}" is part of the language and cannot be the name of a ${what}.`, at);
    if (this.data.has(name)) this.fail(`"${name}" is a data name and cannot be changed or reused as a ${what}. Please choose another name.`, at);
    if (what !== "function" && this.functions.has(name)) this.fail(`"${name}" is the name of a function and cannot be reused as a ${what}.`, at);
  }

  private collect(body: Stmt[]): void {
    for (const s of body) {
      if (s.k === "assign" || s.k === "for") this.assigned.add(s.name!);
      for (const b of s.branches ?? []) this.collect(b.body);
      this.collect(s.orelse ?? []);
      this.collect(s.body ?? []);
    }
  }

  /** Checks the statements and tells whether every path through them returns. */
  private block(body: Stmt[]): boolean {
    let returns = false;
    for (const s of body) returns = this.statement(s) || returns;
    return returns;
  }

  private statement(s: Stmt): boolean {
    const scope = this.scope!;
    if (s.k === "return") {
      this.expr(s.e!);
      return true;
    }
    if (s.k === "assign") {
      this.expr(s.e!);
      if (s.op !== "=" && !scope.has(s.name!)) this.fail(`"${s.name}" has no value yet, so ${s.op} cannot change it. Give it a value first, for example ${s.name} = 0.`, s);
      this.newName(s.name!, s, "local name");
      scope.add(s.name!);
      return false;
    }
    if (s.k === "for") {
      if (s.e!.k === "list") s.e!.xs!.forEach((x) => this.expr(x));
      else this.expr(s.e!);
      this.newName(s.name!, s, "loop variable");
      // the loop may run zero times, so nothing it assigns is sure afterwards
      this.scope = new Set(scope).add(s.name!);
      this.block(s.body!);
      this.scope = scope;
      return false;
    }
    // if: a name is sure afterwards when every branch that continues has set it
    const ends: Set<string>[] = [];
    let returns = true;
    const branch = (body: Stmt[]) => {
      this.scope = new Set(scope);
      if (!this.block(body)) {
        returns = false;
        ends.push(this.scope);
      }
    };
    for (const b of s.branches!) {
      this.scope = scope;
      this.expr(b.cond);
      branch(b.body);
    }
    branch(s.orelse ?? []);
    this.scope = returns ? scope : new Set([...ends[0]].filter((name) => ends.every((end) => end.has(name))));
    return returns;
  }

  private expr(e: Expr): void {
    switch (e.k) {
      case "num":
      case "bool":
        return;
      case "name":
        return this.name(e);
      case "ops": {
        const entry = OPS.get(e.id!);
        if (!entry) this.fail(`ops.${e.id} does not exist. See the list of ops functions.`, e);
        if (entry.value === undefined) this.fail(`ops.${e.id} is a function. Call it with parentheses: ops.${e.id}(...).`, e);
        return;
      }
      case "list":
        return this.fail("A list in square brackets can only be used in two places: ops.array([a, b, c]) and for v in [a, b, c].", e);
      case "slice":
        if (e.a) this.expr(e.a);
        if (e.b) this.expr(e.b);
        return;
      case "index":
        this.expr(e.a!);
        e.xs!.forEach((x) => this.expr(x));
        return;
      case "call":
        return this.call(e);
      case "cmp":
        e.xs!.forEach((x) => this.expr(x));
        return;
      default: // un, bin, logic
        this.expr(e.a!);
        if (e.b) this.expr(e.b);
    }
  }

  private name(e: Expr): void {
    const id = e.id!;
    if (this.scope?.has(id)) return;
    if (this.scope && this.assigned.has(id)) this.fail(`"${id}" may not have a value yet at this point. Give it a value before the loop or the if.`, e);
    if (this.data.has(id)) return;
    if (this.variables.has(id)) {
      if (this.scope) this.fail(`A function cannot see the variable "${id}". Add it as a parameter and pass it in when you call the function.`, e);
      return;
    }
    if (id === "ops") this.fail("`ops` is not a value by itself. Write ops.<name>, for example ops.sqrt(x).", e);
    if (BUILTINS.has(id) || this.functions.has(id)) this.fail(`"${id}" is a function. Call it with parentheses: ${id}(...).`, e);
    this.fail(`The name "${id}" is not known. You can use the variables, the data names, your own functions, sum, min, max, abs, len, range, and ops.<name>.`, e);
  }

  private call(e: Expr): void {
    const fn = e.a!, given = e.xs!.length;
    if (fn.k === "ops") {
      const entry = OPS.get(fn.id!);
      if (!entry) this.fail(`ops.${fn.id} does not exist. See the list of ops functions.`, fn);
      if (entry.args === undefined) this.fail(`ops.${fn.id} is a number, not a function. Write it without parentheses.`, fn);
      if (given !== entry.args) this.fail(`ops.${fn.id} takes ${count(entry.args, "argument")}, but ${given} ${given === 1 ? "was" : "were"} given.`, e);
      if (e.axis) {
        if (!entry.axis) this.fail(`ops.${fn.id} does not take axis=.`, e.axis);
        if (!(e.axis.k === "num" && e.axis.int && (e.axis.v === 0 || e.axis.v === 1))) this.fail("axis= must be written as 0 (down the columns) or 1 (along the rows).", e.axis);
      }
      if (fn.id === "array") {
        if (e.xs![0].k !== "list") this.fail("ops.array needs a list in square brackets: ops.array([a, b, c]).", e.xs![0]);
        e.xs![0].xs!.forEach((x) => this.expr(x));
        return;
      }
    } else {
      const id = fn.id!, builtin = BUILTINS.get(id), own = this.functions.get(id);
      if (this.scope?.has(id) || (this.scope && this.assigned.has(id)) || this.data.has(id) || this.variables.has(id)) {
        this.fail(`"${id}" is a value, not a function, so it cannot be called.`, fn);
      } else if (builtin) {
        if (given < builtin.min || given > builtin.max) this.fail(`${id} does not take ${count(given, "argument")}.`, e);
      } else if (own) {
        if (own.index === this.current) this.fail(`The function "${id}" cannot call itself.`, fn);
        if (own.index > this.current || own.index < 0) this.fail(`The function "${id}" is defined further down. A function can only call functions defined above it.`, fn);
        if (given !== own.params) this.fail(`The function "${id}" takes ${count(own.params, "argument")}, but ${given} ${given === 1 ? "was" : "were"} given.`, e);
      } else if (id === "ops") {
        this.fail("`ops` is not a function. Write ops.<name>(...), for example ops.sqrt(x).", fn);
      } else {
        this.fail(`The function "${id}" is not known. You can call your own functions, sum, min, max, abs, len, range, and ops.<name>.`, fn);
      }
    }
    e.xs!.forEach((x) => this.expr(x));
  }
}

/**
 * Checks the functions field and returns a checker for the expression fields.
 * `data` and `variables` are the names of the project's inputs.
 */
export function checkFunctions(defs: FuncDef[], field: string, data: ReadonlySet<string>, variables: ReadonlySet<string>): (e: Expr, field: string) => void {
  const checker = new Checker(field, data, variables);
  checker.functionsField(defs);
  return (e, expressionField) => checker.expression(e, expressionField);
}
