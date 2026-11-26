import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseProject } from "../project.ts";
import { runProject } from "../run.ts";
import { shade } from "./shade.ts";
import { METHODS } from "./index.ts";
import { assertSameTrace } from "./parity.ts";

const { runs } = JSON.parse(readFileSync(new URL("../../spec/parity/methods/shade.json", import.meta.url), "utf8"));

for (const { name } of runs) test(`SHADE follows ypea's SHADE bit for bit: ${name}`, () => assertSameTrace(name, shade));

test("SHADE with default settings converges on the sphere", () => {
  METHODS.shade = shade;
  const project = structuredClone(runs[0].project);
  project.run = { method: "shade", settings: {}, budget: 20000, seed: 1 };
  const result = runProject(parseProject(project));
  assert.ok(result.best.objective < 1e-5, `best objective ${result.best.objective}`);
});
