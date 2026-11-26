// The messages between the page and the run worker, and the worker's side of them.
// This file has no browser code, so it is tested in Node.

import { parseProject } from "../../engine/project.ts";
import { runProject, type Progress, type RunResult } from "../../engine/run.ts";

/** Page to worker. One worker does one run. Cancel is `worker.terminate()`, so it needs no message. */
export type RunRequest = { type: "run"; project: unknown; runIndex?: number };

/** Worker to page. `result` or `error` comes once and is the last message. */
export type RunMessage =
  | { type: "progress"; progress: Progress }
  | { type: "result"; result: RunResult }
  | { type: "error"; message: string };

/** Runs the project and posts progress at most once per `minIntervalMs`, then the result or the error. */
export function handleRun(request: RunRequest, post: (message: RunMessage) => void, minIntervalMs = 50): void {
  try {
    let last = -Infinity;
    const result = runProject(parseProject(request.project), {
      runIndex: request.runIndex,
      onProgress(progress) {
        const now = performance.now();
        if (now - last < minIntervalMs) return;
        last = now;
        post({ type: "progress", progress });
      },
    });
    post({ type: "result", result });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
