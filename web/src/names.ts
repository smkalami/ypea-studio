// Where a name of the project is used: in the objective, in the sides of the constraints, in
// the functions, in the drawing, in the candidate and in the stored solutions. The app asks
// before something that is used is removed, and can carry a new name to the places that use
// the old one. Code is read as names, never as text: `weight` is not found inside
// `weight_limit` or in a comment. Nothing here translates or runs the code. No browser code.

import type { Project } from "../../engine/project.ts";

/** What a name belongs to. The three kinds are visible in different places (spec/language.md, section 1). */
export type NameKind = "variable" | "data" | "function";

export interface Ref {
  name: string;
  start: number;
  end: number;
}

const START = /[A-Za-z_]/, PART = /[A-Za-z0-9_]/;
/** A name that an expression can use. */
export const isName = (text: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text);

/**
 * Every name that the code refers to, with its place. Left out: comments, numbers (the `e`
 * of `1e3`), a name after a dot (`ops.roll`), and a keyword of a call (`axis=0`).
 */
export function refs(code: string): Ref[] {
  const found: Ref[] = [];
  let depth = 0, i = 0, before = "";
  while (i < code.length) {
    const ch = code[i];
    if (ch === "#") {
      while (i < code.length && code[i] !== "\n") i++;
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(code[i + 1] ?? ""))) {
      // a number, with its fraction and its exponent
      while (i < code.length && (PART.test(code[i]) || code[i] === "." || (/[+-]/.test(code[i]) && /[eE]/.test(code[i - 1]) && /[0-9]/.test(code[i + 1] ?? "")))) i++;
      before = "0";
    } else if (START.test(ch)) {
      const start = i;
      while (i < code.length && PART.test(code[i])) i++;
      const after = code.slice(i).match(/^[ \t]*(=?)(=?)/)!;
      const keyword = depth > 0 && after[1] === "=" && after[2] === "";
      if (before !== "." && !keyword) found.push({ name: code.slice(start, i), start, end: i });
      before = "a";
    } else {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      if (!/\s/.test(ch)) before = ch;
      i++;
    }
  }
  return found;
}

/** The functions of a project, one block for each `def`, with the names that belong to the function itself. */
function blocks(functions: string): { name: string; start: number; text: string; own: Set<string> }[] {
  const starts = [...functions.matchAll(/^def[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm)];
  return starts.map((match, n) => {
    const start = match.index, text = functions.slice(start, starts[n + 1]?.index ?? functions.length);
    const head = text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"));
    // its parameters, and the names it sets itself: these hide a data name inside the function
    const own = new Set(refs(head.slice(head.indexOf("(") + 1)).map((r) => r.name));
    for (const line of text.matchAll(/^[ \t]+(?:for[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:[-+*/]?=(?!=)|in\b)/gm)) own.add(line[1]);
    return { name: match[1], start, text, own };
  });
}

/** The names of the functions, in their order. */
export const defNames = (functions: string | undefined): string[] => blocks(functions ?? "").map((block) => block.name);

/** The places in the functions where a name of this kind is used, each with the function it is in. */
function inFunctions(functions: string, name: string, kind: NameKind): (Ref & { def: string })[] {
  // a function cannot see the variables: it gets them as arguments, so the same word there is a name of its own
  if (kind === "variable") return [];
  return blocks(functions).flatMap((block) => {
    if (kind === "data" && block.own.has(name)) return [];
    const all = refs(block.text).filter((r) => r.name === name);
    // the first name of a block is the one after `def`: the function itself, not a use of it
    const used = kind === "function" && block.name === name ? all.slice(1) : all;
    return used.map((r) => ({ name, start: block.start + r.start, end: block.start + r.end, def: block.name }));
  });
}

const replaceAll = (code: string, places: Ref[], to: string) =>
  [...places].sort((a, b) => b.start - a.start).reduce((text, place) => text.slice(0, place.start) + to + text.slice(place.end), code);

/** An expression with every use of a name renamed. Other names, comments and numbers are left alone. */
export const rename = (code: string, from: string, to: string) => replaceAll(code, refs(code).filter((r) => r.name === from), to);

/** One place that uses a name: the entry of the sidebar it belongs to, and what to call it in a sentence. */
export interface Use {
  where: string;
  place: string;
}

const uses = (code: unknown, name: string) => typeof code === "string" && refs(code).some((r) => r.name === name);
const holds = (solution: unknown, name: string) => typeof solution === "object" && solution !== null && Object.hasOwn(solution, name);

/**
 * Every place that uses a name. `texts` is the candidate that is being typed, by the name of
 * each variable. A project that is still being edited may have holes, so everything is read with care.
 */
export function usesOf(project: Project, name: string, kind: NameKind, texts: Record<string, string> = {}): Use[] {
  const found: Use[] = [];
  if (uses(project.objective?.source, name)) found.push({ where: "objective", place: "The objective" });
  (project.constraints ?? []).forEach((c, i) => {
    if (uses(c?.left, name) || uses(c?.right, name)) found.push({ where: `constraint.${i}`, place: `The constraint "${c.name}"` });
  });
  for (const def of new Set(inFunctions(project.functions ?? "", name, kind).map((r) => r.def))) found.push({ where: "functions", place: `The function ${def}` });
  const view = (project.view ?? {}) as Record<string, unknown>;
  const picked = kind === "variable" ? [view.variable] : kind === "data" ? [view.x, view.y, view.size, view.distance] : [];
  if (picked.includes(name) || uses(view.expression, name)) found.push({ where: "view", place: "The drawing" });
  if (kind === "variable") {
    if ((texts[name] ?? "").trim() !== "") found.push({ where: "candidate", place: "The candidate that is being tested" });
    if (holds(project.baseline?.solution, name)) found.push({ where: "baseline", place: "The baseline" });
    if (holds(project.reference?.solution, name)) found.push({ where: "reference", place: "The known solution" });
  }
  return found;
}

const renamedKey = <T,>(record: Record<string, T>, from: string, to: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key === from ? to : key, value]));

/** The project with every use of a name carried to the new name. The thing that has the name is not touched. */
export function renameUses(project: Project, from: string, to: string, kind: NameKind): Project {
  const next: Record<string, any> = { ...project, objective: { ...project.objective, source: rename(project.objective.source, from, to) } };
  if (project.constraints) next.constraints = project.constraints.map((c) => ({ ...c, left: rename(c.left, from, to), right: rename(c.right, from, to) }));
  if (project.functions) next.functions = replaceAll(project.functions, inFunctions(project.functions, from, kind), to);
  if (project.view) {
    const view: Record<string, unknown> = { ...project.view };
    for (const key of kind === "variable" ? ["variable"] : kind === "data" ? ["x", "y", "size", "distance"] : []) if (view[key] === from) view[key] = to;
    if (typeof view.expression === "string") view.expression = rename(view.expression, from, to);
    next.view = view;
  }
  if (kind === "variable") {
    if (holds(project.baseline?.solution, from)) next.baseline = { ...project.baseline, solution: renamedKey(project.baseline!.solution, from, to) };
    if (holds(project.reference?.solution, from)) next.reference = { ...project.reference, solution: renamedKey(project.reference!.solution!, from, to) };
  }
  return next as Project;
}

/** The typed candidate with the text of a renamed variable under its new name too. The old one stays, so that an undo finds it. */
export const renamedTexts = (texts: Record<string, string>, from: string, to: string): Record<string, string> =>
  from in texts ? { ...texts, [to]: texts[from] } : texts;
