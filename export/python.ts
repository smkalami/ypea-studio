// The Python script exporter. It turns a project definition and one result of that project
// into a single Python file that repeats the run with the ypea package: the same solver,
// settings, budget and seed. The mapping follows spec/parity/make_cases.py, which the parity
// cases of the engine are made with.
//
// Everything in a project file and in a stored result is untrusted. The rules here:
// - Names, labels, descriptions and units are written only through `comment` (one line of a
//   comment) or `str` (an escaped string literal). Numbers go through `num`, identifiers
//   through `ident`. Nothing is written with a bare String(x).
// - The code fields (functions, objective, constraint sides) are code by design. They are
//   written as code only after parseProject and buildProblem have accepted the project.
// - The generated code itself calls only print, len, range, abs and float, which no data
//   table, column, variable or function of a project can be named after. Its own names move
//   out of the way of the project's names (`free` below).

import { METHODS, resolveSettings, type SettingValue } from "../engine/methods/index.ts";
import { buildProblem, parseProject, type Project } from "../engine/project.ts";
import type { RunResult } from "../engine/run.ts";
import { OPS_PY } from "./ops_py.ts";

/** What the exporter reads from a result of `runProject`. A stored result has all of it. */
export type ExportedRun = Pick<RunResult, "method" | "settings" | "seed" | "scales" | "versions" | "evaluations"> & {
  best?: { objective?: number | null };
  baseline?: { objective?: number | null };
  reference?: { objective?: number | null };
};

/** The Python version that ypea needs. */
const PYTHON_NEEDED = "3.12";
const WIDTH = 100;

const fail = (message: string): never => {
  throw new Error(`Python export: ${message}`);
};

const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A finite number as a Python literal. JavaScript prints the shortest text that reads back to the same float, and so does Python. */
function num(x: unknown): string {
  if (!isNumber(x)) return fail(`expected a number, got ${typeof x}`);
  return Object.is(x, -0) ? "-0.0" : String(x);
}

function ident(x: unknown): string {
  if (typeof x !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x)) return fail("expected a name made of letters, digits and underscores");
  return x;
}

/** Half of a surrogate pair on its own cannot be written to a file or printed. */
const wellFormed = (text: string) => text.replace(/\p{Cs}/gu, "\uFFFD");

/** Any text as a Python string literal. A JSON string is one: its escapes mean the same in Python. */
function str(x: unknown): string {
  if (typeof x !== "string") return fail("expected text");
  // escaped too: characters that some programs take for a line end
  return JSON.stringify(wellFormed(x)).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Any text as it may appear inside a comment: one line, with nothing that ends a line. */
export function comment(x: unknown): string {
  if (typeof x !== "string") return fail("expected text");
  return wellFormed(x).replace(/[\u0000- \u007f-\u009f\u2028\u2029]+/g, " ").trim();
}

/** A setting value as a Python literal. */
export function pythonLiteral(value: SettingValue): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  return typeof value === "string" ? str(value) : num(value);
}

/** A unit or note as a comment at the end of a line of code. */
const note = (text: string | undefined) => (text !== undefined && comment(text) ? `  # ${comment(text)}` : "");

/** Text as comment lines, wrapped at the width of the file. */
function commentLines(text: string): string[] {
  const lines: string[] = [];
  let line = "#";
  for (const word of comment(text).split(" ")) {
    if (line.length + 1 + word.length > WIDTH && line !== "#") {
      lines.push(line);
      line = "#";
    }
    line += " " + word;
  }
  return line === "#" ? lines : [...lines, line];
}

/** Items separated by commas, in as few lines as fit the width. */
function wrap(items: string[], indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    if (line && indent.length + line.length + 1 + item.length + 1 > WIDTH) {
      lines.push(indent + line);
      line = "";
    }
    line += (line ? " " : "") + item + ",";
  }
  return line ? [...lines, indent + line] : lines;
}

/** A flat list of numbers as a Python list, nested into rows when `shape` is a table. */
function list(values: number[], shape: number[] = []): string {
  if (shape.length < 2) return `[${values.map(num).join(", ")}]`;
  const columns = shape[1];
  return `[${Array.from({ length: shape[0] }, (_, r) => list(values.slice(r * columns, (r + 1) * columns))).join(", ")}]`;
}

const tuple = (shape: number[]) => `(${shape.map(num).join(", ")}${shape.length === 1 ? "," : ""})`;

/** A data column or matrix as a NumPy float array. */
function dataLines(name: string, values: number[] | number[][], unit: string | undefined): string[] {
  const head = `${ident(name)} = np.array([`, tail = `], dtype=float)${note(unit)}`;
  if (!Array.isArray(values[0])) {
    const one = head + (values as number[]).map(num).join(", ") + tail;
    return one.length <= WIDTH ? [one] : [head, ...wrap((values as number[]).map(num), "    "), tail];
  }
  const rows = (values as number[][]).flatMap((row) => {
    const one = `    ${list(row)},`;
    return one.length <= WIDTH ? [one] : ["    [", ...wrap(row.map(num), "        "), "    ],"];
  });
  return [head, ...rows, tail];
}

/** A variable of the project as a call of its ypea type. */
function variableCall(v: Project["variables"][number]): string {
  const name = str(ident(v.name));
  const bound = (b: number | number[], shape: number[]) => (Array.isArray(b) ? list(b, shape) : num(b));
  switch (v.type) {
    case "real":
    case "integer":
      return `ypea.${v.type === "real" ? "Real" : "Integer"}(${name}, ${v.shape.length ? `shape=${tuple(v.shape)}, ` : ""}lb=${bound(v.lb, v.shape)}, ub=${bound(v.ub, v.shape)})`;
    case "binary":
      return `ypea.Binary(${name}${v.shape.length ? `, shape=${tuple(v.shape)}` : ""})`;
    case "permutation":
      return `ypea.Permutation(${name}, n=${num(v.n)})`;
    case "selection":
    case "binary_selection":
    case "partition":
    case "binary_partition": {
      const cls = { selection: "Selection", binary_selection: "BinarySelection", partition: "Partition", binary_partition: "BinaryPartition" }[v.type];
      return `ypea.${cls}(${name}, n=${num(v.n)}, k=${num(v.k)})`;
    }
    case "fixed_sum":
    case "fixed_row_sum":
    case "fixed_column_sum": {
      const axis = { fixed_sum: "None", fixed_row_sum: "1", fixed_column_sum: "0" }[v.type];
      return `ypea.FixedSum(${name}, shape=${tuple(v.shape)}, target=${Array.isArray(v.target) ? list(v.target) : num(v.target)}, axis=${axis})`;
    }
    default:
      return fail("unknown variable type");
  }
}

/** A code field with the line ends of this file. Python reads all three kinds of line end alike, and so does the app. */
function code(text: string, where: string): string {
  if (text.includes("\0")) fail(`${where} contains a character that Python cannot read`);
  return wellFormed(text).replace(/\r\n?/g, "\n");
}

/**
 * One expression of the user as lines of code, between `before` and `after`. An expression
 * that has a comment or more than one line goes between parentheses on lines of its own, so
 * that nothing of this file shares a line with it.
 */
function expression(source: string, where: string, indent: string, before: string, after: string): string[] {
  const text = code(source, where).trim();
  if (!/[\n#]/.test(text)) return [`${indent}${before}${text}${after}`];
  return [`${indent}${before}(`, ...text.split("\n").map((line) => `${indent}    ${line}`.trimEnd()), `${indent})${after}`];
}

/**
 * The text of one self-contained Python script that repeats the run `result` of `project`
 * with ypea. `project` is the definition the result was produced from (its snapshot). The
 * solver, its settings, the budget, the seed and the constraint scales come from the result,
 * so the `run` of the project is not read.
 *
 * Throws when the project or the result is not valid, with a message for the user.
 */
export function exportPython(project: Project, result: ExportedRun): string {
  // the checks that make the names safe to write as identifiers and the code fields safe to write as code
  parseProject(project);
  buildProblem(project);

  const method = Object.hasOwn(METHODS, result.method) ? METHODS[result.method] : fail("the result names an unknown solver");
  const settings = resolveSettings(method, result.settings);
  const constraints = project.constraints ?? [];
  const scales = result.scales;
  if (!Array.isArray(scales) || scales.length !== constraints.length || !scales.every((s) => isNumber(s) && s > 0)) {
    fail("the result must hold one positive scale for every constraint");
  }
  const whole = (x: unknown, high: number) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= high;
  const budget = result.evaluations?.budget;
  if (!whole(budget, Number.MAX_SAFE_INTEGER) || budget < 1) fail("the result has no valid budget");
  if (!whole(result.seed?.base, 0xffffffff) || !whole(result.seed?.runIndex, 0xffffffff)) fail("the result has no valid seed");
  const version = (v: unknown) => (typeof v === "string" && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,40}$/.test(v) ? v : fail("the result has no valid version"));
  const appVersion = version(result.versions?.app), ypeaVersion = version(result.versions?.ypeaTested);

  const tables = project.data ?? [];
  const functions = code(project.functions ?? "", "the functions").replace(/^\n+/, "").trimEnd();
  const variables = project.variables.map((v) => ident(v.name));

  // The script's own names at the top level. One that a project already uses gets underscores added.
  const taken = new Set<string>([
    ...tables.flatMap((t) => [t.name, ...(t.kind === "columns" ? t.columns.map((c) => c.name) : [])]),
    ...variables,
    ...Array.from(functions.matchAll(/^def[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm), (m) => m[1]),
  ]);
  const free = (name: string) => {
    while (taken.has(name)) name += "_";
    return name;
  };
  const N = {
    json: free("json"), os: free("os"), sys: free("sys"), makeOps: free("make_ops"), objective: free("objective"),
    sides: free("constraint_sides"), gap: free("gap"), evaluate: free("evaluate"), constraints: free("CONSTRAINTS"), main: free("main"),
  };
  const importLine = (module: string, name: string) => (name === module ? `import ${module}` : `import ${module} as ${name}`);

  const out: string[] = [];
  const add = (...lines: string[]) => void out.push(...lines);
  const section = (title: string) => add("", "", `# ${title}`, "");

  // header
  // Python reads a comment in the first two lines as the encoding of the file when it looks
  // like "coding: name", so no text of the project may stand there. These two lines are fixed.
  add(
    `# Exported from YPEA Studio ${appVersion}. Tested with ypea ${ypeaVersion}, which needs Python ${PYTHON_NEEDED} or newer.`,
    `# Install it with: pip install ypea==${ypeaVersion}`,
    "#",
  );
  const before = out.length;
  if (comment(project.name)) add(...commentLines(project.name));
  if (project.description !== undefined && comment(project.description)) add(...commentLines(project.description));
  if (out.length > before) add("#");
  add(
    "# Running this file repeats the run of the app with the same solver, settings, budget and seed.",
    "# How closely the Python run follows the app:",
    "# - With CMA-ES (ypea.CMAES) the two runs agree within a small tolerance, which grows with the",
    "#   length of the run: about 1e-11 of the best value after 1000 evaluations.",
    "# - With every other solver the two runs are the same, number for number.",
    "# - Functions such as exp, log, sin, cos and tan, a power other than 2, and the square of a single",
    "#   number can differ in the last digit between the two languages. A run that uses them can",
    "#   then take a slightly different path. Write x * x for a square that must be exact.",
    "#",
    `# The solver of this run is ypea.${ident(method.ypea)}.`,
  );
  if (isNumber(result.best?.objective) && whole(result.evaluations.used, Number.MAX_SAFE_INTEGER)) {
    add(`# In the app it gave the objective value ${num(result.best.objective)} after ${num(result.evaluations.used)} evaluations.`);
  }
  add("", importLine("json", N.json), importLine("os", N.os), importLine("sys", N.sys), "", "import numpy as np", "import ypea");

  // ops
  add(
    "", "",
    "# The ops functions of the app. Each one is the NumPy function of the same name. They are made",
    "# inside a function and live only in ops, so that sum, min, max, abs, len and range keep their",
    "# Python meaning in the rest of this file.",
    `def ${N.makeOps}():`,
    // the module's text, indented, with one empty line where a module has two
    ...OPS_PY.trimEnd().replace(/\n{3,}/g, "\n\n").split("\n").map((line) => (line ? `    ${line}` : "")),
    "",
    "    import types",
    "",
    "    return types.SimpleNamespace(**locals())",
    "", "",
    `ops = ${N.makeOps}()`,
  );

  if (tables.length) {
    section("The data");
    tables.forEach((t, i) => {
      if (i) add("");
      add(`# Table ${comment(t.name)}`);
      if (t.kind === "matrix") add(...dataLines(t.name, t.values, t.unit));
      else for (const c of t.columns) add(...dataLines(c.name, c.values, c.unit));
    });
  }

  if (functions) {
    section("The functions, as they are written in the app");
    add(...functions.split("\n"));
  }

  section("The problem");
  const bind = variables.map((name) => `    ${name} = sol.${name}`);
  const sense = project.objective.sense === "max" ? "max" : "min";
  add(
    `def ${N.objective}(sol):`,
    `    # The value to ${sense === "max" ? "maximize" : "minimize"}${comment(project.objective.unit ?? "") ? `, in ${comment(project.objective.unit!)}` : ""}.`,
    ...bind,
    ...expression(project.objective.source, "the objective", "    ", "return ", ""),
  );

  if (constraints.length) {
    add(
      "", "",
      "# Every constraint: its name, its unit, its operator, the tolerance of an == constraint, and its",
      "# scale. The app fixed the scales for this run. They only weigh the constraints against each",
      "# other while the solver compares candidates that break them.",
      `${N.constraints} = [`,
      ...constraints.map((c, i) => `    (${str(c.name)}, ${str(c.unit ?? "")}, ${str(["<=", ">=", "=="].find((op) => op === c.op) ?? fail("unknown operator"))}, ${num(c.tolerance ?? 0)}, ${num(scales[i])}),`),
      "]",
      "", "",
      `def ${N.sides}(sol):`,
      "    # The left side and the right side of every constraint, in the constraint's own unit.",
      ...bind,
      "    return [",
    );
    for (const c of constraints) {
      const unit = comment(c.unit ?? ""), within = c.op === "==" && c.tolerance ? `, within ${num(c.tolerance)}` : "";
      add(`        # ${comment(c.name)}: left ${c.op} right${within}${unit ? `, in ${unit}` : ""}`);
      const left = expression(c.left, `the left side of "${c.name}"`, "            ", "", ",");
      const right = expression(c.right, `the right side of "${c.name}"`, "            ", "", ",");
      if (left.length === 1 && right.length === 1) add(`        (${left[0].trim()} ${right[0].trim().slice(0, -1)}),`);
      else add("        (", ...left, ...right, "        ),");
    }
    add(
      "    ]",
      "", "",
      `def ${N.gap}(op, left, right, tolerance):`,
      "    # How far a constraint is from holding, in its own unit. It holds when this is 0 or less.",
      `    if op == "<=":`,
      "        return left - right",
      `    if op == ">=":`,
      "        return right - left",
      "    return abs(left - right) - tolerance",
      "", "",
      `def ${N.evaluate}(sol):`,
      "    # What ypea calls for every candidate. It returns the objective value and one number g for",
      "    # every constraint: the gap divided by the scale. A constraint holds when its g is 0 or less.",
      `    sides = ${N.sides}(sol)`,
      "    g = []",
      `    for i in range(len(${N.constraints})):`,
      `        name, unit, op, tolerance, scale = ${N.constraints}[i]`,
      `        g.append(${N.gap}(op, float(sides[i][0]), float(sides[i][1]), tolerance) / scale)`,
      `    return ${N.objective}(sol), g`,
    );
  }

  section("The run");
  const objectiveUnit = comment(project.objective.unit ?? "") ? `, ${str(project.objective.unit)}` : "";
  add(
    `def ${N.main}():`,
    "    # a name or a unit that the console cannot show must not stop the script",
    "    try:",
    `        ${N.sys}.stdout.reconfigure(errors="replace")`,
    "    except AttributeError:  # an output without this setting, as in a notebook",
    "        pass",
    "",
    "    problem = ypea.Problem(",
    "        [",
    ...project.variables.map((v) => `            ${variableCall(v)},${note("unit" in v ? v.unit : undefined)}`),
    "        ],",
    `        ${constraints.length ? N.evaluate : N.objective},`,
    `        sense=${str(sense)},`,
    "    )",
    `    solver = ypea.${ident(method.ypea)}(`,
    ...Object.entries(settings).map(([key, value]) => `        ${ident(key)}=${pythonLiteral(value)},`),
    `        max_nfe=${num(budget)},  # the budget, in evaluations`,
    "    )",
    `    base_seed = ${num(result.seed.base)}  # the seed of the experiment in the app`,
    `    run_index = ${num(result.seed.runIndex)}  # which run of the experiment this is, counted from 0`,
    "    seed = ypea.StudioRng(ypea.derive_seed(base_seed, run_index))",
    "    # as in the app, a candidate that divides by zero counts as the worst, without a warning",
    `    with np.errstate(all="ignore"):`,
    "        result = solver.solve(problem, seed=seed)",
    "",
    "    best = result.best.solution",
    "    f = result.best.obj_value",
  );
  if (constraints.length) {
    add(
      "    # both sides of every constraint for the best solution, computed again here",
      `    sides = ${N.sides}(best)`,
      "    feasible = True",
      "    lines = []",
      `    for i in range(len(${N.constraints})):`,
      `        name, unit, op, tolerance, scale = ${N.constraints}[i]`,
      "        left, right = float(sides[i][0]), float(sides[i][1])",
      `        holds = ${N.gap}(op, left, right, tolerance) <= 0`,
      "        feasible = feasible and holds",
      `        mark = "(holds)" if holds else "(does not hold)"`,
      `        lines.append(("  " + name + ":", left, op, right, unit, mark))`,
      `    print("Best feasible solution found" if feasible else "No feasible solution found")`,
    );
  } else {
    add(`    print("Best feasible solution found")`);
  }
  add(
    `    print("Objective:", f${objectiveUnit})`,
    `    print("Solution:")`,
    ...project.variables.map((v) => `    print(${str(`  ${v.name} =`)}, best.${ident(v.name)}${"unit" in v && comment(v.unit ?? "") ? `, ${str(v.unit)}` : ""})`),
  );
  if (constraints.length) add(`    print("Constraints:")`, "    for line in lines:", "        print(*line)");
  add(`    print("Evaluations:", result.nfe, "of", ${num(budget)})`);
  for (const [what, value, label] of [["Baseline", result.baseline, project.baseline?.label], ["Reference", result.reference, project.reference?.label]] as const) {
    if (!value || !isNumber(value.objective)) continue;
    const title = label !== undefined && comment(label) ? `${what} (${wellFormed(label)}):` : `${what}:`;
    add(
      `    # the objective value of the ${what.toLowerCase()}, as the app computed it`,
      `    print(${str(title)}, ${num(value.objective)}${objectiveUnit})`,
      `    print("  This run minus it:", f - ${num(value.objective)})`,
    );
  }
  add(
    "",
    "    # for programs that read the result: set the environment variable YPEA_STUDIO_JSON to get",
    "    # one more line, the whole result as JSON with every digit",
    `    if ${N.os}.environ.get("YPEA_STUDIO_JSON"):`,
    `        print(${N.json}.dumps(result.to_dict()))`,
    "", "",
    `if __name__ == "__main__":`,
    `    ${N.main}()`,
    "",
  );
  return out.join("\n");
}
