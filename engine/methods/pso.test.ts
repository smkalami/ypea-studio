import { test } from "node:test";
import { assertSameTrace } from "./parity.ts";
import { pso } from "./pso.ts";
import { random } from "./random.ts";

test("PSO follows ypea's PSO bit for bit", () => assertSameTrace("pso_sphere", pso));
test("Random Search follows ypea's RandomSearch bit for bit", () => assertSameTrace("random_sphere", random));
