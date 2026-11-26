import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { summarize } from "../engine/compare.ts";
import { parseProject, type Project } from "../engine/project.ts";
import { runProject } from "../engine/run.ts";
import { comparisonCsv, historyCsv, parseResultFile, RESULT_FORMAT, resultJson, solutionCsv, toCsv } from "./data.ts";

const examples = new URL("../examples/", import.meta.url);
const names = readdirSync(examples).filter((f) => f.endsWith(".json"));
const example = (file: string) => parseProject(JSON.parse(readFileSync(new URL(file, examples), "utf8")));
const quick = (project: Project, budget = 300): Project => ({ ...project, run: { ...project.run, budget } });
const impossible = (): Project => {
  const knapsack = quick(example("knapsack.json"));
  return { ...knapsack, constraints: [...knapsack.constraints!, { name: "Impossible", left: "sum(take)", op: "<=", right: "-1" }] };
};

/** A reader of CSV as a spreadsheet reads it: quoted cells may hold commas, quotes and line breaks. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') value += text[++i];
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"' && value === "") quoted = true;
    else if (c === ",") {
      row.push(value);
      value = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      rows.push([...row, value]);
      row = [];
      value = "";
      i++;
    } else value += c;
  }
  assert.equal(value, "", "the text ends with a line break");
  assert.equal(quoted, false);
  return rows;
}

test("CSV: commas, quotes and line breaks in text survive", () => {
  const rows = [["name", "note"], ["a,b", 'say "hi"'], ["two\nlines", "two\r\nlines"], ["plain", ""]];
  const text = toCsv(rows);
  assert.equal(text, 'name,note\r\n"a,b","say ""hi"""\r\n"two\nlines","two\r\nlines"\r\nplain,\r\n');
  assert.deepEqual(readCsv(text), rows);
});

test("CSV: text that a spreadsheet would read as a formula is made plain, and numbers are left alone", () => {
  for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
    const [[got]] = readCsv(toCsv([[`${start}cmd|' /C calc'!A0`]]));
    assert.equal(got, `'${start}cmd|' /C calc'!A0`, JSON.stringify(start));
  }
  assert.equal(toCsv([["=1+1", "@SUM(A1)", "+1", "-1"]]), "'=1+1,'@SUM(A1),'+1,'-1\r\n");
  // the guard comes first, then the quotes
  assert.equal(toCsv([['=HYPERLINK("x","y")']]), `"'=HYPERLINK(""x"",""y"")"\r\n`);
  // a number value is a number, also a negative one. Text that looks like a number is still text.
  assert.equal(toCsv([[-5, -0.25, 1e-7, -1e21, 3]]), "-5,-0.25,1e-7,-1e+21,3\r\n");
  assert.equal(toCsv([["-5", "3"]]), "'-5,3\r\n");
  // no number, and numbers that are not finite, are empty cells
  assert.equal(toCsv([[null, undefined, NaN, Infinity, -Infinity, 0]]), ",,,,,0\r\n");
  // a formula sign that is not at the start is harmless
  assert.equal(toCsv([["a=b", "kg-m"]]), "a=b,kg-m\r\n");
});

test("CSV: hostile names and units of a project cannot become formulas", () => {
  const linefit = quick(example("linefit.json"));
  const project: Project = { ...linefit, variables: linefit.variables.map((v, i) => ({ ...v, unit: i === 0 ? '=cmd|"/C calc"!A0' : "-2+3,\n@x" })), objective: { ...linefit.objective, unit: "+SUM(A1:A9)" } };
  const result = runProject(project);
  const rows = readCsv(solutionCsv(project, result));
  assert.equal(rows[1][3], `'=cmd|"/C calc"!A0`);
  assert.equal(rows[2][3], "'-2+3,\n@x");
  const summary = summarize([{ name: "=1+1", project, results: [result, runProject(project, { runIndex: 1 })] }, { name: '@a,"b"', project, results: [result] }]);
  const table = readCsv(comparisonCsv(summary));
  assert.equal(table[1][0], "'=1+1");
  assert.equal(table[2][0], `'@a,"b"`);
  assert.equal(table[1].at(-1), "'+SUM(A1:A9)");
  // every cell of every table: one that starts with a formula sign is a plain number
  for (const text of [solutionCsv(project, result), historyCsv(result), comparisonCsv(summary)]) {
    for (const value of readCsv(text).flat()) if (/^[=+\-@\t\r]/.test(value)) assert.match(value, /^-\d+(\.\d+)?(e[+-]\d+)?$/, value);
  }
});

test("the solution table gives a position for every shape of value", () => {
  // one number, a list, a table and groups, in a hand-made result
  const project = {
    variables: [
      { name: "gain", type: "real", shape: [], lb: 0, ub: 1, unit: "kPa/V" },
      { name: "x", type: "real", shape: [3], lb: -9, ub: 9 },
      { name: "plan", type: "integer", shape: [2, 2], lb: 0, ub: 9, unit: "h" },
      { name: "routes", type: "partition", n: 4, k: 3 },
    ],
  } as unknown as Project;
  const result = { best: { solution: { gain: 0.5, x: [1, -2.5, 3], plan: [[1, 2], [3, 4]], routes: [[2, 0], [], [3, 1]] } } } as any;
  assert.deepEqual(readCsv(solutionCsv(project, result)), [
    ["variable", "position", "value", "unit"],
    ["gain", "", "0.5", "kPa/V"],
    ["x", "0", "1", ""],
    ["x", "1", "-2.5", ""],
    ["x", "2", "3", ""],
    ["plan", "0 0", "1", "h"],
    ["plan", "0 1", "2", "h"],
    ["plan", "1 0", "3", "h"],
    ["plan", "1 1", "4", "h"],
    ["routes", "0 0", "2", ""],
    ["routes", "0 1", "0", ""],
    ["routes", "2 0", "3", ""],
    ["routes", "2 1", "1", ""],
  ]);
});

for (const file of names) {
  test(`${file}: the tables hold the result, and the JSON file reads back`, () => {
    const project = quick(example(file)), result = runProject(project);
    const solution = readCsv(solutionCsv(project, result));
    assert.deepEqual(solution[0], ["variable", "position", "value", "unit"]);
    const flat = project.variables.flatMap((v) => [result.best.solution[v.name]].flat(2) as number[]);
    assert.deepEqual(solution.slice(1).map((row) => Number(row[2])), flat);
    assert.deepEqual(new Set(solution.slice(1).map((row) => row[0])), new Set(project.variables.map((v) => v.name)));

    const history = readCsv(historyCsv(result));
    assert.deepEqual(history[0], ["evaluations", "best_value", "feasible"]);
    assert.deepEqual(history.slice(1).map((row) => Number(row[0])), result.history.nfe);
    assert.deepEqual(history.slice(1).map((row) => Number(row[1])), result.history.best);
    assert.equal(history.at(-1)![2], result.best.feasible ? "yes" : "no");

    const summary = summarize([{ name: "Own solver", project, results: [0, 1, 2].map((runIndex) => runProject(project, { runIndex })) }]);
    const table = readCsv(comparisonCsv(summary));
    assert.equal(table.length, 2);
    assert.deepEqual(table[1].slice(0, 5), ["Own solver", project.run.method, "3", String(summary.experiments[0].feasibleRuns), "300"]);

    const text = resultJson({ project, result, finished: Date.UTC(2026, 10, 26, 9, 5), experiment: "Quick run", comparison: summary });
    const back = parseResultFile(text);
    assert.equal(back.format, RESULT_FORMAT);
    assert.equal(back.version, 1);
    assert.equal(back.finished, "2026-11-26T09:05:00.000Z");
    assert.equal(back.experiment, "Quick run");
    assert.deepEqual(back.versions, result.versions);
    assert.deepEqual(back.project, JSON.parse(JSON.stringify(project)));
    assert.deepEqual(back.result, JSON.parse(JSON.stringify(result)));
    assert.deepEqual(back.comparison, JSON.parse(JSON.stringify(summary)));
    // the definition that was read back gives the same run again
    const again = runProject(back.project, { runIndex: back.result.seed.runIndex, scales: back.result.scales });
    assert.equal(again.best.objective, result.best.objective);
    assert.deepEqual(again.best.solution, result.best.solution);
  });
}

test("a result that is not feasible: the history says so, and the file reads back", () => {
  const project = impossible(), result = runProject(project);
  assert.equal(result.best.feasible, false);
  const history = readCsv(historyCsv(result));
  assert.ok(history.slice(1).every((row) => row[2] === "no"));
  const summary = summarize([{ name: "GA", project, results: [result] }]);
  assert.deepEqual(readCsv(comparisonCsv(summary))[1], ["GA", "ga", "1", "0", "300", "300", "300", "", "", "", "", "$"]);
  const file = parseResultFile(resultJson({ project, result, comparison: summary }));
  assert.equal(file.result.status, "No feasible solution found");
  assert.equal(file.result.best.feasible, false);
  assert.equal("finished" in file, false);
  assert.equal("objective" in file.comparison!.experiments[0], false);
});

test("the file carries the tolerances, which constraints were off, and the breach of every constraint", () => {
  const knapsack = quick(example("knapsack.json"));
  const project = parseProject(JSON.parse(JSON.stringify({ ...knapsack, constraints: [
    ...knapsack.constraints!,
    { name: "Seven items", left: "sum(take)", op: "==", right: "7", tolerance: 1, relative_tolerance: 0.01 },
    { name: "Impossible", left: "sum(take)", op: "<=", right: "-1" },
    { name: "Switched off", left: "sum(take)", op: ">=", right: "40", enabled: false },
  ] })));
  const result = runProject(project), file = parseResultFile(resultJson({ project, result }));
  assert.deepEqual(file.project.constraints!.map((c) => [c.tolerance, c.relative_tolerance, c.enabled]), [[undefined, undefined, undefined], [1, 0.01, undefined], [undefined, undefined, undefined], [undefined, undefined, false]]);
  assert.deepEqual(file.result.best.checks, JSON.parse(JSON.stringify(result.best.checks)));
  assert.deepEqual(file.result.best.checks.map((c) => [c.name, c.applied, c.tolerance, c.relativeTolerance, c.satisfied]), [
    ["Total weight", true, 0, 0, true], ["Seven items", true, 1, 0.01, true], ["Impossible", true, 0, 0, false], ["Switched off", false, 0, 0, undefined]]);
  const impossible = file.result.best.checks[2];
  assert.deepEqual([impossible.excess, impossible.difference, impossible.differencePercent], [impossible.left + 1, impossible.left + 1, (impossible.left + 1) * 100]);
  assert.deepEqual(file.result.best.constraints.map((c) => c.name), ["Total weight", "Seven items", "Impossible"]);
  assert.deepEqual(file.result.scales.map((s) => typeof s), ["number", "number", "number", "object"]);
  assert.equal(file.result.scales[3], null);
  // the file gives the same run again
  const again = runProject(file.project, { scales: file.result.scales });
  assert.deepEqual([again.trace, again.best.codes], [result.trace, result.best.codes]);
  // the tables for a spreadsheet hold the solution and the history, and need nothing from the constraints
  assert.deepEqual(readCsv(solutionCsv(project, result))[0], ["variable", "position", "value", "unit"]);
  assert.deepEqual(readCsv(historyCsv(result))[0], ["evaluations", "best_value", "feasible"]);
});

test("a result file stored before the tolerances and the switch existed still reads back", () => {
  const project = impossible(), result = runProject(project);
  const old = JSON.parse(resultJson({ project, result }));
  delete old.result.best.checks;
  const file = parseResultFile(JSON.stringify(old));
  assert.equal(file.result.best.checks, undefined);
  assert.deepEqual(file.result.best.constraints, JSON.parse(JSON.stringify(result.best.constraints)));
  assert.deepEqual(file.result.scales, result.scales);
  assert.deepEqual(readCsv(historyCsv(file.result)), readCsv(historyCsv(result)));
  assert.deepEqual(runProject(file.project, { scales: file.result.scales }).best.codes, result.best.codes);
});

test("a number that is not finite is written as null", () => {
  const project = quick(example("benchmark.json")), result = runProject(project);
  const broken = { ...result, best: { ...result.best, objective: Infinity, violation: NaN } };
  const file = parseResultFile(resultJson({ project, result: broken }));
  assert.equal(file.result.best.objective, null);
  assert.equal(file.result.best.violation, null);
});

test("a file that is not a result is refused", () => {
  const project = quick(example("benchmark.json")), result = runProject(project);
  const good = () => JSON.parse(resultJson({ project, result }));
  assert.throws(() => parseResultFile("not json"), /Result file: it is not JSON/);
  assert.throws(() => parseResultFile({ ...good(), format: "something" }), /"format" must be "ypea-studio-result"/);
  assert.throws(() => parseResultFile({ ...good(), version: 2 }), /version 2 is not supported/);
  assert.throws(() => parseResultFile({ ...good(), project: { format: "ypea-studio-project" } }), /Project file/);
  assert.throws(() => parseResultFile({ ...good(), result: { status: "fine" } }), /"result" is not the result of a run/);
  assert.throws(() => parseResultFile({ ...good(), finished: 5 }), /"finished" must be text/);
  assert.throws(() => parseResultFile(project), /"format" must be/);
});
