// Runs a project file from the command line: node engine/cli.ts <project.json> [--full]

import { readFileSync } from "node:fs";
import { parseProject } from "./project.ts";
import { runProject } from "./run.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node engine/cli.ts <project.json> [--full]");
  process.exit(2);
}
try {
  const result = runProject(parseProject(JSON.parse(readFileSync(file, "utf8"))));
  if (args.includes("--full")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { best, evaluations, seed, method } = result;
    console.log(result.status);
    console.log(`Objective: ${best.objective}`);
    for (const other of [result.baseline, result.reference]) {
      if (other) console.log(`${other.label ?? "Reference"}: ${other.objective} (difference ${other.difference})`);
    }
    for (const c of best.constraints) {
      console.log(`${c.satisfied ? "Holds" : "Broken"}: ${c.name} ${c.left} ${c.op} ${c.right}${c.unit ? " " + c.unit : ""}`);
    }
    console.log(`Solution: ${JSON.stringify(best.solution)}`);
    console.log(`Evaluations: ${evaluations.used} of ${evaluations.budget}, ${result.timeMs.toFixed(0)} ms`);
    console.log(`One run of ${method} with seed ${seed.base} (run ${seed.runIndex}).`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
