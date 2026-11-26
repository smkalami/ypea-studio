// Tests of the Python script exporter. The plain tests need only Node. The others run the
// exported scripts in real Python with the pinned ypea and compare them with the app. They are
// skipped, with the reason, when the project's .venv is missing or holds another ypea.
//
// To write the stored files again (export/ops_py.ts and export/expected/*.py):
//   UPDATE_EXPECTED=1 node --test "export/*.test.ts"

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { METHODS } from "../engine/methods/index.ts";
import { parseProject, type Project } from "../engine/project.ts";
import { runProject, YPEA_TESTED, type RunResult } from "../engine/run.ts";

const UPDATE = process.env.UPDATE_EXPECTED === "1";
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const read = (relative: string) => readFileSync(path(relative), "utf8").replace(/\r\n/g, "\n");
const readJson = (relative: string) => JSON.parse(read(relative));

// The exporter cannot read files in a browser, so it carries the ops module as text.
const opsSource = read("../spec/language/ops.py");
if (UPDATE) {
  const text = opsSource.replace(/[\\`]|\$\{/g, (m) => "\\" + m);
  writeFileSync(path("./ops_py.ts"), `// A copy of spec/language/ops.py, which an exported script carries. Do not edit it here: a test\n// compares the two, and the command at the top of python.test.ts writes this file again.\nexport const OPS_PY = \`${text}\`;\n`);
}
// loaded here, after the copy above may have been written again
const { exportPython, pythonLiteral, comment } = await import("./python.ts");
const { OPS_PY } = await import("./ops_py.ts");
const { breach } = await import("./report.ts");

const HOW = `Write the stored files again with: UPDATE_EXPECTED=1 node --test "export/*.test.ts"`;

const EXAMPLES = readdirSync(path("../examples")).filter((f) => f.endsWith(".json")).sort().map((f) => f.slice(0, -5));
/** Every example, run in the app once. */
const exampleRuns = new Map<string, { project: Project; result: RunResult }>();
function exampleRun(name: string) {
  if (!exampleRuns.has(name)) {
    const project = parseProject(readJson(`../examples/${name}.json`));
    exampleRuns.set(name, { project, result: runProject(project) });
  }
  return exampleRuns.get(name)!;
}

/** A small project to change in the tests below. */
const small = (changes: Record<string, unknown> = {}, run: Record<string, unknown> = {}): Project =>
  parseProject({
    format: "ypea-studio-project",
    version: 1,
    name: "Small",
    variables: [{ name: "x", type: "real", shape: [3], lb: -5, ub: 5 }],
    objective: { sense: "min", source: "sum(x * x)" },
    run: { method: "random", settings: {}, budget: 300, seed: 7, ...run },
    ...changes,
  });

// ---------------------------------------------------------------------------------------------
// Plain tests

test("the carried copy of the ops module is spec/language/ops.py", () => {
  assert.equal(OPS_PY, opsSource, HOW);
});

for (const name of EXAMPLES) {
  test(`example ${name}: the script is the stored one`, () => {
    const { project, result } = exampleRun(name);
    const script = exportPython(project, result);
    assert.equal(exportPython(project, structuredClone(result)), script, "the same input gives the same text");
    const file = `./expected/${name}.py`;
    if (UPDATE) {
      mkdirSync(path("./expected"), { recursive: true });
      writeFileSync(path(file), script);
    }
    assert.ok(existsSync(path(file)), `There is no stored script for the example "${name}". ${HOW}`);
    assert.equal(script, read(file), `The script of the example "${name}" changed. ${HOW}`);
  });
}

test("the header names the versions, the Python version and how closely the runs agree", () => {
  const { project, result } = exampleRun(EXAMPLES[0]);
  const script = exportPython(project, result);
  assert.match(script, new RegExp(`^# Exported from YPEA Studio ${result.versions.app.replaceAll(".", "\\.")}\\. Tested with ypea ${YPEA_TESTED.replaceAll(".", "\\.")}, which needs Python 3\\.12 or newer\\.$`, "m"));
  assert.ok(script.includes(`# Install it with: pip install ypea==${YPEA_TESTED}\n`));
  assert.match(script, /CMA-ES .* agree within a small tolerance/);
  assert.match(script, /every other solver the two runs are the same/);
  assert.match(script, /exp, log, sin, cos and tan.*\n.*last digit/);
});

test("no line of a script is longer than a careful person would write, except the user's own", () => {
  for (const name of EXAMPLES) {
    const { project, result } = exampleRun(name);
    const own = [...(project.functions ?? "").split("\n"), project.objective.source, project.baseline?.label, project.reference?.label,
      ...(project.constraints ?? []).flatMap((c) => [c.name, c.left, c.right])].filter((text) => text?.trim()).map((text) => text!.trim());
    for (const line of exportPython(project, result).split("\n")) {
      assert.equal(line, line.trimEnd(), `${name}: a line ends in spaces`);
      if (!own.some((text) => line.includes(text))) assert.ok(line.length <= 100, `${name}: ${line.length} columns: ${line}`);
    }
  }
});

// Text that tries to end a comment or a string and run code. If any of it ran, Python would
// stop with exit code 7, and the tests that run the script would see it.
const HOSTILE = [
  `x"\nraise SystemExit(7)\n"`,
  `'''\r\nraise SystemExit(7)\r\n'''`,
  `"""\rraise SystemExit(7)\r"""`,
  `\\"); raise SystemExit(7)  # \\`,
  `a\u2028raise SystemExit(7)\u2029b\u0085raise SystemExit(7)\u000craise SystemExit(7)\u0000\ud800`,
  `# kg") or exit(7) or ("`,
];
const hostileProject = (): Project =>
  parseProject({
    format: "ypea-studio-project",
    version: 1,
    name: HOSTILE[0],
    description: HOSTILE.join(" and "),
    data: [
      { name: "items", kind: "columns", columns: [{ name: "weight", unit: HOSTILE[1], values: [3, 7, 4, 9, 5] }, { name: "value", unit: HOSTILE[2], values: [40, 90, 55, 70, 30] }] },
      { name: "table", kind: "matrix", unit: HOSTILE[3], values: [[1, 2], [3, 4]] },
    ],
    variables: [{ name: "take", type: "binary", shape: [5], unit: HOSTILE[4] }, { name: "y", type: "real", shape: [], lb: 0, ub: 1, unit: HOSTILE[5] }],
    objective: { sense: "max", unit: HOSTILE[0], source: "sum(value * take) + y * table[1, 1]" },
    constraints: HOSTILE.map((text, i) => ({ name: text, left: "sum(weight * take)", op: "<=", right: String(12 + i), unit: HOSTILE[(i + 1) % HOSTILE.length], ...(i % 3 === 2 && { enabled: false }) })),
    baseline: { label: HOSTILE[1], solution: { take: [1, 0, 0, 0, 0], y: 0.5 } },
    reference: { label: HOSTILE[3], objective: 100 },
    run: { method: "ga", settings: { pop_size: 20 }, budget: 400, seed: 3 },
  });

test("hostile names, labels and units end up only in comments of one line and in string literals", () => {
  const project = hostileProject();
  const script = exportPython(project, runProject(project));
  assert.ok(!/[\r\u0000\u0085\u2028\u2029\u000c]/.test(script), "no raw line end or control character from the texts");
  assert.ok(!/\p{Cs}/u.test(script), "no half of a surrogate pair");
  // take out everything that is a comment or a string literal: no hostile text may remain in code
  // (the ops module is fixed text with a docstring, and another test compares it with its source)
  const body = script.replace(/\ndef make_ops\(\):\n[\s\S]*?\nops = make_ops\(\)\n/, "\n");
  assert.notEqual(body, script);
  let rest = "";
  for (const line of body.split("\n")) {
    let code = "", i = 0;
    while (i < line.length && line[i] !== "#") {
      if (line[i] === '"') {
        const end = /^"(?:[^"\\]|\\.)*"/.exec(line.slice(i));
        assert.ok(end, `a string literal that does not end on its line: ${line}`);
        JSON.parse(end[0]);
        i += end[0].length;
        code += '""';
      } else {
        code += line[i++];
      }
    }
    rest += code + "\n";
  }
  assert.ok(!/SystemExit|exit\(7\)|'|\\/.test(rest), "hostile text outside comments and string literals");
});

// Python takes a comment like "coding: name" in the first two lines of a file as its encoding.
// Under raw_unicode_escape the six plain characters \u000a are a line end, so a name and a
// description there could end their own comment.
const BACKSLASH = String.fromCharCode(92);
const ENCODING = (name: string): Project =>
  small({ name, description: `x ${BACKSLASH}u000araise SystemExit(7)`, objective: { sense: "min", unit: `${BACKSLASH}u000araise SystemExit(7)`, source: "sum(x * x)" } });

test("the first two lines of a script hold no text of the project", () => {
  for (const name of ["coding: raw_unicode_escape", "-*- coding: utf_7 -*-", "Huffman coding: test"]) {
    const project = ENCODING(name);
    const lines = exportPython(project, runProject(project)).split("\n");
    assert.match(lines[0], /^# Exported from YPEA Studio [0-9.]+\. Tested with ypea [0-9.]+, which needs Python 3\.12 or newer\.$/);
    assert.match(lines[1], /^# Install it with: pip install ypea==[0-9.]+$/);
    assert.equal(lines[2], "#");
    assert.equal(lines[3], `# ${name}`);
  }
});

test("comment text is one line whatever it holds", () => {
  for (const text of HOSTILE) assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(comment(text)));
  assert.equal(comment("a\nb\r\n c"), "a b c");
});

test("what is not a valid project or result is refused", () => {
  const project = small();
  const result = runProject(project);
  const bad = (change: (r: any, p: any) => void, message: RegExp) => {
    const r = structuredClone(result) as any, p = structuredClone(project) as any;
    change(r, p);
    assert.throws(() => exportPython(p, r), message);
  };
  bad((r) => (r.method = "os.system"), /unknown solver/);
  bad((r) => (r.method = "constructor"), /unknown solver/);
  bad((r) => (r.settings = { "pop_size=1); import os; (x": 1 }), /no setting/);
  bad((r) => (r.settings.pop_size = "1); import os; (1"), /pop_size/);
  bad((r) => (r.scales = [1]), /scale/);
  bad((r) => (r.seed.base = "1; import os"), /seed/);
  bad((r) => (r.seed.runIndex = 1.5), /seed/);
  bad((r) => (r.evaluations.budget = "9"), /budget/);
  bad((r) => (r.versions.ypeaTested = "0.4.0\nimport os"), /version/);
  bad((r) => (r.versions.app = "1 # x"), /version/);
  bad((_, p) => (p.variables[0].name = "x = 1\nimport os\ny"), /name/);
  bad((_, p) => (p.variables[0].lb = "0); import os; ("), /./);
  bad((_, p) => (p.objective.source = "__import__('os').system('x')"), /./);
  bad((_, p) => (p.objective.source = "sum(x)\nimport os"), /./);
  bad((_, p) => (p.functions = "import os\n"), /./);
  bad((_, p) => (p.constraints = [{ name: "c", left: "x[0]", op: "<= 0 or exit() or 1 <=", right: "1" }]), /./);
  const constrained = small({ constraints: [{ name: "c", left: "x[0]", op: "<=", right: "1" }] });
  const r = structuredClone(runProject(constrained)) as any;
  for (const scale of [0, -1, Infinity, NaN, "1", null]) {
    r.scales = [scale];
    assert.throws(() => exportPython(constrained, r), /scale/);
  }
  // the scales must agree with the constraints that were on: a number for each of those, and null for one that was off
  const off = small({ constraints: [{ name: "c", left: "x[0]", op: "<=", right: "1", enabled: false }, { name: "d", left: "x[1]", op: "<=", right: "1" }] });
  const stored = structuredClone(runProject(off)) as any;
  assert.deepEqual([stored.scales[0], typeof stored.scales[1]], [null, "number"]);
  exportPython(off, stored);
  for (const scales of [[1, stored.scales[1]], [null, null], [stored.scales[1], null], [null]]) {
    assert.throws(() => exportPython(off, { ...stored, scales }), /scale/);
  }
});

test("a script states the rule once, with both tolerances of every constraint", () => {
  const project = small({ constraints: [
    { name: "exact", left: "x[0]", op: "==", right: "1" },
    { name: "fixed", left: "x[0]", op: "==", right: "1", tolerance: 0.5, unit: "m" },
    { name: "relative", left: "x[1]", op: "==", right: "x[2]", relative_tolerance: 0.01 },
    { name: "both", left: "x[1]", op: "==", right: "2", tolerance: 0.25, relative_tolerance: 0.001 },
    { name: "limit", left: "x[2]", op: "<=", right: "4" },
  ] });
  const result = runProject(project), script = exportPython(project, result);
  assert.equal(script.match(/abs\(left - right\) - \(tolerance \+ relative_tolerance \* abs\(right\)\)/g)?.length, 1, "the rule is written in one place");
  assert.ok(script.includes("def gap(op, left, right, tolerance, relative_tolerance):\n"));
  for (const [k, line] of [`("exact", "", "==", 0, 0, `, `("fixed", "m", "==", 0.5, 0, `, `("relative", "", "==", 0, 0.01, `, `("both", "", "==", 0.25, 0.001, `, `("limit", "", "<=", 0, 0, `].entries()) {
    assert.ok(script.includes(`    ${line}${result.scales[k]}),\n`), `missing: ${line}`);
  }
  for (const line of [
    "# exact: left == right",
    "# fixed: left == right, within 0.5, in m",
    "# relative: left == right, within 0.01 times the size of the right side",
    "# both: left == right, within 0.25 plus 0.001 times the size of the right side",
    "# limit: left <= right",
  ]) assert.ok(script.includes(`        ${line}\n`), `missing: ${line}`);
});

test("a constraint that was off is left out of what ypea evaluates and shown as a comment", () => {
  const constraints = [
    { name: "kept", left: "x[0]", op: "<=", right: "1", unit: "m" },
    { name: "switched off", left: "(x[1] +\n x[2])  # two of them", op: "==", right: "100", unit: "kg", tolerance: 0.5, enabled: false },
  ];
  const project = small({ constraints });
  const result = runProject(project), script = exportPython(project, result);
  assert.ok(script.includes("\n# Turned off in the app, so this run does not check them. The result says nothing about them.\n#   switched off: (x[1] + x[2]) # two of them == 100, in kg\n"), script);
  // its text is nowhere else, and ypea gets one constraint
  assert.equal(script.match(/x\[1\]/g)?.length, 1);
  assert.equal(script.match(/^    \("/gm)?.length, 1);
  assert.ok(script.includes(`    ("kept", "m", "<=", 0, 0, ${result.scales[0]}),\n`) && result.scales[1] === null);
  assert.ok(script.includes(`    print("Off in the app, so not checked:")\n    print("  switched off")\n`));

  // with every constraint off, ypea gets the objective alone, as for a project without constraints
  const none = small({ constraints: [constraints[1]] });
  const bare = exportPython(none, runProject(none));
  assert.ok(bare.includes("        objective,\n        sense=\"min\",\n") && !bare.includes("CONSTRAINTS") && !bare.includes("def evaluate"));
  assert.ok(bare.includes("#   switched off: (x[1] + x[2]) # two of them == 100, in kg\n"));
  assert.ok(bare.includes(`    print("Best feasible solution found")\n`) && bare.includes(`    print("  switched off")\n`));
});

const ALL_TYPES = (): Project =>
  small({
    variables: [
      { name: "r0", type: "real", shape: [], lb: -1, ub: 3, unit: "m" },
      { name: "r1", type: "real", shape: [3], lb: [0, -5, 2], ub: [1, 5, 2] },
      { name: "r2", type: "real", shape: [2, 3], lb: [0, 1, 2, 3, 4, 5], ub: 10 },
      { name: "i1", type: "integer", shape: [4], lb: -2, ub: 5 },
      { name: "b1", type: "binary", shape: [6] },
      { name: "b0", type: "binary", shape: [] },
      { name: "p", type: "permutation", n: 7 },
      { name: "s", type: "selection", n: 7, k: 3 },
      { name: "bs", type: "binary_selection", n: 7, k: 3 },
      { name: "part", type: "partition", n: 6, k: 3 },
      { name: "bp", type: "binary_partition", n: 6, k: 3 },
      { name: "fs", type: "fixed_sum", shape: [5], target: 10 },
      { name: "frs", type: "fixed_row_sum", shape: [3, 4], target: [1, 2, 3] },
      { name: "fcs", type: "fixed_column_sum", shape: [3, 4], target: 5 },
    ],
    objective: {
      sense: "min",
      source: "r0 + sum(r1) + ops.sum(r2 * r2) + sum(i1 * i1) + sum(b1) + b0 + p[0] * 3 + sum(s) + sum(bs * ops.arange(7)) + len(part[0]) * 2 + sum(part[1]) +ops.sum(bp[0]) + fs[0] * fs[1] + ops.max(frs) + ops.sum(fcs * fcs)",
    },
  });

test("every variable type becomes its ypea type", () => {
  const project = ALL_TYPES();
  const script = exportPython(project, runProject(project));
  for (const line of [
    `ypea.Real("r0", lb=-1, ub=3),  # m`,
    `ypea.Real("r1", shape=(3,), lb=[0, -5, 2], ub=[1, 5, 2]),`,
    `ypea.Real("r2", shape=(2, 3), lb=[[0, 1, 2], [3, 4, 5]], ub=10),`,
    `ypea.Integer("i1", shape=(4,), lb=-2, ub=5),`,
    `ypea.Binary("b1", shape=(6,)),`,
    `ypea.Binary("b0"),`,
    `ypea.Permutation("p", n=7),`,
    `ypea.Selection("s", n=7, k=3),`,
    `ypea.BinarySelection("bs", n=7, k=3),`,
    `ypea.Partition("part", n=6, k=3),`,
    `ypea.BinaryPartition("bp", n=6, k=3),`,
    `ypea.FixedSum("fs", shape=(5,), target=10, axis=None),`,
    `ypea.FixedSum("frs", shape=(3, 4), target=[1, 2, 3], axis=1),`,
    `ypea.FixedSum("fcs", shape=(3, 4), target=5, axis=0),`,
  ]) assert.ok(script.includes(`            ${line}\n`), `missing: ${line}`);
});

test("every kind of setting is written, with the budget and the seed", () => {
  assert.deepEqual([null, true, false, 3, 0.25, -0, 1e-7, 1e21, 'a"b\\'].map(pythonLiteral), ["None", "True", "False", "3", "0.25", "-0.0", "1e-7", "1e+21", '"a\\"b\\\\"']);
  assert.throws(() => pythonLiteral(Infinity));
  assert.throws(() => pythonLiteral({} as any));

  const de = small({}, { method: "de", settings: { base_vector: "best", crossover_prob: 0.35 }, budget: 321, seed: 4294967295 });
  const script = exportPython(de, runProject(de, { runIndex: 2 }));
  assert.ok(script.includes(`    solver = ypea.DE(\n        pop_size=100,\n        base_vector="best",\n        diff_vectors_count=1,\n        crossover_method="bin",\n        crossover_prob=0.35,\n        beta_min=0.5,\n        beta_max=0.5,\n        max_nfe=321,  # the budget, in evaluations\n    )\n`), script);
  assert.match(script, /^    base_seed = 4294967295 {2}#/m);
  assert.match(script, /^    run_index = 2 {2}#/m);
  assert.ok(script.includes("ypea.StudioRng(ypea.derive_seed(base_seed, run_index))"));

  const cmaes = small({}, { method: "cmaes" });
  assert.ok(exportPython(cmaes, runProject(cmaes)).includes("    solver = ypea.CMAES(\n        pop_size=None,\n        mu=None,\n        sigma0=0.3,\n"));

  // every setting of every solver the app has is written, whatever the list is
  for (const method of Object.values(METHODS)) {
    const project = small({}, { method: method.id });
    const text = exportPython(project, runProject(project));
    assert.ok(text.includes(`    solver = ypea.${method.ypea}(\n`));
    for (const key of Object.keys(method.params)) assert.match(text, new RegExp(`^        ${key}=`, "m"), `${method.id}: ${key}`);
  }
});

test("the solver, settings, budget and seed come from the result, not from the project's run", () => {
  const project = small();
  const result = runProject(small({}, { method: "pso", settings: { w: 0.7 }, budget: 150, seed: 99 }));
  const script = exportPython(project, result);
  assert.ok(script.includes("ypea.PSO(") && script.includes("w=0.7,") && script.includes("max_nfe=150,") && script.includes("base_seed = 99 "));
});

test("a result stored before a setting existed is exported without it, for the ypea release it names", () => {
  const project = small({}, { method: "pso" }), result = runProject(project);
  const { w_final, max_velocity, ...settings } = result.settings;
  assert.deepEqual([w_final, max_velocity], [null, null]);
  const script = exportPython(project, { ...result, settings, versions: { ...result.versions, ypeaTested: "0.5.0" } });
  assert.ok(script.includes("pip install ypea==0.5.0") && script.includes("        c2=2,\n        max_nfe="), script);
  assert.ok(!script.includes("w_final") && !script.includes("max_velocity"));
});

// Names that a project may use and that this file's own code must not trip over.
const COLLIDING = (): Project =>
  small({
    data: [{
      name: "json", kind: "columns", columns: ["os", "sys", "zip", "list", "str", "id", "type", "result", "seed", "best", "main", "gap", "breach", "d", "text", "percent", "relative_tolerance", "mark", "CONSTRAINTS", "tuple", "locals", "types", "getattr", "f", "g", "sides", "left", "right", "name", "unit", "op", "tolerance", "scale", "problem", "solver", "feasible", "lines", "line", "holds", "i", "make_ops_"]
        .map((name, k) => ({ name, values: [k, k + 1, k + 2] })),
    }],
    variables: [{ name: "x", type: "real", shape: [3], lb: -5, ub: 5 }, { name: "constraint_sides", type: "real", shape: [], lb: 0, ub: 1 }],
    functions: "def objective(a):\n    return sum(a * a)\n\ndef evaluate(a, b):\n    return a + b\n\ndef make_ops(a):\n    return a\n",
    objective: { sense: "min", source: "evaluate(objective(x - zip), constraint_sides) + sum(os * sys + id + type + f + g + i) + make_ops(0)" },
    constraints: [
      { name: "first", left: "x[0] + left[0]", op: "<=", right: "right[1] + scale[0] - 30" },
      { name: "second", left: "sum(gap) + x[1]", op: ">=", right: "tolerance[0]", unit: "kg" },
      { name: "third", left: "x[2]", op: "==", right: "constraint_sides", tolerance: 0.5, relative_tolerance: 0.125 },
      { name: "fourth", left: "sum(breach) + percent[0]", op: "<=", right: "relative_tolerance[1] - 500", unit: "kg", enabled: false },
    ],
  });

test("the script's own names move out of the way of the project's names", () => {
  const project = COLLIDING();
  const script = exportPython(project, runProject(project));
  for (const line of ["import json as json_", "import os as os_", "import sys as sys_", "def make_ops__():", "ops = make_ops__()", "def objective_(sol):", "def constraint_sides_(sol):", "def gap_(op, left, right, tolerance, relative_tolerance):", "def breach_(op, left, right, unit):", "def evaluate_(sol):", "CONSTRAINTS_ = [", "def main_():", "    main_()"]) {
    assert.ok(script.includes(`\n${line}\n`), `missing: ${line}`);
  }
});

// An expression may hold comments and, inside brackets, line ends.
const MULTILINE = (): Project =>
  small({
    objective: { sense: "min", source: "\n# the sum of squares\nsum(  # of all three\n  x * x\n)  # done\n" },
    constraints: [
      { name: "a", left: "x[0]  # the first", op: "<=", right: "1" },
      { name: "b", left: "x[1]", op: ">=", right: "(x[0] +\r\n 0.5)" },
    ],
  });

test("an expression with comments or several lines shares no line with the script's own code", () => {
  const project = MULTILINE();
  const script = exportPython(project, runProject(project));
  assert.ok(script.includes("    return (\n        # the sum of squares\n        sum(  # of all three\n          x * x\n        )  # done\n    )\n"), script);
  assert.ok(script.includes("        (\n            (\n                x[0]  # the first\n            ),\n            1,\n        ),\n"), script);
  assert.ok(script.includes("        (\n            x[1],\n            (\n                (x[0] +\n                 0.5)\n            ),\n        ),\n"), script);
});

// ---------------------------------------------------------------------------------------------
// Tests that run the scripts in Python

const PYTHON = [path("../.venv/Scripts/python.exe"), path("../.venv/bin/python")].find((p) => existsSync(p));
/** Why the Python tests cannot run here, or false. */
const SKIP: string | false = (() => {
  if (!PYTHON) return "the project has no .venv folder with Python and ypea (export/README.md says how to create it)";
  const found = spawnSync(PYTHON, ["-c", "import ypea; print(ypea.__version__)"], { encoding: "utf8" });
  if (found.status !== 0) return "the Python in .venv cannot import ypea";
  if (found.stdout.trim() !== YPEA_TESTED) return `the .venv holds ypea ${found.stdout.trim()}, and exports are tested with ${YPEA_TESTED}`;
  return false;
})();

interface PythonRun {
  nfe: number;
  best: { obj_value: unknown; violation: unknown; position: number[]; solution: Record<string, unknown> };
  trace: { nfe: number[]; obj_value: unknown[]; violation: unknown[] };
}

/** Runs a script as `python -`, so that no file is written, and returns what it printed. */
function python(script: string, args: string[] = ["-"], encoding = "utf-8"): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON!, args, { env: { ...process.env, YPEA_STUDIO_JSON: "1", PYTHONIOENCODING: encoding } });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(script);
  });
}

/** ypea writes a float that JSON cannot hold as the text "inf", "-inf" or "nan", and whole numbers and truth values as they are. */
const float = (v: unknown): number => (v === "inf" ? Infinity : v === "-inf" ? -Infinity : v === "nan" ? NaN : Number(v));
const floats = (v: unknown): unknown => (Array.isArray(v) ? v.map(floats) : float(v));

async function runScript(script: string): Promise<{ run: PythonRun; report: string[] }> {
  const { code, stdout, stderr } = await python(script);
  assert.equal(code, 0, `Python stopped with code ${code}:\n${stderr}`);
  assert.equal(stderr, "", "Python wrote warnings or errors");
  const lines = stdout.trimEnd().split(/\r?\n/);
  return { run: JSON.parse(lines.pop()!), report: lines };
}

/** The Python run found the same improvements at the same evaluations and ended on the same solution, bit for bit. */
function assertSameRun(run: PythonRun, result: RunResult) {
  assert.equal(run.nfe, result.evaluations.used, "evaluations used");
  assert.deepEqual(run.trace.nfe, Array.from(result.trace.nfe), "the evaluations that improved the best solution");
  assert.deepEqual(floats(run.trace.obj_value), Array.from(result.trace.objective), "the objective value of every improvement");
  assert.deepEqual(floats(run.trace.violation), Array.from(result.trace.violation), "the violation of every improvement");
  assert.deepEqual(float(run.best.obj_value), result.best.objective, "the best objective value");
  assert.deepEqual(float(run.best.violation), result.best.violation, "the violation of the best solution");
  assert.deepEqual(run.best.position, result.best.codes, "the best position");
  assert.deepEqual(floats(Object.values(run.best.solution)), Object.values(result.best.solution), "the best solution");
  assert.deepEqual(Object.keys(run.best.solution), Object.keys(result.best.solution));
}

/** A number that was printed with `digits` significant digits is `value`, rounded there. */
function assertRounded(text: string, value: number, digits: number, where: string) {
  const printed = Number(text);
  assert.ok(Math.abs(printed - value) <= 0.5 * 10 ** (1 - digits) * Math.abs(value) * (1 + 1e-12), `${text} is not ${value} with ${digits} digits: ${where}`);
  assert.ok(text.replace(/e[+-]?\d+$/, "").replace(/[-.]/g, "").replace(/^0+/, "").length <= digits, `${text} has more than ${digits} digits: ${where}`);
}

/** What the script prints for people agrees with the app's result. */
function assertSameReport(report: string[], project: Project, result: RunResult) {
  const checks = result.best.checks, applied = checks.filter((c) => c.applied), off = checks.filter((c) => !c.applied);
  assert.equal(checks.length, (project.constraints ?? []).length);
  assert.equal(report[0], result.status);
  assert.ok(report.includes(`Evaluations: ${result.evaluations.used} of ${result.evaluations.budget}`), report.join("\n"));
  const start = report.indexOf("Constraints:");
  assert.equal(start >= 0, applied.length > 0);
  // both sides of every constraint that was on, computed again in Python, are the app's numbers
  applied.forEach((c, i) => {
    const line = report[start + 1 + i], at = line.lastIndexOf(c.satisfied ? " (holds)" : " (does not hold): ");
    assert.ok(at > 0, line);
    const [left, right] = line.slice(0, at).split(` ${c.op} `).slice(-2).map((side, k) => float(k ? side.split(" ")[0] : side.split(" ").pop()));
    assert.deepEqual([left, right], [c.left, c.right], `constraint ${i}: ${line}`);
    const tail = line.slice(at);
    if (c.satisfied) return assert.equal(tail, " (holds)", line);
    // the breach in the words of the report: the difference in the unit, and as a percentage of the limit unless that is 0
    const words = breach(c);
    const said = /^ \(does not hold\): (over|short|apart) by (\S+)( .+?)??(?: \((\S+)% of the limit\))?$/.exec(tail);
    if (!Number.isFinite(c.difference)) return assert.equal(tail, " (does not hold): a side is not a number", line);
    assert.ok(said, line);
    assert.equal(said[1], { "<=": "over", ">=": "short", "==": "apart" }[c.op], line);
    assert.ok(words.toLowerCase().startsWith(`${said[1]} by `), `${words} against: ${line}`);
    assertRounded(said[2], Math.abs(c.difference!), 6, line);
    assert.equal(said[3] ?? "", c.unit ? ` ${c.unit}` : "", line);
    assert.equal(said[4] !== undefined, c.differencePercent !== undefined, line);
    assert.equal(said[4] !== undefined, words.endsWith("% of the limit)"), `${words} against: ${line}`);
    if (said[4] !== undefined) assertRounded(said[4], c.differencePercent!, 3, line);
  });
  // the constraints that were off are named, and nothing is said about whether they hold
  const offAt = report.indexOf("Off in the app, so not checked:");
  assert.equal(offAt >= 0, off.length > 0);
  if (off.length) assert.deepEqual(report.slice(offAt + 1, offAt + 1 + off.length), off.map((c) => `  ${c.name}`));
  if (off.length) assert.equal(report.filter((line) => /\((holds|does not hold)/.test(line)).length, applied.length);
}

// CMA-ES: the best value so far as a relative difference, with the bounds of engine/methods/cmaes.test.ts.
const CMAES_BOUNDS = [[500, 1e-10], [1000, 1e-8], [2000, 1e-6]];
function assertCloseRun(run: PythonRun, result: RunResult, diagnostic: (text: string) => void) {
  assert.equal(run.nfe, result.evaluations.used, "evaluations used");
  const bestAt = (nfe: number[], f: number[], point: number) => {
    let k = -1;
    while (k + 1 < nfe.length && nfe[k + 1] <= point) k++;
    return f[k];
  };
  const relative = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
  const f = floats(run.trace.obj_value) as number[];
  for (const [point, bound] of CMAES_BOUNDS) {
    if (point > run.nfe) continue;
    const a = bestAt(run.trace.nfe, f, point), b = bestAt(result.trace.nfe, result.trace.objective, point);
    assert.ok(relative(a, b) <= bound, `at ${point} evaluations: Python ${a}, the app ${b}, relative difference ${relative(a, b)} is above ${bound}`);
  }
  // no bound is documented for the end of a longer run or for the solution, so these are only reported
  const x = (floats(Object.values(run.best.solution)) as number[][]).flat(), y = (Object.values(result.best.solution) as number[][]).flat();
  diagnostic(`${run.nfe} evaluations: final best value differs by ${relative(float(run.best.obj_value), result.best.objective).toExponential(1)} (relative), ` +
    `the solution by at most ${Math.max(...x.map((v, i) => Math.abs(v - y[i]))).toExponential(1)} (absolute)`);
}

// every test names the reason when it is skipped, so that the summary counts it
describe("in Python, with the pinned ypea", { concurrency: 8 }, () => {
  for (const name of EXAMPLES) {
    test(`example ${name}: the script repeats the app's run`, { skip: SKIP }, async () => {
      const { project, result } = exampleRun(name);
      const { run, report } = await runScript(exportPython(project, result));
      assertSameRun(run, result);
      assertSameReport(report, project, result);
      for (const [what, value] of [["Baseline", result.baseline], ["Reference", result.reference]] as const) {
        assert.equal(report.some((line) => line.startsWith(what)), value !== undefined, `the ${what} line`);
      }
    });
  }

  // every run of the parity cases, with the scales the case lists, as the method tests run them
  for (const file of readdirSync(path("../spec/parity/methods")).filter((f) => f.endsWith(".json")).sort()) {
    for (const run of readJson(`../spec/parity/methods/${file}`).runs) {
      test(`parity run ${run.name}: the script repeats the app's run`, { skip: SKIP }, async (t) => {
        const project = parseProject(structuredClone(run.project));
        const result = runProject(project, { scales: run.scales });
        const got = await runScript(exportPython(project, result));
        if (result.method === "cmaes") assertCloseRun(got.run, result, (text) => t.diagnostic(`${run.name}: ${text}`));
        else assertSameRun(got.run, result);
        assertSameReport(got.report, project, result);
      });
    }
  }

  test("every variable type: the script repeats the app's run", { skip: SKIP }, async () => {
    const project = ALL_TYPES();
    const result = runProject(project);
    assertSameRun((await runScript(exportPython(project, result))).run, result);
  });

  test("a second run of an experiment (run index 1): the script repeats it", { skip: SKIP }, async () => {
    const project = small({ constraints: [{ name: "c", left: "x[0] + x[1]", op: ">=", right: "1", unit: "m" }] }, { method: "de", settings: { pop_size: 20 }, budget: 500 });
    const result = runProject(project, { runIndex: 1 });
    assert.notDeepEqual(result.best.codes, runProject(project).best.codes);
    const { run, report } = await runScript(exportPython(project, result));
    assertSameRun(run, result);
    assertSameReport(report, project, result);
  });

  test("hostile names, labels and units: nothing of them runs, and the script repeats the app's run", { skip: SKIP }, async () => {
    const project = hostileProject();
    const result = runProject(project);
    const { run, report } = await runScript(exportPython(project, result));
    assertSameRun(run, result);
    assert.equal(report[0], result.status);
  });

  test("project names that are also names of the script or of Python: the script repeats the app's run", { skip: SKIP }, async () => {
    const project = COLLIDING();
    const result = runProject(project);
    const { run, report } = await runScript(exportPython(project, result));
    assertSameRun(run, result);
    assertSameReport(report, project, result);
  });

  test("expressions with comments and several lines: the script repeats the app's run", { skip: SKIP }, async () => {
    const project = MULTILINE();
    const result = runProject(project);
    const { run, report } = await runScript(exportPython(project, result));
    assertSameRun(run, result);
    assertSameReport(report, project, result);
  });

  test("a constraint side that is a truth value counts as 1 or 0, as in the app", { skip: SKIP }, async () => {
    const project = small({ constraints: [{ name: "c", left: "x[0] > 1", op: ">=", right: "x[1] > 0" }] });
    const result = runProject(project);
    assertSameRun((await runScript(exportPython(project, result))).run, result);
  });

  test("a project name that looks like an encoding line: the script, run as a file, repeats the app's run", { skip: SKIP }, async () => {
    // Python reads the encoding line of a file, so this case needs one: a throwaway file in the system's temp folder
    const folder = mkdtempSync(join(tmpdir(), "ypea-studio-export-"));
    try {
      for (const [k, name] of ["coding: raw_unicode_escape", "-*- coding: utf_7 -*-", "Huffman coding: test"].entries()) {
        const project = ENCODING(name);
        const result = runProject(project);
        const file = join(folder, `script${k}.py`);
        writeFileSync(file, exportPython(project, result));
        const { code, stdout, stderr } = await python("", [file]);
        assert.equal(stderr, "", name);
        assert.equal(code, 0, name);
        assertSameRun(JSON.parse(stdout.trimEnd().split(/\r?\n/).pop()!), result);
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("a run that ends without a feasible solution: the script says so, with the same sides", { skip: SKIP }, async () => {
    const project = small({ constraints: [{ name: "out of reach", left: "x[0]", op: ">=", right: "10", unit: "m" }, { name: "fine", left: "x[1]", op: "<=", right: "5" }] });
    const result = runProject(project);
    assert.equal(result.status, "No feasible solution found");
    const { run, report } = await runScript(exportPython(project, result));
    assertSameRun(run, result);
    assertSameReport(report, project, result);
    assert.match(report[report.indexOf("Constraints:") + 1], /^ {2}out of reach: .* >= 10\.0 m \(does not hold\): short by \S+ m \(\S+% of the limit\)$/);
  });

  test("a broken constraint with a limit of zero, and one without a unit: the breach is printed without a percentage", { skip: SKIP }, async () => {
    const project = small({ constraints: [
      { name: "zero", left: "x[0] * x[0] + 3", op: "<=", right: "0", unit: "kg" },
      { name: "apart", left: "x[1]", op: "==", right: "7.5", tolerance: 0.25, relative_tolerance: 0.01 },
      { name: "none", left: "x[2]", op: ">=", right: "x[0] - x[0]" },
      { name: "off", left: "x[2]", op: ">=", right: "100", unit: "m", enabled: false },
    ] });
    const result = runProject(project);
    assert.deepEqual(result.best.checks.map((c) => c.satisfied), [false, false, true, undefined]);
    const { run, report } = await runScript(exportPython(project, result));
    assertSameRun(run, result);
    assertSameReport(report, project, result);
    const at = report.indexOf("Constraints:");
    assert.match(report[at + 1], /^ {2}zero: \S+ <= 0\.0 kg \(does not hold\): over by \S+ kg$/);
    // print leaves a space on each side of the empty unit
    assert.match(report[at + 2], /^ {2}apart: \S+ == 7\.5 {2}\(does not hold\): apart by \S+ \(\S+% of the limit\)$/);
    assert.match(report[at + 3], /^ {2}none: \S+ >= 0\.0 {2}\(holds\)$/);
  });

  test("a unit that the output cannot show, and an output that is not a console, do not stop the script", { skip: SKIP }, async () => {
    const project = small({ objective: { sense: "min", unit: String.fromCharCode(0x3a9, 0x645), source: "sum(x * x)" } });
    const result = runProject(project);
    const script = exportPython(project, result);
    const plain = await python(script, ["-"], "ascii");
    assert.equal(plain.stderr, "");
    assert.equal(plain.code, 0);
    assert.ok(plain.stdout.includes(`Objective: ${result.best.objective} ??`), plain.stdout);
    // an output like the one of a notebook, which has no reconfigure
    const notebook = `import io, sys
out, sys.stdout = sys.stdout, io.StringIO()
exec(compile(sys.stdin.read(), "script", "exec"), {"__name__": "__main__"})
out.write(sys.stdout.getvalue().splitlines()[0])
`;
    const other = await python(script, ["-c", notebook]);
    assert.equal(other.stderr, "");
    assert.equal(other.stdout.trim(), result.status);
  });

  test("nothing in a script takes the place of a Python built-in", { skip: SKIP }, async () => {
    const { project, result } = exampleRun(EXAMPLES.includes("knapsack") ? "knapsack" : EXAMPLES[0]);
    const check = `import builtins, sys
g = {"__name__": "loaded"}
exec(compile(sys.stdin.read(), "script", "exec"), g)
taken = sorted(n for n in g if not n.startswith("__") and hasattr(builtins, n))
assert not taken, taken
assert g["ops"].sum is not sum and g["ops"].round is not round and callable(g["ops"].dot)
print("ok")
`;
    const { code, stdout, stderr } = await python(exportPython(project, result), ["-c", check]);
    assert.equal(stderr, "");
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "ok");
  });
});
