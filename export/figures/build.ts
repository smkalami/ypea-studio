// The figures of the app, each built from data alone: the solution drawn as the project's view
// asks (a route, several routes, a fitted line, a selection), the best value during a run, and
// the charts of a comparison. Each comes with a caption that says what is shown and how to read
// it, and with words that carry the same for someone who cannot see it. Nothing is told by
// color alone: routes carry their number, lines of another meaning are dashed, chosen items are
// filled and checked, and every figure with more than one kind of mark has a legend.

import { type Comparison, feasibleAt } from "../../engine/compare.ts";
import { buildCurve, type PlainSolution, type Project } from "../../engine/project.ts";
import type { RunResult } from "../../engine/run.ts";
import { count, show } from "../report-html.ts";
import { type Figure, type Paint, pathOf, seriesStyle, type Shape, type Words } from "./figure.ts";
import { everyNth, LabelPlacer, type Mark, type Placed, type Segment, textWidth } from "./labels.ts";
import { logText, logTicks, niceTicks, tickText, useLog } from "./scale.ts";

const W = 440, LINE = 18;
/** More points than this are not all labeled: every k-th is, so that at most this many labels are drawn. */
export const LABEL_LIMIT = 40;

const numbers = (value: unknown): number[] | undefined => (Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v)) ? value : undefined);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// a stored result is not trusted, so a "number" may be anything
const short = (value: number) => (typeof value === "number" ? show(Number(value.toPrecision(3))) : show(value));
const unitOf = (unit?: string) => (unit ? ` (${unit})` : "");
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const evaluations = (n: number) => plural(n, "evaluation");
/** A text cut to a width, so that a long name from a project cannot leave the figure. */
function fit(text: string, width: number, bold = false): string {
  if (textWidth(text, 12, bold) <= width) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, 12, bold) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

// ---------------------------------------------------------------- axes

/** One axis: its ends and ticks in the space it is drawn in (the values, or their logarithms), and the ticks as text. */
interface Scale { low: number; high: number; ticks: number[]; labels: string[]; f: (v: number) => number }
function linear(low: number, high: number, target = 5): Scale {
  const { ticks, step } = niceTicks(low, high, target);
  return { low: ticks[0], high: ticks.at(-1)!, ticks, labels: ticks.map((t) => tickText(t, step)), f: (v) => v };
}
function logarithmic(low: number, high: number): Scale & { every: number } {
  const ticks = logTicks(low, high);
  return { low: ticks[0], high: ticks.at(-1)!, ticks, labels: ticks.map(logText), f: Math.log10, every: ticks[1] - ticks[0] };
}
const valueScale = (values: number[], target = 5) => (useLog(values) ? logarithmic(Math.min(...values), Math.max(...values)) : linear(Math.min(...values), Math.max(...values), target));

/** Where the plot starts, so that the widest tick label of the value axis fits before it. */
const leftOf = (y: Scale) => Math.max(44, 27 + Math.max(0, ...y.labels.map((t) => textWidth(t))));

/**
 * The frame of a chart between `top` and `bottom`: both axes with tick marks, tick labels that
 * do not overlap and are not cut, light lines across at the value ticks, and the titles of the
 * axes. The left edge follows the widest tick label, so no label is ever cut there.
 */
function frame(x: Scale, y: Scale, xTitle: string, yTitle: string, top: number, bottom: number, xLabels = true, left = leftOf(y)) {
  const right = W - Math.max(14, textWidth(x.labels.at(-1) ?? "") / 2 + 4);
  const px = (v: number) => left + ((x.f(v) - x.low) / (x.high - x.low)) * (right - left);
  const py = (v: number) => bottom - ((y.f(v) - y.low) / (y.high - y.low)) * (bottom - top);
  const xs = x.ticks.map((t) => left + ((t - x.low) / (x.high - x.low)) * (right - left));
  const ys = y.ticks.map((t) => bottom - ((t - y.low) / (y.high - y.low)) * (bottom - top));
  // every k-th label along the bottom, with the smallest k at which neighbors keep a gap
  let every = 1;
  const widths = x.labels.map((t) => textWidth(t));
  while (every < xs.length && xs.some((at, i) => i % every === 0 && i + every < xs.length && xs[i + every] - at < (widths[i] + widths[i + every]) / 2 + 8)) every++;
  const shapes: Shape[] = [
    ...ys.map((at): Shape => ({ kind: "line", x1: left, x2: right, y1: at, y2: at, stroke: "grid" })),
    { kind: "line", x1: left, x2: right, y1: bottom, y2: bottom, stroke: "axis" },
    { kind: "line", x1: left, x2: left, y1: top, y2: bottom, stroke: "axis" },
    ...ys.flatMap((at, i): Shape[] => [
      { kind: "line", x1: left - 4, x2: left, y1: at, y2: at, stroke: "axis" },
      { kind: "text", x: left - 7, y: at + 4, text: y.labels[i], anchor: "end", tick: "y" },
    ]),
    ...xs.flatMap((at, i): Shape[] => [
      { kind: "line", x1: at, x2: at, y1: bottom, y2: bottom + 4, stroke: "axis" },
      ...(xLabels && i % every === 0 ? [{ kind: "text", x: at, y: bottom + 17, text: x.labels[i], anchor: "middle", tick: "x" } as Shape] : []),
    ]),
    ...(xLabels && xTitle ? [{ kind: "text", x: (left + right) / 2, y: bottom + 35, text: fit(xTitle, right - left), anchor: "middle", fill: "ink" } as Shape] : []),
    ...(yTitle ? [{ kind: "text", x: 14, y: (top + bottom) / 2, text: fit(yTitle, bottom - top + 16), anchor: "middle", fill: "ink", turned: true } as Shape] : []),
  ];
  return { shapes, px, py, left, right };
}

// ---------------------------------------------------------------- legends

interface Entry { text: string; width: number; swatch: (x: number, y: number) => Shape[]; series?: number }
const lineEntry = (text: string, stroke: Paint, width: number, dash?: string, series?: number): Entry => ({
  text, width: 40, series, swatch: (x, y) => [{ kind: "line", x1: x, x2: x + 40, y1: y, y2: y, stroke, width, dash, cap: dash ? undefined : "round", series }],
});
const dotAt = (cx: number, cy: number): Shape => ({ kind: "circle", cx, cy, r: 3, fill: "ink", stroke: "surface", width: 1.5 });
const squareAt = (cx: number, cy: number, size: number): Shape => ({ kind: "rect", x: cx - size / 2, y: cy - size / 2, w: size, h: size, fill: "surface", stroke: "ink", width: 2 });
const hollowAt = (cx: number, cy: number, r: number): Shape => ({ kind: "circle", cx, cy, r, fill: "surface", stroke: "ink", width: 1.5 });
const checkAt = (cx: number, cy: number): Shape => ({ kind: "path", d: `M${cx - 4},${cy} l3,4 l6,-8`, stroke: "ink", width: 2, cap: "round" });

/** The key of a figure, under it: each row of entries flows from the left and wraps, and each list starts a new row. */
function legend(top: number, rows: Entry[][]): { shapes: Shape[]; bottom: number } {
  const shapes: Shape[] = [];
  let y = top;
  for (const row of rows) {
    let x = 24;
    for (const entry of row) {
      const wide = entry.width + 8 + textWidth(entry.text) + 18;
      if (x > 24 && x + wide - 18 > W - 12) {
        x = 24;
        y += LINE;
      }
      shapes.push(...entry.swatch(x, y + 9), { kind: "text", x: x + entry.width + 8, y: y + 13, text: fit(entry.text, W - 20 - x - entry.width), series: entry.series });
      x += wide;
    }
    y += LINE;
  }
  return { shapes, bottom: y + 6 };
}

// ---------------------------------------------------------------- maps: one route, several routes

const MAP = 300, MARGIN = 30;

/** Points on a map: one scale for both directions, so that distances look as they are. */
function mapScale(xs: number[], ys: number[], rows: number[]) {
  const allX = rows.map((r) => xs[r]), allY = rows.map((r) => ys[r]);
  const minX = Math.min(...allX), minY = Math.min(...allY);
  const spanX = Math.max(...allX) - minX || 1, spanY = Math.max(...allY) - minY || 1;
  const k = Math.min((W - 2 * MARGIN) / spanX, (MAP - 2 * MARGIN) / spanY);
  return {
    k,
    px: (r: number) => MARGIN + (W - 2 * MARGIN - spanX * k) / 2 + (xs[r] - minX) * k,
    py: (r: number) => MAP - MARGIN - (MAP - 2 * MARGIN - spanY * k) / 2 - (ys[r] - minY) * k,
  };
}

/** The bar under a map that says how long a round distance is, with the unit when both directions share one. */
function scaleBar(k: number, unit: string, y: number): { shapes: Shape[]; text: string } {
  const raw = 90 / k, power = 10 ** Math.floor(Math.log10(raw)), value = [5, 2, 1].find((m) => m * power <= raw)! * power;
  const text = `${tickText(value, value)}${unit}`, x = 24, end = x + value * k;
  return {
    text,
    shapes: [
      { kind: "path", d: `M${x},${y - 4} V${y + 4} M${x},${y} H${Math.round(end * 100) / 100} M${Math.round(end * 100) / 100},${y - 4} V${y + 4}`, stroke: "muted" },
      { kind: "text", x: end + 8, y: y + 4, text },
    ],
  };
}

const labelShapes = (label: Placed, extra: Partial<Shape> = {}): Shape[] => [
  ...(label.leader ? [{ kind: "line", x1: label.leader[0], y1: label.leader[1], x2: label.leader[2], y2: label.leader[3], stroke: "muted" } as Shape] : []),
  { kind: "text", x: label.x, y: label.y, text: label.text, halo: true, fill: "ink", ...extra } as Shape,
];

/** What a view says about a table of distances: the table, or nothing when it is not there or does not cover the rows. */
function distances(project: Project, name: string | undefined, rows: number) {
  const table = (project.data ?? []).find((t) => t.kind === "matrix" && t.name === name);
  if (!table || table.kind !== "matrix" || table.values.length < rows || table.values.some((row) => !numbers(row) || row.length < rows)) return undefined;
  return { values: table.values, unit: table.unit ? ` ${table.unit}` : "" };
}
/** The length of a closed tour as the table gives it, leg by leg, as words: four digits, with the unit of the table, or named as a length when the table has none. */
function lengthOf(table: { values: number[][]; unit: string }, nodes: number[]): string {
  const length = show(Number(nodes.reduce((sum, node, n) => sum + table.values[node][nodes[(n + 1) % nodes.length]], 0).toPrecision(4)));
  return table.unit ? `${length}${table.unit}` : `length ${length}`;
}

/** The words about labels that were not drawn, for a caption. Empty when every point has its label. */
function labelNote(total: number, step: number, missing: number, what: string): string {
  return (step > 1 ? ` Only every ${ordinal(step)} ${what} is numbered, because ${count(total)} numbers would not fit.` : "") +
    (missing > 0 ? ` ${plural(missing, "number is", "numbers are")} left out where no free place was found. The solution table has them all.` : "");
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

type AnyView = { kind: string; variable?: string; x?: string; y?: string; depot?: number; distance?: string; expression?: string; size?: string };

/**
 * What a view gives: the figure, or the reason there is none. `words` is a view with too many
 * items to draw, told in words. `misfit` is data that do not fit the view. `unknown` is a kind
 * of view that this code does not know.
 */
export type Drawn = { figure: Figure } | { words: string } | { misfit: true } | { unknown: string } | undefined;
const MISFIT = { misfit: true } as const;

/**
 * The solution drawn as the project's view asks. Undefined when the project has no view.
 */
export function solutionFigure(project: Project, solution: PlainSolution, curve?: number[]): Drawn {
  // a file may hold a kind of view that is newer than this code
  const view = project.view as AnyView | undefined;
  if (!view) return undefined;
  const column = (name?: string) => (project.data ?? []).flatMap((t) => (t.kind === "columns" ? t.columns : [])).find((col) => col.name === name);
  const cx = column(view.x), cy = column(view.y), xs = numbers(cx?.values), ys = numbers(cy?.values);
  const mapUnit = cx?.unit && cx.unit === cy?.unit ? ` ${cx.unit}` : "";

  if (view.kind === "route") {
    const order = numbers(solution[view.variable!]);
    if (!xs || !ys || !order || order.length === 0 || order.some((i) => xs[i] === undefined || ys[i] === undefined)) return MISFIT;
    const { px, py, k } = mapScale(xs, ys, xs.map((_, i) => i));
    const marks: Mark[] = order.map((i) => ({ x: px(i), y: py(i), r: i === order[0] ? 6 : 3 }));
    const segments: Segment[] = order.map((i, n) => [px(i), py(i), px(order[(n + 1) % order.length]), py(order[(n + 1) % order.length])]);
    const placer = new LabelPlacer({ x: 2, y: 2, w: W - 4, h: MAP - 4 }, segments, marks);
    // every k-th point of the trip when there are too many, taken in the order of the data so that labels stay where they are from one solution to the next
    const step = everyNth(order.length, LABEL_LIMIT), at = new Map(order.map((i, n) => [i, n]));
    const wanted = [...order].sort((a, b) => a - b).filter((i) => at.get(i)! % step === 0);
    const labels = wanted.flatMap((i) => placer.place(String(i), [marks[at.get(i)!]]) ?? []);
    const table = distances(project, view.distance, xs.length);
    const length = table ? `, ${lengthOf(table, order)}` : "";
    const bar = scaleBar(k, mapUnit, MAP + 8);
    const key = legend(MAP + 22, [[
      lineEntry(`Round trip, ${plural(order.length, "point")}${length}`, "accent", 2),
      { text: "Start", width: 12, swatch: (x, y) => [squareAt(x + 6, y, 10)] },
      { text: "Point, with its number", width: 8, swatch: (x, y) => [dotAt(x + 4, y)] },
    ]]);
    const words = `Round trip through ${plural(order.length, "point")}${length}, in this order: ${order.join(", ")}, and back to ${order[0]}.`;
    return {
      figure: {
        width: W, height: key.bottom, title: "Drawing of the route", words,
        caption: [
          `Round trip through ${plural(order.length, "point")}, placed by `, { code: view.x! }, " and ", { code: view.y! }, ` on one scale for both directions (the bar is ${bar.text} long). The square is where the trip starts, at point ${order[0]}. The numbers are the positions of the points, and the order of the trip is in the solution table.`,
          ...(table ? [" The length is read from the data table ", { code: view.distance! }, "."] : []),
          labelNote(order.length, step, wanted.length - labels.length, "point of the trip"),
        ],
        shapes: [
          { kind: "path", d: `${pathOf(order.map((i) => [px(i), py(i)]))} Z`, stroke: "accent", width: 2, cap: "round" },
          ...order.slice(1).map((i) => dotAt(px(i), py(i))),
          squareAt(px(order[0]), py(order[0]), 10),
          ...labels.flatMap((label) => labelShapes(label)),
          ...bar.shapes, ...key.shapes,
        ],
      },
    };
  }

  if (view.kind === "routes") {
    const value = solution[view.variable!], depot = view.depot!;
    const groups = Array.isArray(value) && value.every((g) => numbers(g)) ? (value as number[][]) : undefined;
    // the items skip the row of the depot: item i is row i before it, and row i + 1 from it on
    const row = (item: number) => item + (item >= depot ? 1 : 0);
    if (!xs || !ys || !groups || xs[depot] === undefined || ys[depot] === undefined || groups.flat().some((i) => xs[row(i)] === undefined || ys[row(i)] === undefined)) return MISFIT;
    const { px, py, k } = mapScale(xs, ys, [depot, ...groups.flat().map(row)]);
    // With a table of distances the legend gives the length that the table gives, which is the one an objective built on it uses.
    // Without one it gives no length: a straight-line length could disagree with the result.
    const table = distances(project, view.distance, xs.length);
    const used = groups.flatMap((stops, g) => {
      if (stops.length === 0) return [];
      const nodes = [depot, ...stops.map(row)];
      return [{ g, stops, nodes, text: `Route ${g}: ${plural(stops.length, "stop")}${table ? `, ${lengthOf(table, nodes)}` : ""}` }];
    });
    const empty = groups.length - used.length, items = used.flatMap((r) => r.stops).sort((a, b) => a - b);
    const depotMark: Mark = { x: px(depot), y: py(depot), r: 7 };
    const stopMark = new Map(items.map((i): [number, Mark] => [i, { x: px(row(i)), y: py(row(i)), r: 3 }]));
    const segmentsOf = (nodes: number[]): Segment[] => nodes.map((node, n) => [px(node), py(node), px(nodes[(n + 1) % nodes.length]), py(nodes[(n + 1) % nodes.length])]);
    const placer = new LabelPlacer({ x: 2, y: 2, w: W - 4, h: MAP - 4 }, used.flatMap((r) => segmentsOf(r.nodes)), [depotMark, ...stopMark.values()]);
    const step = everyNth(items.length, LABEL_LIMIT), wanted = items.filter((i) => i % step === 0);
    const stopLabels = wanted.flatMap((i) => placer.place(String(i), [stopMark.get(i)!]) ?? []);
    const depotLabel = placer.place("Depot", [depotMark], true);
    // The name of a route stands beside its line, so that a route is never told by its color alone: at the middle of one of
    // its longest legs, and first of those between two stops, because near the depot the routes run close to each other.
    const routeLabels = used.map((r) => {
      const long = (legs: Segment[]) => legs.sort((a, b) => Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1]));
      const all = segmentsOf(r.nodes), legs = [...long(all.slice(1, -1)), ...long([all[0], ...(all.length > 1 ? [all.at(-1)!] : [])])].slice(0, 5);
      return placer.place(`Route ${r.g}`, legs.map(([x1, y1, x2, y2]) => ({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, r: 2 })), true);
    });
    const unlabeled = routeLabels.filter((label) => !label).length;
    const bar = scaleBar(k, mapUnit, MAP + 8);
    const key = legend(MAP + 22, [
      [{ text: "Depot", width: 14, swatch: (x, y) => [squareAt(x + 7, y, 12)] }, { text: "Stop, with the number of its item", width: 8, swatch: (x, y) => [dotAt(x + 4, y)] }],
      ...used.map((r) => [lineEntry(r.text, seriesStyle(r.g).paint, 2, seriesStyle(r.g).dash, r.g)]),
    ]);
    const words = `${plural(used.length, "route")} from the depot and back. ${used.map((r) => `${r.text}, in this order: ${r.stops.join(", ")}.`).join(" ")}`;
    return {
      figure: {
        width: W, height: key.bottom, title: "Drawing of the routes", words,
        caption: [
          "Each line is one route: it leaves the depot (the square), visits its stops in order and returns. A route has its own color and, beside its line, its name in bold. The list under the map gives the stops of each route",
          ...(table ? [" and its length, read from the data table ", { code: view.distance! }] : []),
          ". The numbers at the dots are the items of ", { code: view.variable! }, ", placed by ", { code: view.x! }, " and ", { code: view.y! }, ` on one scale for both directions (the bar is ${bar.text} long).`,
          empty > 0 ? ` ${count(empty)} of ${plural(groups.length, "group")} ${empty === 1 ? "is" : "are"} empty and ${empty === 1 ? "is" : "are"} not drawn.` : "",
          labelNote(items.length, step, wanted.length - stopLabels.length, "item"),
          unlabeled > 0 ? ` ${plural(unlabeled, "route has", "routes have")} no name on the map, because no free place was found. The list under the map names every route.` : "",
        ],
        shapes: [
          // Under each line a wider line in the color of the page, so that where two routes cross or leave the depot side by side, each reads as its own line.
          ...used.flatMap((r): Shape[] => {
            const d = `${pathOf(r.nodes.map((node) => [px(node), py(node)]))} Z`, style = seriesStyle(r.g);
            return [{ kind: "path", d, stroke: "surface", width: 5, cap: "round" }, { kind: "path", d, stroke: style.paint, width: 2, dash: style.dash, cap: "round", series: r.g }];
          }),
          ...items.map((i) => dotAt(px(row(i)), py(row(i)))),
          squareAt(depotMark.x, depotMark.y, 12),
          ...stopLabels.flatMap((label) => labelShapes(label)),
          ...(depotLabel ? labelShapes(depotLabel, { bold: true }) : []),
          ...routeLabels.flatMap((label, n) => (label ? labelShapes(label, { bold: true, series: used[n].g }) : [])),
          ...bar.shapes, ...key.shapes,
        ],
      },
    };
  }

  if (view.kind === "line") {
    if (!xs || !ys || xs.length === 0 || xs.length !== ys.length) return MISFIT;
    let line = curve;
    if (!line) {
      try {
        line = buildCurve(project)?.(solution);
      } catch {
        // the expression of the view cannot be computed: the data are drawn without the line
      }
    }
    if (!Array.isArray(line) || line.length !== xs.length) line = undefined;
    const fitted = line ? xs.map((x, i) => ({ x, y: ys[i], on: line[i] })).filter((p) => finite(p.on)).sort((a, b) => a.x - b.x) : [];
    const has = fitted.length > 1, yUnit = cy?.unit ? ` ${cy.unit}` : "";
    const xScale = linear(Math.min(...xs), Math.max(...xs)), yScale = linear(Math.min(...ys, ...fitted.map((p) => p.on)), Math.max(...ys, ...fitted.map((p) => p.on)));
    const xTitle = `${view.x}${unitOf(cx?.unit)}`, yTitle = `${view.y}${unitOf(cy?.unit)}`;
    // With a line, a second panel under the first shows what the first cannot: how far each point is from the line.
    const residuals = fitted.map((p) => p.y - p.on), rScale = linear(Math.min(0, ...residuals), Math.max(0, ...residuals), 3);
    // both panels start at the same place, so that a point and its residual are one above the other
    const left = has ? Math.max(leftOf(yScale), leftOf(rScale)) : leftOf(yScale);
    const main = frame(xScale, yScale, xTitle, yTitle, 14, has ? 204 : 254, !has, left);
    const lower = has ? frame(xScale, rScale, xTitle, `Residual${unitOf(cy?.unit)}`, 226, 322, true, left) : undefined;
    const key = legend(has ? 364 : 296, [[
      { text: "Data", width: 10, swatch: (x, y) => [hollowAt(x + 5, y, 4)] },
      ...(has ? [lineEntry("Fitted line", "accent", 2)] : []),
    ]]);
    const gap = has ? Math.max(...residuals.map(Math.abs)) : undefined;
    const words =
      `${plural(xs.length, "data point")} of ${view.y}${unitOf(cy?.unit)} against ${view.x}${unitOf(cx?.unit)}` +
      (gap !== undefined ? `, with the fitted line. The line is at most ${short(gap)}${yUnit} away from a point. The residuals (data minus line) lie between ${short(Math.min(...residuals))} and ${short(Math.max(...residuals))}${yUnit}.` : ".");
    return {
      figure: {
        width: W, height: key.bottom, title: "Data and fitted line", words,
        caption: [
          words, " Circles are the data",
          ...(has ? [", and the line is ", { code: view.expression! }, `. The lower panel shows each residual, the data value minus the line${cy?.unit ? `, in ${cy.unit}` : ""}, on a scale of its own`] : []),
          ".",
        ],
        shapes: [
          ...main.shapes,
          ...(has ? [{ kind: "path", d: pathOf(fitted.map((p) => [main.px(p.x), main.py(p.on)])), stroke: "accent", width: 2, cap: "round" } as Shape] : []),
          ...xs.map((x, i) => hollowAt(main.px(x), main.py(ys[i]), 4)),
          ...(lower ? [
            ...lower.shapes,
            { kind: "line", x1: lower.left, x2: lower.right, y1: lower.py(0), y2: lower.py(0), stroke: "accent", width: 2 } as Shape,
            ...fitted.flatMap((p): Shape[] => [
              { kind: "line", x1: lower.px(p.x), x2: lower.px(p.x), y1: lower.py(0), y2: lower.py(p.y - p.on), stroke: "muted" },
              hollowAt(lower.px(p.x), lower.py(p.y - p.on), 3),
            ]),
          ] : []),
          ...key.shapes,
        ],
      },
    };
  }

  if (view.kind === "selection") {
    const taken = numbers(solution[view.variable!]);
    if (!taken || taken.length === 0) return MISFIT;
    const sizeColumn = column(view.size), sizes = numbers(sizeColumn?.values);
    const chosen = taken.flatMap((t, i) => (t === 1 ? [i] : []));
    const words = `${count(chosen.length)} of ${plural(taken.length, "item")} are chosen: ${chosen.length ? `positions ${chosen.join(", ")}` : "none"}.`;
    // shortcut: one row of items. Past 80 items the bars are too thin to read, so only the words are shown.
    if (taken.length > 80) return { words };
    const sized = sizes?.length === taken.length ? sizes : undefined, n = taken.length;
    // the positions along the bottom: every one, or every 2nd, 5th, 10th when the numbers would touch
    const top = 30, bottom = sized ? 200 : 70;
    const yScale: Scale = sized ? linear(0, Math.max(...sized, 0)) : { low: 0, high: 1, ticks: [], labels: [], f: (v) => v };
    const xScale = (every: number): Scale => {
      const ticks = Array.from({ length: n }, (_, i) => i).filter((i) => i % every === 0);
      return { low: -0.5, high: n - 0.5, ticks, labels: ticks.map(String), f: (v) => v };
    };
    const probe = frame(xScale(1), yScale, "", "", top, bottom), cell = (probe.right - probe.left) / n;
    const every = [1, 2, 5, 10, 20, 50].find((e) => e * cell >= textWidth(String(n - 1)) + 6)!;
    const plot = frame(xScale(every), yScale, `Item of ${view.variable}, by its position`, sized ? `${view.size}${unitOf(sizeColumn?.unit)}` : "", top, bottom);
    const wide = Math.max(2, Math.min(28, cell * 0.72));
    const key = legend(bottom + 44, [[
      { text: "Chosen", width: 14, swatch: (x, y) => [{ kind: "rect", x, y: y - 6, w: 12, h: 12, rx: 2, fill: "accent", stroke: "accent" }] },
      { text: "Not chosen", width: 14, swatch: (x, y) => [{ kind: "rect", x, y: y - 6, w: 12, h: 12, rx: 2, fill: "surface", stroke: "axis" }] },
    ]]);
    return {
      figure: {
        width: W, height: key.bottom, title: "Chosen items", words,
        caption: [
          words, ` A filled bar${cell >= 10 ? " with a check mark above it" : ""} is a chosen item, and an empty bar is one that is left out.`,
          ...(sized ? [" The height of a bar is its ", { code: view.size! }, `${unitOf(sizeColumn?.unit)}.`] : []),
        ],
        shapes: [
          ...plot.shapes,
          ...taken.flatMap((t, i): Shape[] => {
            const x = plot.px(i), y = sized ? Math.min(plot.py(Math.max(sized[i], 0)), bottom - 3) : top + 12;
            return [
              { kind: "rect", x: x - wide / 2, y, w: wide, h: bottom - y, rx: 2, fill: t === 1 ? "accent" : "surface", stroke: t === 1 ? "accent" : "axis" },
              // a check mark above every chosen item, so that the fill is not the only sign
              ...(t === 1 && cell >= 10 ? [checkAt(x - 1, y - 9)] : []),
            ];
          }),
          ...key.shapes,
        ],
      },
    };
  }

  return { unknown: String(view.kind) };
}

// ---------------------------------------------------------------- the best value during a run

/**
 * The best value at the checkpoints of a run, against evaluations, as a line that moves in
 * steps: the best value holds until the next improvement. Where the best candidate so far
 * breaks a constraint, its value is not a result, so that part is dashed and gray and the
 * legend and the caption say so. `at` marks one checkpoint, for a reader who steps through
 * them. Undefined when the run recorded too few values.
 */
export function historyFigure(result: RunResult, unit: string | undefined, at?: number): Figure | undefined {
  const feasible = feasibleAt(result);
  const points = result.history.nfe.map((n, i) => ({ n, v: result.history.best[i] as number, ok: feasible[i] })).filter((p) => finite(p.v) && typeof p.n === "number");
  if (points.length < 2) return undefined;
  const values = points.map((p) => p.v), yScale = valueScale(values), log = "every" in yScale;
  const budget = result.history.nfe.at(-1)!, suffix = unit ? ` ${unit}` : "";
  const plot = frame(linear(0, budget), yScale, "Evaluations", `Best value${unitOf(unit)}${log ? ", log scale" : ""}`, 14, 254);
  // A step is a result only when the candidates at both of its ends are feasible.
  // consecutive steps of one kind are one line, so that the dashes run on evenly
  const solid = (k: number) => k > 0 && points[k].ok && points[k - 1].ok;
  const xy = (p: { n: number; v: number }) => [Math.round(plot.px(p.n) * 100) / 100, Math.round(plot.py(p.v) * 100) / 100];
  const steps = (wanted: boolean) => points.flatMap((p, k) => (k > 0 && solid(k) === wanted ? [`${k > 1 && solid(k - 1) === wanted ? "" : `M${xy(points[k - 1]).join(",")} `}H${xy(p)[0]} V${xy(p)[1]}`] : [])).join(" ");
  const results = steps(true), others = steps(false);
  const first = points[0], last = points.at(-1)!, since = points.find((p) => p.ok);
  const honest = !since
    ? " No candidate was feasible during this run. The whole line is dashed: its values belong to candidates that break a constraint, and they are not results."
    : since !== first
      ? ` Before ${evaluations(since.n)} the best candidate broke a constraint. That part of the line is dashed, and its values are not results.`
      : "";
  const words = `The best value went from ${show(first.v)}${suffix} after ${evaluations(first.n)} to ${show(last.v)}${suffix} after ${count(last.n)}.${honest}`;
  const key = others ? legend(296, [[
    ...(results ? [lineEntry("Best value so far", "accent", 2)] : []),
    lineEntry("Not a result: the best candidate breaks a constraint", "muted", 2, "6 4"),
  ]]) : { shapes: [], bottom: 300 };
  const probes = points.map((p) => ({ x: xy(p)[0], y: xy(p)[1], text: `After ${evaluations(p.n)}: ${show(p.v)}${suffix}${p.ok ? "" : ", from a candidate that breaks a constraint"}` }));
  const marked = at === undefined ? undefined : probes[at];
  return {
    width: W, height: key.bottom, title: "Best value against evaluations", words, probes,
    caption: [
      words, " The line moves in steps, because the best value stays as it is until a better candidate is found.",
      log ? ` The value axis is logarithmic: each mark is ${count(10 ** (yScale as { every: number }).every)} times the one below it.` : "",
    ],
    shapes: [
      ...plot.shapes,
      ...(results ? [{ kind: "path", d: results, stroke: "accent", width: 2 } as Shape] : []),
      ...(others ? [{ kind: "path", d: others, stroke: "muted", width: 2, dash: "6 4" } as Shape] : []),
      ...(marked ? [{ kind: "line", x1: marked.x, x2: marked.x, y1: 14, y2: 254, stroke: "axis", dash: "2 3" } as Shape, hollowAt(marked.x, marked.y, 4)] : []),
      ...key.shapes,
    ],
  };
}

// ---------------------------------------------------------------- the charts of a comparison

export interface ComparisonChart {
  /** The name of the experiment. */
  name: string;
  /** What the chart says, without the name. */
  words: string;
  /** Nothing when the experiment has no feasible run. */
  figure?: Figure;
}

/**
 * One chart for each experiment of a comparison, all with the same scales so that they can be
 * read side by side: the median of the best value so far as a thick line, and the band between
 * the first and the third quartile. All charts use the one accent color: a color for each
 * experiment would rank them at a glance, which a comparison must not do. Undefined when no
 * experiment has a feasible run.
 */
export function comparisonFigures(comparison: Comparison): ComparisonChart[] | undefined {
  const unit = comparison.unit, suffix = unit ? ` ${unit}` : "";
  const all = comparison.experiments.flatMap((e) => [...e.curve.q1, ...e.curve.median, ...e.curve.q3]).filter(finite);
  if (all.length === 0) return undefined;
  const yScale = valueScale(all, 4), log = "every" in yScale, xScale = linear(0, comparison.budget);
  return comparison.experiments.map((e) => {
    const { nfe, median, q1, q3 } = e.curve;
    const runsText = `Feasible runs: ${e.feasibleRuns} of ${e.runs}.`;
    if (e.feasibleRuns === 0) return { name: e.name, words: `${runsText} No run was feasible, so there is nothing to draw.` };
    const plot = frame(xScale, yScale, "Evaluations", `Best value${unitOf(unit)}${log ? ", log scale" : ""}`, 14, 194);
    const line = (values: (number | null)[]) => pathOf(nfe.flatMap((x, k) => (finite(values[k]) ? [[plot.px(x), plot.py(values[k] as number)]] : [])));
    const both = nfe.flatMap((x, k) => (finite(q1[k]) && finite(q3[k]) ? [k] : []));
    const band = both.length > 1 ? `${pathOf(both.map((k) => [plot.px(nfe[k]), plot.py(q3[k] as number)]))} ${pathOf([...both].reverse().map((k) => [plot.px(nfe[k]), plot.py(q1[k] as number)])).replaceAll("M", "L")} Z` : "";
    const start = median.findIndex(finite), end = median.length - 1;
    const words = start < 0
      ? `${runsText} The median is not a finite number.`
      : `${runsText} The median of the best value went from ${show(median[start])}${suffix} after ${evaluations(nfe[start])} to ${show(median[end])}${suffix} after ${count(nfe[end])}.` +
        (e.objective ? ` At the end the middle half of the feasible runs lies between ${show(e.objective.q1)} and ${show(e.objective.q3)}${suffix}.` : "");
    const key = legend(236, [[
      lineEntry("Median", "accent", 2),
      {
        text: "Middle half of the feasible runs", width: 24,
        swatch: (x, y) => [
          { kind: "path", d: `M${x},${y - 5} h24 v10 h-24 Z`, fill: "band", opacity: 0.16 },
          { kind: "line", x1: x, x2: x + 24, y1: y - 5, y2: y - 5, stroke: "accent" }, { kind: "line", x1: x, x2: x + 24, y1: y + 5, y2: y + 5, stroke: "accent" },
        ],
      },
    ]]);
    return {
      name: e.name, words,
      figure: {
        width: W, height: key.bottom, title: `Best value during the runs of ${e.name}`, words: `${e.name}. ${words}`, caption: [words],
        shapes: [
          ...plot.shapes,
          ...(band ? [{ kind: "path", d: band, fill: "band", opacity: 0.16 } as Shape] : []),
          { kind: "path", d: line(q1), stroke: "accent", width: 1 }, { kind: "path", d: line(q3), stroke: "accent", width: 1 },
          { kind: "path", d: line(median), stroke: "accent", width: 2 },
          ...key.shapes,
        ],
      },
    };
  });
}
