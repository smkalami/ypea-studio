// Projects and results in the browser (IndexedDB), in two stores, and the
// project files that go to and from disk.

import { checkComparable } from "../../engine/compare.ts";
import { parseProject, type Project } from "../../engine/project.ts";
import type { RunResult } from "../../engine/run.ts";
import { parseResultFile, RESULT_FORMAT, RESULT_FORMAT_VERSION, type ResultFile } from "../../export/data.ts";
import { readComparison, runsOf, type StoredComparison } from "./compare.ts";

export interface StoredProject {
  id: string;
  /** Time of the last change, in milliseconds since 1970. */
  updated: number;
  /**
   * The project as the user left it. It is saved while it is being edited, so it may not pass
   * `parseProject` yet. Read it with care, and check it before it runs.
   */
  project: Project;
}

/**
 * The version of stored results. It moves whenever the shape of a result changes, and a stored
 * result with another version, or with none, counts as "no result yet".
 */
export const RESULT_VERSION = 2;

/** A result with the definition that produced it, so later edits never change what it refers to. */
export interface StoredResult {
  v: typeof RESULT_VERSION;
  projectId: string;
  /** The id of the experiment. Empty for the project's first experiment, its `run`. */
  experiment: string;
  finished: number;
  /** The project as it was when the run started, with the experiment's setup as its `run`. */
  project: Project;
  /** Carries the method, settings, seed and versions. */
  result: RunResult;
  /** For a project that draws a fitted line: the line of the best solution. */
  curve?: number[];
}

const PROJECTS = "projects";
// shortcut: one result per experiment (its last run). The store's key is one text, the project's
// id for the first experiment and "<project id>/<experiment id>" for the others, so that the
// database of the first public build needs no upgrade. Give results their own ids, in a new
// database version, when one experiment keeps several runs.
const RESULTS = "results";
const keyOf = (projectId: string, experiment: string) => (experiment ? `${projectId}/${experiment}` : projectId);
/** Every key of a project's results other than the first experiment's. */
const others = (projectId: string) => IDBKeyRange.bound(`${projectId}/`, `${projectId}/\uffff`);

let opened: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return (opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("ypea-studio", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PROJECTS, { keyPath: "id" });
      request.result.createObjectStore(RESULTS, { keyPath: "projectId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/** Runs `work` in one transaction. A write resolves only when the transaction has completed. */
async function transact<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const tx = (await database()).transaction(stores, mode);
  return new Promise((resolve, reject) => {
    const request = work(tx);
    tx.oncomplete = () => resolve(request?.result as T);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The browser refused to store the data."));
  });
}

/** All projects, most recently changed first. Reads no results. */
export async function listProjects(): Promise<StoredProject[]> {
  const all = await transact<StoredProject[]>([PROJECTS], "readonly", (tx) => tx.objectStore(PROJECTS).getAll());
  return all.sort((a, b) => b.updated - a.updated);
}

// Not crypto.randomUUID, which is missing when a page is served over plain http.
const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join("-");

/** Stores a project, new or changed, and returns its record. */
export async function saveProject(project: Project, id: string = newId()): Promise<StoredProject> {
  const record: StoredProject = { id, updated: Date.now(), project };
  await transact([PROJECTS], "readwrite", (tx) => void tx.objectStore(PROJECTS).put(record));
  return record;
}

/** Deletes a project and its results together. */
export function deleteProject(id: string): Promise<void> {
  return transact([PROJECTS, RESULTS], "readwrite", (tx) => {
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(RESULTS).delete(id);
    tx.objectStore(RESULTS).delete(others(id));
  });
}

/**
 * A stored record as a result this build can show, or undefined. A browser may hold results
 * that an older build stored in another shape.
 */
export function readResult(record: any, projectId: string, experiment: string): StoredResult | undefined {
  const r = record?.result, p = record?.project;
  const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  const ok =
    record?.v === RESULT_VERSION && isObject(r) && typeof r.status === "string" && typeof r.method === "string" &&
    isObject(r.best) && typeof r.best.objective === "number" && typeof r.best.feasible === "boolean" &&
    Array.isArray(r.best.constraints) && isObject(r.best.solution) &&
    typeof r.evaluations?.used === "number" && typeof r.evaluations.budget === "number" &&
    Array.isArray(r.history?.nfe) && Array.isArray(r.history.best) && typeof r.seed?.base === "number" &&
    typeof r.timeMs === "number" && isObject(r.versions) &&
    // what the chart, the report and the Python script read
    Array.isArray(r.trace?.nfe) && Array.isArray(r.trace.violation) && isObject(r.settings) && Array.isArray(r.scales) &&
    typeof r.seed.runIndex === "number" && typeof r.seed.run === "number" && typeof r.versions.app === "string" && typeof r.versions.ypeaTested === "string" &&
    isObject(p) && isObject(p.objective) && Array.isArray(p.variables) && isObject(p.run) &&
    (record.curve === undefined || Array.isArray(record.curve));
  return ok ? { ...record, projectId, experiment } : undefined;
}

export async function loadResult(projectId: string, experiment = ""): Promise<StoredResult | undefined> {
  const record = await transact([RESULTS], "readonly", (tx) => tx.objectStore(RESULTS).get(keyOf(projectId, experiment)));
  return readResult(record, projectId, experiment);
}

/** Every readable result of a project, one for each experiment that has run. */
export async function loadResults(projectId: string): Promise<StoredResult[]> {
  const first = await loadResult(projectId);
  const rest = await transact<any[]>([RESULTS], "readonly", (tx) => tx.objectStore(RESULTS).getAll(others(projectId)));
  const read = rest.map((record) => readResult(record, projectId, String(record?.projectId).slice(projectId.length + 1)));
  return [first, ...read].filter((r) => r !== undefined);
}

/** Stores the result of an experiment in place of its earlier one. */
export function saveResult(result: Omit<StoredResult, "v" | "experiment"> & { experiment?: string }): Promise<void> {
  const experiment = result.experiment ?? "";
  const record = { ...result, v: RESULT_VERSION, experiment, projectId: keyOf(result.projectId, experiment) };
  return transact([RESULTS], "readwrite", (tx) => void tx.objectStore(RESULTS).put(record));
}

export function deleteResult(projectId: string, experiment: string): Promise<void> {
  return transact([RESULTS], "readwrite", (tx) => void tx.objectStore(RESULTS).delete(keyOf(projectId, experiment)));
}

// The comparison of a project: one, the last that finished. Its key is in the range of the
// project's results, so it goes with the project, and no experiment id can be the same text.
const COMPARISON = "*comparison";

export async function loadComparison(projectId: string): Promise<StoredComparison | undefined> {
  const record = await transact([RESULTS], "readonly", (tx) => tx.objectStore(RESULTS).get(keyOf(projectId, COMPARISON)));
  return readComparison(record, projectId);
}

export function saveComparison(comparison: StoredComparison): Promise<void> {
  return transact([RESULTS], "readwrite", (tx) => void tx.objectStore(RESULTS).put({ ...comparison, projectId: keyOf(comparison.projectId, COMPARISON) }));
}

const BUNDLE = "ypea-studio-projects";

/** The content of the "Download all projects" file. */
export function bundleProjects(projects: Project[]) {
  return { format: BUNDLE, version: 1, projects };
}

/** A project of a file, with the results and the comparison that the file carries for it. */
export interface FileProject {
  project: Project;
  results: Omit<StoredResult, "projectId">[];
  comparison?: Omit<StoredComparison, "projectId">;
}

const isoTime = (ms: number) => new Date(ms).toISOString();

/**
 * The content of a project file with results: the file of projects with one project, the
 * stored result of each experiment as a result file, and the comparison. A file cannot hold a
 * number that is not finite, so a result that would not read back is left out and counted.
 */
export function projectWithResults(project: Project, results: StoredResult[], comparison?: StoredComparison) {
  const entries = results.map((r) => ({
    project: 0, experiment: r.experiment, curve: r.curve,
    file: { format: RESULT_FORMAT, version: RESULT_FORMAT_VERSION, versions: r.result.versions, finished: isoTime(r.finished), project: r.project, result: r.result } satisfies ResultFile,
  }));
  const compared = comparison ? [{ project: 0, finished: isoTime(comparison.finished), versions: comparison.versions, definition: comparison.project, experiments: comparison.experiments }] : [];
  // each part is read back the way a file from a stranger is read, and what does not pass stays out
  const reads = (part: object) => {
    try {
      readProjectFile(JSON.stringify({ ...bundleProjects([project]), ...part }));
      return true;
    } catch {
      return false;
    }
  };
  const kept = entries.filter((entry) => reads({ results: [entry] })), keptCompared = compared.filter((entry) => reads({ comparisons: [entry] }));
  return {
    file: { ...bundleProjects([project]), results: kept, comparisons: keptCompared },
    leftOut: entries.length - kept.length + compared.length - keptCompared.length,
  };
}

/**
 * The projects in a file from disk, each with the results the file carries for it: one project
 * file, a file of all projects, or a project with results. Everything is checked as untrusted
 * input, and one bad part refuses the whole file. Throws a message for the user.
 */
export function readProjectFile(text: string): FileProject[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("This file is not a project file: it is not valid JSON.");
  }
  if (json?.format !== BUNDLE) return [{ project: parseProject(json), results: [] }];
  if (json.version !== 1 || !Array.isArray(json.projects)) throw new Error("This file of projects is damaged or comes from a newer version.");
  const all: FileProject[] = json.projects.map((p: unknown) => ({ project: parseProject(p), results: [] }));
  const damaged = (what: string): never => {
    throw new Error(`This file holds ${what} that cannot be read. It is damaged or comes from a newer version.`);
  };
  const owner = (entry: any, what: string): FileProject => all[Number.isInteger(entry?.project) ? entry.project : -1] ?? damaged(what);
  const time = (value: unknown, what: string): number => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : damaged(what));

  if (json.results !== undefined && !Array.isArray(json.results)) damaged("results");
  for (const entry of json.results ?? []) {
    const what = "a result", into = owner(entry, what), id = entry.experiment;
    const ids = ["", ...(into.project.experiments ?? []).map((e) => e.id)];
    if (!ids.includes(id) || into.results.some((r) => r.experiment === id)) damaged(what);
    if (entry.curve !== undefined && !(Array.isArray(entry.curve) && entry.curve.every((v: unknown) => v === null || typeof v === "number"))) damaged(what);
    const file = parseResultFile(entry.file);
    // then the same guard as for a result that this browser stored
    const read = readResult({ v: RESULT_VERSION, finished: time(file.finished, what), project: file.project, result: file.result, curve: entry.curve }, "", id) ?? damaged(what);
    const { projectId, ...result } = read;
    into.results.push(result);
  }

  if (json.comparisons !== undefined && !Array.isArray(json.comparisons)) damaged("comparisons");
  for (const entry of json.comparisons ?? []) {
    const what = "a comparison", into = owner(entry, what);
    if (into.comparison) damaged(what);
    const read = readComparison({ v: 1, finished: time(entry.finished, what), versions: entry.versions, project: entry.definition, experiments: entry.experiments }, "") ?? damaged(what);
    // the definition with every setup is checked as a project file is, and the runs must be what they say they are
    for (const runs of runsOf(read)) parseProject(runs.project);
    const problems = checkComparable(runsOf(read));
    if (problems.length > 0) throw new Error(`This file holds a comparison that cannot be read. ${problems[0]}`);
    const { projectId, ...comparison } = read;
    into.comparison = comparison;
  }
  return all;
}

/** The projects in a file from disk, without what else the file carries. Throws a message for the user. */
export function projectsFromFile(text: string): Project[] {
  return readProjectFile(text).map((entry) => entry.project);
}
