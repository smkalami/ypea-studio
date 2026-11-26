// Projects and results in the browser (IndexedDB), in two stores, and the
// project files that go to and from disk.

import { parseProject, type Project } from "../../engine/project.ts";
import type { RunResult } from "../../engine/run.ts";

export interface StoredProject {
  id: string;
  /** Time of the last change, in milliseconds since 1970. */
  updated: number;
  project: Project;
}

/** A result with the definition that produced it, so later edits never change what it refers to. */
export interface StoredResult {
  projectId: string;
  finished: number;
  /** The project as it was when the run started. */
  project: Project;
  /** Carries the method, settings, seed and versions. */
  result: RunResult;
}

const PROJECTS = "projects";
// shortcut: one result per project (the last run), keyed by the project's id. Give results
// their own ids, in a new database version, when Compare needs several runs (milestone 6).
const RESULTS = "results";

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

/** Deletes a project and its result together. */
export function deleteProject(id: string): Promise<void> {
  return transact([PROJECTS, RESULTS], "readwrite", (tx) => {
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(RESULTS).delete(id);
  });
}

export function loadResult(projectId: string): Promise<StoredResult | undefined> {
  return transact([RESULTS], "readonly", (tx) => tx.objectStore(RESULTS).get(projectId));
}

export function saveResult(result: StoredResult): Promise<void> {
  return transact([RESULTS], "readwrite", (tx) => void tx.objectStore(RESULTS).put(result));
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
