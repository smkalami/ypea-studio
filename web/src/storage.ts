// Projects and results in the browser (IndexedDB), in two stores, and the
// project files that go to and from disk.

import { parseProject, type Project } from "../../engine/project.ts";
import type { RunResult } from "../../engine/run.ts";

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

const BUNDLE = "ypea-studio-projects";

/** The content of the "Download all projects" file. */
export function bundleProjects(projects: Project[]) {
  return { format: BUNDLE, version: 1, projects };
}

/** The projects in a file from disk: one project file, or a file of all projects. Throws a message for the user. */
export function projectsFromFile(text: string): Project[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("This file is not a project file: it is not valid JSON.");
  }
  if (json?.format !== BUNDLE) return [parseProject(json)];
  if (json.version !== 1 || !Array.isArray(json.projects)) throw new Error("This file of projects is damaged or comes from a newer version.");
  return json.projects.map(parseProject);
}
