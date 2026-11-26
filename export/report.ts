// The report: one HTML document that holds a result, the definition that produced it, and
// optionally the descriptive summary of several experiments. It is one self-contained file with
// one style block: no script, no font file, no image file and no address of any kind, so it
// opens the same way from a disk, from an email and on paper.
//
// Text safety is the job of report-html.ts: every value is escaped where it is placed, and text
// from the project is never put into an attribute. The page also carries a content security
// policy that forbids scripts and every request, as a second lock behind the escaping.

import type { Comparison } from "../engine/compare.ts";
import { METHODS } from "../engine/methods/index.ts";
import type { DataTable, PlainSolution, Project } from "../engine/project.ts";
import type { RunResult } from "../engine/run.ts";
import { comparisonCharts, historyChart, problemDrawing } from "./report-drawings.ts";
import { count, html, type Markup, show, withUnit } from "./report-html.ts";

export interface ReportInput {
  /** The definition that the run used, with the experiment as its `run`. */
  project: Project;
  result: RunResult;
  /** When the run finished: milliseconds since 1970, a date, or text that `Date` reads. Shown in local time. */
  finished?: number | string | Date;
  /** The name of the experiment. Without it, the name in the project's `run` is used. */
  experiment?: string;
  /** For a project that draws a fitted line: the line of the best solution. Computed here when absent. */
  curve?: number[];
  /** The descriptive summary of several experiments on this project. */
  comparison?: Comparison;
}

/** How many rows and columns of a data table, and how many values of a long list, the report shows. */
const DATA_ROWS = 5, DATA_COLUMNS = 8, LIST_VALUES = 60, LIST_LINES = 30;

// The few values the report needs from the design tokens of the app, copied here because the
// report must be one file that depends on nothing. Light and dark on a screen, light on paper.
// The block holds no text from a project.
const STYLE = html`
:root { color-scheme: light; --ink: #0f172a; --ink-2: #334155; --ink-3: #475569; --line: #e2e8f0; --control-border: #64748b; --surface: #ffffff; --surface-2: #f8fafc; --accent: #2563eb; --accent-ink: #1d4ed8; --success-ink: #15803d; --danger-ink: #b91c1c; --warning-soft: #fffbeb; --warning-line: #fde68a; }
@media screen and (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --ink: #f8fafc; --ink-2: #cbd5e1; --ink-3: #a3b1c6; --line: #243044; --control-border: #64748b; --surface: #0b1220; --surface-2: #111a2e; --accent: #60a5fa; --accent-ink: #60a5fa; --success-ink: #4ade80; --danger-ink: #f87171; --warning-soft: #2a2410; --warning-line: #78350f; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--ink-2); font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 0.875rem; line-height: 1.375rem; }
main { max-inline-size: 60rem; margin-inline: auto; padding: 34px 22px 50px; }
h1, h2, h3 { color: var(--ink); font-weight: 600; }
h1 { margin: 0; font-size: 1.5rem; line-height: 2rem; }
h2 { margin: 34px 0 14px; padding-block-start: 22px; border-block-start: 1px solid var(--line); font-size: 1.25rem; line-height: 1.75rem; }
h3 { margin: 22px 0 8px; font-size: 1rem; line-height: 1.5rem; }
p { max-inline-size: 44rem; margin: 0 0 8px; overflow-wrap: anywhere; }
.lead { margin-block-start: 8px; white-space: pre-line; }
.meta, figcaption, caption, footer { color: var(--ink-3); font-size: 0.8125rem; line-height: 1.25rem; }
.outcome { color: var(--ink); font-size: 1rem; line-height: 1.5rem; font-weight: 600; }
.note { max-inline-size: 44rem; margin-block: 14px; padding: 14px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); }
.note.warning { background: var(--warning-soft); border-color: var(--warning-line); }
.facts { display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr); gap: 4px 22px; margin: 0 0 14px; }
.facts dt { color: var(--ink-3); }
.facts dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.facts .value { font-size: 1.25rem; line-height: 1.75rem; font-weight: 600; }
table { inline-size: 100%; margin-block-end: 14px; border-collapse: collapse; }
th, td { padding: 8px 14px; border-block-end: 1px solid var(--line); text-align: start; vertical-align: top; overflow-wrap: break-word; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { padding-inline-start: 0; }
th:last-child, td:last-child { padding-inline-end: 0; }
thead th { color: var(--ink-3); font-size: 0.8125rem; line-height: 1.25rem; font-weight: 500; }
tbody th { color: var(--ink); font-weight: 500; }
caption { caption-side: top; padding-block-end: 4px; text-align: start; }
.holds, .broken { font-weight: 600; }
.holds { color: var(--success-ink); }
.broken { color: var(--danger-ink); }
code, pre { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.8125rem; font-variant-ligatures: none; }
pre { margin: 0 0 14px; padding: 14px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.lines { margin: 0; padding: 0; list-style: none; }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 27.5rem), 1fr)); gap: 22px; margin-block: 14px; }
figure { min-inline-size: 0; max-inline-size: 34rem; margin: 0; }
.figure-box { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
svg { display: block; inline-size: 100%; min-inline-size: 27.5rem; block-size: auto; }
figcaption { margin-block-start: 4px; }
svg text { font-family: inherit; font-size: 12px; fill: var(--ink-3); }
.axes line { stroke: var(--control-border); stroke-width: 1; }
.axes line.grid { stroke: var(--line); stroke-dasharray: 3 3; }
.axes text.title { fill: var(--ink); }
.mark-line { fill: none; stroke: var(--accent-ink); stroke-width: 2; stroke-linejoin: round; }
.mark-line.thin { stroke-width: 1; }
.mark-line.not-result { stroke: var(--ink-3); stroke-dasharray: 6 4; }
.band { fill: var(--accent); fill-opacity: 0.16; stroke: none; }
.mark-point { fill: var(--ink); stroke: var(--surface); stroke-width: 1.5; }
.mark-point.hollow { fill: var(--surface); stroke: var(--ink); }
.mark-start { fill: var(--surface); stroke: var(--ink); stroke-width: 2; }
.mark-item { fill: var(--surface); stroke: var(--control-border); stroke-width: 1; }
.mark-item.chosen { fill: var(--accent-ink); stroke: var(--accent-ink); }
.mark-check { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
footer { margin-block-start: 34px; padding-block-start: 14px; border-block-start: 1px solid var(--line); }
@media screen and (max-width: 650px) {
  main { padding-inline: 16px; }
  table { display: block; overflow-x: auto; }
  .facts { grid-template-columns: minmax(0, 1fr); }
  .facts dd { margin-block-end: 8px; }
  th, td { padding-inline: 4px; }
}
@page { margin: 16mm; }
@media print {
  main { max-inline-size: none; padding: 0; }
  h1, h2, h3, caption { break-after: avoid; }
  figure, tr, .note, .outcome { break-inside: avoid; }
  thead { display: table-header-group; }
  .definition { break-before: page; }
  .figure-box { overflow: visible; }
  svg { min-inline-size: 0; }
}
`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => String(n).padStart(2, "0");
/** A moment as "November 26, 2026, 09:05", in local time. Undefined when it is not a date. */
function dateText(value: number | string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const time = (ms: unknown) => (typeof ms !== "number" ? "not recorded" : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`);
const solverName = (id: string) => (Object.hasOwn(METHODS, id) ? METHODS[id].name : id);
const OP_WORDS: Record<string, string> = { "<=": "at most", ">=": "at least", "==": "equal to" };

const TYPE_WORDS: Record<string, string> = {
  real: "Decimal numbers within limits",
  integer: "Whole numbers within limits",
  binary: "Yes or no values (0 or 1)",
  permutation: "An ordering of n items",
  selection: "k items picked out of n, in order",
  binary_selection: "Exactly k of n switched on (0 or 1)",
  partition: "Ordered groups (n items in k groups)",
  binary_partition: "Groups without order (n items in k groups), as a table of 0 and 1",
  fixed_sum: "Shares of a fixed total",
  fixed_row_sum: "A table in which every row adds up to a fixed total",
  fixed_column_sum: "A table in which every column adds up to a fixed total",
};

/**
 * The percent change of a result against a comparison value. Only when it means something:
 * the comparison value is not zero and both values have the same sign.
 */
function percentChange(value: number, comparison: number): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(comparison) || comparison === 0 || Math.sign(value) !== Math.sign(comparison)) return undefined;
  return ((value - comparison) / Math.abs(comparison)) * 100;
}

/** How the result stands against a comparison value: the difference in objective units, and a percent change where it means something. */
function difference(value: unknown, other: { objective: unknown; difference: unknown; feasible?: boolean }, sense: "min" | "max", feasible: boolean, unit?: string): string {
  const d = other.difference, o = other.objective;
  if (typeof value !== "number" || typeof o !== "number" || typeof d !== "number" || Number.isNaN(d)) return "Not available";
  // a gap far below the precision of the numbers is rounding, not a better or worse result
  if (Math.abs(d) <= 1e-9 * Math.max(Math.abs(value), Math.abs(o))) return "None: the two values agree";
  const percent = percentChange(value, o);
  // "better" and "worse" are said only of two feasible solutions: a value that breaks a constraint is not a result
  const verdict = !feasible || other.feasible === false ? "" : `, which is ${(d < 0) === (sense === "min") ? "better" : "worse"}`;
  return `${withUnit(d, unit)}${percent === undefined ? "" : ` (${show(Number(Math.abs(percent).toPrecision(3)))}% ${d < 0 ? "lower" : "higher"})`}${verdict}`;
}

/** A value of a variable or of a setting: a number, a list cut after its first values, or rows and groups on lines of their own. */
function valueOf(value: unknown): Markup {
  const list = (v: unknown[]) => (v.length > LIST_VALUES ? `${v.slice(0, LIST_VALUES).map(show).join(", ")}, and ${count(v.length - LIST_VALUES)} more` : v.map(show).join(", "));
  if (!Array.isArray(value)) return html`${show(value)}`;
  if (!value.some(Array.isArray)) return html`${list(value)}`;
  return html`<ul class="lines">${value.slice(0, LIST_LINES).map((row, i) => html`<li>${i}: ${Array.isArray(row) ? (row.length ? list(row) : "empty") : show(row)}</li>`)}${value.length > LIST_LINES && html`<li>and ${count(value.length - LIST_LINES)} more lines</li>`}</ul>`;
}

function dataTable(t: DataTable): Markup {
  if (t.kind === "columns") {
    const rows = t.columns[0]?.values.length ?? 0, columns = t.columns.slice(0, DATA_COLUMNS), shown = Math.min(rows, DATA_ROWS);
    return html`<table>
<caption><code>${t.name}</code>: ${count(rows)} ${rows === 1 ? "row" : "rows"} and ${count(t.columns.length)} ${t.columns.length === 1 ? "column" : "columns"}. ${shown < rows || columns.length < t.columns.length ? `The first ${shown} rows${columns.length < t.columns.length ? ` and ${columns.length} columns` : ""} are shown.` : "All of it is shown."}</caption>
<thead><tr><th scope="col">Row</th>${columns.map((col) => html`<th scope="col"><code>${col.name}</code>${col.unit && ` (${col.unit})`}</th>`)}</tr></thead>
<tbody>${Array.from({ length: shown }, (_, r) => html`<tr><th scope="row">${r}</th>${columns.map((col) => html`<td>${show(col.values[r])}</td>`)}</tr>`)}</tbody>
</table>`;
  }
  const rows = t.values.length, width = t.values[0]?.length ?? 0, shownRows = Math.min(rows, DATA_ROWS), shownColumns = Math.min(width, DATA_COLUMNS);
  return html`<table>
<caption><code>${t.name}</code>: a table of ${count(rows)} rows by ${count(width)} columns${t.unit && `, in ${t.unit}`}. ${shownRows < rows || shownColumns < width ? `The first ${shownRows} rows and ${shownColumns} columns are shown.` : "All of it is shown."}</caption>
<thead><tr><th scope="col">Row</th>${Array.from({ length: shownColumns }, (_, col) => html`<th scope="col">${col}</th>`)}</tr></thead>
<tbody>${t.values.slice(0, shownRows).map((row, r) => html`<tr><th scope="row">${r}</th>${row.slice(0, shownColumns).map((v) => html`<td>${show(v)}</td>`)}</tr>`)}</tbody>
</table>`;
}

function variableRows(project: Project): Markup[] {
  return project.variables.map((v) => {
    const any = v as Record<string, any>;
    const size = "n" in v ? `n = ${any.n}${"k" in v ? `, k = ${any.k}` : ""}` : any.shape.length === 0 ? "One value" : `${any.shape.join(" by ")} values`;
    const limits = v.type === "real" || v.type === "integer" ? html`From ${valueOf(any.lb)} to ${valueOf(any.ub)}` : v.type.startsWith("fixed") ? html`Total ${valueOf(any.target)}` : "";
    return html`<tr><th scope="row"><code>${v.name}</code></th><td>${TYPE_WORDS[v.type] ?? v.type}</td><td>${size}</td><td>${limits}</td><td>${any.unit}</td></tr>`;
  });
}

function solutionText(label: string | undefined, solution: PlainSolution | undefined): Markup {
  return html`${label}${solution && html`<ul class="lines">${Object.entries(solution).map(([name, value]) => html`<li><code>${name}</code> = ${valueOf(value)}</li>`)}</ul>`}`;
}

function comparisonSection(comparison: Comparison): Markup {
  const unit = comparison.unit, runs = comparison.experiments.map((e) => e.runs), same = runs.every((n) => n === runs[0]);
  return html`<section>
<h2>Comparison of experiments</h2>
<p>${same ? `Every experiment was run ${count(runs[0])} ${runs[0] === 1 ? "time" : "times"}` : "The experiments were run several times"}, each run with its own seed and with the same budget of ${count(comparison.budget)} evaluations. The numbers describe these runs. They name no winner and they are not a test of significance: the conclusion is the reader's.</p>
<table>
<caption>The objective is ${comparison.sense === "min" ? "minimized" : "maximized"}${unit && `, in ${unit}`}. The median, the quartiles and the best value are over the feasible runs only, so read them together with the count of feasible runs.</caption>
<thead><tr><th scope="col">Experiment</th><th scope="col">Solver</th><th scope="col">Feasible runs</th><th scope="col">Evaluations used</th><th scope="col">Median</th><th scope="col">First to third quartile</th><th scope="col">Best</th></tr></thead>
<tbody>${comparison.experiments.map((e) => html`<tr>
<th scope="row">${e.name}</th>
<td>${solverName(e.method)}</td>
<td>${e.feasibleRuns} of ${e.runs}</td>
<td>${e.evaluations.usedMin === e.evaluations.usedMax ? count(e.evaluations.usedMax) : `${count(e.evaluations.usedMin)} to ${count(e.evaluations.usedMax)}`} of ${count(e.evaluations.budget)}</td>
${e.objective
    ? html`<td>${withUnit(e.objective.median, unit)}</td><td>${show(e.objective.q1)} to ${withUnit(e.objective.q3, unit)}</td><td>${withUnit(e.objective.best, unit)}</td>`
    : html`<td colspan="3">No numbers, because no run was feasible</td>`}
</tr>`)}</tbody>
</table>
<p class="meta">Quartiles are found by linear interpolation between the sorted values. With few feasible runs they say little.</p>
<h3>Best value during the runs</h3>
<p>In each chart the thick line is the median of the best value so far, and the shaded band between the two thin lines holds the middle half of the feasible runs, from the first to the third quartile. Only runs that end feasible are counted, and each one counts from the evaluation at which it first had a feasible candidate. Before that it counts as worse than every value, so a line starts only where enough runs have a feasible candidate. All charts share the same scales.</p>
${comparisonCharts(comparison, "comparison-chart")}
</section>`;
}

/** The report as the text of one HTML document. */
export function reportHtml(input: ReportInput): string {
  const { project, result, comparison } = input;
  const { best, baseline, reference, seed } = result;
  const { sense, unit } = project.objective;
  const feasible = best.feasible === true;
  const name = project.name || "Untitled project";
  const experiment = input.experiment ?? project.run.name;
  const finished = dateText(input.finished);
  const constraints = project.constraints ?? [];
  let drawing: Markup | undefined;
  try {
    drawing = problemDrawing(project, best.solution, "drawing-title", input.curve);
  } catch {
    drawing = html`<p class="note">The drawing of the solution could not be made from the stored data.</p>`;
  }

  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${name}: report</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>${name}</h1>
${project.description && html`<p class="lead">${project.description}</p>`}
<p class="meta">Report of ${experiment ? `the experiment "${experiment}"` : "one experiment"}. ${finished ? `The run finished on ${finished}.` : "The date of the run was not recorded."} Made with YPEA Studio ${result.versions?.app}, whose exports are tested with ypea ${result.versions?.ypeaTested}.</p>
</header>

<section>
<h2>Result</h2>
<p class="outcome">${feasible ? "Best feasible solution found." : "No feasible solution found."}</p>
${!feasible && html`<p class="note warning"><strong>Not feasible:</strong> the solution below is the candidate that breaks the constraints least. It is not a solution of the problem.</p>`}
<dl class="facts">
<dt>Objective (${sense === "min" ? "minimized" : "maximized"})</dt><dd class="value">${withUnit(best.objective, unit)}${!feasible && " (not feasible)"}</dd>
${baseline && html`<dt>In use today (baseline): ${baseline.label}</dt><dd>${withUnit(baseline.objective, unit)}${baseline.feasible === false && " (it breaks a constraint)"}</dd>
<dt>Difference from what is in use today</dt><dd>${difference(best.objective, baseline, sense, feasible, unit)}</dd>`}
${reference && html`<dt>Known answer (reference): ${reference.label ?? "reference"}</dt><dd>${withUnit(reference.objective, unit)}${reference.feasible === false && " (it breaks a constraint)"}</dd>
<dt>Difference from the known answer</dt><dd>${difference(best.objective, reference, sense, feasible, unit)}</dd>`}
<dt>Evaluations</dt><dd>${count(result.evaluations.used)} of ${count(result.evaluations.budget)}</dd>
<dt>Time</dt><dd>${time(result.timeMs)}</dd>
</dl>
<p class="note">This is one run of a randomized solver (${solverName(result.method)}) with a recorded seed (base seed ${seed.base}, run ${seed.runIndex}). A run with another seed can give a different answer.</p>

${best.constraints.length > 0 && html`<h3>Constraints</h3>
<table>
<thead><tr><th scope="col">Constraint</th><th scope="col">Value</th><th scope="col">Limit</th><th scope="col">Holds</th></tr></thead>
<tbody>${best.constraints.map((k) => html`<tr><th scope="row">${k.name}</th><td>${withUnit(k.left, k.unit)}</td><td>${OP_WORDS[k.op] ?? k.op} ${withUnit(k.right, k.unit)}${k.op === "==" && k.tolerance > 0 && `, within ${withUnit(k.tolerance, k.unit)}`}</td><td class="${k.satisfied === true ? "holds" : "broken"}">${k.satisfied === true ? "Yes" : "No, broken"}</td></tr>`)}</tbody>
</table>`}

<h3>Solution</h3>
<table>
<thead><tr><th scope="col">Variable</th><th scope="col">Value</th><th scope="col">Unit</th></tr></thead>
<tbody>${project.variables.map((v) => html`<tr><th scope="row"><code>${v.name}</code></th><td>${valueOf(best.solution[v.name])}</td><td>${"unit" in v && v.unit}</td></tr>`)}</tbody>
</table>

<h3>Drawings</h3>
<div class="figures">
${drawing}
${historyChart(result, unit, "history-title")}
</div>
</section>

${comparison && comparisonSection(comparison)}

<section class="definition">
<h2>Definition</h2>
<p>This is the project as it was when the run started. Together with the experiment at the end, it is everything needed to run the result again.</p>

<h3>Data</h3>
${(project.data ?? []).length === 0 ? html`<p>The project has no data tables.</p>` : (project.data ?? []).map(dataTable)}

<h3>Variables</h3>
<table>
<thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Limits</th><th scope="col">Unit</th></tr></thead>
<tbody>${variableRows(project)}</tbody>
</table>

<h3>Objective</h3>
<p>${sense === "min" ? "Minimize" : "Maximize"}${unit && `, in ${unit}`}:</p>
<pre><code>${project.objective.source}</code></pre>

<h3>Constraints</h3>
${constraints.length === 0 ? html`<p>The project has no constraints.</p>` : html`<table>
<thead><tr><th scope="col">Constraint</th><th scope="col">As written</th><th scope="col">Unit</th><th scope="col">Scale in this run</th></tr></thead>
<tbody>${constraints.map((k, i) => html`<tr><th scope="row">${k.name}</th><td><code>${k.left} ${k.op} ${k.right}</code>${k.op === "==" && (k.tolerance ?? 0) > 0 && `, within ${show(k.tolerance)}`}</td><td>${k.unit}</td><td>${show(result.scales?.[i])}</td></tr>`)}</tbody>
</table>
<p class="meta">A scale only balances constraints against each other during the search. Whether a constraint holds is always judged in its own unit.</p>`}

<h3>Functions</h3>
${project.functions?.trim() ? html`<pre><code>${project.functions}</code></pre>` : html`<p>The project has no functions.</p>`}

${(project.baseline || project.reference) && html`<h3>Comparison values</h3>
<dl class="facts">
${project.baseline && html`<dt>In use today (baseline)</dt><dd>${solutionText(project.baseline.label, project.baseline.solution)}</dd>`}
${project.reference && html`<dt>Known answer (reference)</dt><dd>${solutionText(project.reference.label, project.reference.solution)}${project.reference.objective !== undefined && html` Objective ${withUnit(project.reference.objective, unit)}`}</dd>`}
</dl>`}

<h3>Experiment</h3>
<dl class="facts">
${experiment && html`<dt>Name</dt><dd>${experiment}</dd>`}
<dt>Solver</dt><dd>${solverName(result.method)} (<code>${result.method}</code>)</dd>
<dt>Budget</dt><dd>${count(result.evaluations.budget)} evaluations</dd>
<dt>Base seed</dt><dd>${seed.base}</dd>
<dt>Run</dt><dd>${seed.runIndex}</dd>
<dt>Seed of this run, derived from the two</dt><dd>${seed.run}</dd>
</dl>
${Object.keys(result.settings ?? {}).length > 0 && html`<table>
<caption>Every setting of the solver in this run, with the defaults that were not changed.</caption>
<thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead>
<tbody>${Object.entries(result.settings).map(([key, value]) => html`<tr><th scope="row"><code>${key}</code></th><td>${value === null ? "chosen by the solver" : show(value)}</td></tr>`)}</tbody>
</table>`}
</section>

<footer>
<p>To get this result again, open the project file in YPEA Studio and run this experiment with the same base seed. The same seed gives the same run in the same version of the app.</p>
</footer>
</main>
</body>
</html>
`;
  return page.text;
}
