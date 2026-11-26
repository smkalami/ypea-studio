// The translator against real Python: every case and reject of spec/language/cases.json,
// the worked examples, and attempts to break out of the generated code.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeVariable, type Value } from "../variables.ts";
import { compile, dataInputs, LanguageError, RuntimeError, type DataSpec, type InputSpec, type Plain, type ProgramSource } from "./index.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const spec = read("../../spec/language/cases.json");

// cases.json does not say which names are data and which are variables. Functions read these
// directly, so they must be data. Everything else is a variable.
const DATA = new Set(["voltage", "pressure", "w", "distance", "weight"]);
// "assignment to a data name" needs x to be data, while "function sees no variables" needs it
// to be a variable. So this one reject runs with every name as data.
const ALL_DATA = new Set(["assignment to a data name"]);

function inputs(envName: string, allData = false) {
  const data: DataSpec[] = [], variables: InputSpec[] = [], solution: Record<string, Value> = {};
  for (const [name, entry] of Object.entries(spec.envs[envName]) as [string, { kind: "float" | "int" | "groups"; value: any }][]) {
    const { kind, value } = entry;
    if (kind === "groups") {
      variables.push({ name, kind, shape: [value.length] });
      solution[name] = value.map((g: number[]) => Int32Array.from(g));
      continue;
    }
    const shape = !Array.isArray(value) ? [] : Array.isArray(value[0]) ? [value.length, value[0].length] : [value.length];
    if (allData || DATA.has(name)) {
      data.push({ name, kind, shape, values: value });
    } else {
      variables.push({ name, kind, shape });
      solution[name] = (kind === "int" ? Int32Array : Float64Array).from([value].flat(2));
    }
  }
  return { data, variables, solution };
}

/** An expected value as numbers: cases.json stores non-finite numbers as text. */
const expected = (v: unknown): Plain => (Array.isArray(v) ? v.map(expected) : v === "inf" ? Infinity : v === "-inf" ? -Infinity : v === "nan" ? NaN : (v as number));

function same(got: Plain, want: Plain, approx: boolean): boolean {
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => same(got[i], w, approx));
  if (typeof got !== "number") return false;
  return Object.is(got, want) || (approx && Math.abs(got - want) <= 1e-12 * Math.max(Math.abs(got), Math.abs(want)));
}

// A RuntimeError from the generated code names a line. One without a line would be a stray
// JavaScript error that value() wrapped, and that must not count as Python's error.
const ours = (error: unknown) => error instanceof LanguageError || (error instanceof RuntimeError && error.line > 0);

for (const optimize of [true, false]) {
  test(`the ${spec.cases.length} cases give Python's values (${optimize ? "optimized" : "plain"})`, async (t) => {
    for (const c of spec.cases) {
      await t.test(c.name, () => {
        const { data, variables, solution } = inputs(c.env);
        const run = () => {
          const program = compile({ functions: c.functions, data, variables, expressions: [{ label: "case", source: c.expression, any: true }] }, { optimize });
          const e = program.expressions[0], value = e.value(solution);
          if (e.shape === "number") assert.ok(Object.is(e.number(solution), value), "number() and value() differ");
          return value;
        };
        if (c.error) {
          assert.throws(run, ours);
        } else {
          const got = run(), want = expected(c.value);
          assert.ok(same(got, want, c.approx === true), `got ${JSON.stringify(got)}, Python gives ${JSON.stringify(c.value)}`);
        }
      });
    }
  });
}

test(`the ${spec.rejects.length} rejects are refused with the right line`, async (t) => {
  for (const r of spec.rejects) {
    await t.test(r.name, () => {
      const { data, variables } = inputs("basic", ALL_DATA.has(r.name));
      const source: ProgramSource = r.where === "functions"
        ? { functions: r.source, data, variables, expressions: [] }
        : { data, variables, expressions: [{ label: "expression", source: r.source, any: true }] };
      assert.throws(() => compile(source), (error: unknown) => {
        assert.ok(error instanceof LanguageError, `not a LanguageError: ${error}`);
        assert.equal(error.line, r.line, error.message);
        assert.equal(error.field, r.where);
        return true;
      });
    });
  }
});

test("errors carry the field, the line and the column", () => {
  const { data, variables, solution } = inputs("basic");
  assert.throws(() => compile({ data, variables, expressions: [{ label: "Total weight", source: "(s +\n  nothing)" }] }), (error: any) =>
    error instanceof LanguageError && error.field === "Total weight" && error.line === 2 && error.column === 3);
  // an objective or constraint side must be one number
  assert.throws(() => compile({ data, variables, expressions: [{ label: "objective", source: "x * 2" }] }), (error: any) =>
    error instanceof LanguageError && error.field === "objective" && /single number/.test(error.message));
  const functions = "def pick(a, i):\n    b = a * 2\n    return b[i]\n";
  const program = compile({ functions, data, variables, expressions: [{ label: "objective", source: "pick(x, k + 1)" }, { label: "limit", source: "x[\n k + 1]" }] });
  assert.throws(() => program.expressions[0].number(solution), (error: any) => error instanceof RuntimeError && error.field === "pick" && error.line === 3);
  assert.throws(() => program.expressions[1].number(solution), (error: any) => error instanceof RuntimeError && error.field === "limit" && error.line === 1);
  assert.throws(() => program.expressions[0].value({}), RuntimeError);
});

test("kinds and shapes inside a function are checked for each way it is called", () => {
  const { data, variables, solution } = inputs("basic");
  const run = (functions: string, source: string) => compile({ functions, data, variables, expressions: [{ label: "e", source, any: true }] }).expressions[0].value(solution);
  const refuse = (functions: string, source: string, line: number) => assert.throws(() => run(functions, source), (error: any) =>
    error instanceof LanguageError && error.field === "functions" && error.line === line, `${functions} with ${source}`);

  // += is fine on a number. On a list it would change the caller's list in Python, so it is refused.
  const add = "def f(a):\n    a += 1\n    return a\n";
  assert.equal(run(add, "f(s)"), 3.5);
  refuse(add, "f(x)", 2);
  // a position must be a whole number: the same function works with k and is refused with s
  const pick = "def f(a, i):\n    return a[i]\n";
  assert.equal(run(pick, "f(x, k)"), 0.5);
  refuse(pick, "f(x, s)", 2);
  // a name that is a number on one path and a list on the other cannot be used afterwards
  refuse("def f(a, c):\n    if c > 0:\n        b = a\n    else:\n        b = 1\n    return b\n", "f(x, s)", 6);
  refuse("def f(a):\n    if a[0] > 0:\n        return a\n    return 1\n", "f(x)", 4);
  refuse("def f(a):\n    total = 0\n    for row in a:\n        total = total + row\n    return total\n", "f(t)", 4);
  // v is a plain Python 5 on one path and a NumPy number on the other. Python then adds the two
  // truth values as numbers (2) or as "or" (True), so the sum is refused. A product is the same either way.
  const mixed = (op: string) => `def f(c):\n    if c > 0:\n        v = 5\n    else:\n        v = c\n    return (v > 1) ${op} (v > 2)\n`;
  refuse(mixed("+"), "f(s)", 6);
  assert.equal(run(mixed("*"), "f(s)"), 1);
  // a parameter cannot hide a data name
  const fit = inputs("fit");
  assert.throws(() => compile({ functions: "def f(voltage):\n    return voltage\n", data: fit.data, variables: fit.variables, expressions: [] }), LanguageError);

  // Division of plain Python whole numbers by zero stops a Python script. Here it gives infinity
  // (spec, section 4), and a range that would never end is an error.
  const mean = "def f(a):\n    count = 0\n    for v in a:\n        if v > 99:\n            count += 1\n    return sum(a) / count\n";
  assert.equal(run(mean, "f(x)"), Infinity);
  const loop = "def f(a):\n    total = 0\n    for i in range(len(a) // (len(a) - 4)):\n        total += 1\n    return total\n";
  assert.throws(() => run(loop, "f(x)"), (error: any) => error instanceof RuntimeError && error.field === "f" && error.line === 3);
  assert.throws(() => run("def f(n):\n    return ops.zeros(n)\n", "f(10 ** 9)"), RuntimeError);
});

test("the worked examples compile and give the value of a direct calculation", () => {
  const load = (name: string, objective?: string) => {
    const project = read(`../../examples/${name}.json`);
    const made = project.variables.map(makeVariable);
    const variables: InputSpec[] = made.map((v: any) => ({
      name: v.spec.name, shape: v.shape,
      kind: v.spec.type === "partition" ? "groups" : v.spec.type === "real" || v.spec.type.startsWith("fixed") ? "float" : "int",
    }));
    const sides = (project.constraints ?? []).flatMap((c: any) => [{ label: c.name, source: c.left }, { label: c.name, source: c.right }]);
    const source = (text: string): ProgramSource => ({
      functions: project.functions, data: dataInputs(project.data), variables,
      expressions: [{ label: "objective", source: text }, ...sides],
    });
    const solution: Record<string, Value> = {};
    let seed = 1;
    for (const v of made) solution[v.spec.name] = v.decode(Float64Array.from({ length: v.codeSize }, () => (seed = (seed * 16807) % 2147483647) / 2147483647), 0);
    const column = (id: string): number[] => project.data.flatMap((t: any) => t.columns ?? []).find((c: any) => c.name === id).values;
    const matrix = (id: string): number[][] => project.data.find((t: any) => t.name === id).values;
    return { project, source, program: compile(source(objective ?? project.objective.source)), solution, column, matrix };
  };

  const fit = load("linefit");
  let want = 0;
  fit.column("pressure").forEach((p, i) => (want += (p - (fit.solution.offset[0] + fit.solution.gain[0] * fit.column("voltage")[i])) ** 2));
  assert.ok(Object.is(fit.program.expressions[0].number(fit.solution), want));

  const sack = load("knapsack");
  const total = (id: string) => sack.column(id).reduce((s, v, i) => s + v * (sack.solution.take as Int32Array)[i], 0);
  assert.deepEqual(sack.program.expressions.map((e) => e.number(sack.solution)), [total("value"), total("weight"), 50]);

  // The corrected text is used here whatever tsp.json holds. The earlier placeholder name
  // ops.shift is refused: the name is ops.roll.
  const tsp = load("tsp", "sum(distance[route, ops.roll(route, -1)])");
  assert.throws(() => compile(tsp.source("sum(distance[route, ops.shift(route, -1)])")), (error: any) => error instanceof LanguageError && /ops\.shift does not exist/.test(error.message));
  const route = tsp.solution.route as Int32Array;
  want = 0;
  route.forEach((city, i) => (want += tsp.matrix("distance")[city][route[(i + 1) % route.length]]));
  assert.ok(Object.is(tsp.program.expressions[0].number(tsp.solution), want));

  const assignment = load("assignment");
  want = 0;
  (assignment.solution.task as Int32Array).forEach((task, worker) => (want += assignment.matrix("cost")[worker][task]));
  assert.ok(Object.is(assignment.program.expressions[0].number(assignment.solution), want));
});

test("generated code holds nothing from the user's text", () => {
  const { data, variables, solution } = inputs("basic");
  // names that mean something in JavaScript are fine as Python names, and never reach the output
  const functions = [
    "def constructor(prototype, valueOf):",
    "    toString = prototype + valueOf",
    "    for arguments in range(3):",
    "        toString = toString + arguments",
    "    return toString  # globalThis.fetch('x') `${1}` \u2028 \u0647",
    "def window(this):",
    "    return constructor(this, 1e21) + constructor(2, 1e-7)",
  ].join("\n");
  const program = compile({ functions, data, variables, expressions: [{ label: "'; alert(1); //", source: "window(s) + window(x[0])" }] });
  assert.equal(program.expressions[0].number(solution), 2.5 + 1e21 + 3 + (2 + 1e-7 + 3) + (1.5 + 1e21 + 3) + (2 + 1e-7 + 3));
  for (const word of ["constructor", "prototype", "valueOf", "toString", "arguments", "window", "this", "globalThis", "fetch", "alert", "'", '"', "`", "\\", "$"]) {
    assert.ok(!program.js.includes(word), `the output contains ${word}`);
  }
  for (const word of program.js.match(/\d[\w.]*|[A-Za-z_$][\w$]*/g) ?? []) {
    if (!/^\d/.test(word)) assert.match(word,/^(?:const|let|for|if|else|return|function|length|[DQdrc]|r_[A-Za-z0-9]+|[tlfeavdsq]\d+)$/, word);
  }

  // input names are checked too, and a solution cannot smuggle a value in through a prototype
  for (const name of ["__proto__", "constructor", "toString", "a b", "x;", ""]) {
    assert.throws(() => compile({ variables: [{ name, kind: "float", shape: [] }], expressions: [] }), /cannot be the name/);
  }
  const inherited = Object.create({ s: Float64Array.of(7) });
  assert.throws(() => program.expressions[0].value(inherited), RuntimeError);
});

test("hostile text is refused, not run", () => {
  const { data, variables } = inputs("basic");
  const refuse = (source: string, where = "expression") => {
    const program: ProgramSource = where === "functions" ? { functions: source, data, variables, expressions: [] } : { data, variables, expressions: [{ label: "e", source, any: true }] };
    assert.throws(() => compile(program), LanguageError, source.slice(0, 60));
  };
  // far too long, and too deep in every direction that could exhaust the stack
  refuse("1 + ".repeat(40_000) + "1");
  refuse("1 + ".repeat(2_000) + "1");
  refuse("(".repeat(20_000) + "1" + ")".repeat(20_000));
  refuse("[".repeat(20_000));
  refuse("- ".repeat(20_000) + "1");
  refuse("not ".repeat(20_000) + "1");
  refuse("2 ** ".repeat(20_000) + "1");
  refuse("x" + "[0]".repeat(20_000));
  refuse("abs(".repeat(20_000) + "1" + ")".repeat(20_000));
  refuse("1 < ".repeat(20_000) + "1");
  refuse("s and ".repeat(20_000) + "s");
  refuse(`def f(a):\n${Array.from({ length: 60 }, (_, i) => `${" ".repeat(i + 1)}if a:\n`).join("")}${" ".repeat(61)}return a\n`, "functions");
  refuse(`def f(a):\n${"    a = a + 1\n".repeat(9_000)}    return a\n`, "functions");
  // a function called in ever more ways: the translation effort is capped
  const kinds = ["s", "k", "x", "n", "t", "m", "True", "1", "1.5", "x > 1", "s > 1"];
  const calls = kinds.flatMap((a) => kinds.flatMap((b) => kinds.map((c) => ({ label: "e", source: `f(${a}, ${b}, ${c})`, any: true }))));
  assert.throws(() => compile({ functions: "def f(a, b, c):\n    return 1\n", data, variables, expressions: calls }), LanguageError);
});
