// The messages between the page and its two workers, and the workers' side of them.
// The run worker does one run. The helper worker checks a project, tests a candidate or
// draws a random one. Both exist because the text of a project becomes code: it must never
// be translated or run on the page, and only ending a worker can stop a loop that is too long.
// This file has no browser code, so it is tested in Node.

import { LanguageError } from "../../engine/lang/index.ts";
import { METHODS, resolveSettings } from "../../engine/methods/index.ts";
import { buildCurve, buildProblem, parseProject, type PlainSolution, type Project } from "../../engine/project.ts";
import { randomCandidate, runProject, testCandidate, type Inspection, type Progress, type RunResult } from "../../engine/run.ts";
import { exportPython } from "../../export/python.ts";
import { solutionFigure } from "../../export/figures/build.ts";
import { figureSvg } from "../../export/figures/figure.ts";
import { reportHtml, type ReportInput } from "../../export/report.ts";

/**
 * Page to run worker. A worker does one run at a time. Cancel is `worker.terminate()`, so it
 * needs no message. A quiet run posts no progress, only its result or its error.
 */
export type RunRequest = { type: "run"; project: unknown; runIndex?: number; quiet?: boolean };

/** Run worker to page. `result` or `error` comes once and is the last message. `curve` is the fitted line of a line view. */
export type RunMessage =
  | { type: "progress"; progress: Progress; curve?: number[] }
  | { type: "result"; result: RunResult; curve?: number[] }
  | { type: "error"; message: string };

/**
 * Page to helper worker. One worker answers one request. The last three write a file from a
 * stored result: the Python script, the report, and the drawing of the solution as an SVG file.
 * They are asked of a worker because each of them translates the text of the project.
 */
export type HelpRequest =
  | { type: "check"; project: unknown }
  | { type: "test"; project: unknown; solution: PlainSolution }
  | { type: "random"; project: unknown; seed: number }
  | { type: "python"; project: unknown; result: RunResult }
  | { type: "report"; input: Omit<ReportInput, "project"> & { project: unknown } }
  | { type: "drawing"; project: unknown; solution: PlainSolution; curve?: number[] };

/**
 * A problem in a project, and the part of the editor it belongs to. `where` is a path such as
 * "objective", "functions", "variable.1.lb", "constraint.0.left", "data.0.column.1", "view",
 * "baseline", "reference" or "experiment.<id>" (the id is empty for the project's `run`).
 */
export interface Issue {
  where: string;
  message: string;
  /** For code: the line and column, both from 1. */
  line?: number;
  column?: number;
}

export type HelpReply =
  | { type: "checked"; issues: Issue[] }
  | { type: "tested"; inspection: Inspection; curve?: number[] }
  | { type: "candidate"; solution: PlainSolution }
  | { type: "text"; text: string }
  | { type: "error"; message: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs the project and posts progress at most once per `minIntervalMs`, then the result or the error. */
export function handleRun(request: RunRequest, post: (message: RunMessage) => void, minIntervalMs = 50): void {
  try {
    let last = -Infinity;
    const project = parseProject(request.project);
    const curve = buildCurve(project);
    // a drawing that fails must not end the run
    const drawn = (solution: PlainSolution) => {
      try {
        return curve ? { curve: curve(solution) } : {};
      } catch {
        return {};
      }
    };
    const result = runProject(project, {
      runIndex: request.runIndex,
      onProgress: request.quiet ? undefined : (progress) => {
        const now = performance.now();
        if (now - last < minIntervalMs) return;
        last = now;
        post({ type: "progress", progress, ...drawn(progress.best.solution) });
      },
    });
    post({ type: "result", result, ...drawn(result.best.solution) });
  } catch (error) {
    post({ type: "error", message: messageOf(error) });
  }
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** The part of the editor that a message of `parseProject` is about. */
export function locate(message: string, json: unknown): string {
  const p = isObject(json) ? json : {};
  const tables = list(p.data), variables = list(p.variables);
  // every name an expression can use, in the order the engine reads them
  const claims: [unknown, string][] = [];
  tables.forEach((t, i) => {
    claims.push([t?.name, `data.${i}`]);
    list(t?.columns).forEach((c, j) => claims.push([c?.name, `data.${i}.column.${j}`]));
  });
  variables.forEach((v, i) => claims.push([v?.name, `variable.${i}.name`]));
  const indexOf = (items: any[], name: string) => items.findIndex((item) => item?.name === name);
  let m: RegExpMatchArray | null;

  if (/"baseline/.test(message)) return "baseline";
  if (/reference/.test(message)) return "reference";
  if (/"view/.test(message)) return "view";
  if ((m = message.match(/experiment "(.*?)":/))) return `experiment.${m[1]}`;
  if (/"run\.|the run's/.test(message)) return "experiment.";
  if (/experiment/.test(message)) return "experiments";
  if ((m = message.match(/the name "(.*)" is (reserved|used twice)/))) {
    const found = claims.filter(([name]) => name === m![1]);
    return (m[2] === "reserved" ? found[0] : found[1])?.[1] ?? "overview";
  }
  if (/needs a "name" made of/.test(message)) {
    return claims.find(([name]) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))?.[1] ?? "overview";
  }
  if ((m = message.match(/variable "(.*?)":(?: "(\w+)")?/))) {
    const i = indexOf(variables, m[1]);
    return i < 0 ? "variables" : m[2] ? `variable.${i}.${m[2]}` : `variable.${i}`;
  }
  if ((m = message.match(/column "(.*?)":/))) return claims.find(([name, where]) => name === m![1] && where.includes("column"))?.[1] ?? "data";
  if ((m = message.match(/table "(.*?)":/))) return indexOf(tables, m[1]) < 0 ? "data" : `data.${indexOf(tables, m[1])}`;
  if (/data table|"data"|the data is too large/.test(message)) return "data";
  if (/"variables"/.test(message)) return "variables";
  if ((m = message.match(/constraint "(.*?)":/))) return indexOf(list(p.constraints), m[1]) < 0 ? "constraints" : `constraint.${indexOf(list(p.constraints), m[1])}`;
  if (/constraint/.test(message)) return "constraints";
  if (/objective/.test(message)) return "objective";
  return "overview";
}

/**
 * Every problem that stops a project from running: the first one the project file has, or, for
 * a file that passes, one for each field of code that cannot be translated and one for each
 * experiment whose settings are wrong. An empty list means the project can run.
 */
export function checkProject(json: unknown): Issue[] {
  // an unfinished project gets a plain next step instead of the file format's wording
  if (isObject(json) && Array.isArray(json.variables) && json.variables.length === 0) {
    return [{ where: "variables", message: "Add at least one variable." }];
  }
  let project: Project;
  const issues: Issue[] = [];
  // a copy, because the check changes it
  const copy = structuredClone(json);
  for (;;) {
    try {
      project = parseProject(copy);
      break;
    } catch (error) {
      const message = messageOf(error), where = locate(message, copy);
      issues.push({ where, message: message.replace(/^Project file: /, "") });
      // The drawing, the baseline and the reference only show or compare. When one of them is what
      // fails, for example after a column it names was removed, it is set aside and the check goes
      // on, so that the expressions that lost the same name show their own problem too.
      if (!["view", "baseline", "reference"].includes(where) || !isObject(copy) || copy[where] === undefined) return issues;
      delete copy[where];
    }
  }
  for (const setup of [{ id: "", ...project.run }, ...(project.experiments ?? [])]) {
    try {
      const method = Object.hasOwn(METHODS, setup.method) ? METHODS[setup.method] : undefined;
      if (!method) throw new Error(`Unknown solver "${setup.method}".`);
      resolveSettings(method, setup.settings);
    } catch (error) {
      issues.push({ where: `experiment.${setup.id}`, message: messageOf(error) });
    }
  }
  if (project.objective.source.trim() === "") {
    issues.push({ where: "objective", message: "Write what to minimize or maximize, or use a preset." });
    project.objective.source = "0";
  }

  // The translator stops at the first problem. A field with a problem is set aside and the
  // rest is translated again, so that every field shows its own problem.
  const constraints = project.constraints ?? [];
  const fields = new Map<string, { where: string; skip: () => void }>([
    ["the objective", { where: "objective", skip: () => (project.objective.source = "0") }],
    ["the drawing", { where: "view", skip: () => delete project.view }],
  ]);
  constraints.forEach((c, i) => {
    for (const side of ["left", "right"] as const) {
      const label = `the ${side} side of "${c.name}"`;
      if (!fields.has(label)) fields.set(label, { where: `constraint.${i}.${side}`, skip: () => (constraints[i] = { ...constraints[i], [side]: "0" }) });
    }
  });
  for (let tries = fields.size; tries >= 0; tries--) {
    try {
      buildProblem(project);
      buildCurve(project);
      break;
    } catch (error) {
      if (!(error instanceof LanguageError)) {
        issues.push({ where: "overview", message: messageOf(error) });
        break;
      }
      const field = fields.get(error.field);
      issues.push({
        where: field?.where ?? "functions",
        message: error.message.replace(/^In .*?, line \d+, column \d+: /, ""),
        line: error.line,
        column: error.column,
      });
      // a problem in the functions hides everything that uses them
      if (!field) break;
      field.skip();
      fields.delete(error.field);
    }
  }
  return issues;
}

/** The helper worker's side: one request, one reply. */
export function handleHelp(request: HelpRequest): HelpReply {
  try {
    if (request.type === "check") return { type: "checked", issues: checkProject(request.project) };
    if (request.type === "report") return { type: "text", text: reportHtml({ ...request.input, project: parseProject(request.input.project) }) };
    const project = parseProject(request.project);
    if (request.type === "python") return { type: "text", text: exportPython(project, request.result) };
    // empty when the project has no drawing, or none that can be drawn
    if (request.type === "drawing") {
      const drawn = solutionFigure(project, request.solution, request.curve);
      return { type: "text", text: drawn && "figure" in drawn ? figureSvg(drawn.figure, "file", "drawing") : "" };
    }
    if (request.type === "random") return { type: "candidate", solution: randomCandidate(project, request.seed) };
    const inspection = testCandidate(project, request.solution);
    let curve: number[] | undefined;
    try {
      curve = buildCurve(project)?.(request.solution);
    } catch {
      // the check shows what is wrong with the drawing
    }
    return { type: "tested", inspection, ...(curve ? { curve } : {}) };
  } catch (error) {
    return { type: "error", message: messageOf(error) };
  }
}

/** What `ask` needs from a worker. A browser Worker fits. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): unknown;
  onmessage: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
}

export const TIME_LIMIT_MS = 5000;
export const tooLong = (limitMs: number) =>
  `This takes too long, so it was stopped after ${limitMs / 1000} seconds. Look for a loop over a very large range in the functions.`;

/**
 * Sends one request to a fresh helper worker and gives its reply. The worker is ended after
 * the reply, and also when the time limit passes: that is the only way to stop code that loops.
 */
export function ask(worker: WorkerLike, request: HelpRequest, limitMs = TIME_LIMIT_MS): Promise<HelpReply> {
  return new Promise((resolve) => {
    const end = (reply: HelpReply) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(() => end({ type: "error", message: tooLong(limitMs) }), limitMs);
    worker.onmessage = (event) => end(event.data);
    worker.onerror = (event) => end({ type: "error", message: `The check could not run. ${event.message ?? ""}`.trim() });
    worker.postMessage(request);
  });
}

/**
 * Does every request, each in one of `size` workers, and tells where each result belongs by the
 * position of its request. So nothing depends on the order in which the workers finish. The
 * first error ends all of it. Returns the way to stop: it ends every worker, and nothing is
 * told after it.
 */
export function runJobs(
  requests: RunRequest[], size: number, spawn: () => WorkerLike,
  on: { result: (index: number, result: RunResult) => void; error: (message: string) => void },
): () => void {
  const workers: WorkerLike[] = [];
  let next = 0, stopped = false;
  const stop = () => {
    stopped = true;
    for (const worker of workers) worker.terminate();
  };
  const fail = (message: string) => {
    if (stopped) return;
    stop();
    on.error(message);
  };
  for (let k = 0; k < Math.min(size, requests.length); k++) {
    const worker = spawn();
    workers.push(worker);
    let index = -1;
    const take = () => {
      if (next >= requests.length) return void worker.terminate();
      index = next++;
      worker.postMessage(requests[index]);
    };
    worker.onmessage = ({ data }: { data: RunMessage }) => {
      if (stopped || data.type === "progress") return;
      if (data.type === "error") return fail(data.message);
      on.result(index, data.result);
      take();
    };
    worker.onerror = (event) => fail(`A run could not start. ${event.message ?? ""}`.trim());
    take();
  }
  return stop;
}
