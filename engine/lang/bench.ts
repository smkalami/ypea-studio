// Speed of translated objectives in one thread: node engine/lang/bench.ts
// The target is 100,000 evaluations per second for the 50-city route objective.
// "plain" is the translation without loop fusion and scratch buffers, "optimized" is the default.

import { compile, type ProgramSource } from "./index.ts";

// a small fixed generator, so that every run measures the same data
let seed = 12345;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const cities = 50;
const distance = Array.from({ length: cities }, () => Array.from({ length: cities }, () => random() * 100));
const routes = Array.from({ length: 64 }, () => {
  const route = Int32Array.from({ length: cities }, (_, i) => i);
  for (let i = cities - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [route[i], route[j]] = [route[j], route[i]];
  }
  return { route };
});

const voltage = Array.from({ length: 12 }, (_, i) => 0.5 + (4 * i) / 11);
const pressure = voltage.map((v) => 1.7 + 24.3 * v + random());
const lines = Array.from({ length: 64 }, () => ({ offset: Float64Array.of(random() * 20 - 10), gain: Float64Array.of(random() * 100) }));

const route_loop = [
  "def route_cost(r):",
  "    total = 0",
  "    for i in range(len(r)):",
  "        total += distance[r[i], r[(i + 1) % len(r)]]",
  "    return total",
].join("\n");

const benchmarks: { name: string; source: ProgramSource; solutions: Record<string, Float64Array | Int32Array>[] }[] = [
  {
    name: "route, 50 cities: sum(distance[route, ops.roll(route, -1)])",
    source: {
      data: [{ name: "distance", kind: "float", shape: [cities, cities], values: distance }],
      variables: [{ name: "route", kind: "int", shape: [cities] }],
      expressions: [{ label: "objective", source: "sum(distance[route, ops.roll(route, -1)])" }],
    },
    solutions: routes,
  },
  {
    name: "route, 50 cities, written as a loop in a function",
    source: {
      functions: route_loop,
      data: [{ name: "distance", kind: "float", shape: [cities, cities], values: distance }],
      variables: [{ name: "route", kind: "int", shape: [cities] }],
      expressions: [{ label: "objective", source: "route_cost(route)" }],
    },
    solutions: routes,
  },
  {
    name: "line fit, 12 points: sum((pressure - (offset + gain * voltage)) ** 2)",
    source: {
      data: [{ name: "voltage", kind: "float", shape: [12], values: voltage }, { name: "pressure", kind: "float", shape: [12], values: pressure }],
      variables: [{ name: "offset", kind: "float", shape: [] }, { name: "gain", kind: "float", shape: [] }],
      expressions: [{ label: "objective", source: "sum((pressure - (offset + gain * voltage)) ** 2)" }],
    },
    solutions: lines,
  },
];

/**
 * Evaluations per second: the best of three rounds of about 0.1 s, after a warm-up.
 * The rounds are short on purpose. On the machine this was written on, any Node process became
 * about nine times slower after a few seconds of full load (the cause was not found), and a
 * long benchmark measured that instead. The reference loop at the end shows when it happens.
 */
function rate(f: (solution: any) => number, solutions: any[]): { perSecond: number; check: number } {
  // A new timing loop for every measurement. One shared loop would remember the first function
  // it called, and V8 would then run every later function more slowly.
  const round: (f: unknown, solutions: unknown, ms: number) => number = new Function("f", "solutions", "ms", `
    const start = performance.now();
    let count = 0, sink = 0;
    while (performance.now() - start < ms) {
      for (let i = 0; i < 1000; i++) sink += f(solutions[(count + i) & 63]);
      count += 1000;
    }
    return sink === sink ? (count * 1000) / (performance.now() - start) : 0;
  `) as any;
  round(f, solutions, 60);
  let check = 0;
  for (let i = 0; i < 64; i++) check += f(solutions[i]);
  return { perSecond: Math.max(round(f, solutions, 100), round(f, solutions, 100), round(f, solutions, 100)), check };
}

/** A plain loop, to notice when the machine itself slows down during the run. */
function reference(): number {
  const a = Float64Array.from({ length: 50 }, (_, i) => i);
  return rate(() => {
    let s = 0;
    for (let i = 0; i < 50; i++) s += a[i];
    return s;
  }, routes).perSecond;
}

const show = (v: number) => `${(v / 1e6).toFixed(2)} million/s`;
const before = reference();
for (const { name, source, solutions } of benchmarks) {
  const plain = rate(compile(source, { optimize: false }).expressions[0].number, solutions);
  const optimized = rate(compile(source).expressions[0].number, solutions);
  if (!Object.is(plain.check, optimized.check)) throw new Error(`${name}: the two translations disagree`);
  console.log(`${name}\n  plain ${show(plain.perSecond)}, optimized ${show(optimized.perSecond)}, ${(optimized.perSecond / plain.perSecond).toFixed(1)} times faster\n`);
}
const after = reference();
console.log(`reference loop (a sum of 50 numbers): ${show(before)} at the start, ${show(after)} at the end`);
if (after < before / 2) console.log("The machine slowed down during the run, so the numbers above are too low.");
