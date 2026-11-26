import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseProject } from "../project.ts";
import { runProject } from "../run.ts";
import { de } from "./de.ts";
import { METHODS } from "./index.ts";
import { assertSameTrace } from "./parity.ts";

const { runs } = JSON.parse(readFileSync(new URL("../../spec/parity/methods/de.json", import.meta.url), "utf8"));

for (const { name } of runs) test(`DE follows ypea's DE bit for bit: ${name}`, () => assertSameTrace(name, de));

test("DE with default settings converges on the sphere", () => {
  METHODS.de = de;
  const project = structuredClone(runs[0].project);
  project.run = { method: "de", settings: {}, budget: 20000, seed: 1 };
  const result = runProject(parseProject(project));
  assert.ok(result.best.objective < 1e-5, `best objective ${result.best.objective}`);
});
