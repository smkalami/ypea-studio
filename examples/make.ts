// Writes the worked examples that carry synthetic data: node examples/make.ts
// The data are drawn from the Studio generator with fixed seeds, so every run writes the
// same files. benchmark.json has no data and is written by hand.

import { mkdirSync, writeFileSync } from "node:fs";
import { Rng } from "../engine/rng.ts";

const here = (path: string) => new URL(path, import.meta.url);
const round = (x: number, digits: number) => Number(x.toFixed(digits));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const header = { format: "ypea-studio-project", version: 1 };

function save(name: string, project: object, csvName: string, columns: string[], rows: number[][]) {
  writeFileSync(here(`${name}.json`), JSON.stringify(project, null, 2) + "\n");
  writeFileSync(here(`data/${csvName}.csv`), [columns.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n");
  console.log("wrote", name);
}

mkdirSync(here("data/"), { recursive: true });

// 1. Calibration line fit
{
  const rng = new Rng(11), n = 12;
  const voltage = range(n).map((i) => round(0.5 + (4 * i) / (n - 1), 2));
  const pressure = voltage.map((v) => round(2 + 25 * v + 0.8 * rng.standardNormal(), 2));
  // the least-squares line, as the known answer
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mv = mean(voltage), mp = mean(pressure);
  const gain = voltage.reduce((s, v, i) => s + (v - mv) * (pressure[i] - mp), 0) / voltage.reduce((s, v) => s + (v - mv) ** 2, 0);
  save("linefit", {
    ...header,
    name: "Calibration line fit",
    description: "Fit the offset and gain of a pressure sensor to calibration readings. The data are synthetic.",
    data: [{
      name: "calibration", kind: "columns",
      columns: [{ name: "voltage", unit: "V", values: voltage }, { name: "pressure", unit: "kPa", values: pressure }],
    }],
    variables: [
      { name: "offset", type: "real", shape: [], lb: -10, ub: 10, unit: "kPa" },
      { name: "gain", type: "real", shape: [], lb: 0, ub: 100, unit: "kPa/V" },
    ],
    objective: { sense: "min", unit: "kPa^2", source: "sum((pressure - (offset + gain * voltage)) ** 2)" },
    baseline: { label: "Current settings", solution: { offset: 0, gain: 24 } },
    reference: { label: "Least-squares line", solution: { offset: mp - gain * mv, gain } },
    view: { kind: "line", x: "voltage", y: "pressure", expression: "offset + gain * voltage" },
    run: { method: "pso", settings: {}, budget: 5000, seed: 1 },
  }, "calibration", ["voltage", "pressure"], voltage.map((v, i) => [v, pressure[i]]));
}

// 2. 0/1 knapsack
{
  const rng = new Rng(22), n = 20;
  const weight = range(n).map(() => rng.integers(2, 16));
  const value = range(n).map(() => rng.integers(10, 101));
  save("knapsack", {
    ...header,
    name: "0/1 knapsack",
    description: "Choose items to carry so that their total value is as large as possible within a weight limit. The data are synthetic.",
    data: [{
      name: "items", kind: "columns",
      columns: [{ name: "weight", unit: "kg", values: weight }, { name: "value", unit: "$", values: value }],
    }],
    variables: [{ name: "take", type: "binary", shape: [n] }],
    objective: { sense: "max", unit: "$", source: "sum(value * take)" },
    constraints: [{ name: "Total weight", left: "sum(weight * take)", op: "<=", right: "50", unit: "kg" }],
    view: { kind: "selection", variable: "take", size: "weight" },
    run: { method: "random", settings: {}, budget: 20000, seed: 1 },
  }, "items", ["weight", "value"], weight.map((w, i) => [w, value[i]]));
}

// 3. Traveling salesman
{
  const rng = new Rng(33), n = 30;
  const x = range(n).map(() => rng.integers(0, 101)), y = range(n).map(() => rng.integers(0, 101));
  const distance = range(n).map((i) => range(n).map((j) => round(Math.hypot(x[i] - x[j], y[i] - y[j]), 2)));
  // the nearest-neighbor tour from city 0, as the solution in use today
  const route = [0];
  while (route.length < n) {
    const from = route[route.length - 1];
    const rest = range(n).filter((c) => !route.includes(c));
    route.push(rest.reduce((best, c) => (distance[from][c] < distance[from][best] ? c : best)));
  }
  save("tsp", {
    ...header,
    name: "Traveling salesman",
    description: "Find a short round trip through 30 cities. The data are synthetic.",
    data: [
      { name: "cities", kind: "columns", columns: [{ name: "x", unit: "km", values: x }, { name: "y", unit: "km", values: y }] },
      { name: "distance", kind: "matrix", unit: "km", values: distance },
    ],
    variables: [{ name: "route", type: "permutation", n }],
    objective: { sense: "min", unit: "km", source: "sum(distance[route, ops.roll(route, -1)])" },
    baseline: { label: "Nearest-neighbor tour", solution: { route } },
    view: { kind: "route", variable: "route", x: "x", y: "y" },
    run: { method: "random", settings: {}, budget: 50000, seed: 1 },
  }, "cities", ["x", "y"], x.map((v, i) => [v, y[i]]));
}

// 4. Assignment
{
  const rng = new Rng(44), n = 8;
  const cost = range(n).map(() => range(n).map(() => rng.integers(10, 100)));
  // row by row, each worker takes the cheapest task that is still free
  const task: number[] = [];
  for (const row of cost) task.push(range(n).filter((t) => !task.includes(t)).reduce((best, t) => (row[t] < row[best] ? t : best)));
  save("assignment", {
    ...header,
    name: "Assignment",
    description: "Give each of 8 workers one task so that the total cost is as small as possible. Row i of the cost table is worker i. The data are synthetic.",
    data: [{ name: "cost", kind: "matrix", unit: "$", values: cost }],
    variables: [{ name: "task", type: "permutation", n }],
    objective: { sense: "min", unit: "$", source: "sum(cost[range(8), task])" },
    baseline: { label: "Row-by-row greedy assignment", solution: { task } },
    run: { method: "random", settings: {}, budget: 20000, seed: 1 },
  }, "cost", range(n).map((t) => `task_${t}`), cost);
}
