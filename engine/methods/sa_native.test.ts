import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sa } from "./sa.ts";
import { assertSameTrace } from "./parity.ts";

// every run of the file, so a run added there is tested without a change here
const runs: { name: string }[] = JSON.parse(readFileSync(new URL("../../spec/parity/methods/sa_native.json", import.meta.url), "utf8")).runs;

test("there are runs with native operators", () => assert.ok(runs.length >= 8));

for (const { name } of runs) test(`${name} follows ypea's SA with native operators bit for bit`, () => assertSameTrace(name, sa));
