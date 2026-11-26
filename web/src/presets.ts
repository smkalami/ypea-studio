// Presets write an ordinary expression from a few names of the project. The text they give
// goes into the field and stays editable. A preset that needs helper functions writes them
// into the functions of the project, and never replaces a function that is already there.

import type { Constraint, Project } from "../../engine/project.ts";

/** One thing a preset asks for, and which names of the project can fill it. */
export interface Need {
  key: string;
  label: string;
  from: "column" | "matrix" | "number-variable" | "list-variable" | "yes-no-variable" | "ordering-variable" | "groups-variable" | "number" | "text";
  /** What a typed need holds at first. */
  initial?: string;
  /** May stay empty. */
  optional?: boolean;
  hint?: string;
}

/** A helper function that a preset writes, by its name. */
export interface Helper {
  name: string;
  text: string;
}

export interface Preset {
  id: string;
  label: string;
  help: string;
  needs: Need[];
  /** The expression, from the chosen name for every need. */
  write(names: Record<string, string>): string;
  /** The helper functions that the expression calls. */
  helpers?(names: Record<string, string>): Helper[];
  /** Why the chosen values cannot be used, when they cannot. */
  refuse?(names: Record<string, string>, project: Project): string | undefined;
}

const def = (lines: string[]) => lines.join("\n") + "\n";

/**
 * The length of one route and of all routes. With the depot in row 0, item i is row i + 1 of
 * the table. With the depot elsewhere, the items skip its row: item i is row i + 1 from the
 * depot's row on, and row i before it.
 */
function routeHelpers(n: Record<string, string>): Helper[] {
  const depot = n.depot.trim(), d = n.distance;
  const length = depot === "0"
    ? [`    return ${d}[0, g[0] + 1] + sum(${d}[g[:-1] + 1, g[1:] + 1]) + ${d}[g[-1] + 1, 0]`]
    : [`    stops = g + (g >= ${depot})`, `    return ${d}[${depot}, stops[0]] + sum(${d}[stops[:-1], stops[1:]]) + ${d}[stops[-1], ${depot}]`];
  return [
    { name: "route_length", text: def(["def route_length(g):", "    if len(g) == 0:", "        return 0", ...length]) },
    { name: "total_length", text: def(["def total_length(groups):", "    total = 0", "    for g in groups:", "        total += route_length(g)", "    return total"]) },
  ];
}

export const OBJECTIVE_PRESETS: Preset[] = [
  {
    id: "weighted-sum", label: "Weighted sum",
    help: "Each value of a variable times its weight, added up.",
    needs: [{ key: "weights", label: "Weights (data column)", from: "column" }, { key: "x", label: "Variable", from: "list-variable" }],
    write: (n) => `sum(${n.weights} * ${n.x})`,
  },
  {
    id: "route-cost", label: "Route cost",
    help: "The length of a round trip that visits every position in the order of the variable.",
    needs: [{ key: "distance", label: "Distance table (matrix)", from: "matrix" }, { key: "route", label: "Ordering variable", from: "ordering-variable" }],
    write: (n) => `sum(${n.distance}[${n.route}, ops.roll(${n.route}, -1)])`,
  },
  {
    id: "routes-length", label: "Total length of several routes",
    help:
      "Every group is one route that leaves the depot, visits its items in order and returns. An empty group is a route of length 0. " +
      "The table holds the depot and every item: the depot in the row and column given here, and the items in the others, in their order.",
    needs: [
      { key: "routes", label: "Ordered groups variable", from: "groups-variable" },
      { key: "distance", label: "Distance table (matrix)", from: "matrix" },
      { key: "depot", label: "Row of the depot", from: "number", initial: "0", hint: "In the table. Rows start at 0." },
    ],
    write: (n) => `total_length(${n.routes})`,
    helpers: routeHelpers,
    refuse(n, project) {
      const variable = (project.variables ?? []).find((v) => v.name === n.routes), depot = Number(n.depot);
      const items = variable?.type === "partition" && Number.isInteger(variable.n) ? variable.n : undefined;
      return Number.isInteger(depot) && depot >= 0 && (items === undefined || depot <= items) ? undefined : `The row of the depot must be a whole number from 0 to ${items ?? "the number of items"}.`;
    },
  },
  {
    id: "selected-total", label: "Total of selected items",
    help: "The total of a data column over the items that are switched on.",
    needs: [{ key: "values", label: "Value of each item (data column)", from: "column" }, { key: "take", label: "Yes or no variable", from: "yes-no-variable" }],
    write: (n) => `sum(${n.values} * ${n.take})`,
  },
  {
    id: "assignment-cost", label: "Assignment cost",
    help: "Row i of the cost table gets the column that the variable holds at position i.",
    needs: [{ key: "cost", label: "Cost table (matrix)", from: "matrix" }, { key: "task", label: "Ordering variable", from: "ordering-variable" }],
    write: (n) => `sum(${n.cost}[range(len(${n.task})), ${n.task}])`,
  },
  {
    id: "squared-error", label: "Squared error of a straight line",
    help: "How far the line offset + gain * input is from the measured values, squared and added up.",
    needs: [
      { key: "y", label: "Measured values (data column)", from: "column" },
      { key: "x", label: "Input values (data column)", from: "column" },
      { key: "offset", label: "Offset variable", from: "number-variable" },
      { key: "gain", label: "Gain variable", from: "number-variable" },
    ],
    write: (n) => `sum((${n.y} - (${n.offset} + ${n.gain} * ${n.x})) ** 2)`,
  },
];

export const CAPACITY_PRESET: Preset = {
  id: "capacity-limit", label: "Capacity limit",
  help: "The total of a data column over the chosen items must stay within a limit.",
  needs: [
    { key: "sizes", label: "Size of each item (data column)", from: "column" },
    { key: "take", label: "Variable", from: "list-variable" },
    { key: "limit", label: "Limit", from: "number" },
  ],
  write: (n) => `sum(${n.sizes} * ${n.take})`,
};

export const LOAD_PRESET: Preset = {
  id: "largest-load", label: "Largest load of a group at most a limit",
  help: "The loads of the items of each group are added up, and the largest of these totals must stay within the limit. For example, no vehicle may carry more than it can hold.",
  needs: [
    { key: "groups", label: "Ordered groups variable", from: "groups-variable" },
    { key: "loads", label: "Load of each item (data column)", from: "column" },
    { key: "limit", label: "Limit", from: "number" },
    { key: "unit", label: "Unit", from: "text", optional: true, hint: "Empty takes the unit of the column." },
  ],
  write: (n) => `heaviest_load(${n.groups})`,
  helpers: (n) => [{
    name: "heaviest_load",
    text: def(["def heaviest_load(groups):", "    worst = 0", "    for g in groups:", `        load = sum(${n.loads}[g])`, "        if load > worst:", "            worst = load", "    return worst"]),
  }],
};

export const CONSTRAINT_PRESETS = [CAPACITY_PRESET, LOAD_PRESET];

/** The constraint that a constraint preset adds. */
export function presetConstraint(preset: Preset, names: Record<string, string>, project: Project): Constraint {
  if (preset.id !== LOAD_PRESET.id) return capacityConstraint(names, project);
  const unit = names.unit.trim() || columnsOf(project).find((c) => c.name === names.loads)?.unit;
  return { name: "Largest load", left: preset.write(names), op: "<=", right: names.limit.trim(), ...(unit ? { unit } : {}) };
}

/**
 * The functions of a project with the helpers of a preset. A helper is added only when no
 * function of its name exists, so that nothing the user wrote is replaced. `added` and `kept`
 * are the names of the helpers, to say what happened.
 */
export function withHelpers(functions: string | undefined, helpers: Helper[]): { functions: string | undefined; added: string[]; kept: string[] } {
  const has = (name: string) => new RegExp(`^def[ \\t]+${name}[ \\t]*\\(`, "m").test(functions ?? "");
  const kept = helpers.filter((h) => has(h.name)), added = helpers.filter((h) => !has(h.name));
  const before = (functions ?? "").trimEnd();
  const text = added.length ? [...(before ? [before + "\n"] : []), ...added.map((h) => h.text)].join("\n") : functions;
  return { functions: text, added: added.map((h) => h.name), kept: kept.map((h) => h.name) };
}

/** What a preset did to the functions, in words. Empty when the preset has no helpers. */
export function helpersNote(added: string[], kept: string[]): string {
  const one = kept.length === 1;
  return [
    added.length ? `Added to Functions: ${added.join(", ")}.` : "",
    kept.length ? `Functions already has ${kept.join(", ")}, which ${one ? "was kept as it is" : "were kept as they are"}. Check that ${one ? "it does" : "they do"} what this preset expects.` : "",
  ].filter(Boolean).join(" ");
}

/** The constraint that the capacity preset adds. It takes its unit from the data column. */
export function capacityConstraint(names: Record<string, string>, project: Project): Constraint {
  const unit = columnsOf(project).find((c) => c.name === names.sizes)?.unit;
  return { name: `Total ${names.sizes}`, left: CAPACITY_PRESET.write(names), op: "<=", right: names.limit.trim(), ...(unit ? { unit } : {}) };
}

export const columnsOf = (project: Project) => (project.data ?? []).flatMap((t) => (t.kind === "columns" ? t.columns ?? [] : []));

/** The names of the project that can fill a need. */
export function optionsFor(project: Project, from: Need["from"]): string[] {
  const variables = project.variables ?? [];
  const dims = (v: (typeof variables)[number]) => ("shape" in v && Array.isArray(v.shape) ? v.shape.length : 1);
  switch (from) {
    case "column": return columnsOf(project).map((c) => c.name);
    case "matrix": return (project.data ?? []).filter((t) => t.kind === "matrix").map((t) => t.name);
    case "number-variable": return variables.filter((v) => (v.type === "real" || v.type === "integer") && dims(v) === 0).map((v) => v.name);
    case "list-variable": return variables.filter((v) => v.type !== "partition" && v.type !== "binary_partition" && dims(v) === 1).map((v) => v.name);
    case "yes-no-variable": return variables.filter((v) => (v.type === "binary" && dims(v) === 1) || v.type === "binary_selection").map((v) => v.name);
    case "ordering-variable": return variables.filter((v) => v.type === "permutation" || v.type === "selection").map((v) => v.name);
    case "groups-variable": return variables.filter((v) => v.type === "partition").map((v) => v.name);
    case "number": case "text": return [];
  }
}
