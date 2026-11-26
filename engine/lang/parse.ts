// Tokenizer and parser for the limited Python syntax (spec/language.md).
// The parser builds a tree and refuses every form the language does not have. It never looks
// at what a name means: that is the checker's work (check.ts).

/** Text that cannot be translated. Thrown when a project is compiled, never during a run. */
export class LanguageError extends Error {
  /** The label of the field the text came from: "functions", or an expression's label. */
  field: string;
  /** Line and column of the problem, both starting at 1. */
  line: number;
  column: number;
  constructor(message: string, field: string, line: number, column: number) {
    super(message);
    this.name = "LanguageError";
    this.field = field;
    this.line = line;
    this.column = column;
  }
}

export interface Token {
  t: "num" | "name" | "op" | "nl" | "indent" | "dedent" | "end";
  v: string;
  /** For a number: its value, and whether it was written as a whole number. */
  n: number;
  int: boolean;
  line: number;
  col: number;
}

/** One node of an expression. Which fields are set depends on `k`. */
export interface Expr {
  /** num, bool, name, ops (ops.<id>), un, bin, cmp, logic, call, index, list, slice */
  k: string;
  line: number;
  col: number;
  /** Height of the tree below this node. It is capped, so later passes can recurse safely. */
  depth: number;
  v?: number;
  int?: boolean;
  id?: string;
  op?: string;
  a?: Expr;
  b?: Expr;
  /** cmp: the operators between the operands in `xs`. */
  ops?: string[];
  /** cmp operands, call arguments, list elements, index positions. */
  xs?: Expr[];
  axis?: Expr;
}

export interface Stmt {
  /** assign, if, for, return */
  k: string;
  line: number;
  col: number;
  name?: string;
  /** assign: "=", "+=", "-=", "*=" or "/=". */
  op?: string;
  e?: Expr;
  branches?: { cond: Expr; body: Stmt[] }[];
  orelse?: Stmt[];
  body?: Stmt[];
}

export interface FuncDef {
  name: string;
  params: { name: string; line: number; col: number }[];
  body: Stmt[];
  line: number;
  col: number;
}

const MAX_SOURCE = 100_000;
const MAX_NESTING = 100;
const MAX_DEPTH = 500;
const MAX_INDENTS = 40;

const NUMBER = /(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const OPERATORS = [
  "**=", "//=", "<<=", ">>=",
  "**", "//", "<=", ">=", "==", "!=", "+=", "-=", "*=", "/=", "%=", ":=", "->", "<<", ">>", "&=", "|=", "^=", "@=",
  "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]", ",", ":", ".",
];
const SUPPORTED = new Set(["**", "//", "<=", ">=", "==", "!=", "+=", "-=", "*=", "/=", "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]", ",", ":", "."]);

// Characters and operators that Python has and this language does not, each with its message.
const REFUSED: Record<string, string> = {
  "'": "Text in quotes is not supported. Only numbers can be used.",
  '"': "Text in quotes is not supported. Only numbers can be used.",
  "`": "The character ` is not allowed.",
  "{": "Dictionaries and sets, written with { }, are not supported.",
  "}": "Dictionaries and sets, written with { }, are not supported.",
  ";": "A semicolon is not allowed. Write one statement per line, and one expression per field.",
  "\\": "A backslash is not allowed. To continue on the next line, put the expression in parentheses.",
  "@": "The @ operator is not supported. Use ops.dot(a, b) for products of lists and tables.",
  "&": "The & operator is not supported. Use `and` for single truth values.",
  "|": "The | operator is not supported. Use `or` for single truth values.",
  "^": "The ^ operator is not supported. Write a power as a ** b.",
  "~": "The ~ operator is not supported. Use `not` for a single truth value.",
  "!": "The character ! is only allowed in != (not equal). Use `not` to negate.",
  "$": "The character $ is not allowed.",
  "?": "The character ? is not allowed.",
  ":=": "Assignment inside an expression (:=) is not supported.",
  "->": "Type hints (->) are not supported.",
  "<<": "The << operator is not supported.",
  ">>": "The >> operator is not supported.",
  "//=": "Only =, +=, -=, *= and /= can assign. Write a = a // b.",
  "%=": "Only =, +=, -=, *= and /= can assign. Write a = a % b.",
  "**=": "Only =, +=, -=, *= and /= can assign. Write a = a ** b.",
};

// Python keywords outside the subset, each with what to say about it.
const KEYWORDS: Record<string, string> = {
  import: "`import` is not supported. Only the built-in functions and `ops` are available.",
  from: "`import` is not supported. Only the built-in functions and `ops` are available.",
  while: "`while` loops are not supported. Use `for ... in range(...)`.",
  class: "`class` is not supported.",
  lambda: "`lambda` is not supported. Define a function with `def` in the functions field.",
  break: "`break` is not supported. Use `return` to leave a function early.",
  continue: "`continue` is not supported. Use `if` to skip the rest of the loop body.",
  pass: "`pass` is not supported. Every block needs a real statement.",
  global: "`global` is not supported.",
  nonlocal: "`nonlocal` is not supported.",
  try: "`try` is not supported.",
  except: "`try` is not supported.",
  finally: "`try` is not supported.",
  raise: "`raise` is not supported.",
  with: "`with` is not supported.",
  as: "`as` is not supported.",
  assert: "`assert` is not supported.",
  del: "`del` is not supported.",
  yield: "`yield` is not supported.",
  async: "`async` is not supported.",
  await: "`await` is not supported.",
  is: "`is` is not supported. Compare with == or !=.",
  None: "`None` is not supported. Every value is a number, a list or a table.",
  def: "A function can only be defined at the start of a line in the functions field, not inside another function or an expression.",
  if: "`if` cannot be used here.",
  elif: "`elif` needs an `if` before it, at the same indentation.",
  else: "`else` needs an `if` before it, at the same indentation.",
  for: "`for` cannot be used here.",
  in: "`in` can only be used in a `for` loop.",
  return: "`return` can only be used inside a function, at the start of a line.",
  and: "Something is missing before `and`.",
  or: "Something is missing before `or`.",
  not: "Put `not` and what follows it in parentheses here.",
};

/**
 * Splits text into tokens. With `blocks`, indentation becomes indent and dedent tokens, as in
 * Python. Without it (one expression), indentation has no meaning.
 */
export function tokenize(src: string, field: string, blocks: boolean): Token[] {
  const fail = (message: string, line: number, col: number): never => {
    throw new LanguageError(message, field, line, col);
  };
  if (src.length > MAX_SOURCE) fail(`This text is too long (the limit is ${MAX_SOURCE} characters).`, 1, 1);
  const out: Token[] = [];
  const indents = [0];
  const open: Token[] = [];
  let pos = 0, line = 1, lineStart = 0, fresh = true;
  const push = (t: Token["t"], v: string, n = 0, int = false) => {
    out.push({ t, v, n, int, line, col: pos - lineStart + 1 });
    return out[out.length - 1];
  };

  while (pos < src.length) {
    const c = src[pos], col = pos - lineStart + 1;
    if (c === "\n" || c === "\r") {
      if (!fresh && open.length === 0) push("nl", "");
      pos += c === "\r" && src[pos + 1] === "\n" ? 2 : 1;
      line++;
      lineStart = pos;
      if (open.length === 0) fresh = true;
      continue;
    }
    if (c === " " || c === "\t") {
      pos++;
      continue;
    }
    if (c === "#") {
      while (pos < src.length && src[pos] !== "\n" && src[pos] !== "\r") pos++;
      continue;
    }
    if (fresh && open.length === 0) {
      fresh = false;
      if (blocks) {
        const tab = src.indexOf("\t", lineStart);
        if (tab >= 0 && tab < pos) fail("Indent with spaces. A tab in the indentation is not allowed.", line, tab - lineStart + 1);
        const width = pos - lineStart;
        if (width > indents[indents.length - 1]) {
          if (indents.length >= MAX_INDENTS) fail("The blocks are nested too deeply.", line, col);
          indents.push(width);
          push("indent", "");
        }
        while (width < indents[indents.length - 1]) {
          indents.pop();
          push("dedent", "");
        }
        if (width !== indents[indents.length - 1]) fail("The indentation of this line does not match any block above it.", line, col);
      }
    }
    const code = c.charCodeAt(0);
    if (code < 32 || code > 126) {
      fail(`The character with code ${code} is not allowed. Use plain English letters, digits and the operators of the language. Other characters may only appear in a comment after #.`, line, col);
    }
    NUMBER.lastIndex = pos;
    const number = (c >= "0" && c <= "9") || c === "." ? NUMBER.exec(src) : null;
    if (number) {
      const text = number[0], next = src[pos + text.length] ?? "";
      const int = /^\d+$/.test(text), value = Number(text);
      if (/[A-Za-z0-9_]/.test(next)) {
        fail(`"${text}${next}" is not a number of this language. Write whole numbers like 16 or 1000 and decimal numbers like 0.5 or 1e-3, without letters or underscores.`, line, col);
      }
      if (/^0\d/.test(text)) fail("A number cannot start with an extra zero.", line, col);
      if (!Number.isFinite(value)) fail("This number is too large. Use ops.inf for infinity.", line, col);
      if (int && value > Number.MAX_SAFE_INTEGER) fail("This whole number is too large to be exact (the limit is 9007199254740991).", line, col);
      push("num", text, value, int);
      pos += text.length;
      continue;
    }
    NAME.lastIndex = pos;
    const name = NAME.exec(src);
    if (name) {
      push("name", name[0]);
      pos += name[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, pos)) ?? c;
    if (!SUPPORTED.has(op)) fail(REFUSED[op] ?? REFUSED[c] ?? `The operator ${op} is not supported.`, line, col);
    const token = push("op", op);
    if (op === "(" || op === "[") open.push(token);
    if (op === ")" || op === "]") {
      const partner = open.pop();
      if (!partner || partner.v !== (op === ")" ? "(" : "[")) fail(`This ${op} has no matching opening bracket.`, line, col);
    }
    pos += op.length;
  }
  if (open.length > 0) {
    const first = open[open.length - 1];
    fail(`This ${first.v} is never closed.`, first.line, first.col);
  }
  if (!fresh) push("nl", "");
  while (indents.length > 1) {
    indents.pop();
    push("dedent", "");
  }
  push("end", "");
  return out;
}

class Parser {
  private readonly tokens: Token[];
  private readonly field: string;
  private i = 0;
  private nesting = 0;

  constructor(tokens: Token[], field: string) {
    this.tokens = tokens;
    this.field = field;
  }

  private get tok(): Token {
    return this.tokens[this.i];
  }

  fail(message: string, at: { line: number; col: number } = this.tok): never {
    throw new LanguageError(message, this.field, at.line, at.col);
  }

  private is(v: string, t: Token["t"] = "op"): boolean {
    return this.tok.t === t && this.tok.v === v;
  }

  private word(v: string): boolean {
    return this.is(v, "name");
  }

  private take(): Token {
    return this.tokens[this.i++];
  }

  private describe(): string {
    const { t, v } = this.tok;
    return t === "nl" || t === "end" || t === "dedent" ? "the end of the line" : t === "indent" ? "extra indentation" : `"${v}"`;
  }

  private expect(v: string, why: string): Token {
    if (!this.is(v)) this.fail(`Expected ${v} ${why}, but found ${this.describe()}.`);
    return this.take();
  }

  private node(k: string, at: { line: number; col: number }, fields: Partial<Expr>, children: (Expr | undefined)[]): Expr {
    let depth = 1;
    for (const child of children) if (child && child.depth >= depth) depth = child.depth + 1;
    if (depth > MAX_DEPTH) this.fail("This expression is too long. Split it into smaller steps.", at);
    return { k, line: at.line, col: at.col, depth, ...fields };
  }

  private deeper(): void {
    if (++this.nesting > MAX_NESTING) this.fail("This expression is nested too deeply. Split it into smaller steps.");
  }

  // ---- expressions ----

  /** A whole expression. Also catches the two Python forms that start after one. */
  expr(): Expr {
    this.deeper();
    const e = this.or();
    if (this.word("if")) this.fail("A conditional expression (a if c else b) is not supported. Use ops.where(c, a, b), or `if` and `else` inside a function.");
    if (this.word("for")) this.fail("Comprehensions (... for ... in ...) are not supported. Use ops functions on whole lists, or a `for` loop inside a function.");
    this.nesting--;
    return e;
  }

  private or(): Expr {
    let e = this.and();
    while (this.word("or")) {
      const at = this.take(), b = this.and();
      e = this.node("logic", at, { op: "or", a: e, b }, [e, b]);
    }
    return e;
  }

  private and(): Expr {
    let e = this.not();
    while (this.word("and")) {
      const at = this.take(), b = this.not();
      e = this.node("logic", at, { op: "and", a: e, b }, [e, b]);
    }
    return e;
  }

  private not(): Expr {
    if (!this.word("not")) return this.comparison();
    this.deeper();
    const at = this.take(), a = this.not();
    this.nesting--;
    return this.node("un", at, { op: "not", a }, [a]);
  }

  private comparison(): Expr {
    const first = this.arith(), ops: string[] = [], xs = [first];
    for (;;) {
      if (this.word("in") || this.word("is")) this.fail(KEYWORDS[this.tok.v]);
      if (this.word("not")) this.fail("`not in` is not supported.");
      if (!(this.tok.t === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(this.tok.v))) break;
      ops.push(this.take().v);
      xs.push(this.arith());
    }
    return ops.length === 0 ? first : this.node("cmp", first, { ops, xs }, xs);
  }

  private binary(next: () => Expr, operators: string[]): Expr {
    let e = next();
    while (this.tok.t === "op" && operators.includes(this.tok.v)) {
      const at = this.take(), b = next();
      e = this.node("bin", at, { op: at.v, a: e, b }, [e, b]);
    }
    return e;
  }

  private arith(): Expr {
    return this.binary(() => this.binary(() => this.unary(), ["*", "/", "//", "%"]), ["+", "-"]);
  }

  private unary(): Expr {
    if (!(this.is("-") || this.is("+"))) return this.power();
    this.deeper();
    const at = this.take(), a = this.unary();
    this.nesting--;
    return this.node("un", at, { op: at.v, a }, [a]);
  }

  private power(): Expr {
    const a = this.postfix();
    if (!this.is("**")) return a;
    this.deeper();
    const at = this.take(), b = this.unary();
    this.nesting--;
    return this.node("bin", at, { op: "**", a, b }, [a, b]);
  }

  private postfix(): Expr {
    let e = this.atom();
    for (;;) {
      if (this.is(".")) {
        const dot = this.take();
        if (!(e.k === "name" && e.id === "ops")) this.fail("Attributes and methods (a.b) are not supported. The only form with a dot is ops.<name>.", dot);
        if (this.tok.t !== "name") this.fail(`Expected a name after "ops.", but found ${this.describe()}.`);
        e = this.node("ops", e, { id: this.take().v }, []);
      } else if (this.is("(")) {
        if (e.k !== "name" && e.k !== "ops") this.fail("Only a function can be called: a built-in, an ops function, or one from the functions field.");
        e = this.call(e);
      } else if (this.is("[")) {
        e = this.index(e);
      } else {
        return e;
      }
    }
  }

  private call(fn: Expr): Expr {
    this.take();
    const xs: Expr[] = [];
    let axis: Expr | undefined;
    while (!this.is(")")) {
      if (this.is("*") || this.is("**")) this.fail("Unpacking with * is not supported. Pass each argument by itself.");
      const next = this.tokens[this.i + 1];
      if (this.tok.t === "name" && next.t === "op" && next.v === "=") {
        if (!(fn.k === "ops" && this.tok.v === "axis") || axis) {
          this.fail("Arguments with a name (name=value) are not supported. The one exception is axis=0 or axis=1 in an ops function.");
        }
        this.i += 2;
        axis = this.expr();
      } else {
        if (axis) this.fail("axis= must be the last argument.");
        xs.push(this.expr());
      }
      if (!this.is(")")) this.expect(",", "between arguments");
    }
    this.take();
    return this.node("call", fn, { a: fn, xs, axis }, [...xs, axis]);
  }

  private index(base: Expr): Expr {
    const at = this.take(), xs: Expr[] = [];
    do {
      const start = this.tok;
      const low = this.is(":") ? undefined : this.expr();
      if (!this.is(":")) {
        xs.push(low as Expr);
      } else {
        this.take();
        const high = this.is("]") || this.is(",") || this.is(":") ? undefined : this.expr();
        if (this.is(":")) this.fail("A slice with a step (a[i:j:k]) is not supported.");
        xs.push(this.node("slice", start, { a: low, b: high }, [low, high]));
      }
    } while (this.is(",") && this.take());
    this.expect("]", "to close the position");
    if (xs.length > 2) this.fail("At most two positions are allowed, as in t[i, j].", at);
    return this.node("index", at, { a: base, xs }, [base, ...xs]);
  }

  private atom(): Expr {
    const t = this.tok;
    if (t.t === "num") {
      this.take();
      return this.node("num", t, { v: t.n, int: t.int }, []);
    }
    if (t.t === "name") {
      if (t.v === "True" || t.v === "False") {
        this.take();
        return this.node("bool", t, { v: t.v === "True" ? 1 : 0 }, []);
      }
      if (Object.hasOwn(KEYWORDS, t.v)) this.fail(KEYWORDS[t.v]);
      this.take();
      return this.node("name", t, { id: t.v }, []);
    }
    if (this.is("(")) {
      this.take();
      if (this.is(")")) this.fail("Empty parentheses are not a value.", t);
      const e = this.expr();
      if (this.is(",")) this.fail("Several values in parentheses (a tuple) are not supported.");
      this.expect(")", "to close the parenthesis");
      return e;
    }
    if (this.is("[")) {
      this.take();
      const xs: Expr[] = [];
      while (!this.is("]")) {
        xs.push(this.expr());
        if (!this.is("]")) this.expect(",", "between the elements of a list");
      }
      this.take();
      return this.node("list", t, { xs }, xs);
    }
    return this.fail(`Expected a value here, but found ${this.describe()}.`);
  }

  // ---- statements ----

  /** One expression field: a single expression and nothing else. */
  single(): Expr {
    if (this.tok.t === "end") this.fail("This field is empty. Write an expression.");
    const e = this.expr();
    if (this.is("=")) this.fail("An assignment is not allowed here. This field takes one expression.");
    if (this.is(",")) this.fail("Several values separated by commas are not supported. This field takes one expression.");
    if (this.tok.t === "nl") this.take();
    if (this.tokens[this.i].t !== "end") this.fail(`This field takes one expression, but ${this.describe()} follows it.`);
    return e;
  }

  /** The functions field: zero or more `def` statements. */
  functions(): FuncDef[] {
    const out: FuncDef[] = [];
    while (this.tok.t !== "end") {
      if (this.tok.t === "indent") this.fail("This line is indented, but it is not inside a function.");
      if (!this.word("def")) {
        if (this.tok.t === "name" && Object.hasOwn(KEYWORDS, this.tok.v) && !["if", "for", "return", "elif", "else"].includes(this.tok.v)) this.fail(KEYWORDS[this.tok.v]);
        this.fail("Only function definitions (def name(...):) are allowed in the functions field. Put this line inside a function.");
      }
      out.push(this.def());
    }
    return out;
  }

  private def(): FuncDef {
    const at = this.take();
    if (this.tok.t !== "name") this.fail(`Expected the name of the function after def, but found ${this.describe()}.`);
    const name = this.take();
    if (Object.hasOwn(KEYWORDS, name.v) || name.v === "True" || name.v === "False") this.fail(`"${name.v}" is a word of the language and cannot be the name of a function.`, name);
    this.expect("(", "after the function name");
    const params: FuncDef["params"] = [];
    while (!this.is(")")) {
      if (this.is("*") || this.is("**")) this.fail("Parameters with * are not supported. List every parameter by name.");
      const p = this.tok;
      if (p.t !== "name") this.fail(`Expected a parameter name, but found ${this.describe()}.`);
      if (Object.hasOwn(KEYWORDS, p.v) || p.v === "True" || p.v === "False") this.fail(`"${p.v}" is a word of the language and cannot be the name of a parameter.`);
      this.take();
      if (this.is("=")) this.fail("Default values for parameters are not supported.");
      if (this.is(":")) this.fail("Type hints for parameters are not supported.");
      params.push({ name: p.v, line: p.line, col: p.col });
      if (!this.is(")")) this.expect(",", "between parameters");
    }
    this.take();
    const body = this.block("the function");
    return { name: name.v, params, body, line: at.line, col: at.col };
  }

  /** The colon, the line end, and the indented statements that follow. */
  private block(owner: string): Stmt[] {
    this.expect(":", `at the end of the line that starts ${owner}`);
    if (this.tok.t !== "nl") this.fail("Start a new, indented line after the colon.");
    this.take();
    if (this.tokens[this.i].t !== "indent") this.fail(`The lines of ${owner} must be indented under it.`);
    this.take();
    const out: Stmt[] = [];
    while (this.tokens[this.i].t !== "dedent") out.push(this.statement());
    this.take();
    return out;
  }

  private endOfLine(): void {
    if (this.tok.t !== "nl") this.fail(`Expected the end of the line, but found ${this.describe()}.`);
    this.take();
  }

  private statement(): Stmt {
    const at = this.tok;
    if (at.t === "indent") this.fail("This line is indented more than the lines above it, but no block starts there.");
    if (this.word("def")) this.fail(KEYWORDS.def);
    if (this.word("return")) {
      this.take();
      if (this.tok.t === "nl") this.fail("`return` needs a value.");
      const e = this.expr();
      if (this.is(",")) this.fail("Returning several values is not supported. Return one number, list or table.");
      this.endOfLine();
      return { k: "return", line: at.line, col: at.col, e };
    }
    if (this.word("if")) {
      const branches: Stmt["branches"] = [];
      let orelse: Stmt[] | undefined;
      do {
        this.take();
        const cond = this.expr();
        branches.push({ cond, body: this.block("the `if`") });
      } while (this.word("elif"));
      if (this.word("else")) {
        this.take();
        if (this.word("if")) this.fail("Write `elif` instead of `else if`.");
        orelse = this.block("the `else`");
      }
      return { k: "if", line: at.line, col: at.col, branches, orelse };
    }
    if (this.word("for")) {
      this.take();
      const name = this.tok;
      if (name.t !== "name" || Object.hasOwn(KEYWORDS, name.v) || name.v === "True" || name.v === "False") this.fail(`Expected the name of the loop variable after for, but found ${this.describe()}.`);
      this.take();
      if (this.is(",")) this.fail("A loop with several variables is not supported.");
      if (!this.word("in")) this.fail(`Expected "in" after the loop variable, but found ${this.describe()}.`);
      this.take();
      const e = this.expr();
      const body = this.block("the `for`");
      if (this.word("else")) this.fail("`else` after a `for` loop is not supported.");
      return { k: "for", line: at.line, col: at.col, name: name.v, e, body };
    }
    const target = this.expr();
    if (this.is(",")) this.fail("Assigning to several names at once (a, b = ...) is not supported. Use one line for each name.");
    if (!(this.tok.t === "op" && ["=", "+=", "-=", "*=", "/="].includes(this.tok.v))) {
      this.fail("This line does nothing. A line inside a function must assign (name = ...), return, or start an `if` or a `for`.", at);
    }
    if (target.k === "index") this.fail("Assigning to an element (a[i] = ...) is not supported. Lists and tables cannot be changed. Build a new value instead.", at);
    if (target.k !== "name") this.fail("Only a plain name can be assigned to.", at);
    const op = this.take().v;
    const e = this.expr();
    if (this.is("=")) this.fail("Assigning to several names at once (a = b = ...) is not supported.");
    if (this.is(",")) this.fail("Several values separated by commas (a tuple) are not supported.");
    this.endOfLine();
    return { k: "assign", line: at.line, col: at.col, name: target.id, op, e };
  }
}

/** Parses one expression field. */
export function parseExpression(source: string, field: string): Expr {
  return new Parser(tokenize(source, field, false), field).single();
}

/** Parses the functions field. */
export function parseFunctions(source: string, field: string): FuncDef[] {
  return new Parser(tokenize(source, field, true), field).functions();
}
