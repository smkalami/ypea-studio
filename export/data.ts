// Results as data: one JSON file that can be read back, and CSV tables for a spreadsheet.
//
// The JSON file ("ypea-studio-result", version 1) is one object:
//   format      "ypea-studio-result"
//   version     1
//   versions    { app, ypeaTested }: the app version, and the ypea release its exports were tested with
//   finished    when the run finished, as ISO 8601 text in UTC (absent when not known)
//   experiment  the name of the experiment (absent when not known)
//   project     the project definition as it was when the run started, with the experiment as
//               its `run` (the project format of spec/project-format.md)
//   result      what the engine returned for the run: status, best (objective, violation, feasible,
//               constraints with both sides, solution, codes), baseline, reference, evaluations,
//               history, trace, method, settings, seed (base, runIndex, run), scales, versions, timeMs
//   comparison  the descriptive summary of several experiments (absent when there is none)
// JSON has no way to write a number that is not finite. Such a number (an objective that could
// not be computed, for example) is written as null, and a reader must take null as "no number".
//
// The CSV tables use a comma between cells, CRLF between lines, and double quotes around a cell
// that holds a comma, a double quote or a line break (RFC 4180). They are plain UTF-8 text with
// no byte order mark. A number that is not finite is an empty cell.
//
// Spreadsheet formulas. A spreadsheet reads a cell that starts with "=", "+", "-" or "@" as a
// formula, and names and units come from a project file that a stranger may have shared. So a
// text cell that starts with one of these characters, or with a tab or a carriage return, gets
// an apostrophe in front, which a spreadsheet shows as plain text. Numbers are exempt, negative
// ones too. The two are told apart by their type in the program and never by how they look: a
// cell made from a number value is a number, and a cell made from text is text, also when that
// text looks like a number (a unit written as "-5" becomes "'-5").

import { type Comparison, feasibleAt } from "../engine/compare.ts";
import { parseProject, type Project } from "../engine/project.ts";
import type { RunResult } from "../engine/run.ts";

export const RESULT_FORMAT = "ypea-studio-result";
export const RESULT_FORMAT_VERSION = 1;

export interface ResultFile {
  format: typeof RESULT_FORMAT;
  version: number;
  versions: { app: string; ypeaTested: string };
  finished?: string;
  experiment?: string;
  project: Project;
  /** After reading back, a number that was not finite is null. */
  result: RunResult;
  comparison?: Comparison;
}

export interface ResultExport {
  /** The definition that the run used, with the experiment as its `run`. */
  project: Project;
  result: RunResult;
  /** When the run finished: milliseconds since 1970, a date, or text that `Date` reads. */
  finished?: number | string | Date;
  /** The name of the experiment. */
  experiment?: string;
  comparison?: Comparison;
}

/** The result, the definition that produced it and the versions, as the text of one JSON file. */
export function resultJson(input: ResultExport): string {
  const finished = input.finished === undefined ? undefined : new Date(input.finished);
  const file: ResultFile = {
    format: RESULT_FORMAT,
    version: RESULT_FORMAT_VERSION,
    versions: input.result.versions,
    finished: finished && !Number.isNaN(finished.getTime()) ? finished.toISOString() : undefined,
    experiment: input.experiment,
    project: input.project,
    result: input.result,
    comparison: input.comparison,
  };
  return JSON.stringify(file);
}

/** Reads a result file back, from its text or from parsed JSON. Throws a message for the user when it is not one. */
export function parseResultFile(input: unknown): ResultFile {
  const fail = (message: string): never => {
    throw new Error(`Result file: ${message}`);
  };
  let json = input;
  if (typeof input === "string") {
    try {
      json = JSON.parse(input);
    } catch {
      fail("it is not JSON");
    }
  }
  const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObject(json) || json.format !== RESULT_FORMAT) return fail(`"format" must be "${RESULT_FORMAT}"`);
  if (json.version !== RESULT_FORMAT_VERSION) fail(`version ${json.version} is not supported (this app reads version ${RESULT_FORMAT_VERSION})`);
  parseProject(json.project);
  const r = json.result;
  const numbers = (v: unknown) => Array.isArray(v) && v.every((x) => x === null || typeof x === "number");
  const ok = isObject(r) && typeof r.status === "string" && isObject(r.best) && typeof r.best.feasible === "boolean" && isObject(r.best.solution) &&
    Array.isArray(r.best.constraints) && isObject(r.evaluations) && isObject(r.history) && numbers(r.history.nfe) && numbers(r.history.best) &&
    r.history.nfe.length === r.history.best.length && isObject(r.trace) && numbers(r.trace.nfe) && numbers(r.trace.violation) &&
    typeof r.method === "string" && isObject(r.settings) && isObject(r.seed) && isObject(r.versions);
  if (!ok) fail(`"result" is not the result of a run`);
  for (const key of ["finished", "experiment"]) if (json[key] !== undefined && typeof json[key] !== "string") fail(`"${key}" must be text`);
  if (json.comparison !== undefined && !(isObject(json.comparison) && Array.isArray(json.comparison.experiments))) fail(`"comparison" is not a summary of experiments`);
  return json as ResultFile;
}

/** A cell: a number value is written as a number, and text is guarded and quoted. Nothing, or a number that is not finite, is an empty cell. */
type Cell = number | string | null | undefined;

function cell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows of cells as CSV text. */
export function toCsv(rows: Cell[][]): string {
  return rows.map((row) => `${row.map(cell).join(",")}\r\n`).join("");
}

/**
 * The solution, one value per line: variable, position, value, unit. Positions start at 0. The
 * position is empty for a single number, "3" in a list, and "1 3" (row, then column, with a
 * space between) in a table. For groups it is the group, then the place within the group, and the
 * value is the item. A group with no items has no line.
 */
export function solutionCsv(project: Project, result: RunResult): string {
  const rows: Cell[][] = [["variable", "position", "value", "unit"]];
  for (const v of project.variables) {
    const unit = "unit" in v ? v.unit : undefined;
    const walk = (value: unknown, path: number[]) => {
      if (Array.isArray(value)) value.forEach((inner, i) => walk(inner, [...path, i]));
      else rows.push([v.name, path.length === 1 ? path[0] : path.join(" "), typeof value === "number" ? value : null, unit]);
    };
    walk(result.best.solution[v.name], []);
  }
  return toCsv(rows);
}

/**
 * The history of a run: evaluations, the best value by then, and whether that value belongs to
 * a feasible candidate ("yes" or "no"). A value with "no" is not a result.
 */
export function historyCsv(result: RunResult): string {
  const feasible = feasibleAt(result);
  return toCsv([
    ["evaluations", "best_value", "feasible"],
    ...result.history.nfe.map((n, k) => [n, result.history.best[k], feasible[k] ? "yes" : "no"]),
  ]);
}

/**
 * The descriptive summary, one experiment per line, in the order of the summary. The median, the
 * quartiles and the best value are over the feasible runs only, and they are empty for an
 * experiment with no feasible run.
 */
export function comparisonCsv(comparison: Comparison): string {
  return toCsv([
    ["experiment", "solver", "runs", "feasible_runs", "budget", "evaluations_used_min", "evaluations_used_max", "median", "first_quartile", "third_quartile", "best", "unit"],
    ...comparison.experiments.map((e) => [
      e.name, e.method, e.runs, e.feasibleRuns, e.evaluations.budget, e.evaluations.usedMin, e.evaluations.usedMax,
      e.objective?.median, e.objective?.q1, e.objective?.q3, e.objective?.best, comparison.unit,
    ]),
  ]);
}
