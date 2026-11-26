// Presets write an ordinary expression from a few names of the project. The text they give
// goes into the field and stays editable.

import type { Constraint, Project } from "../../engine/project.ts";

/** One thing a preset asks for, and which names of the project can fill it. */
export interface Need {
  key: string;
  label: string;
  from: "column" | "matrix" | "number-variable" | "list-variable" | "yes-no-variable" | "ordering-variable" | "number";
}

export interface Preset {
  id: string;
  label: string;
  help: string;
  needs: Need[];
  /** The expression, from the chosen name for every need. */
  write(names: Record<string, string>): string;
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
    case "number": return [];
  }
}
