// Code generation: turns checked trees into JavaScript source, and checks kinds and shapes on
// the way (spec/language.md, sections 2 to 6).
//
// Security (spec/language.md, section 1). Every identifier in the output is made here: t<n> for temporaries,
// l<n> for the user's local names, f<n> and e<n> for functions, a<n> and v<n> for variables,
// d<n> for data, s<n> for scratch buffers, q<n> for the places that can fail, and r_<name> for
// the runtime library. A user's name is only ever a key in a Map. Numbers are printed again from their parsed value. The output
// holds no text in quotes and reads no property except length, d, r and c.
//
// Kinds of numbers. Python tells truth values, whole numbers and decimal numbers apart, and so
// does NumPy, with different rules (np.True_ + np.True_ is True, True + True is 2). The
// generator therefore tracks, for every value, which of six kinds it can be. At run time all of
// them are plain float64 numbers, and a truth value is 1 or 0.

import { OPS } from "./check.ts";
import { LanguageError, type Expr, type FuncDef, type Stmt } from "./parse.ts";

// The six kinds, as bits: a plain Python value or a NumPy value, each truth, whole or decimal.
const PB = 1, PI = 2, PF = 4, NB = 8, NI = 16, NF = 32;
const BOOLS = PB | NB, FLOATS = PF | NF;
const BITS = [PB, PI, PF, NB, NI, NF];
/** 0 for a truth value, 1 for a whole number, 2 for a decimal number. */
const level = (bit: number) => (bit & BOOLS ? 0 : bit & FLOATS ? 2 : 1);
const isPy = (bit: number) => bit < NB;
const bitOf = (lvl: number, py: boolean) => (py ? [PB, PI, PF] : [NB, NI, NF])[lvl];
/** The kinds as NumPy holds them in a list or table. */
const toNp = (d: number) => ((d & 7) << 3) | (d & 56);
/** Truth values counted: what a sum of them is. */
const counted = (d: number) => (d & FLOATS ? NF : 0) | (d & ~FLOATS ? NI : 0);

/** What is known about a value when the project is translated. */
export interface Ty {
  /** 0 a single number, 1 a list, 2 a table, 3 the groups of a partition. */
  r: number;
  /** The kinds the numbers can be (bits). */
  d: number;
  /** True for a range(...) value, which Python lets you use in fewer places than a list. */
  range?: boolean;
}

/** A value while code is generated. A list or table may be "lazy": not computed yet, only described element by element. */
interface Val extends Ty {
  /** A number: its expression. A list, table or groups: the name that holds it, or "" when lazy. */
  js: string;
  /** Name of the flat array of elements, or "" when lazy. */
  flat: string;
  /** Number of elements, rows and columns, as names. */
  n: string;
  rows: string;
  cols: string;
  /** The expression for element i. It may add statements to the loop body first. */
  at: (i: string, body: string[]) => string;
}

type Slot = (Ty & { js: string }) | { conflict: true };
type Env = Map<string, Slot>;

export interface Input {
  name: string;
  ty: Ty;
  data: boolean;
  /** Position among the data values or among the variables. */
  index: number;
  shape: number[];
}

interface Context {
  lines: string[];
  temps: number;
  locals: Map<string, number>;
  env: Env;
  /** Field for a LanguageError, and label for a runtime error. */
  field: string;
  label: string;
  /** What the function returns, joined over its return statements. */
  ret: Ty | null;
  /** Variables an expression reads. */
  used: Set<number>;
}

const MAX_WORK = 200_000;
const MAX_VARIANTS = 300;
const RANKS = ["a single number", "a list", "a table", "the groups of a partition"];

/** A number as JavaScript source. Only finite, non-negative numbers reach this. */
function num(v: number): string {
  const text = String(v);
  if (!(Number.isFinite(v) && v >= 0 && /^[0-9.e+-]+$/.test(text))) throw new Error("internal: a number that cannot be written");
  return text;
}

/**
 * Kinds and meaning of `a op b`. Returns a message when Python refuses the pair, or when the
 * answer would depend on which kind the values turn out to be.
 */
function arith(op: string, A: number, B: number): { d: number; sem: string } | string {
  let d = 0, or = false, plain = false, float = false, np = false;
  for (const a of BITS) {
    if (!(A & a)) continue;
    for (const b of BITS) {
      if (!(B & b)) continue;
      const py = isPy(a) && isPy(b), lvl = Math.max(level(a), level(b));
      if (lvl === 0 && !py && (op === "+" || op === "*")) {
        // NumPy: + on truth values is "or" and * is "and"
        d |= NB;
        if (op === "+") or = true;
        continue;
      }
      if (lvl === 0 && !py && op === "-") {
        return "Python cannot subtract two truth values. Turn one into a number first, for example (a > 1) * 1.";
      }
      plain = true;
      const out = op === "/" ? 2 : Math.max(lvl, 1);
      if (out === 2) float = true;
      else if (!py) np = true;
      d |= op === "**" && out === 1 && py ? PI | PF : bitOf(out, py);
    }
  }
  if (or && plain) return "This adds values that are truth values on one path and numbers on another, and Python treats the two differently. Turn the truth values into numbers first, for example (a > 1) * 1.";
  return { d, sem: or ? "or" : float ? "float" : np ? "npint" : "pyint" };
}

/** Kinds of the result of a NumPy function that picks or mixes its arguments (minimum, where, clip, dot). */
function promote(kinds: number[]): number {
  let levels = 0;
  for (const d of kinds) {
    let next = 0;
    for (const bit of BITS) if (d & bit) for (let l = 0; l < 3; l++) if (levels === 0 || levels & (1 << l)) next |= 1 << Math.max(l, level(bit));
    levels = next;
  }
  return (levels & 1 ? NB : 0) | (levels & 2 ? NI : 0) | (levels & 4 ? NF : 0);
}

export class Generator {
  /** For each place that can fail at run time: the field and line to report. */
  readonly sites: { field: string; line: number }[] = [];
  /** The finished JavaScript functions. */
  readonly functions: string[] = [];
  scratch = 0;
  private readonly inputs: ReadonlyMap<string, Input>;
  private readonly defs: ReadonlyMap<string, FuncDef>;
  private readonly functionsField: string;
  private readonly optimize: boolean;
  private readonly variants = new Map<string, { name: string; ret: Ty }>();
  private work = 0;
  private cx!: Context;

  constructor(inputs: ReadonlyMap<string, Input>, defs: FuncDef[], functionsField: string, optimize: boolean) {
    this.inputs = inputs;
    this.defs = new Map(defs.map((def) => [def.name, def]));
    this.functionsField = functionsField;
    this.optimize = optimize;
  }

  /** Generates the function e<index>(a<i>, ...) for one expression field. */
  expression(e: Expr, label: string, index: number): { ty: Ty; used: number[] } {
    this.cx = { lines: [], temps: 0, locals: new Map(), env: new Map(), field: label, label, ret: null, used: new Set() };
    const v = this.solid(this.ev(e));
    const used = [...this.cx.used].sort((a, b) => a - b);
    const byIndex = new Map([...this.inputs.values()].filter((input) => !input.data).map((input) => [input.index, input]));
    const head = used.map((i) => {
      const { ty, shape } = byIndex.get(i)!;
      return `const v${i} = ${ty.r === 0 ? `a${i}[0]` : ty.r === 2 ? `r_tab(a${i}, ${num(shape[0])}, ${num(shape[1])})` : `a${i}`};`;
    });
    this.functions.push(`function e${index}(${used.map((i) => `a${i}`).join(", ")}) {\n${[...head, ...this.cx.lines, `return ${v.js};`].join("\n")}\n}`);
    return { ty: { r: v.r, d: v.d, range: v.range }, used };
  }

  // ---- small tools ----

  private fail(message: string, at: { line: number; col: number }): never {
    throw new LanguageError(message, this.cx.field, at.line, at.col);
  }

  private site(at: { line: number }): string {
    this.sites.push({ field: this.cx.label, line: at.line });
    return `q${this.sites.length - 1}`;
  }

  private t(): string {
    return `t${this.cx.temps++}`;
  }

  /** Stores an expression in a fresh constant and returns its name. */
  private copy(js: string): string {
    const name = this.t();
    this.cx.lines.push(`const ${name} = ${js};`);
    return name;
  }

  /** A name or literal for an expression, so that it can be used many times. */
  private bind(js: string): string {
    return /^(?:[a-z]\d+|\d+)$/.test(js) ? js : this.copy(js);
  }

  private scalar(js: string, d: number): Val {
    return { r: 0, d, js, flat: "", n: "", rows: "", cols: "", at: () => js };
  }

  /** A list held in a typed array. */
  private list(js: string, d: number, range = false): Val {
    const a = this.bind(js), n = this.copy(`${a}.length`);
    return { r: 1, d: toNp(d), range, js: a, flat: a, n, rows: "", cols: "", at: (i) => `${a}[${i}]` };
  }

  /** A table held in a Table object. */
  private table(js: string, d: number): Val {
    const a = this.bind(js), flat = this.copy(`${a}.d`), rows = this.copy(`${a}.r`), cols = this.copy(`${a}.c`);
    return { r: 2, d: toNp(d), js: a, flat, n: this.copy(`${rows} * ${cols}`), rows, cols, at: (i) => `${flat}[${i}]` };
  }

  private groups(js: string): Val {
    return { r: 3, d: NI, js: this.bind(js), flat: "", n: "", rows: "", cols: "", at: () => "" };
  }

  private value(js: string, ty: Ty): Val {
    return ty.r === 0 ? this.scalar(js, ty.d) : ty.r === 1 ? this.list(js, ty.d, ty.range) : ty.r === 2 ? this.table(js, ty.d) : this.groups(js);
  }

  /** Computes the elements of a list or table into a flat array. A scratch buffer is only for a value that is used up at once. */
  private flatten(v: Val, scratch: boolean): string {
    if (v.flat) return v.flat;
    const out = this.t(), i = this.t(), L = this.cx.lines;
    if (scratch && this.optimize) {
      const s = `s${this.scratch++}`;
      L.push(`if (${s}.length < ${v.n}) ${s} = r_f64(${v.n});`, `const ${out} = ${s};`);
    } else {
      L.push(`const ${out} = r_f64(${v.n});`);
    }
    const body: string[] = [];
    const element = v.at(i, body);
    L.push(`for (let ${i} = 0; ${i} < ${v.n}; ${i}++) {`, ...body, `${out}[${i}] = ${element};`, "}");
    return out;
  }

  /** A value that can be stored, passed on or returned: computed, and in memory of its own. */
  private solid(v: Val): Val {
    if (v.r === 0 || v.r === 3 || v.js) return v;
    const flat = this.flatten(v, false);
    return v.r === 1 ? this.list(flat, v.d, v.range) : this.table(`r_tab(${flat}, ${v.rows}, ${v.cols})`, v.d);
  }

  /** Statements that turn the position `value` into a checked position from 0 to n - 1. Returns its name. */
  private position(value: string, n: string, site: string, body: string[]): string {
    const j = this.t();
    body.push(`let ${j} = ${value};`, `if (${j} < 0) ${j} += ${n};`, `if (!(${j} >= 0 && ${j} < ${n})) r_fail(1, ${site});`);
    return j;
  }

  /**
   * Applies a function of single numbers element by element, with the shape rules of the spec:
   * numbers with anything, lists of one length, tables of one shape, a table with a list that
   * has one value for each column.
   */
  private map(args: Val[], d: number, at: Expr, fn: (xs: string[], body: string[]) => string): Val {
    const rank = Math.max(...args.map((a) => a.r));
    for (const a of args) {
      if (a.r === 3) this.fail("The groups of a partition cannot be used in arithmetic. Take one group, as in g[0], or loop over them.", at);
      if (a.range) this.fail("A range can only be used in a for loop, as positions (a[range(n)]), and in sum, min, max and len.", at);
    }
    if (rank === 0) return this.scalar(fn(args.map((a) => a.js), this.cx.lines), d);
    const L = this.cx.lines, site = this.site(at);
    // single numbers are computed once, before the loop
    let xs = args.map((a) => (a.r === 0 ? this.scalar(this.bind(a.js), a.d) : a));
    const first = xs.find((a) => a.r === rank)!;
    for (const a of xs) {
      if (a === first || a.r === 0) continue;
      if (a.r === rank) L.push(rank === 1 ? `if (${a.n} !== ${first.n}) r_fail(2, ${site});` : `if (${a.rows} !== ${first.rows} || ${a.cols} !== ${first.cols}) r_fail(3, ${site});`);
      else L.push(`if (${a.n} !== ${first.cols}) r_fail(3, ${site});`);
    }
    if (rank === 2) {
      xs = xs.map((a) => {
        if (a.r !== 1) return a;
        const flat = this.flatten(a, false);
        return { ...a, at: (i: string) => `${flat}[${i} % ${first.cols}]` };
      });
    }
    const out: Val = {
      r: rank, d: toNp(d), js: "", flat: "", n: first.n, rows: first.rows, cols: first.cols,
      at: (i, body) => fn(xs.map((a) => a.at(i, body)), body),
    };
    return this.optimize ? out : this.solid(out);
  }

  private single(v: Val, at: Expr, what: string): Val {
    if (v.r !== 0) this.fail(`${what} must be a single number or truth value, but this is ${RANKS[v.r]}.`, at);
    return v;
  }

  /** A position must be a whole number in Python: 2.0 and True are refused there, so they are refused here. */
  private whole(v: Val, at: Expr, what = "A position"): Val {
    if (v.r > 1) this.fail(`${what} must be a whole number or a list of whole numbers, but this is ${RANKS[v.r]}.`, at);
    if (v.d & BOOLS) this.fail(`${what} must be a whole number, but this is (or may be) a truth value.`, at);
    if (v.d & FLOATS) {
      this.fail(`${what} must be a whole number, but this is (or may be) a decimal number. Python refuses decimal numbers here, even 2.0. Build it from whole numbers with + - * // and %.`, at);
    }
    return v;
  }

  private noRange(v: Val, at: Expr, where: string): Val {
    if (v.range) this.fail(`A range cannot be used in ${where}. It can be used in a for loop, as positions (a[range(n)]), and in sum, min, max and len.`, at);
    return v;
  }

  // ---- expressions ----

  private ev(e: Expr): Val {
    if (++this.work > MAX_WORK) this.fail("The functions and expressions are too complex to translate. Please simplify them.", e);
    switch (e.k) {
      case "num":
        return this.scalar(num(e.v!), e.int ? PI : PF);
      case "bool":
        return this.scalar(e.v ? "1" : "0", PB);
      case "name":
        return this.name(e);
      case "ops":
        return this.scalar(e.id === "inf" ? "(1 / 0)" : num(OPS.get(e.id!)!.value!), PF);
      case "un": {
        const a = this.ev(e.a!);
        if (e.op === "not") return this.scalar(`(${this.single(a, e.a!, "The value after `not`").js} === 0 ? 1 : 0)`, PB);
        let d = 0;
        for (const bit of BITS) {
          if (!(a.d & bit)) continue;
          if (bit === NB) this.fail(`Python cannot apply ${e.op} to a truth value that comes from data or variables. Turn it into a number first, for example (a > 1) * 1.`, e);
          d |= bit === PB ? PI : bit;
        }
        return this.map([a], d, e, ([x]) => (e.op === "+" ? x : d & FLOATS ? `(-${x})` : `(0 - ${x})`));
      }
      case "bin":
        return this.binary(e.op!, this.ev(e.a!), this.ev(e.b!), e, e.b!.k === "num" ? e.b!.v! : -1);
      case "cmp":
        return this.compare(e);
      case "logic": {
        const a = this.single(this.ev(e.a!), e.a!, `The value before \`${e.op}\``), result = this.t(), L = this.cx.lines;
        L.push(`let ${result} = ${a.js};`, `if (${result} ${e.op === "and" ? "!==" : "==="} 0) {`);
        const b = this.single(this.ev(e.b!), e.b!, `The value after \`${e.op}\``);
        L.push(`${result} = ${b.js};`, "}");
        return this.scalar(result, a.d | b.d);
      }
      case "index":
        return this.index(e);
      case "call":
        if (e.a!.k === "ops") return this.ops(e);
        return this.defs.has(e.a!.id!) ? this.callOwn(e) : this.builtin(e);
      default:
        return this.fail("This cannot be used as a value here.", e);
    }
  }

  private name(e: Expr): Val {
    const slot = this.cx.env.get(e.id!);
    if (slot) {
      if ("conflict" in slot) this.fail(`"${e.id}" is a single number on one path and a list or table on another. Use two different names.`, e);
      return this.value(slot.js, slot);
    }
    const input = this.inputs.get(e.id!);
    if (!input) return this.fail(`The name "${e.id}" is not known.`, e);
    if (input.data) return this.value(`d${input.index}`, input.ty);
    this.cx.used.add(input.index);
    return this.value(`v${input.index}`, input.ty);
  }

  /** `literal` is the right side when it is a written number, else -1. */
  private binary(op: string, a: Val, b: Val, at: Expr, literal: number): Val {
    const kinds = arith(op, a.d, b.d);
    if (typeof kinds === "string") return this.fail(kinds, at);
    let { d } = kinds;
    const { sem } = kinds;
    // a whole number to a written power of at least 0 stays a whole number
    if (op === "**" && sem === "pyint" && literal >= 0 && Number.isInteger(literal)) d = PI;
    const site = op === "**" && sem === "npint" ? this.site(at) : "";
    return this.map([a, b], d, at, ([x, y], body) => {
      switch (op) {
        case "+":
          return sem === "or" ? `(${x} | ${y})` : `(${x} + ${y})`;
        case "-":
          return `(${x} - ${y})`;
        case "*":
          // whole numbers have no negative zero
          return sem === "float" || d === NB ? `(${x} * ${y})` : `(${x} * ${y} + 0)`;
        case "/":
          return `(${x} / ${y})`;
        case "//":
          return `r_${sem === "float" ? "fdiv" : sem === "npint" ? "idiv" : "pdiv"}(${x}, ${y})`;
        case "%":
          return `r_${sem === "float" ? "fmod" : sem === "npint" ? "imod" : "pmod"}(${x}, ${y})`;
        default: {
          if (sem === "npint") return `r_ipow(${x}, ${y}, ${site})`;
          if (sem === "pyint") return `r_ppow(${x}, ${y})`;
          if (literal !== 2) return `r_pow(${x}, ${y})`;
          const base = this.t();
          body.push(`const ${base} = ${x};`);
          return `(${base} * ${base})`;
        }
      }
    });
  }

  private compare(e: Expr): Val {
    const xs = e.xs!, ops = e.ops!.map((op) => (op === "==" ? "===" : op === "!=" ? "!==" : op));
    // Python's own truth value when both sides are plain Python numbers, NumPy's when either
    // side comes from NumPy. A name that can be both gives a result that can be both.
    const kind = (a: Val, b: Val) => (a.d & 7 && b.d & 7 && a.r === 0 && b.r === 0 ? PB : 0) | (a.d & 56 || b.d & 56 || a.r > 0 || b.r > 0 ? NB : 0);
    if (xs.length === 2) {
      const a = this.ev(xs[0]), b = this.ev(xs[1]);
      return this.map([a, b], kind(a, b), e, ([x, y]) => `(${x} ${ops[0]} ${y} ? 1 : 0)`);
    }
    // a < b < c: each operand is computed once, and the later ones only when needed
    const L = this.cx.lines, result = this.t();
    const operand = (x: Expr) => {
      const v = this.ev(x);
      if (v.r !== 0) this.fail("A chain of comparisons (a < b < c) only works for single numbers. For lists, compare twice and combine the results with *, as in (a < b) * (b < c).", x);
      return { ...v, js: this.bind(v.js) };
    };
    let previous = operand(xs[0]), d = 0;
    L.push(`let ${result} = 1;`);
    for (let k = 1; k < xs.length; k++) {
      if (k > 1) L.push(`if (${result} !== 0) {`);
      const next = operand(xs[k]);
      L.push(`${result} = ${previous.js} ${ops[k - 1]} ${next.js} ? 1 : 0;`);
      d |= kind(previous, next);
      previous = next;
    }
    L.push("}".repeat(xs.length - 2));
    return this.scalar(result, d);
  }

  private index(e: Expr): Val {
    const base = this.ev(e.a!), subs = e.xs!, site = this.site(e);
    if (base.r === 0) this.fail("A single number has no elements, so it cannot take a position in square brackets.", e);
    if (base.range) this.fail("A range cannot take a position. Use the numbers directly.", e);
    if (subs.some((s) => s.k === "slice") && (base.r !== 1 || subs.length !== 1)) {
      this.fail("A slice (a[i:j]) only works on a list. For a table, take a row with t[i] or elements with t[rows, cols].", e);
    }
    if (base.r === 3) {
      if (subs.length !== 1) this.fail("Take one group with a single position, as in g[0].", e);
      const i = this.whole(this.ev(subs[0]), subs[0]);
      if (i.r !== 0) this.fail("Take one group with a single position, as in g[0].", subs[0]);
      return this.list(`r_grp(${base.js}, ${i.js}, ${site})`, NI);
    }
    if (base.r === 1) {
      if (subs.length !== 1) this.fail("A list has one position, as in a[i]. Two positions are for tables.", e);
      const s = subs[0], a = this.solid(base);
      if (s.k === "slice") {
        const end = (x: Expr | undefined, open: string) => (x ? this.single(this.whole(this.ev(x), x, "The end of a slice"), x, "The end of a slice").js : open);
        return this.list(`r_sl(${a.js}, ${end(s.a, "0")}, ${end(s.b, "(1 / 0)")}, ${site})`, a.d);
      }
      const i = this.whole(this.noRangeOk(this.ev(s)), s);
      if (i.r === 0) return this.scalar(`${a.js}[r_ix(${i.js}, ${a.n}, ${site})]`, a.d);
      const out: Val = {
        r: 1, d: a.d, js: "", flat: "", n: i.n, rows: "", cols: "",
        at: (k, body) => `${a.js}[${this.position(i.at(k, body), a.n, site, body)}]`,
      };
      return this.optimize ? out : this.solid(out);
    }
    const t = this.solid(base);
    if (subs.length === 1) {
      const i = this.whole(this.ev(subs[0]), subs[0]);
      if (i.r !== 0) this.fail("To pick elements of a table with lists of positions, give both rows and columns: t[rows, cols].", subs[0]);
      return this.list(`r_row(${t.js}, ${i.js}, ${site})`, t.d);
    }
    const i = this.whole(this.noRangeOk(this.ev(subs[0])), subs[0]), j = this.whole(this.noRangeOk(this.ev(subs[1])), subs[1]);
    if (i.r === 0 && j.r === 0) {
      return this.scalar(`${t.flat}[r_ix(${i.js}, ${t.rows}, ${site}) * ${t.cols} + r_ix(${j.js}, ${t.cols}, ${site})]`, t.d);
    }
    // paired positions: element k is t[rows[k], cols[k]], and one of the two may be a single number
    const fixed = (v: Val, n: string) => (v.r === 0 ? this.copy(`r_ix(${v.js}, ${n}, ${site})`) : "");
    const row = fixed(i, t.rows), col = fixed(j, t.cols);
    if (i.r === 1 && j.r === 1) this.cx.lines.push(`if (${i.n} !== ${j.n}) r_fail(2, ${site});`);
    const out: Val = {
      r: 1, d: t.d, js: "", flat: "", n: i.r === 1 ? i.n : j.n, rows: "", cols: "",
      at: (k, body) => {
        const r = row || this.position(i.at(k, body), t.rows, site, body);
        const c = col || this.position(j.at(k, body), t.cols, site, body);
        return `${t.flat}[${r} * ${t.cols} + ${c}]`;
      },
    };
    return this.optimize ? out : this.solid(out);
  }

  /** Positions may be a range: nothing to check, the name only marks the place. */
  private noRangeOk(v: Val): Val {
    return v.range ? { ...v, range: false } : v;
  }

  private args(e: Expr): Val[] {
    return e.xs!.map((x) => this.ev(x));
  }

  private builtin(e: Expr): Val {
    const id = e.a!.id!, L = this.cx.lines;
    const args = this.args(e), v = args[0];
    switch (id) {
      case "sum": {
        if (v.r === 0 || v.r === 3) this.fail(`sum needs a list or a table, but this is ${RANKS[v.r]}.`, e);
        // Python starts from the whole number 0, which is also the answer for an empty list
        if (v.r === 2) return this.list(`r_sum0(${this.solid(v).js})`, counted(v.d));
        const total = this.t(), i = this.t(), body: string[] = [];
        const element = v.at(i, body);
        L.push(`let ${total} = 0;`, `for (let ${i} = 0; ${i} < ${v.n}; ${i}++) {`, ...body, `${total} += ${element};`, "}");
        return this.scalar(total, v.range ? PI : PI | counted(v.d));
      }
      case "min":
      case "max": {
        if (args.length === 1) {
          if (v.r === 2) this.fail(`${id} of a table is an error in Python. Use ops.${id}(t), or ops.${id}(t, axis=0) for each column.`, e);
          if (v.r !== 1) this.fail(`${id} needs a list, or two or more numbers.`, e);
          return this.scalar(`r_py${id}(${this.flatten(v, true)}, ${v.n}, ${this.site(e)})`, v.range ? PI : v.d);
        }
        args.forEach((a, k) => this.single(a, e.xs![k], `With several arguments, each argument of ${id}`));
        const best = this.t();
        L.push(`let ${best} = ${v.js};`);
        for (const a of args.slice(1)) {
          const next = this.bind(a.js);
          L.push(`if (${next} ${id === "min" ? "<" : ">"} ${best}) ${best} = ${next};`);
        }
        return this.scalar(best, args.reduce((d, a) => d | a.d, 0));
      }
      case "abs":
        return this.map([v], v.d & PB ? (v.d & ~PB) | PI : v.d, e, ([x]) => `r_abs(${x})`);
      case "len": {
        if (v.r === 0) this.fail("len needs a list, a table or groups, but this is a single number.", e);
        const s = this.solid(v);
        return this.scalar(s.r === 1 ? s.n : s.r === 2 ? s.rows : `${s.js}.length`, PI);
      }
      default: {
        // range as a value
        args.forEach((a, k) => this.single(this.whole(a, e.xs![k], "An argument of range"), e.xs![k], "An argument of range"));
        const [a, b, c] = args.length === 1 ? ["0", v.js, "1"] : [v.js, args[1].js, args.length === 3 ? args[2].js : "1"];
        return this.list(`r_range(${a}, ${b}, ${c}, ${this.site(e)})`, NI, true);
      }
    }
  }

  private ops(e: Expr): Val {
    const id = e.a!.id!, L = this.cx.lines, site = this.site(e);
    if (id === "array") {
      const items = e.xs![0].xs!.map((x) => this.single(this.ev(x), x, "An element of ops.array([...])").js);
      return this.list(`r_arr([${items.join(", ")}])`, NF);
    }
    const args = this.args(e), v = args[0];
    args.forEach((a, k) => {
      this.noRange(a, e.xs![k], `ops.${id}`);
      if (a.r === 3) this.fail(`ops.${id} cannot take the groups of a partition. Take one group, as in g[0], or loop over them.`, e.xs![k]);
    });
    const listOnly = () => {
      if (v.r !== 1) this.fail(`ops.${id} needs a list, but this is ${RANKS[v.r]}.`, e.xs![0]);
    };
    const noTruth = (a: Val, k: number) => {
      if (a.d & BOOLS) this.fail(`ops.${id} of truth values gives a low-precision result in NumPy. Turn them into numbers first, for example (a > 1) * 1.`, e.xs![k]);
    };
    switch (id) {
      case "zeros":
      case "ones":
      case "arange":
        return this.list(`r_${id}(${this.single(v, e.xs![0], `The length in ops.${id}`).js}, ${site})`, id === "arange" ? NI : NF);
      case "sum":
      case "mean":
      case "prod":
      case "min":
      case "max": {
        if (v.r === 0) this.fail(`ops.${id} needs a list or a table, but this is a single number.`, e.xs![0]);
        const d = id === "mean" ? NF : id === "min" || id === "max" ? v.d : counted(v.d);
        // a product of whole numbers must not end as negative zero
        const fix = (out: Val) => (id === "prod" && !(d & FLOATS) ? this.map([out], d, e, ([x]) => `(${x} + 0)`) : out);
        if (e.axis) {
          if (v.r !== 2) this.fail("axis= only works on a table.", e.axis);
          const needsSite = id === "min" || id === "max";
          return fix(this.list(`r_${id}${num(e.axis.v!)}(${this.solid(v).js}${needsSite ? `, ${site}` : ""})`, d));
        }
        if (id === "prod") {
          const total = this.t(), i = this.t(), body: string[] = [];
          const element = v.at(i, body);
          L.push(`let ${total} = 1;`, `for (let ${i} = 0; ${i} < ${v.n}; ${i}++) {`, ...body, `${total} *= ${element};`, "}");
          return fix(this.scalar(total, d));
        }
        const flat = this.flatten(v, true);
        if (id === "min" || id === "max") return this.scalar(`r_np${id}(${flat}, ${v.n}, ${site})`, d);
        // np.sum adds in pairs and starts from 0, which turns a sum of negative zeros into +0
        const total = `(r_npSum(${flat}, 0, ${v.n}) + 0)`;
        return this.scalar(id === "sum" ? total : `(${total} / ${v.n})`, d);
      }
      case "argmin":
      case "argmax":
        listOnly();
        return this.scalar(`r_${id}(${this.flatten(v, true)}, ${v.n}, ${site})`, PI);
      case "argsort":
      case "sort":
      case "cumsum":
        listOnly();
        return this.list(`r_${id}(${this.flatten(v, true)}, ${v.n})`, id === "argsort" ? NI : id === "sort" ? v.d : counted(v.d));
      case "roll": {
        listOnly();
        const shift = this.single(args[1], e.xs![1], "The shift in ops.roll").js;
        if (!this.optimize) return this.list(`r_roll(${this.flatten(v, false)}, ${v.n}, ${shift}, ${site})`, v.d);
        const a = this.solid(v), k = this.copy(`r_rollk(${shift}, ${a.n}, ${site})`);
        return {
          r: 1, d: a.d, js: "", flat: "", n: a.n, rows: "", cols: "",
          at: (i, body) => {
            const j = this.t();
            body.push(`let ${j} = ${i} - ${k};`, `if (${j} < 0) ${j} += ${a.n};`);
            return `${a.js}[${j}]`;
          },
        };
      }
      case "sqrt":
      case "exp":
      case "log":
      case "sin":
      case "cos":
      case "tan":
        noTruth(v, 0);
        return this.map([v], NF, e, ([x]) => `r_${id}(${x})`);
      case "round":
      case "sign":
        noTruth(v, 0);
        return this.map([v], toNp(v.d), e, ([x]) => `r_${id}(${x})`);
      case "abs":
        return this.map([v], toNp(v.d), e, ([x]) => `r_abs(${x})`);
      case "floor":
      case "ceil":
        return this.map([v], toNp(v.d), e, ([x]) => (v.d & FLOATS ? `r_${id}(${x})` : x));
      case "minimum":
      case "maximum":
        return this.map(args, promote(args.map((a) => a.d)), e, ([x, y]) => `r_${id === "minimum" ? "min2" : "max2"}(${x}, ${y})`);
      case "clip":
        return this.map(args, promote(args.map((a) => a.d)), e, ([x, low, high]) => `r_min2(r_max2(${x}, ${low}), ${high})`);
      case "where":
        return this.map(args, promote([args[1].d, args[2].d]), e, ([c, x, y]) => `(${c} !== 0 ? ${x} : ${y})`);
      default: {
        // dot
        const b = args[1];
        noTruth(v, 0);
        noTruth(b, 1);
        if (b.r !== 1 || (v.r !== 1 && v.r !== 2)) this.fail("ops.dot needs two lists, or a table and a list.", e);
        const d = promote([v.d, b.d]);
        if (v.r === 1) return this.scalar(`r_dot(${this.flatten(v, true)}, ${this.flatten(b, true)}, ${v.n}, ${b.n}, ${site})`, d);
        return this.list(`r_dot2(${this.solid(v).js}, ${this.flatten(b, true)}, ${b.n}, ${site})`, d);
      }
    }
  }

  // ---- the user's functions ----

  private callOwn(e: Expr): Val {
    const def = this.defs.get(e.a!.id!)!;
    const args = this.args(e).map((a) => this.solid(a));
    const variant = this.variant(def, args, e);
    const call = `${variant.name}(${args.map((a) => a.js).join(", ")})`;
    return variant.ret.r === 0 ? this.scalar(this.copy(call), variant.ret.d) : this.value(call, variant.ret);
  }

  /** One JavaScript function for each different set of argument kinds that a function is called with. */
  private variant(def: FuncDef, args: Ty[], at: Expr): { name: string; ret: Ty } {
    const key = `${def.name} ${args.map((a) => `${a.r}.${a.d}.${a.range ? 1 : 0}`).join(" ")}`;
    const known = this.variants.get(key);
    if (known) return known;
    if (this.variants.size >= MAX_VARIANTS) this.fail("The functions are called in too many different ways to translate. Please simplify them.", at);
    const outer = this.cx;
    this.cx = { lines: [], temps: 0, locals: new Map(), env: new Map(), field: this.functionsField, label: def.name, ret: null, used: outer.used };
    def.params.forEach((p, k) => {
      this.cx.locals.set(p.name, k);
      this.cx.env.set(p.name, { r: args[k].r, d: args[k].d, range: args[k].range, js: `l${k}` });
    });
    this.block(def.body);
    const { lines, locals, ret } = this.cx;
    this.cx = outer;
    if (!ret) return this.fail(`The function "${def.name}" never returns a value.`, at);
    const name = `f${this.variants.size}`;
    const own = [...locals.values()].filter((k) => k >= def.params.length).map((k) => `l${k}`);
    const body = [...(own.length ? [`let ${own.join(", ")};`] : []), ...lines];
    this.functions.push(`function ${name}(${def.params.map((_, k) => `l${k}`).join(", ")}) {\n${body.join("\n")}\n}`);
    const made = { name, ret };
    this.variants.set(key, made);
    return made;
  }

  private assign(name: string, v: Val): void {
    const { locals, env, lines } = this.cx;
    if (!locals.has(name)) locals.set(name, locals.size);
    const js = `l${locals.get(name)}`;
    lines.push(`${js} = ${v.js};`);
    env.set(name, { r: v.r, d: v.d, range: v.range, js });
  }

  /** Generates the statements. Returns true when every path through them returns. */
  private block(body: Stmt[]): boolean {
    for (const s of body) if (this.statement(s)) return true; // what follows can never run
    return false;
  }

  private statement(s: Stmt): boolean {
    const L = this.cx.lines, at = s as unknown as Expr;
    if (s.k === "return") {
      const v = this.solid(this.ev(s.e!)), ret = this.cx.ret;
      if (ret && ret.r !== v.r) this.fail(`This function returns ${RANKS[ret.r]} in one place and ${RANKS[v.r]} here. It must always return the same kind of value.`, at);
      this.cx.ret = { r: v.r, d: v.d | (ret?.d ?? 0), range: v.range && (ret?.range ?? true) };
      L.push(`return ${v.js};`);
      return true;
    }
    if (s.k === "assign") {
      let v = this.ev(s.e!);
      if (s.op !== "=") {
        const current = this.name({ ...s.e!, k: "name", id: s.name, line: s.line, col: s.col });
        // in Python, += on a list or table changes it in place, for every name that holds it
        if (current.r !== 0) this.fail(`${s.op} on a list or table is not supported, because in Python it would also change the original. Write ${s.name} = ${s.name} ${s.op![0]} ... instead.`, at);
        v = this.binary(s.op![0], current, v, at, -1);
      }
      this.assign(s.name!, this.solid(v));
      return false;
    }
    if (s.k === "if") {
      const before = this.cx.env, ends: Env[] = [];
      for (const { cond, body } of s.branches!) {
        this.cx.env = before;
        const c = this.single(this.ev(cond), cond, "The condition of an `if`");
        L.push(`if (${c.js} !== 0) {`);
        this.cx.env = new Map(before);
        if (!this.block(body)) ends.push(this.cx.env);
        L.push("} else {");
      }
      this.cx.env = new Map(before);
      if (!this.block(s.orelse ?? [])) ends.push(this.cx.env);
      L.push("}".repeat(s.branches!.length));
      if (ends.length === 0) return true;
      this.cx.env = ends.reduce((a, b) => this.join(a, b));
      return false;
    }
    return this.loop(s);
  }

  private loop(s: Stmt): boolean {
    const L = this.cx.lines, it = s.e!, k = this.t(), at = s as unknown as Expr;
    let head: string, element: string, ty: Ty;
    if (it.k === "call" && it.a!.k === "name" && it.a!.id === "range") {
      // a counting loop: no list is made
      const site = this.site(it);
      const xs = it.xs!.map((x) => this.single(this.whole(this.ev(x), x, "An argument of range"), x, "An argument of range").js);
      const [a, b, c] = xs.length === 1 ? ["0", xs[0], "1"] : [xs[0], xs[1], xs[2] ?? "1"];
      const from = this.copy(`r_rng(${a}, ${site})`), to = this.copy(`r_rng(${b}, ${site})`), step = this.copy(`r_step(${c}, ${site})`);
      head = `for (let ${k} = ${from}; ${step} > 0 ? ${k} < ${to} : ${k} > ${to}; ${k} += ${step}) {`;
      element = k;
      ty = { r: 0, d: PI };
    } else if (it.k === "list") {
      const items = it.xs!.map((x) => this.solid(this.ev(x)));
      if (items.length === 0) this.fail("A loop over an empty list does nothing.", it);
      if (items.some((v) => v.r !== items[0].r)) this.fail("The elements of this list must all be single numbers, or all lists, or all tables.", it);
      const all = this.copy(`[${items.map((v) => v.js).join(", ")}]`);
      head = `for (let ${k} = 0; ${k} < ${num(items.length)}; ${k}++) {`;
      element = `${all}[${k}]`;
      ty = { r: items[0].r, d: items.reduce((d, v) => d | v.d, 0), range: items.every((v) => v.range) };
    } else {
      const v = this.solid(this.ev(it));
      if (v.r === 0) this.fail("A `for` loop needs a list, a table, groups or a range to go through, but this is a single number.", it);
      const n = v.r === 1 ? v.n : v.r === 2 ? v.rows : this.copy(`${v.js}.length`);
      head = `for (let ${k} = 0; ${k} < ${n}; ${k}++) {`;
      // a constant, because the body may give the name of the list a new value, and Python goes on with the old list
      const source = v.r === 2 ? v.flat : this.copy(v.js);
      element = v.r === 2 ? `r_sub(${source}, ${k} * ${v.cols}, ${k} * ${v.cols} + ${v.cols})` : `${source}[${k}]`;
      ty = v.r === 1 ? { r: 0, d: v.range ? PI : v.d } : { r: 1, d: v.d };
    }
    if (!this.cx.locals.has(s.name!)) this.cx.locals.set(s.name!, this.cx.locals.size);
    const slot = `l${this.cx.locals.get(s.name!)}`;
    // The kinds of the names at the top of the body depend on the body itself (total = 0, then
    // total += v). So the body is generated again until they stop changing. They can only grow.
    let entry = this.cx.env;
    for (;;) {
      if (++this.work > MAX_WORK) this.fail("The functions and expressions are too complex to translate. Please simplify them.", at);
      const mark = L.length;
      this.cx.env = new Map(entry).set(s.name!, { ...ty, js: slot });
      L.push(head, `${slot} = ${element};`);
      const returned = this.block(s.body!);
      L.push("}");
      // the loop may run zero times, so afterwards only the names from before it are sure
      const next = returned ? entry : this.join(entry, this.cx.env);
      const same = [...next].every(([name, a]) => {
        const b = entry.get(name)!;
        return "conflict" in a ? "conflict" in b : !("conflict" in b) && a.r === b.r && a.d === b.d && !a.range === !b.range;
      });
      this.cx.env = next;
      if (same) return false;
      entry = next;
      L.length = mark;
    }
  }

  /** What is known after two paths meet: the names both have, with the kinds of either. */
  private join(a: Env, b: Env): Env {
    const out: Env = new Map();
    for (const [name, x] of a) {
      const y = b.get(name);
      if (!y) continue;
      if ("conflict" in x || "conflict" in y || x.r !== y.r) out.set(name, { conflict: true });
      else out.set(name, { r: x.r, d: x.d | y.d, range: x.range && y.range, js: x.js });
    }
    return out;
  }
}
