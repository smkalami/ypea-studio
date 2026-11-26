// The drawings of the report, as inline SVG: the solution drawn as the project's view asks, the
// best value during a run, and the charts of a comparison. They follow the drawings of the app.
// Each has its words twice: as the title of the picture, for a screen reader, and under it as a
// caption. Nothing is told by color alone: lines differ by their dashes, chosen items carry a
// check mark, and a part of a line that is not a result is dashed and named in the caption.

import { type Comparison, feasibleAt } from "../engine/compare.ts";
import { buildCurve, type PlainSolution, type Project } from "../engine/project.ts";
import type { RunResult } from "../engine/run.ts";
import { count, html, type Markup, show } from "./report-html.ts";

const W = 440, H = 300, PAD = { left: 64, right: 16, top: 16, bottom: 44 };
// One kind of line per route: solid, long dashes, dots, dash and dot, and two more.
// shortcut: six kinds of line. From the seventh route on they repeat, and only the legend and the stops tell two such routes apart. Add kinds when plans with more routes are common.
const DASHES = ["none", "9 5", "2 5", "12 4 2 4", "5 3", "16 4 2 4 2 4"];

const numbers = (value: unknown): number[] | undefined => (Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v)) ? value : undefined);
// a stored result is not trusted, so a "number" may be anything
const short = (value: number) => (typeof value === "number" ? show(Number(value.toPrecision(3))) : show(value));
const unitOf = (unit?: string) => (unit ? ` (${unit})` : "");
const evaluations = (n: number) => `${count(n)} ${n === 1 ? "evaluation" : "evaluations"}`;
/** A coordinate: two decimals, and never anything but a number. */
const c = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
/** A linear scale from [low, high] to [from, to]. A flat range lands in the middle. */
const scale = (low: number, high: number, from: number, to: number) => (v: number) => (high === low ? (from + to) / 2 : from + ((v - low) / (high - low)) * (to - from));
const path = (points: number[][]) => points.map(([x, y], n) => `${n ? "L" : "M"}${c(x)},${c(y)}`).join(" ");

/** A picture with its words: the title inside the picture and the caption under it. */
function figure(id: string, height: number, words: string, body: Markup, caption: Markup): Markup {
  return html`<figure><div class="figure-box"><svg viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="${id}"><title id="${id}">${words}</title>${body}</svg></div><figcaption>${caption}</figcaption></figure>`;
}

/** The frame of a chart: the two axes with their end values and their titles. */
function axes(x: [number, number], y: [number, number], xTitle: string, yTitle: string, height = H): Markup {
  const left = PAD.left, right = W - PAD.right, top = PAD.top, bottom = height - PAD.bottom;
  return html`<g class="axes" aria-hidden="true">
<line class="grid" x1="${left}" x2="${right}" y1="${top}" y2="${top}"/>
<line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/>
<line x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/>
<text x="${left}" y="${bottom + 16}" text-anchor="start">${short(x[0])}</text>
<text x="${right}" y="${bottom + 16}" text-anchor="end">${short(x[1])}</text>
<text x="${(left + right) / 2}" y="${bottom + 34}" text-anchor="middle" class="title">${xTitle}</text>
<text x="${left - 6}" y="${bottom}" text-anchor="end">${short(y[0])}</text>
<text x="${left - 6}" y="${top + 4}" text-anchor="end">${short(y[1])}</text>
<text transform="translate(14 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" class="title">${yTitle}</text>
</g>`;
}

/** Points on a map: one scale for both directions, so that distances look as they are. */
function mapScale(xs: number[], ys: number[], rows: number[]) {
  const allX = rows.map((r) => xs[r]), allY = rows.map((r) => ys[r]);
  const minX = Math.min(...allX), minY = Math.min(...allY);
  const spanX = Math.max(...allX) - minX || 1, spanY = Math.max(...allY) - minY || 1;
  const k = Math.min((W - 48) / spanX, (H - 48) / spanY);
  return {
    px: (r: number) => 24 + (W - 48 - spanX * k) / 2 + (xs[r] - minX) * k,
    py: (r: number) => H - 24 - (H - 48 - spanY * k) / 2 - (ys[r] - minY) * k,
  };
}

/**
 * The solution drawn as the project's view asks. A sentence instead of a picture when the
 * project has a view that this report cannot draw, or when the stored data do not fit the view.
 */
export function problemDrawing(project: Project, solution: PlainSolution, id: string, curve?: number[]): Markup | undefined {
  // a file may hold a kind of view that is newer than this code
  const view = project.view as { kind: string; variable?: string; x?: string; y?: string; depot?: number; expression?: string; size?: string } | undefined;
  if (!view) return undefined;
  const misfit = html`<p class="note">The drawing of the solution could not be made, because the stored data do not fit the view of the project.</p>`;
  const column = (name?: string) => (project.data ?? []).flatMap((t) => (t.kind === "columns" ? t.columns : [])).find((col) => col.name === name);

  if (view.kind === "route") {
    const xs = numbers(column(view.x)?.values), ys = numbers(column(view.y)?.values), order = numbers(solution[view.variable!]);
    if (!xs || !ys || !order || order.length === 0 || order.some((i) => xs[i] === undefined || ys[i] === undefined)) return misfit;
    const { px, py } = mapScale(xs, ys, xs.map((_, i) => i));
    const words = `Round trip through ${order.length} points, in this order: ${order.join(", ")}, and back to ${order[0]}.`;
    return figure(id, H, words, html`
<path class="mark-line" d="${path(order.map((i) => [px(i), py(i)]))} Z"/>
${order.map((i) => html`<circle class="mark-point" cx="${c(px(i))}" cy="${c(py(i))}" r="3"/>`)}
<rect class="mark-start" x="${c(px(order[0]) - 5)}" y="${c(py(order[0]) - 5)}" width="10" height="10"/>
${order.length <= 40 && order.map((i) => html`<text x="${c(px(i) + 6)}" y="${c(py(i) - 6)}">${i}</text>`)}`,
      html`Round trip through ${order.length} points, placed by <code>${view.x}</code> and <code>${view.y}</code>. The square is where the trip starts, at point ${order[0]}. The numbers are the positions of the points, and the order of the trip is in the solution table.`);
  }

  if (view.kind === "routes") {
    const xs = numbers(column(view.x)?.values), ys = numbers(column(view.y)?.values);
    const value = solution[view.variable!], depot = view.depot!;
    const groups = Array.isArray(value) && value.every((g) => numbers(g)) ? (value as number[][]) : undefined;
    // the items skip the row of the depot: item i is row i before it, and row i + 1 from it on
    const row = (item: number) => item + (item >= depot ? 1 : 0);
    if (!xs || !ys || !groups || xs[depot] === undefined || ys[depot] === undefined || groups.flat().some((i) => xs[row(i)] === undefined || ys[row(i)] === undefined)) return misfit;
    const rows = [depot, ...groups.flat().map(row)];
    const { px, py } = mapScale(xs, ys, rows);
    // Lengths are straight lines between the points. The objective may measure another way (a
    // table of road distances), so the legend says what its number is. A unit only when both columns share it.
    const cx = column(view.x), cy = column(view.y);
    const unit = cx?.unit && cx.unit === cy?.unit ? ` ${cx.unit}` : "";
    const used = groups.flatMap((stops, g) => {
      if (stops.length === 0) return [];
      const nodes = [depot, ...stops.map(row), depot];
      const length = nodes.slice(1).reduce((sum, r, n) => sum + Math.hypot(xs[r] - xs[nodes[n]], ys[r] - ys[nodes[n]]), 0);
      return [{ stops, nodes, text: `Route ${g}: ${stops.length} ${stops.length === 1 ? "stop" : "stops"}, ${short(length)}${unit} in straight lines` }];
    });
    const empty = groups.length - used.length;
    const words = `${used.length} ${used.length === 1 ? "route" : "routes"} from the depot and back. ${used.map((r) => `${r.text}, in this order: ${r.stops.join(", ")}.`).join(" ")}`;
    const LINE = 18, stops = used.flatMap((r) => r.stops);
    return figure(id, H + used.length * LINE + 8, words, html`
${used.map((r, n) => html`<path class="mark-line" stroke-dasharray="${DASHES[n % DASHES.length]}" d="${path(r.nodes.map((node) => [px(node), py(node)]))}"/>
<path class="mark-line" stroke-dasharray="${DASHES[n % DASHES.length]}" d="M24,${H + n * LINE + 8} h56"/>
<text x="90" y="${H + n * LINE + 12}">${r.text}</text>`)}
${stops.map((i) => html`<circle class="mark-point" cx="${c(px(row(i)))}" cy="${c(py(row(i)))}" r="3"/>`)}
<rect class="mark-start" x="${c(px(depot) - 5)}" y="${c(py(depot) - 5)}" width="10" height="10"/>
${rows.length <= 41 && stops.map((i) => html`<text x="${c(px(row(i)) + 6)}" y="${c(py(row(i)) - 6)}">${i}</text>`)}`,
      html`Each kind of line is one route: from the depot (the square) through its stops and back. The stops carry the numbers of the items of <code>${view.variable}</code>, placed by <code>${view.x}</code> and <code>${view.y}</code>. The lengths here are straight lines between the points, which may differ from the objective. ${empty > 0 && `${empty} ${empty === 1 ? "group has" : "groups have"} no stops and no line.`}`);
  }

  if (view.kind === "line") {
    const cx = column(view.x), cy = column(view.y), xs = numbers(cx?.values), ys = numbers(cy?.values);
    if (!xs || !ys || xs.length === 0 || xs.length !== ys.length) return misfit;
    let line = curve;
    if (!line) {
      try {
        line = buildCurve(project)?.(solution);
      } catch {
        // the expression of the view cannot be computed: the data are drawn without the line
      }
    }
    if (!Array.isArray(line) || line.length !== xs.length) line = undefined;
    const drawn = line ? xs.map((x, i) => [x, line[i]]).filter(([, y]) => typeof y === "number" && Number.isFinite(y)).sort((a, b) => a[0] - b[0]) : [];
    const allY = [...ys, ...drawn.map(([, y]) => y)];
    const rangeX: [number, number] = [Math.min(...xs), Math.max(...xs)], rangeY: [number, number] = [Math.min(...allY), Math.max(...allY)];
    const px = scale(...rangeX, PAD.left + 8, W - PAD.right - 8), py = scale(...rangeY, H - PAD.bottom - 8, PAD.top + 8);
    const gaps = line ? xs.map((_, i) => Math.abs(ys[i] - line[i])).filter(Number.isFinite) : [];
    const words =
      `${xs.length} data points of ${view.y}${unitOf(cy?.unit)} against ${view.x}${unitOf(cx?.unit)}` +
      (gaps.length > 0 ? `, with the fitted line. The line is at most ${short(Math.max(...gaps))}${cy?.unit ? ` ${cy.unit}` : ""} away from a point.` : ".");
    return figure(id, H, words, html`
${axes(rangeX, rangeY, `${view.x}${unitOf(cx?.unit)}`, `${view.y}${unitOf(cy?.unit)}`)}
${drawn.length > 1 && html`<path class="mark-line" d="${path(drawn.map(([x, y]) => [px(x), py(y)]))}"/>`}
${xs.map((x, i) => html`<circle class="mark-point hollow" cx="${c(px(x))}" cy="${c(py(ys[i]))}" r="4"/>`)}`,
      html`${words} Circles are the data${drawn.length > 1 && html`, and the line is <code>${view.expression}</code>`}.`);
  }

  if (view.kind === "selection") {
    const taken = numbers(solution[view.variable!]);
    if (!taken || taken.length === 0) return misfit;
    const sizeColumn = column(view.size), sizes = numbers(sizeColumn?.values);
    const chosen = taken.flatMap((t, i) => (t === 1 ? [i] : []));
    const words = `${chosen.length} of ${taken.length} items are chosen: ${chosen.length ? `positions ${chosen.join(", ")}` : "none"}.`;
    const sized = sizes?.length === taken.length ? sizes : undefined;
    const largest = sized ? Math.max(...sized, 0) || 1 : 1;
    const cell = Math.min(36, (W - 16) / taken.length), top = 28, tall = 150;
    const caption = html`${words} A filled bar with a check mark is a chosen item.${sized && html` The height of a bar is its <code>${view.size}</code>${unitOf(sizeColumn?.unit)}.`}`;
    // shortcut: one row of items. Past 80 items the bars are too thin to read, so only the words are shown.
    if (taken.length > 80) return html`<p class="note">${words}</p>`;
    return figure(id, top + tall + 24, words, html`${taken.map((t, i) => {
      const h = sized ? Math.max(4, (Math.max(sized[i], 0) / largest) * tall) : Math.min(cell - 4, 28);
      const x = 8 + i * cell, y = top + tall - h, w = Math.max(cell - 4, 2);
      return html`<rect class="${t === 1 ? "mark-item chosen" : "mark-item"}" x="${c(x)}" y="${c(y)}" width="${c(w)}" height="${c(h)}" rx="2"/>
${t === 1 && html`<path class="mark-check" d="M${c(x + w / 2 - 4)},${c(y - 9)} l3,4 l6,-8"/>`}
${taken.length <= 24 && html`<text x="${c(x + w / 2)}" y="${top + tall + 16}" text-anchor="middle">${i}</text>`}`;
    })}`, caption);
  }

  return html`<p class="note">The project has a drawing of the kind "${view.kind}", which this report cannot draw. The solution is in the table above.</p>`;
}

/** Whether a best value that falls through many powers of ten needs a log scale: on a plain scale it would be flat. */
const needsLog = (low: number, high: number) => low > 0 && high / low > 1000;

/**
 * The history of a run as its chart needs it: the best value at the checkpoints against
 * evaluations, as two lines. Where the best candidate so far breaks a constraint, its value is
 * not a result, and that part is the dashed line. Undefined when the run recorded too few values.
 * The report and the app both draw from this, so they show the same lines and the same words.
 */
export function historyLines(result: RunResult, unit: string | undefined) {
  const feasible = feasibleAt(result);
  const points = result.history.nfe.map((n, i) => ({ n, v: result.history.best[i] as number, ok: feasible[i] })).filter((p) => typeof p.v === "number" && Number.isFinite(p.v) && typeof p.n === "number");
  if (points.length < 2) return undefined;
  const values = points.map((p) => p.v), low = Math.min(...values), high = Math.max(...values);
  const log = needsLog(low, high), f = (v: number) => (log ? Math.log10(v) : v);
  const budget = result.history.nfe.at(-1)!;
  const px = scale(0, budget, PAD.left, W - PAD.right), py = scale(f(low), f(high), H - PAD.bottom, PAD.top);
  // The best value holds until the next improvement, so the line moves in steps. A step is a
  // result only when the candidates at both of its ends are feasible.
  // consecutive steps of one kind are one line, so that the dashes run on evenly
  const solid = (k: number) => k > 0 && points[k].ok && points[k - 1].ok;
  const steps = (wanted: boolean) => points.flatMap((p, k) => (k > 0 && solid(k) === wanted ? [`${k > 1 && solid(k - 1) === wanted ? "" : `M${c(px(points[k - 1].n))},${c(py(f(points[k - 1].v)))} `}H${c(px(p.n))} V${c(py(f(p.v)))}`] : [])).join(" ");
  const first = points[0], last = points.at(-1)!, suffix = unit ? ` ${unit}` : "";
  const since = points.find((p) => p.ok);
  const honest = !since
    ? " No candidate was feasible during this run. The whole line is dashed: its values belong to candidates that break a constraint, and they are not results."
    : since !== first
      ? ` Before ${evaluations(since.n)} the best candidate broke a constraint. That part of the line is dashed, and its values are not results.`
      : "";
  const words = `The best value went from ${show(first.v)}${suffix} after ${evaluations(first.n)} to ${show(last.v)}${suffix} after ${count(last.n)}.${honest}`;
  return { points, low, high, log, budget, px, result: steps(true), notResult: steps(false), words, yTitle: `Best value${unitOf(unit)}${log ? ", log scale" : ""}` };
}

/** The chart of the history of a run. */
export function historyChart(result: RunResult, unit: string | undefined, id: string): Markup {
  const h = historyLines(result, unit);
  if (!h) return html`<p class="note">The run recorded too few values to draw its history.</p>`;
  return figure(id, H, h.words, html`
${axes([0, h.budget], [h.low, h.high], "Evaluations", h.yTitle)}
<path class="mark-line" d="${h.result}"/>
<path class="mark-line not-result" d="${h.notResult}"/>`, html`${h.words}`);
}

/**
 * One chart for each experiment of a comparison, all with the same scales: the median of the
 * best value so far, and the band between the first and the third quartile.
 */
export function comparisonCharts(comparison: Comparison, id: string): Markup {
  const HEIGHT = 240, unit = comparison.unit, suffix = unit ? ` ${unit}` : "";
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const all = comparison.experiments.flatMap((e) => [...e.curve.q1, ...e.curve.median, ...e.curve.q3]).filter(finite);
  if (all.length === 0) return html`<p class="note">No experiment has a feasible run, so there is no chart.</p>`;
  const low = Math.min(...all), high = Math.max(...all), log = needsLog(low, high), f = (v: number) => (log ? Math.log10(v) : v);
  const px = scale(0, comparison.budget, PAD.left, W - PAD.right), py = scale(f(low), f(high), HEIGHT - PAD.bottom, PAD.top);
  return html`<div class="figures">${comparison.experiments.map((e, n) => {
    const { nfe, median, q1, q3 } = e.curve;
    const runsText = `Feasible runs: ${e.feasibleRuns} of ${e.runs}.`;
    if (e.feasibleRuns === 0) return html`<figure><figcaption><strong>${e.name}.</strong> ${runsText} No run was feasible, so there is nothing to draw.</figcaption></figure>`;
    const line = (values: (number | null)[]) => path(nfe.flatMap((x, k) => (finite(values[k]) ? [[px(x), py(f(values[k] as number))]] : [])));
    const both = nfe.flatMap((x, k) => (finite(q1[k]) && finite(q3[k]) ? [k] : []));
    const band = both.length > 1 ? `${path(both.map((k) => [px(nfe[k]), py(f(q3[k] as number))]))} ${path([...both].reverse().map((k) => [px(nfe[k]), py(f(q1[k] as number))])).replaceAll("M", "L")} Z` : "";
    const start = median.findIndex(finite), end = median.length - 1;
    const words = start < 0
      ? `${runsText} The median is not a finite number.`
      : `${runsText} The median of the best value went from ${show(median[start])}${suffix} after ${evaluations(nfe[start])} to ${show(median[end])}${suffix} after ${count(nfe[end])}.` +
        (e.objective ? ` At the end the middle half of the feasible runs lies between ${show(e.objective.q1)} and ${show(e.objective.q3)}${suffix}.` : "");
    return figure(`${id}-${n}`, HEIGHT, `${e.name}. ${words}`, html`
${axes([0, comparison.budget], [low, high], "Evaluations", `Best value${unitOf(unit)}${log ? ", log scale" : ""}`, HEIGHT)}
${band && html`<path class="band" d="${band}"/>`}
<path class="mark-line thin" d="${line(q1)}"/>
<path class="mark-line thin" d="${line(q3)}"/>
<path class="mark-line" d="${line(median)}"/>
${start >= 0 && html`<circle class="mark-point" cx="${c(px(nfe[end]))}" cy="${c(py(f(median[end] as number)))}" r="3"/>`}`,
      html`<strong>${e.name}.</strong> ${words}`);
  })}</div>`;
}
