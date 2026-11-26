// The drawings: a solution drawn as the project's view asks (a route, a fitted line or a
// selection), and the chart of the best value against evaluations. Inline SVG, each with a
// caption that says in words what the picture shows.

import type { PlainSolution, Project } from "../../engine/project.ts";
import { count, show } from "./draft.ts";
import { columnsOf } from "./presets.ts";

const W = 440, H = 300, PAD = { left: 64, right: 16, top: 16, bottom: 44 };
const numbers = (value: unknown): number[] | undefined => (Array.isArray(value) && value.every((v) => typeof v === "number") ? value : undefined);
const short = (value: number) => show(Number(value.toPrecision(3)));
const unitOf = (unit?: string) => (unit ? ` (${unit})` : "");
// One kind of line per route, so that routes differ by more than color: solid, long dashes, dots, dash and dot, and two more.
// shortcut: six kinds of line. From the seventh route on they repeat, and only the legend and the stops tell two such routes apart. Add kinds, or a mark per route, when plans with more routes are common.
const DASHES = [undefined, "9 5", "2 5", "12 4 2 4", "5 3", "16 4 2 4 2 4"];

/** A linear scale from [low, high] to [from, to]. A flat range lands in the middle. */
const scale = (low: number, high: number, from: number, to: number) => (v: number) => (high === low ? (from + to) / 2 : from + ((v - low) / (high - low)) * (to - from));

/** The frame of a chart: the two axes with their end values and their titles. */
function Axes(props: { x: [number, number]; y: [number, number]; xTitle: string; yTitle: string; yText?: (v: number) => string }) {
  const { x, y, xTitle, yTitle, yText = short } = props;
  const left = PAD.left, right = W - PAD.right, top = PAD.top, bottom = H - PAD.bottom;
  return (
    <g className="axes" aria-hidden="true">
      <line className="grid" x1={left} x2={right} y1={top} y2={top} />
      <line x1={left} x2={right} y1={bottom} y2={bottom} />
      <line x1={left} x2={left} y1={top} y2={bottom} />
      <text x={left} y={bottom + 16} textAnchor="start">{short(x[0])}</text>
      <text x={right} y={bottom + 16} textAnchor="end">{short(x[1])}</text>
      <text x={(left + right) / 2} y={bottom + 34} textAnchor="middle" className="title">{xTitle}</text>
      <text x={left - 6} y={bottom} textAnchor="end">{yText(y[0])}</text>
      <text x={left - 6} y={top + 4} textAnchor="end">{yText(y[1])}</text>
      <text transform={`translate(14 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" className="title">{yTitle}</text>
    </g>
  );
}

/** A solution drawn as the project's view asks. Nothing when the project has no view, or when the view no longer fits. */
export function Drawing({ project, solution, curve }: { project: Project; solution: PlainSolution; curve?: number[] }) {
  const view = project.view;
  if (!view) return null;
  const column = (name?: string) => columnsOf(project).find((c) => c.name === name);

  if (view.kind === "route") {
    const cx = column(view.x), cy = column(view.y), order = numbers(solution[view.variable]);
    const xs = numbers(cx?.values), ys = numbers(cy?.values);
    if (!xs || !ys || !order || order.length === 0 || order.some((i) => xs[i] === undefined || ys[i] === undefined)) return null;
    // one scale for both directions, so that distances look as they are
    const spanX = Math.max(...xs) - Math.min(...xs) || 1, spanY = Math.max(...ys) - Math.min(...ys) || 1;
    const k = Math.min((W - 48) / spanX, (H - 48) / spanY);
    const px = (i: number) => 24 + (W - 48 - spanX * k) / 2 + (xs[i] - Math.min(...xs)) * k;
    const py = (i: number) => H - 24 - (H - 48 - spanY * k) / 2 - (ys[i] - Math.min(...ys)) * k;
    const words = `Round trip through ${order.length} points, in this order: ${order.join(", ")}, and back to ${order[0]}.`;
    return (
      <figure className="drawing">
        <div className="drawing-box" tabIndex={0} role="group" aria-label="Drawing"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={words}>
          <path className="mark-line" d={`${order.map((i, n) => `${n ? "L" : "M"}${px(i)},${py(i)}`).join(" ")} Z`} />
          {order.map((i) => <circle key={i} className="mark-point" cx={px(i)} cy={py(i)} r={3} />)}
          <rect className="mark-start" x={px(order[0]) - 5} y={py(order[0]) - 5} width={10} height={10} />
          {order.length <= 40 && order.map((i) => <text key={i} className="mark-label" x={px(i) + 6} y={py(i) - 6}>{i}</text>)}
        </svg></div>
        <figcaption>
          Round trip through {order.length} points, placed by <code>{view.x}</code> and <code>{view.y}</code>. The square is where the trip starts,
          at point {order[0]}.
        </figcaption>
      </figure>
    );
  }

  if (view.kind === "routes") {
    const cx = column(view.x), cy = column(view.y), xs = numbers(cx?.values), ys = numbers(cy?.values);
    const value = solution[view.variable], depot = view.depot;
    const groups = Array.isArray(value) && value.every((g) => numbers(g)) ? (value as number[][]) : undefined;
    // the items skip the row of the depot: item i is row i before it, and row i + 1 from it on
    const row = (item: number) => item + (item >= depot ? 1 : 0);
    if (!xs || !ys || !groups || xs[depot] === undefined || ys[depot] === undefined || groups.flat().some((i) => xs[row(i)] === undefined || ys[row(i)] === undefined)) return null;
    const rows = [depot, ...groups.flat().map(row)], allX = rows.map((r) => xs[r]), allY = rows.map((r) => ys[r]);
    const spanX = Math.max(...allX) - Math.min(...allX) || 1, spanY = Math.max(...allY) - Math.min(...allY) || 1;
    const k = Math.min((W - 48) / spanX, (H - 48) / spanY);
    const px = (r: number) => 24 + (W - 48 - spanX * k) / 2 + (xs[r] - Math.min(...allX)) * k;
    const py = (r: number) => H - 24 - (H - 48 - spanY * k) / 2 - (ys[r] - Math.min(...allY)) * k;
    // Lengths are straight lines between the points. The objective may measure another way (a
    // table of road distances), so the legend says what its number is. A unit only when both columns share it.
    const unit = cx?.unit && cx.unit === cy?.unit ? ` ${cx.unit}` : "";
    const used = groups.flatMap((stops, g) => {
      if (stops.length === 0) return [];
      const path = [depot, ...stops.map(row), depot];
      const length = path.slice(1).reduce((sum, r, n) => sum + Math.hypot(xs[r] - xs[path[n]], ys[r] - ys[path[n]]), 0);
      return [{ g, stops, path, text: `Route ${g}: ${stops.length} ${stops.length === 1 ? "stop" : "stops"}, ${short(length)}${unit} in straight lines` }];
    });
    const empty = groups.length - used.length;
    const words = `${used.length} ${used.length === 1 ? "route" : "routes"} from the depot and back. ${used.map((r) => `${r.text}, in this order: ${r.stops.join(", ")}.`).join(" ")}`;
    const LINE = 18, bottom = H + used.length * LINE + 8;
    return (
      <figure className="drawing">
        <div className="drawing-box" tabIndex={0} role="group" aria-label="Drawing"><svg viewBox={`0 0 ${W} ${bottom}`} role="img" aria-label={words}>
          {used.map((r, n) => (
            <g key={r.g}>
              <path className="mark-line" strokeDasharray={DASHES[n % DASHES.length]} d={`${r.path.map((node, at) => `${at ? "L" : "M"}${px(node)},${py(node)}`).join(" ")}`} />
              {/* the legend: the line of the route, and what it is, under the picture */}
              <path className="mark-line" strokeDasharray={DASHES[n % DASHES.length]} d={`M24,${H + n * LINE + 8} h56`} />
              <text x={90} y={H + n * LINE + 12}>{r.text}</text>
            </g>
          ))}
          {used.flatMap((r) => r.stops).map((i) => <circle key={i} className="mark-point" cx={px(row(i))} cy={py(row(i))} r={3} />)}
          <rect className="mark-start" x={px(depot) - 5} y={py(depot) - 5} width={10} height={10} />
          {rows.length <= 41 && used.flatMap((r) => r.stops).map((i) => <text key={i} className="mark-label" x={px(row(i)) + 6} y={py(row(i)) - 6}>{i}</text>)}
        </svg></div>
        <figcaption>
          Each kind of line is one route: from the depot (the square) through its stops and back. The stops carry the numbers of the items
          of <code>{view.variable}</code>, placed by <code>{view.x}</code> and <code>{view.y}</code>. The lengths here are straight lines between
          the points, so they can differ from the objective.
          {empty > 0 && ` ${empty} of ${groups.length} groups ${empty === 1 ? "is" : "are"} empty and ${empty === 1 ? "is" : "are"} not drawn.`}
        </figcaption>
      </figure>
    );
  }

  if (view.kind === "line") {
    const cx = column(view.x), cy = column(view.y);
    const xs = numbers(cx?.values), ys = numbers(cy?.values);
    if (!xs || !ys || xs.length === 0 || xs.length !== ys.length) return null;
    const line = curve?.length === xs.length ? curve : undefined;
    const drawn = line ? xs.map((x, i) => [x, line[i]]).filter(([, y]) => Number.isFinite(y)).sort((a, b) => a[0] - b[0]) : [];
    const allY = [...ys, ...drawn.map(([, y]) => y)];
    const rangeX: [number, number] = [Math.min(...xs), Math.max(...xs)], rangeY: [number, number] = [Math.min(...allY), Math.max(...allY)];
    const px = scale(...rangeX, PAD.left + 8, W - PAD.right - 8), py = scale(...rangeY, H - PAD.bottom - 8, PAD.top + 8);
    const gap = line ? Math.max(...xs.map((_, i) => Math.abs(ys[i] - line[i])).filter(Number.isFinite)) : undefined;
    const words =
      `${xs.length} data points of ${view.y}${unitOf(cy?.unit)} against ${view.x}${unitOf(cx?.unit)}` +
      (gap !== undefined && Number.isFinite(gap) ? `, with the fitted line. The line is at most ${short(gap)}${cy?.unit ? ` ${cy.unit}` : ""} away from a point.` : ".");
    return (
      <figure className="drawing">
        <div className="drawing-box" tabIndex={0} role="group" aria-label="Drawing"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={words}>
          <Axes x={rangeX} y={rangeY} xTitle={`${view.x}${unitOf(cx?.unit)}`} yTitle={`${view.y}${unitOf(cy?.unit)}`} />
          {drawn.length > 1 && <path className="mark-line" d={drawn.map(([x, y], n) => `${n ? "L" : "M"}${px(x)},${py(y)}`).join(" ")} />}
          {xs.map((x, i) => <circle key={i} className="mark-point hollow" cx={px(x)} cy={py(ys[i])} r={4} />)}
        </svg></div>
        <figcaption>{words} Circles are the data{line ? <>, and the line is <code>{view.expression}</code></> : ""}.</figcaption>
      </figure>
    );
  }

  const taken = numbers(solution[view.variable]);
  // shortcut: one row of items. Past 80 items the bars are too thin to read, so only the words are shown.
  if (!taken || taken.length === 0) return null;
  const sizeColumn = column(view.size), sizes = numbers(sizeColumn?.values);
  const chosen = taken.flatMap((t, i) => (t === 1 ? [i] : []));
  const words = `${chosen.length} of ${taken.length} items are chosen: ${chosen.length ? `positions ${chosen.join(", ")}` : "none"}.`;
  const sized = sizes?.length === taken.length ? sizes : undefined;
  const largest = sized ? Math.max(...sized, 0) || 1 : 1;
  const cell = Math.min(36, (W - 16) / taken.length), top = 28, tall = 150;
  return (
    <figure className="drawing">
      {taken.length <= 80 && (
        <div className="drawing-box" tabIndex={0} role="group" aria-label="Drawing"><svg viewBox={`0 0 ${W} ${top + tall + 24}`} role="img" aria-label={words}>
          {taken.map((t, i) => {
            const h = sized ? Math.max(4, (Math.max(sized[i], 0) / largest) * tall) : Math.min(cell - 4, 28);
            const x = 8 + i * cell, y = top + tall - h, w = Math.max(cell - 4, 2);
            return (
              <g key={i}>
                <rect className={t === 1 ? "mark-item chosen" : "mark-item"} x={x} y={y} width={w} height={h} rx={2} />
                {/* a check mark above every chosen item, so that the fill is not the only sign */}
                {t === 1 && <path className="mark-check" d={`M${x + w / 2 - 4},${y - 9} l3,4 l6,-8`} />}
                {taken.length <= 24 && <text className="mark-label" x={x + w / 2} y={top + tall + 16} textAnchor="middle">{i}</text>}
              </g>
            );
          })}
        </svg></div>
      )}
      <figcaption>
        {words} A filled bar with a check mark is a chosen item.
        {sized && <> The height of a bar is its <code>{view.size}</code>{unitOf(sizeColumn?.unit)}.</>}
      </figcaption>
    </figure>
  );
}

/** The best value at the checkpoints of a run, against evaluations. */
export function HistoryChart({ history, unit }: { history: { nfe: number[]; best: (number | null)[] }; unit?: string }) {
  const points = history.nfe.map((n, i) => [n, history.best[i]] as const).filter((p): p is readonly [number, number] => typeof p[1] === "number" && Number.isFinite(p[1]));
  if (points.length < 2) return null;
  const values = points.map(([, v]) => v), low = Math.min(...values), high = Math.max(...values);
  // a best value that falls through many powers of ten is flat on a plain scale
  const log = low > 0 && high / low > 1000;
  const f = (v: number) => (log ? Math.log10(v) : v);
  const budget = history.nfe.at(-1)!;
  const px = scale(0, budget, PAD.left, W - PAD.right), py = scale(f(low), f(high), H - PAD.bottom, PAD.top);
  // the best value holds until the next improvement, so the line moves in steps
  const d = points.map(([n, v], k) => (k ? `H${px(n)} V${py(f(v))}` : `M${px(n)},${py(f(v))}`)).join(" ");
  const [first, last] = [points[0], points.at(-1)!];
  const suffix = unit ? ` ${unit}` : "";
  const words = `The best value went from ${show(first[1])}${suffix} after ${count(first[0])} evaluations to ${show(last[1])}${suffix} after ${count(last[0])}.`;
  const band = (W - PAD.left - PAD.right) / points.length;
  return (
    <figure className="drawing">
      <div className="drawing-box" tabIndex={0} role="group" aria-label="Drawing"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={words}>
        <Axes x={[0, budget]} y={[low, high]} xTitle="Evaluations" yTitle={`Best value${unitOf(unit)}${log ? ", log scale" : ""}`} />
        <path className="mark-line" d={d} />
        {/* one band per checkpoint, so that pointing at the chart shows the value there */}
        {points.map(([n, v]) => (
          <rect key={n} className="hover-band" x={px(n) - band} y={PAD.top} width={band} height={H - PAD.top - PAD.bottom} data-tip={`After ${count(n)} evaluations: ${show(v)}${suffix}`} />
        ))}
      </svg></div>
      <figcaption>{words}</figcaption>
    </figure>
  );
}
