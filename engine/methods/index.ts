// The registry of methods. A method is added here when its parity test passes.

import type { Method, Settings } from "./common.ts";
import { cmaes } from "./cmaes.ts";
import { de } from "./de.ts";
import { ga } from "./ga.ts";
import { ica } from "./ica.ts";
import { nelderMead } from "./nelder_mead.ts";
import { pso } from "./pso.ts";
import { random } from "./random.ts";
import { sa } from "./sa.ts";
import { shade } from "./shade.ts";

export type { Method, ParamSpec, Settings, SettingValue } from "./common.ts";

export const METHODS: Record<string, Method> = Object.fromEntries([random, pso, de, shade, ga, sa, cmaes, nelderMead, ica].map((m) => [m.id, m]));

/** The method's defaults with the project's settings on top, checked against the declared specs. */
export function resolveSettings(method: Method, given: Settings): Settings {
  const out: Settings = {};
  for (const [key, spec] of Object.entries(method.params)) out[key] = spec.default;
  for (const [key, value] of Object.entries(given)) {
    const spec = Object.hasOwn(method.params, key) ? method.params[key] : undefined;
    if (!spec) throw new Error(`${method.name} has no setting "${key}"`);
    const bad = (expected: string): never => {
      throw new Error(`${method.name}: "${key}" must be ${expected}`);
    };
    if (spec.kind === "boolean") {
      if (typeof value !== "boolean") bad("true or false");
    } else if (spec.kind === "choice") {
      if (typeof value !== "string" || !spec.options.includes(value)) bad(`one of ${spec.options.join(", ")}`);
    } else if (!(value === null && spec.nullable)) {
      const ok = typeof value === "number" && value >= spec.min && value <= spec.max && (!spec.integer || Number.isInteger(value));
      if (!ok) bad(`${spec.integer ? "a whole number" : "a number"} from ${spec.min} to ${spec.max}${spec.nullable ? ", or empty" : ""}`);
    }
    out[key] = value;
  }
  return out;
}
