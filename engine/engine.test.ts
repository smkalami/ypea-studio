import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Evaluator } from "./evaluator.ts";
import { npMean, npSum } from "./numpy.ts";
import { buildCurve, buildProblem, parseProject, type Solution } from "./project.ts";
import { deriveSeed, philox, Rng } from "./rng.ts";
import { randomCandidate, runProject, testCandidate } from "./run.ts";
import { makeVariable, toPlain } from "./variables.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const benchmark = () => parseProject(read("../examples/benchmark.json"));

test("philox matches the published test vectors", () => {
  assert.deepEqual(philox(0, 0, 0), [0xff1dae59, 0x6cd10df2]);
  assert.deepEqual(philox(0xffffffff, 0xffffffff, 0xffffffff), [0x2c3f628b, 0xab4fd7ad]);
  assert.deepEqual(philox(0x243f6a88, 0x85a308d3, 0x13198a2e), [0xdd7ce038, 0xf62a4c12]);
});

test("generator matches the Python reference draw for draw", () => {
  const cases = read("../spec/parity/rng.json");
  const rng = new Rng(cases.seed) as any;
  for (const { method, args, values } of cases.draws) {
    for (const expected of values) {
      const got = method === "permutation" ? Array.from(rng.permutation(...args)) : rng[method](...args);
      assert.deepEqual(got, expected, method);
    }
  }
  const { base, seeds } = cases.derivedSeeds;
  assert.deepEqual(seeds.map((_: number, i: number) => deriveSeed(base, i)), seeds);
});

test("npSum and npMean add as NumPy adds", () => {
  for (const { values, sum, mean } of read("../spec/parity/numpy.json").cases) {
    assert.equal(npSum(values), sum, `sum of ${values.length}`);
    assert.equal(npMean(values), mean, `mean of ${values.length}`);
    assert.equal(npSum([0, ...values, 0], 1, values.length + 1), sum, "with offsets");
  }
});

test("progress is reported after every iteration", () => {
  const seen: number[] = [];
  const result = runProject(benchmark(), { onProgress: (p) => seen.push(p.best.objective) });
  assert.equal(seen.length, 20000 / 100); // the first population, then one report per iteration
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a));
  assert.equal(seen.at(-1), result.best.objective);
});

test("every variable type decodes as ypea decodes it", () => {
  const { cases } = read("../spec/parity/variables.json");
  assert.equal(new Set(cases.map((c: any) => c.variable.type)).size, 11);
  for (const { variable, codes, decoded } of cases) {
    const v = makeVariable(variable);
    assert.equal(v.codeSize, codes[0].length, variable.type);
    codes.forEach((row: number[], i: number) => {
      // codes sit at an offset, as they do inside a population
      const got = toPlain(v, v.decode(Float64Array.from([9, 9, ...row]), 2));
      assert.deepEqual(got, decoded[i], `${JSON.stringify(variable)} row ${i}`);
    });
  }
});

test("the first five worked examples run and report in the user's terms", () => {
  const run = (name: string) => runProject(parseProject(read(`../examples/${name}.json`)));

  // the line fit lands close to the least-squares line and far below the current settings
  const fit = run("linefit");
  assert.equal(fit.status, "Best feasible solution found");
  assert.equal(fit.reference!.label, "Least-squares line");
  assert.ok(Math.abs(fit.reference!.difference) < 1e-6);
  assert.equal(fit.baseline!.label, "Current settings");
  assert.ok(fit.baseline!.difference < -50);
  assert.deepEqual(Object.keys(fit.best.solution), ["offset", "gain"]);

  // the knapsack reports its weight in kg against the limit, and holds it
  const knapsack = run("knapsack");
  const [weight] = knapsack.best.constraints;
  assert.deepEqual({ name: weight.name, op: weight.op, right: weight.right, unit: weight.unit }, { name: "Total weight", op: "<=", right: 50, unit: "kg" });
  assert.ok(knapsack.best.feasible && weight.satisfied && weight.left <= 50 && weight.left > 30);
  assert.equal(knapsack.scales.length, 1);
  assert.ok(knapsack.scales[0] > 1);
  assert.equal(knapsack.baseline, undefined);

  // the route and the assignment are compared with their baselines, in objective units
  const tsp = run("tsp"), assignment = run("assignment");
  assert.equal(tsp.baseline!.label, "Nearest-neighbor tour");
  assert.equal(tsp.baseline!.difference, tsp.best.objective - tsp.baseline!.objective);
  assert.equal(tsp.baseline!.feasible, true);
  assert.deepEqual([...(tsp.best.solution.route as number[])].sort((x, y) => x - y), Array.from({ length: 30 }, (_, i) => i));
  assert.equal(new Set(assignment.best.solution.task as number[]).size, 8);

  assert.ok(run("benchmark").best.objective < 1e-6);
});

test("the vehicle routing example gives feasible routes that are shorter than the plan in use today", () => {
  const json = read("../examples/vrp.json"), project = parseProject(structuredClone(json));
  const demand: number[] = json.data[1].columns[0].values, distance: number[][] = json.data[2].values;
  // the data: a depot and 15 customers, and a limit that matters (the vehicles are about four fifths full)
  assert.deepEqual([json.data[0].columns[0].values.length, demand.length, distance.length, distance[0].length], [16, 15, 16, 16]);
  const share = demand.reduce((a, b) => a + b, 0) / (4 * 60);
  assert.ok(share > 0.7 && share < 0.9, `the demand is ${share} of the capacity`);

  // the plan in use today is a real plan: every customer once, within the limit, and the engine agrees with a count by hand
  const plan: number[][] = project.baseline!.solution.routes as number[][];
  assert.deepEqual(plan.flat().sort((a, b) => a - b), demand.map((_, i) => i));
  const byHand = plan.reduce((total, g) => total + [0, ...g.map((c) => c + 1)].reduce((sum, node, i, path) => sum + distance[node][path[i + 1] ?? 0], 0), 0);
  const loads = plan.map((g) => g.reduce((sum, c) => sum + demand[c], 0));
  const today = testCandidate(project, project.baseline!.solution);
  assert.ok(Math.abs(today.objective - byHand) < 1e-9);
  assert.deepEqual(today.constraints, [{ name: "Heaviest load", op: "<=", unit: "kg", tolerance: 0, left: Math.max(...loads), right: 60, satisfied: true }]);
  assert.equal(today.feasible, true);

  // the run of the example: feasible, in kg against the limit, every customer in exactly one route, and shorter than today's plan
  const result = runProject(project);
  const [load] = result.best.constraints;
  assert.equal(result.status, "Best feasible solution found");
  assert.deepEqual({ name: load.name, op: load.op, right: load.right, unit: load.unit, satisfied: load.satisfied }, { name: "Heaviest load", op: "<=", right: 60, unit: "kg", satisfied: true });
  const routes = result.best.solution.routes as number[][];
  assert.equal(routes.length, 4);
  assert.deepEqual(routes.flat().sort((a, b) => a - b), demand.map((_, i) => i));
  assert.equal(load.left, Math.max(...routes.map((g) => g.reduce((sum, c) => sum + demand[c], 0))));
  assert.equal(result.baseline!.feasible, true);
  assert.ok(result.baseline!.difference < -100, `the difference is ${result.baseline!.difference} km`);
});

test("a candidate is tested in original units before any run", () => {
  const knapsack = parseProject(read("../examples/knapsack.json"));
  const nothing = testCandidate(knapsack, { take: new Array(20).fill(0) });
  assert.deepEqual([nothing.objective, nothing.feasible, nothing.constraints[0].left], [0, true, 0]);
  const everything = testCandidate(knapsack, { take: new Array(20).fill(1) });
  assert.equal(everything.feasible, false);
  assert.ok(everything.constraints[0].left > 50 && !everything.constraints[0].satisfied);
  assert.throws(() => testCandidate(knapsack, { take: [1, 0] }), /"take" must be a list of 20/);
  assert.throws(() => testCandidate(knapsack, {}), /every variable/);

  // the baseline of the line fit is its own stored comparison value
  const fit = parseProject(read("../examples/linefit.json"));
  assert.equal(testCandidate(fit, fit.baseline!.solution).objective, runProject(fit).baseline!.objective);

  // a random candidate is a valid one, and the same seed gives the same one
  const tsp = parseProject(read("../examples/tsp.json")), candidate = randomCandidate(tsp, 3);
  assert.deepEqual(candidate, randomCandidate(tsp, 3));
  assert.ok(Number.isFinite(testCandidate(tsp, candidate).objective));
});

test("an infeasible result says so, and an equality can have a tolerance", () => {
  const project = benchmark();
  project.run.budget = 20000;
  project.constraints = [{ name: "Sum", left: "sum(x)", op: "==", right: "3" }];
  const exact = runProject(project);
  // ten real variables almost never add up to exactly 3
  assert.equal(exact.status, "No feasible solution found");
  assert.equal(exact.best.feasible, false);
  assert.ok(Math.abs(exact.best.constraints[0].left - 3) < 0.5);
  project.constraints[0].tolerance = 0.05;
  const loose = runProject(project);
  assert.equal(loose.status, "Best feasible solution found");
  assert.ok(Math.abs(loose.best.constraints[0].left - 3) <= 0.05);
  // the recorded scales repeat the run exactly
  const again = runProject(project, { scales: loose.scales });
  assert.deepEqual(again.best.codes, loose.best.codes);
});

test("a constraint can carry a relative tolerance and can be turned off, and a file is checked for both", () => {
  const project = (constraints: unknown[]) => {
    const p = read("../examples/benchmark.json");
    p.constraints = constraints;
    p.run.budget = 600;
    return parseProject(p);
  };
  const sum = { name: "Sum", left: "sum(x)", op: "==", right: "3", unit: "m" };
  const bad = (constraint: object, message: RegExp) => assert.throws(() => project([{ ...sum, ...constraint }]), message);
  bad({ relative_tolerance: -0.1 }, /constraint "Sum": "relative_tolerance" must be a number that is not negative, and only "==" can have one/);
  bad({ relative_tolerance: "1%" }, /"relative_tolerance" must be a number/);
  bad({ relative_tolerance: Infinity }, /"relative_tolerance" must be a number/);
  bad({ relative_tolerance: null }, /"relative_tolerance" must be a number/);
  bad({ op: "<=", relative_tolerance: 0.01 }, /"relative_tolerance" must be a number that is not negative, and only "==" can have one/);
  bad({ op: ">=", relative_tolerance: 0 }, /only "==" can have one/);
  bad({ tolerance: -1 }, /"tolerance" must be a number that is not negative/);
  bad({ enabled: "no" }, /constraint "Sum": "enabled" must be true or false/);
  bad({ enabled: 0 }, /"enabled" must be true or false/);
  bad({ enabled: null }, /"enabled" must be true or false/);
  // the text of a constraint that is off is still translated, so a mistake in it is still reported
  assert.throws(() => runProject(project([{ ...sum, left: "sum(x", enabled: false }])), /the left side of "Sum"/);
  assert.throws(() => testCandidate(project([{ ...sum, right: "y", enabled: false }]), { x: new Array(10).fill(0) }), /the right side of "Sum"/);
  // zero, both together, and a constraint of any kind switched off or on are all valid
  project([{ ...sum, tolerance: 0, relative_tolerance: 0, enabled: true }, { ...sum, name: "b", tolerance: 0.5, relative_tolerance: 0.01 }, { ...sum, name: "c", op: "<=", enabled: false }]);

  // absent means: no relative tolerance, and switched on
  const candidate = { x: [3.3, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const [exact] = testCandidate(project([sum]), candidate).checks;
  assert.deepEqual(exact, { name: "Sum", op: "==", unit: "m", tolerance: 0, relativeTolerance: 0, applied: true, left: 3.3, right: 3, satisfied: false, excess: 3.3 - 3, difference: 3.3 - 3, differencePercent: ((3.3 - 3) / 3) * 100 });
  const seen = testCandidate(project([{ ...sum, relative_tolerance: 0.2 }, { ...sum, name: "Tight", tolerance: 0.1, relative_tolerance: 0.01 }, { ...sum, name: "Off", enabled: false }]), candidate);
  assert.deepEqual(seen.checks.map((c) => [c.name, c.applied, c.satisfied, c.excess]), [
    ["Sum", true, true, (3.3 - 3) - (0 + 0.2 * 3)],
    ["Tight", true, false, (3.3 - 3) - (0.1 + 0.01 * 3)],
    ["Off", false, undefined, undefined],
  ]);
  // a constraint that is off carries both sides and nothing that reads as a verdict
  assert.deepEqual(seen.checks[2], { name: "Off", op: "==", unit: "m", tolerance: 0, relativeTolerance: 0, applied: false, left: 3.3, right: 3 });
  // the older list holds the constraints that were applied, in the shape it always had
  assert.deepEqual(seen.constraints, [
    { name: "Sum", op: "==", unit: "m", tolerance: 0, left: 3.3, right: 3, satisfied: true },
    { name: "Tight", op: "==", unit: "m", tolerance: 0.1, left: 3.3, right: 3, satisfied: false },
  ]);
  assert.equal(seen.feasible, false);
  // a broken constraint that is off never makes a candidate infeasible
  const loose = testCandidate(project([{ ...sum, relative_tolerance: 0.2 }, { ...sum, name: "Off", enabled: false }]), candidate);
  assert.deepEqual([loose.feasible, loose.constraints.length, loose.checks.length], [true, 1, 2]);
  assert.deepEqual([testCandidate(project([{ ...sum, enabled: false }]), candidate).feasible, testCandidate(project([sum]), candidate).feasible], [true, false]);

  // a run: the constraint that is off has no scale and adds nothing to the violation
  const both = project([{ ...sum, relative_tolerance: 0.02 }, { name: "Never", left: "sum(x * x)", op: "<=", right: "-1", enabled: false }]);
  const result = runProject(both);
  assert.equal(result.scales.length, 2);
  assert.ok(typeof result.scales[0] === "number" && result.scales[0] > 0 && result.scales[1] === null);
  assert.deepEqual([result.status, result.best.feasible, result.best.violation], ["Best feasible solution found", true, 0]);
  assert.deepEqual(result.best.checks.map((c) => [c.name, c.applied, c.satisfied]), [["Sum", true, true], ["Never", false, undefined]]);
  assert.ok(result.best.checks[1].left > result.best.checks[1].right);
  assert.deepEqual(result.best.constraints.map((c) => c.name), ["Sum"]);
  // the same run without the constraint that is off, and again from its recorded scales
  const without = runProject(project([both.constraints![0]]));
  assert.deepEqual([without.trace, without.best.codes, without.scales], [result.trace, result.best.codes, [result.scales[0]]]);
  assert.deepEqual(runProject(both, { scales: result.scales }).best.codes, result.best.codes);
  // a number in the place of the scale of a constraint that is off is not read, and one that is on needs its scale
  assert.deepEqual(runProject(both, { scales: [result.scales[0], 123] }).scales, result.scales);
  for (const scales of [[null, null], [result.scales[0]], [0, null], [-1, null], [NaN, null]]) {
    assert.throws(() => runProject(both, { scales }), /one positive scale for every constraint that is on/);
  }
  // switched on, the same constraint makes the run infeasible
  const on = runProject(project([both.constraints![0], { ...both.constraints![1], enabled: true }]));
  assert.deepEqual([on.best.feasible, on.best.checks[1].satisfied, on.best.checks[1].applied], [false, false, true]);
});

test("the route objective stays far above the speed target", () => {
  // the target is 100,000 evaluations per second for the 50-city route objective
  const n = 50, rng = new Rng(8);
  const distance = Array.from({ length: n }, () => Array.from({ length: n }, () => rng.uniform(1, 100)));
  const problem = buildProblem(parseProject({
    format: "ypea-studio-project", version: 1, name: "Speed",
    data: [{ name: "distance", kind: "matrix", values: distance }],
    variables: [{ name: "route", type: "permutation", n }],
    objective: { sense: "min", source: "sum(distance[route, ops.roll(route, -1)])" },
    run: { method: "random", settings: {}, budget: 1, seed: 1 },
  }));
  const solution = problem.decode(rng.fill(new Float64Array(problem.dim)), 0);
  let evaluations = 0, sink = 0;
  const started = performance.now();
  while (performance.now() - started < 50) {
    for (let k = 0; k < 1000; k++) sink += problem.objective(solution);
    evaluations += 1000;
  }
  const perSecond = evaluations / ((performance.now() - started) / 1000);
  assert.ok(sink > 0 && perSecond > 100_000, `${Math.round(perSecond)} evaluations per second`);
});

test("the same project gives the same result twice, and a new run index changes it", () => {
  const strip = ({ timeMs, ...rest }: ReturnType<typeof runProject>) => rest;
  assert.deepEqual(strip(runProject(benchmark())), strip(runProject(benchmark())));
  assert.notEqual(runProject(benchmark(), { runIndex: 1 }).best.objective, runProject(benchmark()).best.objective);
});

test("the budget is never exceeded and the benchmark converges", () => {
  for (const method of ["pso", "random"]) {
    const project = benchmark();
    project.run = { method, settings: {}, budget: 2050, seed: 3 };
    let calls = 0;
    const problem = buildProblem(project);
    const objective = problem.objective;
    const ev = new Evaluator({ ...problem, objective: (s) => (calls++, objective(s)) }, 2050);
    ev.evaluate(new Float64Array(3000 * problem.dim).fill(0.25));
    assert.equal(calls, 2050);
    assert.equal(ev.done, true);
    assert.equal(runProject(project).evaluations.used, 2050);
  }
  const pso = runProject(benchmark()), random = benchmark();
  random.run.method = "random";
  assert.ok(pso.best.objective < 1e-6);
  assert.ok(pso.best.objective < runProject(random).best.objective);
});

test("maximization, non-finite values and bad project files", () => {
  const project = benchmark();
  project.objective.sense = "max";
  project.run.budget = 2000;
  assert.ok(runProject(project).best.objective > 500); // the corners of [-10, 10]^10 give 1000

  const problem = { ...buildProblem(benchmark()), objective: (s: Solution) => ((s.x as Float64Array)[0] < 0 ? -Infinity : 1) };
  const ev = new Evaluator(problem, 10);
  ev.evaluate(new Float64Array(20).fill(0.1).fill(0.9, 10));
  assert.equal(ev.bestF, 1);

  const bad = (change: (p: any) => void, message: RegExp) => {
    const p = read("../examples/benchmark.json");
    change(p);
    assert.throws(() => runProject(parseProject(p)), message);
  };
  bad((p) => (p.version = 2), /version 2 is not supported/);
  bad((p) => (p.variables[0].type = "matrix"), /is not known/);
  bad((p) => (p.variables[0].shape = [1e9]), /"shape" must be/);
  bad((p) => p.variables.push({ name: "x", type: "binary", shape: [] }), /used twice/);
  bad((p) => (p.baseline = { label: "now", solution: { y: 1 } }), /every variable/);
  bad((p) => (p.baseline = { label: "now", solution: { x: new Array(10).fill(11) } }), /"baseline.solution": "x" must be from -10 to 10/);
  bad((p) => (p.objective.source = "sum(x ** 2"), /the objective/);
  bad((p) => (p.objective.source = "sum(y ** 2)"), /y/);
  bad((p) => (p.objective.source = "x ** 2"), /single number/);
  bad((p) => (p.objective.source = "globalThis"), /the objective/);
  bad((p) => (p.functions = "import os\n"), /functions/);
  bad((p) => (p.constraints = [{ name: "c", left: "sum(x)", op: "<", right: "1" }]), /"op" must be/);
  bad((p) => (p.constraints = [{ name: "c", left: "sum(x)", op: "<=", right: "1", tolerance: 0.1 }]), /only "==" can have one/);
  bad((p) => (p.constraints = [{ name: "c", left: "x", op: "<=", right: "1" }]), /left side of "c"/);
  bad((p) => (p.data = [{ name: "t", kind: "columns", columns: [{ name: "a", values: [1] }, { name: "b", values: [1, 2] }] }]), /same length/);
  bad((p) => (p.variables[0].ub = -20), /upper bound is below/);
  bad((p) => (p.run.budget = 0), /budget/);
  bad((p) => (p.run.seed = -1), /seed/);
  bad((p) => (p.run.method = "magic"), /Unknown method/);
  bad((p) => (p.run.settings = { w: -1 }), /"w" must be/);
  bad((p) => (p.run.settings = { speed: 1 }), /no setting "speed"/);
  bad((p) => (p.run.settings = { w: "fast" }), /"w" must be/);
  bad((p) => (p.run.settings = { w: [1] }), /run.settings/);
  for (const name of ["constructor", "__proto__", "class", "for", "sum", "ops", "lambda"]) {
    bad((p) => (p.variables[0].name = name), /is reserved/);
  }
});

test("a view names real columns and variables, and a fitted line gives its curve", () => {
  const fit = parseProject(read("../examples/linefit.json"));
  assert.deepEqual(fit.view, { kind: "line", x: "voltage", y: "pressure", expression: "offset + gain * voltage" });
  const curve = buildCurve(fit)!;
  // voltage starts at 0.5 and ends at 4.5
  const y = curve({ offset: 1, gain: 2 });
  assert.equal(y.length, 12);
  assert.deepEqual([y[0], y[11]], [2, 10]);
  assert.throws(() => curve({ offset: 1 }), /every variable/);
  assert.equal(buildCurve(parseProject(read("../examples/tsp.json"))), undefined);
  assert.equal(buildCurve(benchmark()), undefined);

  const bad = (name: string, change: (p: any) => void, message: RegExp) => {
    const p = read(`../examples/${name}.json`);
    change(p);
    assert.throws(() => buildCurve(parseProject(p)), message);
  };
  bad("linefit", (p) => (p.view.x = "offset"), /"view.x" must be the name of a data column/);
  bad("linefit", (p) => (p.view.expression = 3), /"view.expression" must be text/);
  bad("linefit", (p) => (p.view.kind = "pie"), /"view.kind" must be/);
  bad("linefit", (p) => (p.view = "line"), /"view" must be an object/);
  bad("linefit", (p) => (p.view.expression = "offset + gain"), /In the drawing, line 1, column 1: This must give a list/);
  // a list of another length is found when a solution is drawn
  const short = read("../examples/linefit.json");
  short.view.expression = "voltage[0:3] * gain";
  assert.throws(() => buildCurve(parseProject(short))!({ offset: 1, gain: 2 }), /one value for each row of "voltage"/);
  bad("linefit", (p) => (p.view.expression = "offset + window"), /In the drawing, line 1/);
  bad("linefit", (p) => {
    p.data.push({ name: "more", kind: "columns", columns: [{ name: "z", values: [1] }] });
    p.view.y = "z";
  }, /same length/);
  bad("tsp", (p) => (p.view.variable = "x"), /"view.variable" must be the name of a permutation variable/);
  bad("tsp", (p) => {
    p.variables[0].n = 31;
    p.baseline.solution.route.push(30);
  }, /a row for every position of "route"/);
  bad("knapsack", (p) => (p.view.variable = "weight"), /"view.variable" must be the name of a list of 0 or 1 values/);
  bad("knapsack", (p) => (p.variables[0].shape = [19]), /"view.size" must have one value for every item of "take"/);
  // the size column is optional
  const knapsack = read("../examples/knapsack.json");
  delete knapsack.view.size;
  assert.equal(parseProject(knapsack).view!.kind, "selection");

  // several routes from one depot: a partition variable, coordinates for the depot and every item, and the row of the depot
  assert.deepEqual(parseProject(read("../examples/vrp.json")).view, { kind: "routes", variable: "routes", x: "x", y: "y", depot: 0, distance: "distance" });
  // the table of distances is optional, for one route and for several: a square table with a row for every row of the coordinates
  const distanceTable = /"view.distance" must be the name of a square data table with a row and a column for every row of "x"/;
  bad("vrp", (p) => (p.view.distance = "demand"), distanceTable);
  bad("vrp", (p) => (p.view.distance = "nothing"), distanceTable);
  bad("vrp", (p) => (p.view.distance = 3), distanceTable);
  bad("vrp", (p) => p.data[2].values.pop(), distanceTable);
  bad("vrp", (p) => (p.data[2].values = p.data[2].values.slice(0, 15).map((row: number[]) => row.slice(0, 15))), distanceTable);
  const without = read("../examples/vrp.json");
  delete without.view.distance;
  assert.equal("distance" in parseProject(without).view!, false);
  const tour = read("../examples/tsp.json");
  tour.view.distance = "distance";
  assert.equal((parseProject(tour).view as { distance?: string }).distance, "distance");
  bad("tsp", (p) => (p.view.distance = "x"), distanceTable);
  assert.equal(buildCurve(parseProject(read("../examples/vrp.json"))), undefined);
  bad("vrp", (p) => (p.view.variable = "x"), /"view.variable" must be the name of a partition variable/);
  bad("vrp", (p) => (p.view.y = "demand"), /"view.x" and "view.y" must have the same length, with a row for the depot and one for every item of "routes"/);
  bad("vrp", (p) => (p.view.x = p.view.y = "demand"), /a row for the depot and one for every item of "routes"/);
  bad("vrp", (p) => (p.view.x = "distance"), /"view.x" must be the name of a data column/);
  for (const depot of [-1, 16, 1.5, "0", undefined]) bad("vrp", (p) => (p.view.depot = depot), /"view.depot" must be the row of the depot, a whole number from 0 to 15/);
  // the depot may be any row, the last one included
  const last = read("../examples/vrp.json");
  last.view.depot = 15;
  assert.equal(parseProject(last).view!.kind, "routes");
  // the drawing of one route does not take a partition, and the drawing of several does not take a permutation
  bad("vrp", (p) => (p.view.kind = "route"), /"view.variable" must be the name of a permutation variable/);
  bad("tsp", (p) => (p.view = { ...p.view, kind: "routes", depot: 0 }), /"view.variable" must be the name of a partition variable/);
  bad("vrp", (p) => (p.view.kind = "tours"), /"view.kind" must be "route", "routes", "line" or "selection"/);
});

test("a project carries more experiments, each checked as the run is", () => {
  const json = read("../examples/benchmark.json");
  json.run.name = "Quick run";
  json.experiments = [{ id: "de-20k", name: "DE 20k", method: "de", settings: {}, budget: 20000, seed: 7 }];
  const project = parseProject(json);
  assert.equal(project.run.name, "Quick run");
  // an experiment runs as a copy of the project whose run is that experiment
  const { id, name, ...setup } = project.experiments![0];
  const result = runProject({ ...project, run: setup });
  assert.deepEqual([result.method, result.seed.base, result.evaluations.budget], ["de", 7, 20000]);
  assert.equal(runProject(project).method, "pso");

  const bad = (change: (p: any) => void, message: RegExp) => {
    const p = structuredClone(json);
    change(p);
    assert.throws(() => parseProject(p), message);
  };
  bad((p) => (p.run.name = 3), /the run's "name" must be text/);
  bad((p) => (p.experiments = {}), /"experiments" must be a list/);
  bad((p) => (p.experiments[0].id = "de 20k"), /every experiment needs an "id"/);
  bad((p) => delete p.experiments[0].id, /every experiment needs an "id"/);
  bad((p) => p.experiments.push({ ...p.experiments[0] }), /the experiment id "de-20k" is used twice/);
  bad((p) => delete p.experiments[0].name, /experiment "de-20k": "name" must be text/);
  bad((p) => (p.experiments[0].method = 1), /experiment "de-20k": "method" must be text/);
  bad((p) => (p.experiments[0].settings = { w: [1] }), /experiment "de-20k": "settings" must hold/);
  bad((p) => (p.experiments[0].budget = 0), /experiment "de-20k": "budget" must be a positive whole number/);
  bad((p) => (p.experiments[0].seed = 2 ** 32), /experiment "de-20k": "seed" must be a whole number/);
});
