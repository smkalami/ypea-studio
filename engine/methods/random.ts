// Random Search, from ypea/algorithms/random_search.py. The reference method of comparisons.

import { type Method, popSize, randomPopulation } from "./common.ts";

export const random: Method = {
  id: "random",
  name: "Random Search",
  ypea: "RandomSearch",
  suits: ["real", "integer", "binary", "ordering"],
  params: { pop_size: popSize },
  start(ctx) {
    const step = () => void randomPopulation(ctx, ctx.settings.pop_size as number);
    step();
    return step;
  },
};
