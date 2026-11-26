// The bare app: the project list with the welcome actions, and one project with its run and result.
// The page title, the description and the Python link are static HTML in index.html.

import { useEffect, useRef, useState } from "react";
import type { Project } from "../../engine/project.ts";
import type { Progress } from "../../engine/run.ts";
import { EXAMPLES } from "./examples.ts";
import type { RunMessage, RunRequest } from "./protocol.ts";
import {
  bundleProjects, deleteProject, listProjects, loadResult, projectsFromFile, saveProject, saveResult,
  type StoredProject, type StoredResult,
} from "./storage.ts";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const count = (n: number) => n.toLocaleString("en-US");

/** A number with at most six significant digits, or a list of them in brackets. */
function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  return typeof value === "number" && !Number.isInteger(value) ? String(Number(value.toPrecision(6))) : String(value);
}

function download(name: string, content: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|\s]+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Asks the browser once to keep the data from automatic clearing. It waits for
// the first project, because some browsers ask the user and a new visitor has nothing to keep.
let askedToKeep = false;
function keepData(): void {
  if (askedToKeep) return;
  askedToKeep = true;
  navigator.storage?.persist?.().catch(() => {});
}

export function App() {
  const [projects, setProjects] = useState<StoredProject[]>();
  const [openId, setOpenId] = useState<string>();
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  /** Does one storage action, then reads the list again. A failure becomes a notice. */
  const act = async (work?: () => Promise<unknown>) => {
    setNotice("");
    try {
      await work?.();
      setProjects(await listProjects());
    } catch (error) {
      setNotice(messageOf(error));
    }
  };
  useEffect(() => void act(), []);
  useEffect(() => {
    if (projects?.length) keepData();
  }, [projects]);

  const open = projects?.find((p) => p.id === openId);
  if (open) return <ProjectView key={open.id} record={open} onBack={() => setOpenId(undefined)} />;

  const add = (project: Project) => act(async () => setOpenId((await saveProject(project)).id));
  const openFile = (file: File) =>
    act(async () => {
      const saved: StoredProject[] = [];
      for (const project of projectsFromFile(await file.text())) saved.push(await saveProject(project));
      // a file of all projects stays on the list, and a single project opens
      if (saved.length === 1) setOpenId(saved[0].id);
    });
  const rename = (p: StoredProject) => {
    const name = window.prompt("New name for the project", p.project.name)?.trim();
    if (name) act(() => saveProject({ ...p.project, name }, p.id));
  };
  const remove = (p: StoredProject) => {
    if (window.confirm(`Delete "${p.project.name}" and its result? This cannot be undone.`)) act(() => deleteProject(p.id));
  };

  return (
    <>
      {notice && <p className="notice" role="alert">{notice}</p>}
      {!projects && !notice && <p>Loading your projects.</p>}

      {projects && projects.length > 0 && (
        <section aria-labelledby="projects-heading">
          <h2 id="projects-heading">Your projects</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Method</th>
                <th scope="col">Budget</th>
                <th scope="col">Last changed</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const { name, run } = p.project;
                return (
                  <tr key={p.id}>
                    <th scope="row">{name}</th>
                    <td>{run.method}</td>
                    <td>{count(run.budget)} evaluations</td>
                    <td>{new Date(p.updated).toLocaleString()}</td>
                    <td className="actions">
                      <button className="primary" aria-label={`Open ${name}`} onClick={() => setOpenId(p.id)}>Open</button>
                      <button aria-label={`Rename ${name}`} onClick={() => rename(p)}>Rename</button>
                      <button aria-label={`Duplicate ${name}`} onClick={() => act(() => saveProject({ ...p.project, name: `${name} copy` }))}>Duplicate</button>
                      <button aria-label={`Download ${name}`} onClick={() => download(name, p.project)}>Download</button>
                      <button aria-label={`Delete ${name}`} onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="examples-heading">
        <h2 id="examples-heading">Try an example</h2>
        <p>
          Each example becomes a project of your own.
        </p>
        <ul className="examples">
          {EXAMPLES.map((example) => (
            <li key={example.name}>
              <button onClick={() => add(example)}>{example.name}</button>
              <span>{example.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="open-heading">
        <h2 id="open-heading">Open a project</h2>
        <p>Load a project file (JSON) from this computer.</p>
        <button onClick={() => fileInput.current?.click()}>Open a project</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // so the same file can be chosen again
            if (file) openFile(file);
          }}
        />
      </section>

      <aside className="reminder" aria-label="Where your projects are kept">
        <p>
          Your projects are kept in this browser, on this computer, and nowhere else. Clearing the browser's data
          deletes them. Download a copy to keep them safe.
        </p>
        {projects && projects.length > 0 && (
          <button onClick={() => download("ypea-studio-projects", bundleProjects(projects.map((p) => p.project)))}>
            Download all projects
          </button>
        )}
      </aside>
    </>
  );
}

type RunState =
  | { state: "idle" | "done" | "cancelled" }
  | { state: "running"; progress?: Progress }
  | { state: "error"; message: string };

function ProjectView({ record, onBack }: { record: StoredProject; onBack: () => void }) {
  const { project } = record;
  const [stored, setStored] = useState<StoredResult>();
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    loadResult(record.id).then(setStored, (error) => setRun({ state: "error", message: messageOf(error) }));
    // leaving the project cancels its run
    return () => worker.current?.terminate();
  }, [record.id]);

  const start = () => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setRun({ state: "running" });
    const end = (next: RunState) => {
      w.terminate();
      worker.current = null;
      setRun(next);
    };
    w.onmessage = async ({ data }: MessageEvent<RunMessage>) => {
      if (data.type === "progress") return setRun({ state: "running", progress: data.progress });
      if (data.type === "error") return end({ state: "error", message: data.message });
      // the snapshot: the definition this run started from
      const result: StoredResult = { projectId: record.id, finished: Date.now(), project, result: data.result };
      setStored(result);
      try {
        await saveResult(result);
        end({ state: "done" });
      } catch (error) {
        end({ state: "error", message: `The run finished, but its result could not be saved: ${messageOf(error)}` });
      }
    };
    w.onerror = (event) => end({ state: "error", message: `The run could not start. ${event.message ?? ""}` });
    w.postMessage({ type: "run", project } satisfies RunRequest);
  };
  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setRun({ state: "cancelled" });
  };

  const running = run.state === "running";
  const status =
    run.state === "running" ? "Running."
    : run.state === "done" ? `Run finished. ${stored?.result.status ?? ""}.`
    : run.state === "cancelled" ? "Run cancelled. Nothing was kept from it."
    : run.state === "error" ? run.message
    : "";
  const { objective, variables, constraints = [] } = project;

  return (
    <>
      <p><button onClick={onBack}>All projects</button></p>
      <h2>{project.name}</h2>
      {project.description && <p>{project.description}</p>}

      <section aria-labelledby="problem-heading">
        <h3 id="problem-heading">Problem</h3>
        <dl>
          <dt>Objective</dt>
          <dd>
            {objective.sense === "min" ? "Minimize" : "Maximize"} <code>{objective.source}</code>
            {objective.unit && ` (${objective.unit})`}
          </dd>
          <dt>Variables</dt>
          <dd>
            {variables.map((v) => (
              <div key={v.name}>
                <code>{v.name}</code>: {v.type.replaceAll("_", " ")}
                {"shape" in v ? v.shape.length > 0 && `, ${v.shape.join(" by ")} values` : `, n = ${v.n}`}
                {"k" in v && `, k = ${v.k}`}
                {"unit" in v && v.unit && ` (${v.unit})`}
              </div>
            ))}
          </dd>
          {constraints.length > 0 && (
            <>
              <dt>Constraints</dt>
              <dd>
                {constraints.map((c) => (
                  <div key={c.name}>
                    {c.name}: <code>{c.left} {c.op} {c.right}</code>
                    {c.unit && ` (${c.unit})`}
                  </div>
                ))}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section aria-labelledby="run-heading">
        <h3 id="run-heading">Run</h3>
        <p>
          One quick run with the method <code>{project.run.method}</code>, a budget of {count(project.run.budget)}{" "}
          evaluations and seed {project.run.seed}.
        </p>
        {/* one button, so keyboard focus stays in place when a run starts or ends */}
        <button className="primary" onClick={running ? cancel : start}>{running ? "Cancel" : "Run"}</button>
        <p role="status" aria-live="polite" className={run.state === "error" ? "notice" : "status"}>{status}</p>
        {/* outside the live region: a screen reader should not read every update */}
        {run.state === "running" && run.progress && (
          <p className="progress">
            <progress aria-label="Evaluations used" max={run.progress.evaluations.budget} value={run.progress.evaluations.used} />
            <span>
              {count(run.progress.evaluations.used)} of {count(run.progress.evaluations.budget)} evaluations. Best objective
              so far: {show(run.progress.best.objective)}
            </span>
          </p>
        )}
      </section>

      {stored && <Result stored={stored} />}
    </>
  );
}

function Result({ stored }: { stored: StoredResult }) {
  // everything here comes from the stored snapshot, not from the live project
  const { result, project } = stored;
  const unit = project.objective.unit ? ` ${project.objective.unit}` : "";
  const { timeMs } = result;
  return (
    <section aria-labelledby="result-heading" className="result">
      <h3 id="result-heading">Result</h3>
      <p className="outcome">{result.status}.</p>
      {!result.best.feasible && (
        <p className="notice">The solution below is the candidate that breaks the constraints least. It is not feasible.</p>
      )}
      <dl>
        <dt>Objective ({project.objective.sense === "min" ? "minimized" : "maximized"})</dt>
        <dd>{show(result.best.objective)}{unit}</dd>
        {result.baseline && (
          <>
            <dt>In use today: {result.baseline.label}</dt>
            <dd>{show(result.baseline.objective)}{unit}</dd>
            <dt>Difference from what is in use today</dt>
            <dd>{show(result.baseline.difference)}{unit}</dd>
          </>
        )}
        {result.reference && (
          <>
            <dt>Known answer: {result.reference.label ?? "reference"}</dt>
            <dd>{show(result.reference.objective)}{unit}</dd>
            <dt>Difference from the known answer</dt>
            <dd>{show(result.reference.difference)}{unit}</dd>
          </>
        )}
        <dt>Evaluations</dt>
        <dd>{count(result.evaluations.used)} of {count(result.evaluations.budget)}</dd>
        <dt>Time</dt>
        <dd>{timeMs < 1000 ? `${timeMs.toFixed(0)} ms` : `${(timeMs / 1000).toFixed(1)} s`}</dd>
      </dl>
      {result.best.constraints.length > 0 && (
        <>
          <h4>Constraints</h4>
          <table>
            <thead>
              <tr>
                <th scope="col">Constraint</th>
                <th scope="col">Value</th>
                <th scope="col">Limit</th>
                <th scope="col">Holds</th>
              </tr>
            </thead>
            <tbody>
              {result.best.constraints.map((c) => (
                <tr key={c.name}>
                  <th scope="row">{c.name}</th>
                  <td>{show(c.left)}{c.unit ? ` ${c.unit}` : ""}</td>
                  <td>{c.op} {show(c.right)}{c.unit ? ` ${c.unit}` : ""}</td>
                  <td>{c.satisfied ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h4>Solution</h4>
      <table>
        <thead>
          <tr>
            <th scope="col">Variable</th>
            <th scope="col">Value</th>
            <th scope="col">Unit</th>
          </tr>
        </thead>
        <tbody>
          {project.variables.map((v) => (
            <tr key={v.name}>
              <th scope="row">{v.name}</th>
              <td>{show(result.best.solution[v.name])}</td>
              <td>{("unit" in v && v.unit) || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        This is one run of a randomized method (<code>{result.method}</code>) with a recorded seed (seed{" "}
        {result.seed.base}, run {result.seed.runIndex}). A run with another seed can give a different answer.
      </p>
      <p className="small">
        Finished {new Date(stored.finished).toLocaleString()}. App version {result.versions.app}, tested with ypea{" "}
        {result.versions.ypeaTested}. The project definition that produced this result is stored with it.
      </p>
    </section>
  );
}
