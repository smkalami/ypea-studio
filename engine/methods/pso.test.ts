import { test } from "node:test";
import { assertSameTrace } from "./parity.ts";
import { pso } from "./pso.ts";
import { random } from "./random.ts";

test("PSO follows ypea's PSO bit for bit", () => assertSameTrace("pso_sphere", pso));
test("PSO with a final inertia weight follows ypea's PSO bit for bit", () => assertSameTrace("pso_sphere_w_final", pso));
test("PSO with a velocity limit follows ypea's PSO bit for bit", () => assertSameTrace("pso_sphere_max_velocity", pso));
test("PSO with both follows ypea's PSO bit for bit", () => assertSameTrace("pso_rosenbrock_both", pso));
test("Random Search follows ypea's RandomSearch bit for bit", () => assertSameTrace("random_sphere", random));
