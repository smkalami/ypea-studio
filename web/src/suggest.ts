// The solver that the app suggests for a project, from the kinds of its variables. The whole
// rule is the one function `suggest`, so that new measurements change one place. The app never
// chooses for the user: a suggestion is written only into an experiment that the user has not
// changed by hand, and `follow` is what decides that. No browser code.

import { METHODS, type Settings } from "../../engine/methods/index.ts";
import type { Project } from "../../engine/project.ts";
import { type Experiment, experimentsOf, withExperiment } from "./draft.ts";

export interface Suggestion {
  method: string;
  settings: Settings;
  budget: number;
  /** The reason, as the end of a sentence that starts with "… is suggested for this project". */
  why: string;
}

const BUDGET = 20000;
// Three groups of the 11 types. They are not the kinds a solver "suits": exactly k of n and
// groups without order are tables of 0 and 1, but they were measured with the orderings.
const DECIMAL = new Set(["real", "fixed_sum", "fixed_row_sum", "fixed_column_sum"]);
const ORDERED = new Set(["permutation", "selection", "binary_selection", "partition", "binary_partition"]);
const COUNTED = new Set(["binary", "integer"]);
/** The settings of the worked examples: a step that does not shrink. */
const STEADY = { mutation_step_size: 0.3, mutation_step_size_damp: 1 };

/** The suggested solver, settings and budget for these variables. A type that is not known counts for nothing. */
export function suggest(variables: readonly { type?: unknown }[]): Suggestion {
  const has = (group: Set<string>) => variables.some((v) => group.has(String(v?.type)));
  const ordered = has(ORDERED), counted = has(COUNTED), decimal = has(DECIMAL);
  if (ordered && (counted || decimal)) {
    return { method: "ga", settings: { space: "native" }, budget: BUDGET, why: "because it mixes orderings, selections or groups with other kinds of values" };
  }
  if (ordered) {
    return {
      method: "sa", settings: { space: "native", initial_temp: 10, final_temp: 0.01, ...STEADY }, budget: BUDGET,
      why: "because its variables are orderings, selections or groups",
    };
  }
  if (counted) return { method: "ga", settings: { ...STEADY }, budget: BUDGET, why: "because it holds yes or no values or whole numbers" };
  return {
    method: "cmaes", settings: {}, budget: BUDGET,
    why: decimal ? "because it holds only decimal numbers" : "as a start, and the suggestion will follow the variables you add",
  };
}

/** The sentence shown on an experiment that still is the suggestion. */
export function suggestionSentence(variables: readonly { type?: unknown }[]): string {
  const { method, why } = suggest(variables);
  return `${METHODS[method].name} is suggested for this project ${why}. You can change it.`;
}

type Setup = Pick<Suggestion, "method" | "settings" | "budget">;
const settingsText = (settings: Settings) => JSON.stringify(Object.entries(settings ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
/** True when two setups have the same solver, settings and budget. The name and the seed do not count. */
export const sameSetup = (a: Setup, b: Setup) => a.method === b.method && a.budget === b.budget && settingsText(a.settings) === settingsText(b.settings);

/**
 * One edit, seen by the experiments that still follow the suggestion (`following` holds their
 * ids). An experiment whose solver, settings or budget the edit changed is the user's own from
 * now on and leaves the list. The others get the suggestion for the variables as they now are.
 * `changed` lists the experiments that were rewritten, for the message on screen.
 */
export function follow(before: Project, after: Project, following: readonly string[]): { project: Project; following: string[]; changed: Experiment[] } {
  const was = experimentsOf(before), now = experimentsOf(after), suggested = suggest(after.variables ?? []);
  const kept: string[] = [], changed: Experiment[] = [];
  let project = after;
  for (const id of following) {
    const current = now.find((e) => e.id === id), earlier = was.find((e) => e.id === id);
    if (!current || (earlier && !sameSetup(earlier, current))) continue;
    kept.push(id);
    if (sameSetup(current, suggested)) continue;
    const next = { ...current, method: suggested.method, settings: { ...suggested.settings }, budget: suggested.budget };
    project = withExperiment(project, next);
    changed.push(next);
  }
  return { project, following: kept, changed };
}
