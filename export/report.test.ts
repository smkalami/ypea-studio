import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { summarize } from "../engine/compare.ts";
import { METHODS } from "../engine/methods/index.ts";
import { parseProject, type Project } from "../engine/project.ts";
import { deriveSeed } from "../engine/rng.ts";
import { runProject } from "../engine/run.ts";
import { historyFigure } from "./figures/build.ts";
import { escapeHtml, html } from "./report-html.ts";
import { breach, difference, reportHtml, ruleWords } from "./report.ts";

const examples = new URL("../examples/", import.meta.url);
const names = readdirSync(examples).filter((f) => f.endsWith(".json"));
const example = (file: string) => parseProject(JSON.parse(readFileSync(new URL(file, examples), "utf8")));
const quick = (project: Project, budget = 400): Project => ({ ...project, run: { ...project.run, budget } });
const runs = (name: string, project: Project, count = 3) => ({ name, project, results: Array.from({ length: count }, (_, runIndex) => runProject(project, { runIndex })) });
const withSolver = (project: Project, method: string): Project => ({ ...project, run: { method, settings: {}, budget: project.run.budget, seed: project.run.seed } });

const TAGS = new Set("!doctype html head meta title style body main header section footer h1 h2 h3 p dl dt dd table caption thead tbody tr th td code pre ul li figure figcaption div svg g line text path circle rect strong".split(" "));
const ATTRIBUTES = new Set("lang charset name content http-equiv class id scope colspan viewBox role aria-labelledby aria-hidden x y x1 x2 y1 y2 cx cy r rx width height d transform text-anchor stroke-dasharray fill stroke stroke-width stroke-linecap stroke-linejoin fill-opacity paint-order font-size font-weight data-series data-tick".split(" "));
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;

/**
 * Checks that a page cannot run script or load anything, whatever text it was made from: every
 * tag is one the report writes, with attributes the report writes, and none of them can hold
 * an address or a handler. Returns the tags.
 */
function assertInert(page: string): string[] {
  assert.doesNotMatch(page, /<script/i);
  assert.equal(page.match(/<style/gi)?.length, 1, "one style block");
  assert.equal(page.match(/<\/style/gi)?.length, 1, "which is closed once");
  const style = page.slice(page.indexOf("<style>") + "<style>".length, page.indexOf("</style>"));
  assert.doesNotMatch(style, /url\(|@import|expression\(|<|http/i);
  const body = page.replace(style, "");
  const tags = body.match(/<[^>]*>/g) ?? [];
  // outside the tags there is no raw angle bracket at all
  assert.doesNotMatch(body.replace(/<[^>]*>/g, ""), /[<>]/);
  for (const tag of tags) {
    const inner = tag.slice(1, -1).replace(/^\//, "").replace(/\/$/, "");
    const name = inner.split(/\s/)[0];
    assert.ok(TAGS.has(name), `tag ${tag}`);
    const rest = inner.slice(name.length).replace(/\s([\w:-]+)="[^"]*"/g, (_, attribute) => {
      assert.ok(ATTRIBUTES.has(attribute), `attribute ${attribute} in ${tag}`);
      assert.doesNotMatch(attribute, /^on/i);
      return "";
    });
    assert.equal(rest.trim(), name === "!doctype" ? "html" : "", `nothing else in ${tag}`);
    // the policy tag is compared letter by letter below, and its "style-src" is not an address
    if (tag !== POLICY) assert.doesNotMatch(tag, /javascript:|https?:|\/\/|data:|\bsrc\b|\bhref\b|\bstyle=/i);
  }
  // the one policy of the page forbids scripts and every request
  assert.equal(tags.filter((tag) => tag === POLICY).length, 1);
  assert.equal(tags.filter((tag) => /http-equiv/i.test(tag)).length, 1);
  return tags;
}

for (const file of names) {
  test(`${file}: the report holds the result and what produced it`, () => {
    const project = quick(example(file)), result = runProject(project);
    const page = reportHtml({ project, result, finished: new Date(2026, 10, 26, 9, 5) });
    assertInert(page);
    // no address at all: the only "http" is the name of the policy attribute
    assert.equal(page.replace("http-equiv", "").includes("http"), false);
    assert.doesNotMatch(page, /undefined|NaN|\[object|no number/);
    assert.ok(page.startsWith("<!doctype html>"));
    const has = (text: string) => assert.ok(page.includes(escapeHtml(text)), `the report says: ${text}`);

    has(project.name);
    if (project.description) has(project.description);
    has("The run finished on November 26, 2026, 09:05.");
    has(`Made with YPEA Studio ${result.versions.app}, whose exports are tested with ypea ${result.versions.ypeaTested}.`);
    // the five things a result states
    has(`${result.status}.`);
    for (const v of project.variables) has(v.name);
    for (const c of result.best.constraints) has(c.name);
    assert.equal(page.includes("<h3>Constraints</h3>\n<table>\n<thead><tr><th scope=\"col\">Constraint</th><th scope=\"col\">Value</th>"), result.best.constraints.length > 0);
    assert.equal(page.includes("In use today (baseline): "), result.baseline !== undefined);
    assert.equal(page.includes("Difference from what is in use today"), result.baseline !== undefined);
    assert.equal(page.includes("Known answer (reference): "), result.reference !== undefined);
    assert.equal(page.includes("Difference from the known answer"), result.reference !== undefined);
    assert.ok(page.includes("<dt>Evaluations</dt><dd>400 of 400</dd>"));
    assert.match(page, /<dt>Time<\/dt><dd>\d+(\.\d)? m?s<\/dd>/);
    // one run, with its seed
    has(`This is one run of a randomized solver (${METHODS[project.run.method].name}) with a recorded seed (base seed ${project.run.seed}, run 0).`);
    // the definition and the experiment
    has(project.objective.source);
    for (const c of project.constraints ?? []) has(`${c.left} ${c.op} ${c.right}`);
    if (project.functions) has(project.functions);
    for (const t of project.data ?? []) has(t.name);
    for (const key of Object.keys(result.settings)) has(key);
    has("400 evaluations");
    assert.ok(page.includes(`<dd>${deriveSeed(project.run.seed, 0)}</dd>`));
    // drawings: the history always, and the drawing of the solution when the project has a view
    const pictures = page.match(/<svg /g)?.length ?? 0;
    assert.equal(pictures, project.view ? 2 : 1);
    assert.equal(page.match(/<svg viewBox="0 0 440 [\d.]+" role="img" aria-labelledby="[\w-]+" font-size="12"><title id="[\w-]+">[^<]+<\/title><rect width="440" height="[\d.]+" fill="#ffffff"\/>/g)?.length, pictures, "every picture has its words");
    assert.equal(page.match(/<figcaption>/g)?.length, pictures);
    // the same input gives the same text
    assert.equal(reportHtml({ project, result, finished: new Date(2026, 10, 26, 9, 5) }), page);
  });
}

test("data tables show their size and their first rows only", () => {
  const project = quick(example("tsp.json")), page = reportHtml({ project, result: runProject(project) });
  const cities = project.data!.find((t) => t.kind === "columns")!, distance = project.data!.find((t) => t.kind === "matrix")!;
  const rows = (cities as any).columns[0].values.length;
  assert.ok(rows > 5);
  assert.ok(page.includes(`</code>: ${rows} rows and 2 columns. The first 5 rows are shown.`));
  assert.ok(page.includes(`a table of ${(distance as any).values.length} rows by ${(distance as any).values.length} columns`));
  assert.ok(page.includes("The first 5 rows and 8 columns are shown."));
  assert.ok(page.length < 40_000, "not thousands of rows");
  assert.ok(page.includes("The date of the run was not recorded."));
});

test("the baseline and the reference are told apart, and a percent appears only when it means something", () => {
  const project = quick(example("linefit.json")), run = runProject(project);
  // hand-set values, so that the wording is checked and not the tuning of an example
  const page = (objective: number, baseline: number, reference: number, feasible = true, baselineFeasible = true) => {
    const result = {
      ...run,
      best: { ...run.best, objective, feasible },
      baseline: { label: "Current settings", objective: baseline, feasible: baselineFeasible, difference: objective - baseline },
      reference: { label: "Least-squares line", objective: reference, feasible: true, difference: objective - reference },
    };
    const text = reportHtml({ project, result });
    return text.slice(text.indexOf("<main>"));
  };
  const lower = page(10, 40, 10);
  assert.ok(lower.includes("<dt>In use today (baseline): Current settings</dt><dd>40 kPa^2</dd>\n<dt>Difference from what is in use today</dt><dd>-30 kPa^2 (75% lower), which is better</dd>"));
  assert.ok(lower.includes("<dt>Known answer (reference): Least-squares line</dt><dd>10 kPa^2</dd>\n<dt>Difference from the known answer</dt><dd>None: the two values agree</dd>"));
  assert.ok(page(50, 40, 10).includes("<dd>10 kPa^2 (25% higher), which is worse</dd>"));
  // a comparison value of zero, and values of opposite signs: no percent
  const zero = page(2, 0, -4);
  assert.ok(zero.includes("<dd>2 kPa^2, which is worse</dd>"));
  assert.ok(zero.includes("<dd>6 kPa^2, which is worse</dd>"));
  assert.doesNotMatch(zero, /%/);
  // no verdict for a result that is not feasible, or against a baseline that breaks a constraint
  const broken = page(10, 40, 20, false);
  assert.ok(broken.includes("<dd>-30 kPa^2 (75% lower)</dd>"));
  assert.ok(broken.includes("<dd>-10 kPa^2 (50% lower)</dd>"));
  assert.doesNotMatch(broken, /which is (better|worse)/);
  const against = page(10, 40, 20, true, false);
  assert.ok(against.includes("<dd>40 kPa^2 (it breaks a constraint)</dd>"));
  assert.ok(against.includes("<dd>-30 kPa^2 (75% lower)</dd>"));
  assert.ok(against.includes("<dd>-10 kPa^2 (50% lower), which is better</dd>"));
});

test("a result that is not feasible says so, in words", () => {
  const knapsack = quick(example("knapsack.json"));
  const project: Project = { ...knapsack, constraints: [...knapsack.constraints!, { name: "Impossible", left: "sum(take)", op: "<=", right: "-1" }] };
  const result = runProject(project), page = reportHtml({ project, result });
  assertInert(page);
  assert.equal(result.best.feasible, false);
  assert.ok(page.includes(`<p class="outcome">No feasible solution found.</p>`));
  assert.ok(page.includes("<strong>Not feasible:</strong> the solution below is the candidate that breaks the constraints least."));
  assert.ok(page.includes("(not feasible)</dd>"));
  assert.ok(page.includes(`<td class="broken">No, broken</td>`));
  assert.doesNotMatch(page, /Best feasible solution found/);
  // the history of such a run holds no results, and the chart says it
  assert.ok(page.includes("No candidate was feasible during this run. The whole line is dashed"));
  // one line only, the dashed gray one, and the legend names it
  assert.equal(page.match(/<path fill="none" stroke="#1d4ed8"/g), null);
  assert.match(page, /<path fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="6 4" d="M/);
  assert.ok(page.includes(">Not a result: the best candidate breaks a constraint</text>"));
});

test("with a comparison: the table and the charts, with the count of feasible runs beside the numbers", () => {
  const knapsack = quick(example("knapsack.json"), 300);
  const impossible: Project = { ...knapsack, constraints: [...knapsack.constraints!, { name: "Impossible", left: "sum(take)", op: "<=", right: "-1" }] };
  const own = runs("Own solver", knapsack), comparison = summarize([own, runs("Random search", withSolver(knapsack, "random"))]);
  const page = reportHtml({ project: knapsack, result: own.results[0], comparison });
  assertInert(page);
  assert.ok(page.includes("<h2>Comparison of experiments</h2>"));
  assert.ok(page.includes("Every experiment was run 3 times, each run with its own seed and with the same budget of 300 evaluations."));
  for (const e of comparison.experiments) {
    assert.ok(page.includes(`<th scope="row">${e.name}</th>\n<td>${METHODS[e.method].name}</td>\n<td>${e.feasibleRuns} of 3</td>\n<td>300 of 300</td>`));
    assert.ok(page.includes(`<strong>${e.name}.</strong> Feasible runs: ${e.feasibleRuns} of 3.`));
  }
  assert.equal(page.match(/<svg /g)?.length, 2 + comparison.experiments.filter((e) => e.feasibleRuns > 0).length);
  // no verdict of any kind
  assert.doesNotMatch(page.replace("They name no winner and they are not a test of significance", ""), /winner|significan|p-value|p =|outperform|wins\b|ranked|rank\b/i);
  assert.equal(reportHtml({ project: knapsack, result: own.results[0] }).includes("Comparison of experiments"), false);

  const none = summarize([runs("Never feasible", impossible)]);
  const empty = reportHtml({ project: impossible, result: runProject(impossible), comparison: none });
  assert.ok(empty.includes(`<td>0 of 3</td>\n<td>300 of 300</td>\n<td colspan="3">No numbers, because no run was feasible</td>`));
  assert.ok(empty.includes("No experiment has a feasible run, so there is no chart."));
});

test("the history of a run is two lines: results, and values of candidates that break a constraint", () => {
  // a knapsack that must carry at least 15 items within 50 kg cannot be done, so no value of the run is a result
  const knapsack = example("knapsack.json");
  const never = runProject(quick({ ...knapsack, constraints: [...knapsack.constraints!, { name: "At least 15 items", left: "sum(take)", op: ">=", right: "15" }] }));
  // the two lines of a chart: the accent line of results, and the dashed gray line of the rest
  const lines = (figure: NonNullable<ReturnType<typeof historyFigure>>) => ["accent", "muted"].map((stroke) => figure.shapes.some((shape) => shape.kind === "path" && shape.stroke === stroke && shape.d.startsWith("M")));
  const dashed = historyFigure(never, "$")!;
  assert.equal(never.best.feasible, false);
  assert.deepEqual(lines(dashed), [false, true]);
  assert.match(dashed.words, /No candidate was feasible during this run\. The whole line is dashed/);
  // a run without constraints is all results, and its words end after the two values
  const free = historyFigure(runProject(quick(example("benchmark.json"))), undefined)!;
  assert.deepEqual(lines(free), [true, false]);
  assert.match(free.words, /^The best value went from \S+ after 4 evaluations to \S+ after 400\.$/);
  assert.equal(free.probes!.length, 100);
  // too few values is no chart
  assert.equal(historyFigure({ ...never, history: { nfe: [1], best: [2] } }, undefined), undefined);
});

test("better and worse are said only of two feasible solutions", () => {
  const other = { objective: 10, difference: -2, feasible: true };
  assert.equal(difference(8, other, "min", true, "km"), "-2 km (20% lower), which is better");
  assert.equal(difference(8, other, "max", true, "km"), "-2 km (20% lower), which is worse");
  assert.equal(difference(8, other, "min", false, "km"), "-2 km (20% lower)");
  assert.equal(difference(8, { ...other, feasible: false }, "min", true, "km"), "-2 km (20% lower)");
  assert.equal(difference(10, { ...other, difference: 0 }, "min", true), "None: the two values agree");
});

test("a breach is phrased in the unit, with a percentage of the limit unless the limit is zero", () => {
  const seen = (op: string, left: unknown, right: unknown, more: object = {}) => breach({ op, left, right, unit: "kg", ...more });
  assert.equal(seen("<=", 53, 50), "Over by 3 kg (6% of the limit)");
  assert.equal(seen(">=", 3, 5), "Short by 2 kg (40% of the limit)");
  assert.equal(seen("==", 4.5, 5), "Apart by 0.5 kg (10% of the limit)");
  assert.equal(seen("==", 5.5, 5), "Apart by 0.5 kg (10% of the limit)");
  assert.equal(seen(">=", -8, -5), "Short by 3 kg (60% of the limit)");
  assert.equal(breach({ op: "<=", left: 1234.5678, right: 1000 }), "Over by 234.568 (23.5% of the limit)");
  // no percentage of a limit of zero
  assert.equal(seen("<=", 3, 0), "Over by 3 kg");
  assert.equal(seen("==", -0.25, 0, { relativeTolerance: 0.5 }), "Apart by 0.25 kg");
  // the words give the difference between the sides, also when a tolerance covers a part of it
  assert.equal(seen("==", 5.5, 5, { tolerance: 0.25, relativeTolerance: 0.01 }), "Apart by 0.5 kg (10% of the limit)");
  // nothing to say when it holds
  for (const [op, left, right, more] of [["<=", 48, 50], [">=", 5, 5], ["==", 5, 5], ["==", 5.2, 5, { tolerance: 0.25 }], ["==", 5.2, 5, { relativeTolerance: 0.05 }], ["<=", -Infinity, 5]] as const) {
    assert.equal(seen(op, left, right, more), "None", `${left} ${op} ${right}`);
  }
  // a constraint that was off was not checked, whatever its sides are
  assert.equal(seen("<=", 53, 50, { applied: false }), "Not checked: the constraint was off");
  assert.equal(seen("<=", 48, 50, { applied: false, satisfied: true }), "Not checked: the constraint was off");
  // the verdict of the result is taken as it is, and a stored result without the newer fields is read by the rule
  assert.equal(seen("<=", 53, 50, { satisfied: false, applied: true, excess: 3, difference: 3, differencePercent: 6 }), "Over by 3 kg (6% of the limit)");
  assert.equal(seen("==", 5.2, 5, { tolerance: 0.25, satisfied: true }), "None");
  assert.equal(seen("==", 5.2, 5, { tolerance: 0.1, satisfied: false }), "Apart by 0.2 kg (4% of the limit)");
  // a side that is not a number: JSON stores it as null, and null must not count as 0
  for (const [left, right] of [[null, 50], [53, null], [NaN, 50], [Infinity, 50], ["53", 50], [undefined, undefined]]) {
    assert.equal(seen("<=", left, right, { satisfied: false }), "Not available: a side is not a number");
    assert.equal(seen("<=", left, right), "Not available: a side is not a number");
  }
  // a limit of infinity is a limit that holds
  assert.equal(seen("<=", 53, Infinity), "None");
  assert.equal(seen(">=", 53, Infinity), "Not available: a side is not a number");
});

test("the rule of a constraint is said in words, with both tolerance values", () => {
  assert.equal(ruleWords({ op: "<=" }), "Exact");
  assert.equal(ruleWords({ op: ">=", tolerance: 0, relativeTolerance: 0 }), "Exact");
  assert.equal(ruleWords({ op: "==" }), "Exact");
  assert.equal(ruleWords({ op: "==", tolerance: 0, relativeTolerance: 0 }), "Exact");
  assert.equal(ruleWords({ op: "==", tolerance: 0.05, unit: "kg" }), "The two sides may differ by 0.05 kg (tolerance 0.05, relative tolerance 0)");
  assert.equal(ruleWords({ op: "==", relativeTolerance: 0.001 }), "The two sides may differ by 0.1% of the size of the right side (tolerance 0, relative tolerance 0.001)");
  assert.equal(ruleWords({ op: "==", tolerance: 0.05, relativeTolerance: 0.01, unit: "kg" }), "The two sides may differ by 0.05 kg plus 1% of the size of the right side (tolerance 0.05, relative tolerance 0.01)");
  // the values are given as they are stored, not rounded
  assert.match(ruleWords({ op: "==", tolerance: 0.1 + 0.2, relativeTolerance: 1 / 3 }), /\(tolerance 0\.30000000000000004, relative tolerance 0\.3333333333333333\)$/);
  // for one solution: a relative tolerance on a right side of zero adds nothing, and the words say so
  assert.equal(ruleWords({ op: "==", relativeTolerance: 0.01, right: 0 }), "The two sides may differ by 1% of the size of the right side (tolerance 0, relative tolerance 0.01). The right side is 0 here, so the relative tolerance adds nothing");
  assert.doesNotMatch(ruleWords({ op: "==", relativeTolerance: 0.01, right: 4 }), /adds nothing/);
  // only "equal to" has tolerances, and a value that is not a number counts as none
  assert.equal(ruleWords({ op: "<=", tolerance: 0.5, relativeTolerance: 0.5 }), "Exact");
  assert.equal(ruleWords({ op: "==", tolerance: "<b>", relativeTolerance: null }), "Exact");
});

test("the report states the rule, whether each constraint was on, both sides and the breach", () => {
  const knapsack = quick(example("knapsack.json"));
  const project = parseProject(JSON.parse(JSON.stringify({ ...knapsack, constraints: [
    ...knapsack.constraints!,
    { name: "Seven items", left: "sum(take)", op: "==", right: "7", unit: "items", tolerance: 1, relative_tolerance: 0.01 },
    { name: "Even count", left: "sum(take) - 2 * ops.floor(sum(take) / 2)", op: "==", right: "0", relative_tolerance: 0.5 },
    { name: "Impossible", left: "sum(take)", op: "<=", right: "-1", unit: "items" },
    { name: "Switched off", left: "sum(take)", op: ">=", right: "40", unit: "items", enabled: false },
  ] })));
  const result = runProject(project), page = reportHtml({ project, result });
  assertInert(page);
  assert.doesNotMatch(page, /undefined|NaN|\[object|no number/);
  const [weight, seven, even, impossible, off] = result.best.checks;
  assert.deepEqual(result.best.checks.map((c) => [c.applied, c.satisfied]), [[true, true], [true, true], [true, true], [true, false], [false, undefined]]);
  // every constraint, on or off, with both sides, its rule, and the breach in the unit and as a percentage
  const row = (cells: string) => assert.ok(page.includes(cells), `the report has the row: ${cells}`);
  row(`<tr><th scope="row">Total weight</th><td>${weight.left} kg</td><td>at most 50 kg</td><td>Exact</td><td class="holds">Yes</td><td>None</td></tr>`);
  row(`<tr><th scope="row">Seven items</th><td>${seven.left} items</td><td>equal to 7 items</td><td>The two sides may differ by 1 items plus 1% of the size of the right side (tolerance 1, relative tolerance 0.01)</td><td class="holds">Yes</td><td>None</td></tr>`);
  row(`<tr><th scope="row">Even count</th><td>0</td><td>equal to 0</td><td>The two sides may differ by 50% of the size of the right side (tolerance 0, relative tolerance 0.5). The right side is 0 here, so the relative tolerance adds nothing</td><td class="holds">Yes</td><td>None</td></tr>`);
  row(`<tr><th scope="row">Impossible</th><td>${impossible.left} items</td><td>at most -1 items</td><td>Exact</td><td class="broken">No, broken</td><td>Over by ${impossible.left + 1} items (${Number(((impossible.left + 1) * 100).toPrecision(3))}% of the limit)</td></tr>`);
  row(`<tr><th scope="row">Switched off</th><td>${off.left} items</td><td>at least 40 items</td><td>Exact</td><td class="off">Off, not checked</td><td></td></tr>`);
  // the constraint that was off is named at the top of the result, and it carries no verdict anywhere
  assert.ok(page.includes(`<p class="note warning"><strong>Not checked:</strong> one constraint was turned off in this run (&quot;Switched off&quot;). The result does not say whether it holds.</p>`));
  assert.equal(page.match(/class="(holds|broken)"/g)?.length, 4);
  // the definition: the rule with both values, on or off, and a scale only for a constraint that was on
  row(`<tr><th scope="row">Seven items</th><td><code>sum(take) == 7</code></td><td>items</td><td>The two sides may differ by 1 items plus 1% of the size of the right side (tolerance 1, relative tolerance 0.01)</td><td>On</td><td>${Number(result.scales[1]!.toPrecision(6))}</td></tr>`);
  row(`<tr><th scope="row">Switched off</th><td><code>sum(take) &gt;= 40</code></td><td>items</td><td>Exact</td><td>Off, not checked</td><td>Not used</td></tr>`);
  assert.ok(page.includes("it holds when the two sides differ by no more than its tolerance plus its relative tolerance times the size of the right side."));
  assert.ok(page.includes("On a right side of 0 the relative tolerance adds nothing."));
  // two constraints off
  const two = parseProject(JSON.parse(JSON.stringify({ ...project, constraints: project.constraints!.map((k, i) => ({ ...k, enabled: i < 3 })) })));
  assert.ok(reportHtml({ project: two, result: runProject(two) }).includes(`<strong>Not checked:</strong> 2 constraints were turned off in this run (&quot;Impossible&quot;, &quot;Switched off&quot;). The result does not say whether they hold.`));
  // a project with every constraint on says nothing about constraints that were off
  assert.doesNotMatch(reportHtml({ project: knapsack, result: runProject(knapsack) }), /Not checked|turned off|class="off"/);
});

test("a result stored before the tolerances and the switch existed is still reported", () => {
  const knapsack = quick(example("knapsack.json"));
  const project: Project = { ...knapsack, constraints: [...knapsack.constraints!, { name: "Impossible", left: "sum(take)", op: "<=", right: "-1" }, { name: "About seven", left: "sum(take)", op: "==", right: "7", tolerance: 30 }] };
  const now = runProject(project);
  // the shape of an older result: the constraints as they were, no list of checks, and a scale for every constraint
  const old = JSON.parse(JSON.stringify(now));
  delete old.best.checks;
  assert.deepEqual(Object.keys(old.best.constraints[0]).sort(), ["left", "name", "op", "right", "satisfied", "tolerance", "unit"]);
  const page = reportHtml({ project, result: old });
  assertInert(page);
  assert.doesNotMatch(page, /undefined|NaN|\[object|no number|Not checked|Off, not checked/);
  // it says what the report of the same run says today
  assert.equal(page, reportHtml({ project, result: JSON.parse(JSON.stringify(now)) }));
  assert.ok(page.includes(`<td>Exact</td><td class="broken">No, broken</td><td>Over by ${now.best.constraints[1].left + 1} (`));
  assert.ok(page.includes(`<td>The two sides may differ by 30 (tolerance 30, relative tolerance 0)</td><td class="holds">Yes</td><td>None</td>`));
});

test("a view of an unknown kind is skipped with a sentence", () => {
  const project = quick(example("knapsack.json")), result = runProject(project);
  const newer = { ...project, view: { kind: "heat<map>", variable: "take" } } as unknown as Project;
  const page = reportHtml({ project: newer, result });
  assertInert(page);
  assert.ok(page.includes("The project has a drawing of the kind \"heat&lt;map&gt;\", which this report cannot draw."));
  assert.equal(page.match(/<svg /g)?.length, 1);
  // a view that no longer fits its data is skipped too
  const misfit = reportHtml({ project: { ...project, view: { kind: "route", variable: "take", x: "weight", y: "nothing" } } as unknown as Project, result });
  assert.ok(misfit.includes("The drawing of the solution could not be made"));
});

test("escaping: content and quoted attribute values", () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;");
  assert.equal(escapeHtml("a\u0000b\u001Bc\td\ne"), "a�b�c\td\ne");
  const hostile = `"><script>alert(1)</script>`;
  assert.equal(html`<p class="${hostile}">${hostile}${[hostile, html`<b>${hostile}</b>`]}${undefined}${false}${null}${0}</p>`.text,
    `<p class="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;<b>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</b>0</p>`);
});

const HOSTILE = [
  `<script>alert(1)</script>`,
  `"onload="alert(1)`,
  `' onmouseover='alert(1)`,
  `</style><script>alert(2)</script>`,
  `</title></head><body onload=alert(3)>`,
  `<img src=x onerror=alert(4)>`,
  `<a href="javascript:alert(5)">link</a>`,
  `<svg onload=alert(6)><iframe src="https://example.invalid/x"></iframe>`,
  `]]><!--<link rel=stylesheet href=//example.invalid/a.css>-->`,
  `&lt;b&gt; \u0000 <base href="https://example.invalid/">`,
];

test("hostile text in a project cannot run script or load anything", () => {
  const knapsack = quick(example("knapsack.json"), 300);
  const [a, b, c, d, e, f, g, h, i, j] = HOSTILE;
  const project = parseProject(JSON.parse(JSON.stringify({
    ...knapsack,
    name: a,
    description: `${d}\n${e}`,
    data: knapsack.data!.map((t: any) => ({ ...t, columns: t.columns.map((col: any) => ({ ...col, unit: b })) })),
    variables: knapsack.variables.map((v) => ({ ...v, unit: c })),
    objective: { ...knapsack.objective, unit: f },
    constraints: knapsack.constraints!.map((k) => ({ ...k, name: g, unit: h })),
    reference: { label: i, objective: 100 },
    run: { ...knapsack.run, name: j },
  })));
  const own = runs(d, project), comparison = summarize([own, runs(g, withSolver(project, "random"))]);
  for (const page of [
    reportHtml({ project, result: own.results[0], comparison, finished: 0 }),
    reportHtml({ project, result: own.results[0], experiment: e, finished: `${a}` }),
  ]) {
    assertInert(page);
    // the text is all there, as text
    for (const text of [a, b, c, f, g, h, i]) assert.ok(page.includes(escapeHtml(text)), text);
    assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  }
});

test("a hostile stored result cannot run script either", () => {
  const project = quick(example("knapsack.json"), 300);
  const result = JSON.parse(JSON.stringify(runProject(project)));
  const [a, b, c, d, e, f, g, h] = HOSTILE;
  result.status = a;
  result.method = d;
  result.settings = { [b]: e, [c]: f };
  result.seed = { base: g, runIndex: h, run: a };
  result.versions = { app: d, ypeaTested: e };
  result.best.constraints[0] = { ...result.best.constraints[0], name: f, unit: g, op: h, left: a, right: b };
  result.best.checks = [
    { name: f, unit: g, op: h, left: a, right: b, tolerance: c, relativeTolerance: d, applied: e, satisfied: f, excess: g, difference: h, differencePercent: a },
    { name: a, unit: b, op: "==", left: 1, right: 2, tolerance: 0.5, relativeTolerance: 0.5, applied: false },
    { name: c, unit: d, op: "<=", left: 3, right: 2, tolerance: 0, relativeTolerance: 0, applied: true, satisfied: false },
  ];
  result.best.objective = c;
  result.best.solution.take = [a, b, [c, d]];
  result.evaluations = { used: e, budget: f };
  result.history.nfe[3] = g;
  result.history.best[5] = h;
  result.timeMs = a;
  result.scales = [b];
  result.reference = { label: c, objective: d, difference: e, feasible: false };
  const comparison = JSON.parse(JSON.stringify(summarize([runs("A", project)])));
  comparison.unit = a;
  comparison.budget = b;
  Object.assign(comparison.experiments[0], { name: c, method: d, runs: e, feasibleRuns: f, evaluations: { budget: g, usedMin: h, usedMax: a }, objective: { median: b, q1: c, q3: d, best: e } });
  comparison.experiments[0].curve.nfe[2] = f;
  comparison.experiments[0].curve.median[4] = g;
  const page = reportHtml({ project, result, comparison });
  assertInert(page);
  assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});
