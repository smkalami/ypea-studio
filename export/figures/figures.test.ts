// The rules of the figures: ticks at round values, when the value axis is logarithmic, where
// labels go, the order of the colors, true lengths in the legend of routes, and a saved
// picture that depends on nothing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { summarize } from "../../engine/compare.ts";
import { parseProject, type Project } from "../../engine/project.ts";
import { runProject } from "../../engine/run.ts";
import { comparisonFigures, historyFigure, LABEL_LIMIT, solutionFigure } from "./build.ts";
import { type Figure, figureCss, figureSvg, PAINTS, SERIES_COLORS, seriesStyle, type Shape, stack } from "./figure.ts";
import { type Box, crosses, everyNth, LabelPlacer, type Mark, type Segment, textWidth } from "./labels.ts";
import { logText, logTicks, niceStep, niceTicks, tickText, useLog } from "./scale.ts";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), "utf8"));
const figureOf = (project: Project, solution: Record<string, unknown>): Figure => {
  const drawn = solutionFigure(project, solution);
  assert.ok(drawn && "figure" in drawn);
  return drawn.figure;
};
const texts = (figure: Figure) => figure.shapes.flatMap((shape) => (shape.kind === "text" ? [shape] : []));
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("ticks: round steps of 1, 2 or 5 times a power of ten, that cover the range, at least three", () => {
  assert.deepEqual(niceTicks(0, 20000).ticks, [0, 5000, 10000, 15000, 20000]);
  assert.deepEqual(niceTicks(0, 50000).ticks, [0, 10000, 20000, 30000, 40000, 50000]);
  assert.deepEqual(niceTicks(0.5, 4.5).ticks, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(niceTicks(14.2, 113.6).ticks, [0, 20, 40, 60, 80, 100, 120]);
  // no noise from binary fractions
  assert.deepEqual(niceTicks(0.1, 0.3).ticks, [0.1, 0.15, 0.2, 0.25, 0.3]);
  assert.deepEqual(niceTicks(-1.33, 2.28, 3).ticks, [-2, 0, 2, 4]);
  // a flat range gets room on both sides
  assert.deepEqual(niceTicks(547.15, 547.15).ticks, [450, 500, 550, 600, 650]);
  assert.deepEqual(niceTicks(0, 0).ticks, [-1, -0.5, 0, 0.5, 1]);
  for (const [low, high] of [[0, 1], [3, 7], [-250, 990], [1e-9, 3e-9], [12345, 12346], [0, 2_000_000_000], [-0.004, 0.0031], [665.01, 547.15].sort((a, b) => a - b)]) {
    for (const target of [3, 4, 5]) {
      const { ticks, step } = niceTicks(low, high, target);
      const part = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
      assert.ok([1, 2, 5].some((m) => Math.abs(part - m) < 1e-9), `step ${step} of ${low} to ${high}`);
      assert.ok(ticks.length >= 3 && ticks.length <= 2 * target + 2, `${ticks.length} ticks for ${low} to ${high}`);
      assert.ok(ticks[0] <= low && ticks.at(-1)! >= high, `the ticks cover ${low} to ${high}`);
      for (let i = 1; i < ticks.length; i++) assert.ok(Math.abs(ticks[i] - ticks[i - 1] - step) < step * 1e-9);
    }
  }
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(7, 5), 2);
});

test("tick text: thousands separators, only the decimals the step needs, and an exponent at the extremes", () => {
  assert.equal(tickText(20000, 5000), "20,000");
  assert.equal(tickText(0, 5000), "0");
  assert.equal(tickText(0.5, 0.5), "0.5");
  assert.equal(tickText(1, 0.5), "1.0");
  assert.equal(tickText(0.15, 0.05), "0.15");
  assert.equal(tickText(-2, 2), "-2");
  assert.equal(tickText(2_000_000_000, 500_000_000), "2e9");
  assert.equal(tickText(1.5e-9, 5e-10), "1.5e-9");
  assert.equal(logText(-12), "1e-12");
});

test("a logarithmic value axis: only for positive values that span more than three powers of ten", () => {
  // the benchmark example: from thousands down to 1e-12
  assert.equal(useLog([2551.3, 91.2, 0.004, 3.97e-12]), true);
  assert.equal(useLog([665.01, 547.15]), false);
  // exactly 1,000 times is not more than 1,000 times
  assert.equal(useLog([1, 1000]), false);
  assert.equal(useLog([1, 1000.1]), true);
  // a zero or a negative value cannot be on a logarithmic axis, so the axis stays linear
  assert.equal(useLog([5000, 0.001, 0]), false);
  assert.equal(useLog([5000, 0.001, -2]), false);
  assert.equal(useLog([5000, Number.NaN]), false);
  // the rule reads the values only: a maximized objective that grows through many powers of ten gets it too
  assert.equal(useLog([0.01, 3, 80000]), true);
  assert.deepEqual(logTicks(3.97e-12, 2551.3), [-12, -9, -6, -3, 0, 3, 6]);
  assert.deepEqual(logTicks(0.002, 900), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual(logTicks(1e-40, 1e40), [-40, -20, 0, 20, 40]);
  for (const [low, high] of [[1e-12, 1e3], [1e-300, 1e300], [0.5, 800]]) {
    const ticks = logTicks(low, high);
    assert.ok(ticks.length >= 3 && ticks.length <= 8 && 10 ** ticks[0] <= low * (1 + 1e-9) && 10 ** ticks.at(-1)! >= high * (1 - 1e-9), `${low} to ${high}: ${ticks}`);
  }
});

test("labels: two points that nearly coincide get two labels that keep apart", () => {
  const marks: Mark[] = [{ x: 200, y: 150, r: 3 }, { x: 205, y: 151, r: 3 }];
  const placer = new LabelPlacer({ x: 0, y: 0, w: 440, h: 300 }, [], marks);
  const first = placer.place("2", [marks[0]])!, second = placer.place("14", [marks[1]])!;
  assert.ok(first && second);
  assert.equal(overlap(first.box, second.box), false);
  // a gap between them, so that they cannot read as "214"
  const gap = Math.max(second.box.x - (first.box.x + first.box.w), first.box.x - (second.box.x + second.box.w));
  assert.ok(gap >= 4 || first.box.y + first.box.h <= second.box.y || second.box.y + second.box.h <= first.box.y, `gap ${gap}`);
  // and neither covers the mark of the other point
  for (const [label, other] of [[first, marks[1]], [second, marks[0]]] as const) assert.equal(overlap(label.box, { x: other.x - 3, y: other.y - 3, w: 6, h: 6 }), false);
});

test("labels: a label stays off a line where a free place exists, and says so when none does", () => {
  // a line runs through the point toward the upper right, where a label would go first
  const mark: Mark = { x: 100, y: 100, r: 3 }, line: Segment = [60, 140, 180, 20];
  const label = new LabelPlacer({ x: 0, y: 0, w: 440, h: 300 }, [line], [mark]).place("13", [mark])!;
  assert.equal(label.crossings, 0);
  assert.equal(crosses(line, label.box), false);
  assert.equal(label.leader, undefined, "the nearest distance was enough");
  // without the line the first place is the upper right
  const free = new LabelPlacer({ x: 0, y: 0, w: 440, h: 300 }, [], [mark]).place("13", [mark])!;
  assert.ok(free.box.x > mark.x && free.box.y + free.box.h < mark.y);
  // a point in a corner: the label goes where the figure is, never outside
  const corner: Mark = { x: 437, y: 3, r: 3 };
  const inside = new LabelPlacer({ x: 0, y: 0, w: 440, h: 300 }, [], [corner]).place("27", [corner])!;
  assert.ok(inside.box.x >= 0 && inside.box.x + inside.box.w <= 440 && inside.box.y >= 0);
  // lines all around: the label takes the place with the fewest crossings, and reports them
  const star: Segment[] = Array.from({ length: 24 }, (_, k) => [100, 100, 100 + 200 * Math.cos((k * Math.PI) / 12), 100 + 200 * Math.sin((k * Math.PI) / 12)]);
  const crowded = new LabelPlacer({ x: 0, y: 0, w: 440, h: 300 }, star, [mark]).place("13", [mark])!;
  assert.ok(crowded.crossings >= 1);
  // no room at all: no label, and the caller is told
  assert.equal(new LabelPlacer({ x: 0, y: 0, w: 10, h: 10 }, [], []).place("123456", [{ x: 5, y: 5, r: 3 }]), undefined);
  // a label that had to move away has a leader from its mark
  const blocked = new LabelPlacer({ x: 0, y: 0, w: 440, h: 300 }, [], [mark], [{ x: 78, y: 80, w: 44, h: 40 }]).place("13", [mark])!;
  assert.ok(blocked.leader && Math.hypot(blocked.leader[0] - mark.x, blocked.leader[1] - mark.y) <= 3.01);
});

/** Points on a jittered grid, from a fixed rule, so that a test draws the same ones every time. */
const scatter = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 20 + ((i * 97) % 400) + ((i * 31) % 7), y: 20 + ((i * 59) % 260) + ((i * 17) % 5) }));

test("labels: many points give no overlap, nothing outside, the same result every time, and few changes after a small move", () => {
  const points = scatter(100), bounds = { x: 2, y: 2, w: 436, h: 296 };
  const run = (moved?: number) => {
    const marks: Mark[] = points.map((p, i) => ({ x: p.x + (i === moved ? 2 : 0), y: p.y, r: 3 }));
    const segments: Segment[] = marks.map((m, i) => [m.x, m.y, marks[(i + 1) % marks.length].x, marks[(i + 1) % marks.length].y]);
    const placer = new LabelPlacer(bounds, segments, marks);
    return marks.map((mark, i) => placer.place(String(i), [mark]));
  };
  const labels = run(), placed = labels.flatMap((label) => label ?? []);
  assert.ok(placed.length >= 60, `${placed.length} of 100 labels found a place`);
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i].box;
    assert.ok(a.x >= bounds.x && a.y >= bounds.y && a.x + a.w <= bounds.x + bounds.w && a.y + a.h <= bounds.y + bounds.h);
    for (let j = 0; j < i; j++) assert.equal(overlap(a, placed[j].box), false, `labels ${placed[i].text} and ${placed[j].text}`);
    for (const p of points) assert.equal(overlap(a, { x: p.x - 3, y: p.y - 3, w: 6, h: 6 }) && String(points.indexOf(p)) !== placed[i].text, false);
  }
  assert.deepEqual(run(), labels, "no randomness");
  // One point moves by 2: its own label follows it, and only a few of the other 99 change. A label
  // before it in the order can change too, when the moved mark or one of its two lines is beside it.
  const after = run(50);
  const changed = after.filter((label, i) => JSON.stringify(label?.box) !== JSON.stringify(labels[i]?.box)).length;
  assert.ok(changed <= 3, `${changed} labels moved`);
});

test("too many points: every k-th is labeled, the caption says which, and a route of 100 points is drawn fast", () => {
  assert.deepEqual([everyNth(40, 40), everyNth(41, 40), everyNth(100, 40), everyNth(1000, 40)], [1, 2, 3, 25]);
  const points = scatter(100), tsp = example("tsp");
  const project = parseProject({
    ...tsp,
    data: [{ name: "cities", kind: "columns", columns: [{ name: "x", unit: "km", values: points.map((p) => p.x) }, { name: "y", unit: "km", values: points.map((p) => p.y) }] }],
    variables: [{ name: "route", type: "permutation", n: 100 }], baseline: undefined,
    objective: { sense: "min", source: "sum(x[route])" },
  });
  const order = points.map((_, i) => (i * 37) % 100);
  const figure = figureOf(project, { route: order });
  const numbers = texts(figure).filter((t) => /^\d+$/.test(t.text) && t.halo);
  assert.ok(numbers.length <= Math.ceil(100 / 3) && numbers.length >= 15, `${numbers.length} numbers`);
  assert.ok(numbers.length <= LABEL_LIMIT);
  const caption = figure.caption.map((part) => (typeof part === "string" ? part : part.code)).join("");
  assert.match(caption, /Only every 3rd point of the trip is numbered, because 100 numbers would not fit\./);
  // the live preview draws the figure again at every improvement, so it must be quick
  const start = performance.now();
  for (let n = 0; n < 20; n++) figureSvg(figureOf(project, { route: order }), "screen");
  const each = (performance.now() - start) / 20;
  assert.ok(each < 50, `a route of 100 points took ${each.toFixed(1)} ms`);
});

test("colors of series: seven solid colors in a fixed order, and dashes only after them", () => {
  const first = Array.from({ length: SERIES_COLORS }, (_, n) => seriesStyle(n));
  assert.deepEqual(first.map((s) => s.paint), ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7"]);
  assert.ok(first.every((s) => s.dash === undefined));
  assert.equal(new Set(first.map((s) => PAINTS[s.paint][1])).size, SERIES_COLORS);
  const second = Array.from({ length: SERIES_COLORS }, (_, n) => seriesStyle(SERIES_COLORS + n));
  assert.deepEqual(second.map((s) => s.paint), first.map((s) => s.paint));
  assert.ok(second.every((s) => s.dash === second[0].dash && s.dash !== undefined));
  assert.notEqual(seriesStyle(2 * SERIES_COLORS).dash, second[0].dash);
  // 28 series are all different in color or in dashes
  assert.equal(new Set(Array.from({ length: 28 }, (_, n) => JSON.stringify(seriesStyle(n)))).size, 28);
  // every color of a line or a mark stands 3 to 1 or more against the page (the formula of WCAG)
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const paint of ["ink", "muted", "axis", "accent", ...first.map((s) => s.paint)] as const) {
    const ratio = 1.05 / (lum(PAINTS[paint][1]) + 0.05);
    assert.ok(ratio >= 3, `${paint} ${PAINTS[paint][1]}: ${ratio.toFixed(2)} to 1`);
  }
  // the classes of the screen: one fill and one stroke for each role, each from its token
  assert.equal(figureCss().split("\n").filter(Boolean).length, 2 * Object.keys(PAINTS).length);
  assert.ok(figureCss().includes(".fig-stroke-series-1 { stroke: var(--series-1); }"));
});

test("routes: every route has its color, its name on the map and its legend entry, with the length that the table gives", () => {
  const json = example("vrp"), project = parseProject(structuredClone(json)), result = runProject(project);
  assert.equal((project.view as { distance?: string }).distance, "distance");
  const figure = figureOf(project, result.best.solution);
  const routes = (result.best.solution.routes as number[][]).flatMap((stops, g) => (stops.length ? [g] : []));
  for (const g of routes) {
    const mine = figure.shapes.filter((shape) => "series" in shape && shape.series === g);
    // the line on the map, the line in the legend, the name beside the line, and the words of the legend
    assert.deepEqual(mine.map((shape) => shape.kind).sort(), ["line", "path", "text", "text"], `route ${g}`);
    assert.ok(mine.some((shape) => shape.kind === "text" && shape.text === `Route ${g}` && shape.bold));
    const stroke = mine.flatMap((shape) => (shape.kind === "path" || shape.kind === "line" ? [shape.stroke] : []));
    assert.deepEqual(stroke, [seriesStyle(g).paint, seriesStyle(g).paint]);
  }
  // the lengths of the legend are the ones of the objective: together they are the result
  const lengths = [...figure.words.matchAll(/Route \d+: \d+ stops?, ([\d.]+) km, in this order/g)].map((m) => Number(m[1]));
  assert.equal(lengths.length, routes.length);
  assert.ok(Math.abs(lengths.reduce((sum, v) => sum + v, 0) - result.best.objective) < 0.05 * routes.length, `${lengths} against ${result.best.objective}`);
  assert.match(figure.caption.map((part) => (typeof part === "string" ? part : part.code)).join(""), /and its length, read from the data table distance\./);
  // the depot is named, and no two texts of the map overlap by the estimate of their widths
  assert.ok(texts(figure).some((t) => t.text === "Depot" && t.bold));
  const boxes = texts(figure).map((t) => ({ t, box: { x: t.x, y: t.y - 11, w: textWidth(t.text, 12, t.bold), h: 14 } }));
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) assert.equal(overlap(boxes[i].box, boxes[j].box), false, `"${boxes[i].t.text}" and "${boxes[j].t.text}"`);

  // without a table of distances: the number of stops only, and no length anywhere
  const plain = structuredClone(json);
  delete plain.view.distance;
  const bare = figureOf(parseProject(plain), result.best.solution);
  assert.match(bare.words, /^4 routes from the depot and back\. Route 0: \d+ stops?, in this order: /);
  assert.equal(texts(bare).some((t) => /Route \d+: .* km/.test(t.text)), false);
  assert.doesNotMatch(bare.caption.map((part) => (typeof part === "string" ? part : part.code)).join(""), /length/);

  // nine routes: the eighth and the ninth start the colors again, with dashes
  const many = structuredClone(json);
  many.variables[0].k = 9;
  many.baseline.solution.routes = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10], [11], [12, 13], [14]];
  const nine = figureOf(parseProject(many), many.baseline.solution);
  const dashes = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((g) => (nine.shapes.find((shape) => shape.kind === "path" && shape.series === g) as Extract<Shape, { kind: "path" }>).dash);
  assert.deepEqual(dashes.slice(0, 7), Array(7).fill(undefined));
  assert.ok(dashes[7] && dashes[8]);
  // an empty group is not drawn, and the caption counts it
  many.baseline.solution.routes = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [], [], [], [], [], [], [], []];
  assert.match(figureOf(parseProject(many), many.baseline.solution).caption.join(""), /8 of 9 groups are empty and are not drawn\./);
});

test("a single route gives its length only with a table of distances", () => {
  const json = example("tsp"), route = json.baseline.solution.route;
  assert.match(figureOf(parseProject(structuredClone(json)), { route }).words, /^Round trip through 30 points, in this order: /);
  json.view.distance = "distance";
  const project = parseProject(json), figure = figureOf(project, { route });
  const length = Number(figure.words.match(/^Round trip through 30 points, ([\d.]+) km, in this order: /)![1]);
  assert.ok(Math.abs(length - runProject(project).baseline!.objective) < 0.05);
  // a table without a unit: the number is named as a length
  delete json.data[1].unit;
  assert.match(figureOf(parseProject(json), { route }).words, /^Round trip through 30 points, length [\d.]+, in this order: /);
});

test("every chart has at least three ticks on each axis, inside the figure and apart from each other", () => {
  const figures: [string, Figure][] = [];
  for (const name of ["benchmark", "linefit", "knapsack", "tsp", "vrp", "assignment"]) {
    const project = parseProject(example(name)), result = runProject({ ...project, run: { ...project.run, budget: 2000 } });
    figures.push([`${name} history`, historyFigure(result, project.objective.unit)!]);
    if (name === "linefit" || name === "knapsack") figures.push([`${name} drawing`, figureOf(project, result.best.solution)]);
  }
  const knapsack = parseProject(example("knapsack")), quick = { ...knapsack, run: { ...knapsack.run, budget: 600 } };
  const comparison = summarize([{ name: "Quick run", project: quick, results: [0, 1, 2].map((runIndex) => runProject(quick, { runIndex })) }]);
  for (const chart of comparisonFigures(comparison)!) figures.push(["comparison", chart.figure!]);
  for (const [name, figure] of figures) {
    for (const axis of ["x", "y"] as const) {
      const ticks = texts(figure).filter((t) => t.tick === axis);
      assert.ok(ticks.length >= 3, `${name}: ${ticks.length} ticks on the ${axis} axis`);
      for (const t of ticks) {
        const wide = textWidth(t.text), left = t.anchor === "end" ? t.x - wide : t.x - wide / 2;
        assert.ok(left >= 0 && left + wide <= figure.width, `${name}: the tick "${t.text}" is cut`);
      }
    }
    // neighbors along the bottom keep a gap (several panels each have their own row)
    const rows = Map.groupBy(texts(figure).filter((t) => t.tick === "x"), (t) => t.y);
    for (const row of rows.values()) for (let i = 1; i < row.length; i++) assert.ok(row[i].x - row[i - 1].x >= (textWidth(row[i].text) + textWidth(row[i - 1].text)) / 2 + 4, `${name}: "${row[i - 1].text}" and "${row[i].text}"`);
    assert.ok(texts(figure).some((t) => t.turned), `${name}: the value axis has a title`);
  }
  // the benchmark history falls through many powers of ten, and its axis says that it is logarithmic
  const benchmark = parseProject(example("benchmark")), history = historyFigure(runProject(benchmark), undefined)!;
  assert.ok(texts(history).some((t) => t.text === "Best value, log scale"));
  assert.deepEqual(texts(history).filter((t) => t.tick === "y").map((t) => t.text), ["1e-12", "1e-9", "1e-6", "1e-3", "1e0", "1e3"]);
  assert.deepEqual(texts(history).filter((t) => t.tick === "x").map((t) => t.text), ["0", "5,000", "10,000", "15,000", "20,000"]);
  assert.match(history.caption.join(""), /The value axis is logarithmic: each mark is 1,000 times the one below it\./);
  // a reader can step through the checkpoints: each has its place and its words, and one can be marked
  assert.equal(history.probes!.length, 100);
  assert.match(history.probes![99].text, /^After 20,000 evaluations: 3\.97294e-12$/);
  assert.equal(historyFigure(runProject(benchmark), undefined, 99)!.shapes.length, history.shapes.length + 2);
});

test("a saved picture stands on its own, the report writes its colors out, and the screen reads tokens", () => {
  for (const name of ["linefit", "knapsack", "tsp", "vrp"]) {
    const project = parseProject(example(name)), result = runProject({ ...project, run: { ...project.run, budget: 500 } });
    const figure = figureOf(project, result.best.solution);
    for (const drawn of [figure, historyFigure(result, project.objective.unit)!]) {
      const file = figureSvg(drawn, "file", "drawing");
      assert.match(file, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 440 \d+" width="440" height="\d+" role="img" aria-labelledby="drawing-title drawing-desc" font-size="12" font-family="system-ui, [^"]+"><title id="drawing-title">[^<]+<\/title><desc id="drawing-desc">[^<]+<\/desc><rect width="440" height="\d+" fill="#ffffff"\/>/);
      // no style variable, no class, no style block, no reference to anything outside the file
      assert.doesNotMatch(file, /var\(|class=|<style|style=|currentColor|url\(|href|<script|<image|<use|@import|inherit/);
      assert.deepEqual([...new Set([...file.matchAll(/https?:[^"]*/g)].map((m) => m[0]))], ["http://www.w3.org/2000/svg"]);
      // every shape says its own fill and stroke, so nothing is left to the black of a browser
      for (const tag of file.match(/<(line|path|circle|rect|text)[^>]*>/g)!) assert.match(tag, / fill="(none|#[0-9a-f]{6})"/, tag);
      const colors = new Set([...file.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
      for (const color of colors) assert.ok(Object.values(PAINTS).some(([, light]) => light === color), `${color} is not a color of the palette`);
      // the report: the same shapes and colors, the words as the title, and no class
      const report = figureSvg(drawn, "report", "drawing-title");
      assert.doesNotMatch(report, /var\(|class=|style|href/);
      assert.equal(report.slice(report.indexOf("<rect")), file.slice(file.indexOf("<rect")).trimEnd());
      // the screen: colors by class only, and the words as the label
      const screen = figureSvg(drawn, "screen");
      assert.doesNotMatch(screen, /#[0-9a-f]{6}|<title|<desc|style=/);
      assert.ok(screen.startsWith(`<svg viewBox="0 0 440 ${drawn.height}" role="img" aria-label="`));
      for (const tag of screen.match(/<(line|path|circle|rect|text)[^>]*>/g)!) assert.match(tag, /class="fig-|fill="none"/, tag);
      for (const used of new Set([...screen.matchAll(/fig-(?:fill|stroke)-[a-z0-9-]+/g)].map((m) => m[0]))) assert.ok(figureCss().includes(`.${used} {`), used);
    }
  }
  // text from a project is escaped wherever it lands
  const hostile = parseProject({ ...example("linefit"), objective: { sense: "min", unit: `"><script>x</script>`, source: "sum((pressure - (offset + gain * voltage)) ** 2)" } });
  const chart = historyFigure(runProject({ ...hostile, run: { ...hostile.run, budget: 300 } }), hostile.objective.unit)!;
  for (const target of ["screen", "report", "file"] as const) assert.doesNotMatch(figureSvg(chart, target), /<script|""/);
  // several figures as one file: each lower than the one before, under its own line of words
  const sheet = stack([{ heading: "First", figure: chart }, { heading: "Second", note: "Nothing to draw." }, { heading: "Third", figure: chart }], "Two charts");
  assert.equal(sheet.height, 12 + (20 + chart.height + 12) + (20 + 20 + 12) + (20 + chart.height + 12));
  const stacked = figureSvg(sheet, "file");
  assert.equal(stacked.match(/<g transform="translate\(0 \d+\)">/g)!.length, 2);
  assert.equal(stacked.match(/<svg /g)!.length, 1);
});
