// The five worked examples, the line fit first. They are bundled with the app.

import { parseProject } from "../../engine/project.ts";
import assignment from "../../examples/assignment.json";
import benchmark from "../../examples/benchmark.json";
import knapsack from "../../examples/knapsack.json";
import linefit from "../../examples/linefit.json";
import tsp from "../../examples/tsp.json";

export const EXAMPLES = [linefit, knapsack, tsp, assignment, benchmark].map(parseProject);
