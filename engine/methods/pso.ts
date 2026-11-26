// Particle Swarm Optimization, from ypea/algorithms/pso.py.

import { copyRow, type Method, popSize, randomPopulation } from "./common.ts";

export const pso: Method = {
  id: "pso",
  name: "Particle Swarm Optimization",
  ypea: "PSO",
  suits: ["real"],
  params: {
    pop_size: popSize,
    w: { kind: "number", default: 1, min: 0, max: 10, help: "Inertia weight." },
    wdamp: { kind: "number", default: 0.99, min: 1e-9, max: 1, help: "The inertia weight is multiplied by this after every iteration." },
    c1: { kind: "number", default: 2, min: 0, max: 10, help: "Personal acceleration coefficient." },
    c2: { kind: "number", default: 2, min: 0, max: 10, help: "Global acceleration coefficient." },
  },
  start(ctx) {
    const { rng, evaluator: ev, dim } = ctx;
    const { pop_size: n, wdamp, c1, c2 } = ctx.settings as Record<string, number>;
    let w = ctx.settings.w as number;
    let pop = randomPopulation(ctx, n);
    const velocity = new Float64Array(n * dim);
    const pbest = { n, X: pop.X.slice(), F: pop.F.slice(), V: pop.V.slice() };
    const r1 = new Float64Array(n * dim), r2 = new Float64Array(n * dim);
    return () => {
      // draw order: all of r1, then all of r2
      rng.fill(r1);
      rng.fill(r2);
      const X = pop.X.slice(), g = ev.bestX!;
      for (let k = 0; k < X.length; k++) {
        const x = X[k];
        let v = w * velocity[k] + c1 * r1[k] * (pbest.X[k] - x) + c2 * r2[k] * (g[k % dim] - x);
        X[k] = x + v;
        if (X[k] < 0 || X[k] > 1) v = -v;
        velocity[k] = v;
      }
      pop = ev.evaluate(X);
      for (let i = 0; i < n; i++) {
        if (ev.better(pop.F[i], pop.V[i], pbest.F[i], pbest.V[i])) copyRow(pbest, i, pop, i, dim);
      }
      w *= wdamp;
    };
  },
};
