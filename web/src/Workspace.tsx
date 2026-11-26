// One open project: a sidebar with the parts of the problem, the test of a candidate and the
// experiments, and a main area that edits the selected part. Below it, always in view, is the
// current experiment with its Run button, its live preview and its result.
//
// Edits are saved as the user works, also while the project cannot run yet. Every change is
// checked in a helper worker, and runs happen in a run worker: the text of a project becomes
// code, and that code never runs on the page.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../../engine/project.ts";
import type { Progress } from "../../engine/run.ts";
import { CandidatePanel, candidateTexts, type Outcome, type Texts } from "./Candidate.tsx";
import {
  count, DEFAULT_SETUP, definitionOf, type Experiment, experimentsOf, FIRST, newExperimentId, projectFor, show, tidy,
  withExperiment, withoutExperiment, withUnit,
} from "./draft.ts";
import { Drawing } from "./Drawing.tsx";
import { ExperimentForm, Result, solverName } from "./Experiment.tsx";
import { ConstraintsPanel, DataPanel, FunctionsPanel, ObjectivePanel, OverviewPanel, VariablesPanel, ViewPanel } from "./Problem.tsx";
import { ask, type HelpRequest, type Issue, type RunMessage, type RunRequest, TIME_LIMIT_MS, tooLong } from "./protocol.ts";
import { deleteResult, loadResults, RESULT_VERSION, saveProject, saveResult, type StoredProject, type StoredResult } from "./storage.ts";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One request to a fresh helper worker, ended after its answer or at the time limit. */
const help = (request: HelpRequest) => ask(new Worker(new URL("./helper.ts", import.meta.url), { type: "module" }), request);

export function download(name: string, content: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${String(name).replace(/[\\/:*?"<>|\s]+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

const PARTS = [
  ["overview", "Overview"], ["data", "Data"], ["variables", "Variables"], ["objective", "Objective"],
  ["constraints", "Constraints"], ["functions", "Functions"], ["view", "Drawing"],
] as const;
const PANELS = {
  overview: OverviewPanel, data: DataPanel, variables: VariablesPanel, objective: ObjectivePanel,
  constraints: ConstraintsPanel, functions: FunctionsPanel, view: ViewPanel,
};
const EXPERIMENT = "experiment.";

/** The entry of the sidebar that a problem belongs to. */
function partOf(where: string): string {
  if (where.startsWith(EXPERIMENT)) return where;
  if (where === "experiments") return EXPERIMENT + FIRST;
  if (where === "baseline" || where === "reference") return "candidate";
  const head = where.split(".")[0];
  return head === "variable" ? "variables" : head === "constraint" ? "constraints" : head;
}

type RunState =
  | { state: "idle" }
  | { state: "running"; id: string; snapshot: Project; progress?: Progress; curve?: number[] }
  | { state: "done" | "cancelled"; id: string }
  | { state: "error"; id: string; message: string };

export function Workspace({ record, onBack }: { record: StoredProject; onBack: () => void }) {
  const [project, setProject] = useState(() => tidy(record.project));
  const [saving, setSaving] = useState<"saved" | "saving" | "failed">("saved");
  const [issues, setIssues] = useState<Issue[]>();
  /** The project that `issues` were found in. After an edit they are a moment behind. */
  const [checked, setChecked] = useState<Project>();
  const [selected, setSelected] = useState<string>(() => (tidy(record.project).variables.length === 0 ? "overview" : EXPERIMENT + FIRST));
  const [current, setCurrent] = useState(FIRST);
  const [results, setResults] = useState<Record<string, StoredResult>>({});
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [texts, setTexts] = useState<Texts>(() => candidateTexts(tidy(record.project).baseline?.solution ?? {}));
  const [outcome, setOutcome] = useState<Outcome>();
  const [said, setSaid] = useState("");
  const worker = useRef<Worker | null>(null);

  // Saving. The latest project is written a moment after the last change, when the user
  // leaves the project, and when the page is hidden or closed.
  const latest = useRef(project), dirty = useRef(false), first = useRef(true), checkNumber = useRef(0);
  latest.current = project;
  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await saveProject(latest.current, record.id);
      if (!dirty.current) setSaving("saved");
    } catch {
      dirty.current = true;
      setSaving("failed");
    }
  }, [record.id]);
  const update = (next: Project) => {
    dirty.current = true;
    setSaving("saving");
    setProject(next);
    setOutcome(undefined);
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      void flush();
      const number = ++checkNumber.current;
      const reply = await help({ type: "check", project });
      if (number !== checkNumber.current) return; // a newer check is on its way
      setChecked(project);
      setIssues(
        reply.type === "checked" ? reply.issues
        : [{ where: reply.type === "error" && reply.message === tooLong(TIME_LIMIT_MS) ? "functions" : "overview", message: reply.type === "error" ? reply.message : "The check gave no answer." }],
      );
    }, first.current ? 0 : 400);
    first.current = false;
    return () => clearTimeout(timer);
  }, [project, flush]);

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    loadResults(record.id).then(
      (all) => setResults(Object.fromEntries(all.map((r) => [r.experiment, r]))),
      (error) => setSaid(`The stored results could not be read: ${messageOf(error)}`),
    );
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
      // leaving the project cancels its run
      worker.current?.terminate();
    };
  }, [record.id, flush]);

  const known = issues ?? [];
  const experiments = experimentsOf(project);
  const running = run.state === "running";
  // the pane below shows the experiment that runs, or else the one last selected
  const shown = experiments.find((e) => e.id === (running ? run.id : current)) ?? experiments[0];
  const marked = new Set(known.map((i) => partOf(i.where)));

  const start = (experiment: Experiment, base: Project = project) => {
    // Problems found in an older state of the project do not refuse a run. The run worker
    // checks the project again, and its message is shown if it still cannot run.
    const blocking = known.find((i) => !i.where.startsWith(EXPERIMENT) || i.where === EXPERIMENT + experiment.id);
    if (base === checked && blocking) {
      setRun({ state: "error", id: experiment.id, message: `This project cannot run yet. ${blocking.message}` });
      setSelected(partOf(blocking.where));
      return;
    }
    // the snapshot: the definition this run starts from, with this experiment's setup as its run
    const snapshot = projectFor(base, experiment);
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setRun({ state: "running", id: experiment.id, snapshot });
    const end = (next: RunState) => {
      w.terminate();
      worker.current = null;
      setRun(next);
      setSaid(""); // the end of a run is said, also after a candidate was tested meanwhile
    };
    w.onmessage = async ({ data }: MessageEvent<RunMessage>) => {
      if (data.type === "progress") return setRun({ state: "running", id: experiment.id, snapshot, progress: data.progress, curve: data.curve });
      if (data.type === "error") return end({ state: "error", id: experiment.id, message: data.message });
      const stored: StoredResult = {
        v: RESULT_VERSION, projectId: record.id, experiment: experiment.id, finished: Date.now(), project: snapshot, result: data.result, curve: data.curve,
      };
      setResults((old) => ({ ...old, [experiment.id]: stored }));
      try {
        await saveResult(stored);
        end({ state: "done", id: experiment.id });
      } catch (error) {
        end({ state: "error", id: experiment.id, message: `The run finished, but its result could not be saved: ${messageOf(error)}` });
      }
    };
    w.onerror = (event) => end({ state: "error", id: experiment.id, message: `The run could not start. ${event.message ?? ""}` });
    w.postMessage({ type: "run", project: snapshot } satisfies RunRequest);
  };
  const cancel = () => {
    if (run.state !== "running") return;
    worker.current?.terminate();
    worker.current = null;
    setRun({ state: "cancelled", id: run.id });
  };
  const rerun = (experiment: Experiment) => {
    // the new seed is written into the experiment, so the form and the result agree
    const next = { ...experiment, seed: Number.isInteger(experiment.seed) ? (experiment.seed + 1) % 2 ** 32 : 1 };
    const changed = withExperiment(project, next);
    update(changed);
    start(next, changed);
  };

  const select = (key: string) => {
    setSelected(key);
    if (key.startsWith(EXPERIMENT)) setCurrent(key.slice(EXPERIMENT.length));
  };
  const addExperiment = (from?: Experiment) => {
    const id = newExperimentId(project);
    const copy: Experiment = from
      ? { ...from, settings: { ...from.settings }, id, name: `${from.name} copy` }
      : { ...DEFAULT_SETUP, settings: {}, id, name: `Experiment ${experiments.length + 1}` };
    update(withExperiment(project, copy));
    select(EXPERIMENT + id);
  };
  const removeExperiment = (experiment: Experiment) => {
    if (!window.confirm(`Delete the experiment "${experiment.name}" and its result? This cannot be undone.`)) return;
    const next = withoutExperiment(project, experiment.id);
    const { [experiment.id]: gone, ...kept } = results;
    void deleteResult(record.id, experiment.id);
    if (experiment.id === FIRST) {
      // the next experiment becomes the first one, and its result moves with it
      const promoted = experiments[1], moved = kept[promoted.id];
      delete kept[promoted.id];
      void deleteResult(record.id, promoted.id);
      if (moved) {
        kept[FIRST] = { ...moved, experiment: FIRST };
        void saveResult(kept[FIRST]);
      }
    }
    setResults(kept);
    update(next);
    select(EXPERIMENT + FIRST);
  };

  const status =
    said ? said
    : run.state === "running" ? `Running "${shown.name}".`
    : run.state === "done" ? `Run finished. ${results[run.id]?.result.status ?? ""}.`
    : run.state === "cancelled" ? "Run cancelled. Nothing was kept from it."
    : run.state === "error" ? run.message
    : "";
  const say = (text: string) => setSaid(text);
  const stored = results[shown.id];
  const counts: Record<string, number | undefined> = {
    data: (project.data ?? []).length, variables: project.variables.length, constraints: (project.constraints ?? []).length,
  };
  const entry = (key: string, label: string, extra?: number) => (
    <li key={key}>
      <button type="button" aria-current={selected === key ? "true" : undefined} onClick={() => select(key)}>
        <span className="label">{label}</span>
        {extra !== undefined && <span className="count">{extra}</span>}
        {marked.has(key) && <span className="mark" role="img" aria-label="has a problem">!</span>}
      </button>
    </li>
  );
  const Panel = PANELS[selected as keyof typeof PANELS];
  const edited = selected.startsWith(EXPERIMENT) ? experiments.find((e) => EXPERIMENT + e.id === selected) ?? experiments[0] : undefined;

  return (
    <div className="workspace">
      <header className="bar">
        <button type="button" onClick={async () => { await flush(); onBack(); }}>All projects</button>
        <h2>{project.name}</h2>
        <span className="saving">{saving === "saved" ? "All changes saved" : saving === "saving" ? "Saving" : "Could not save. Download the project to keep it."}</span>
        <button type="button" onClick={() => download(project.name, project)}>Download project</button>
      </header>

      <nav className="sidebar" aria-label="Parts of the project">
        <p className="group" id="group-problem">Problem</p>
        <ul aria-labelledby="group-problem">{PARTS.map(([key, label]) => entry(key, label, counts[key]))}</ul>
        <p className="group" id="group-test">Test</p>
        <ul aria-labelledby="group-test">{entry("candidate", "Candidate")}</ul>
        <p className="group" id="group-experiments">Experiments</p>
        <ul aria-labelledby="group-experiments">
          {experiments.map((e) => entry(EXPERIMENT + e.id, e.name || "Unnamed"))}
          <li><button type="button" className="new" onClick={() => addExperiment(edited)}><span aria-hidden="true">+</span>New experiment</button></li>
        </ul>
      </nav>

      <div className="main">
        <div className="editor">
          {issues === undefined && <p className="hint">Checking the project.</p>}
          {Panel && <Panel project={project} set={update} issues={known} />}
          {selected === "candidate" && (
            <CandidatePanel
              project={project} set={update} issues={known} texts={texts} outcome={outcome} help={help} say={say}
              setTexts={setTexts} setOutcome={(next) => (setOutcome(next), next === undefined && setSaid(""))}
            />
          )}
          {edited && (
            <ExperimentForm
              key={edited.id} project={project} experiment={edited} issues={known.filter((i) => i.where === EXPERIMENT + edited.id)}
              onChange={(next) => update(withExperiment(project, next))}
              onDuplicate={() => addExperiment(edited)}
              onDelete={experiments.length > 1 && !running ? () => removeExperiment(edited) : undefined}
            />
          )}
        </div>

        <div className="pane">
          <div className="runbar">
            {/* one button, so keyboard focus stays in place when a run starts or ends */}
            <button type="button" className="primary" onClick={running ? cancel : () => (setSaid(""), start(shown))}>{running ? "Cancel" : "Run"}</button>
            <p className="setup">
              <strong>{shown.name}</strong>: {solverName(shown.method)}, {Number.isFinite(shown.budget) ? count(shown.budget) : String(shown.budget)} evaluations, seed {String(shown.seed)}
            </p>
          </div>
          <p role="status" aria-live="polite" className={run.state === "error" && !said ? "notice" : "status"}>{status}</p>
          {/* outside the live region: a screen reader should not read every update */}
          {run.state === "running" && run.progress && (
            <div className="live">
              <p className="progress">
                <progress aria-label="Evaluations used" max={run.progress.evaluations.budget} value={run.progress.evaluations.used} />
                <span>
                  {count(run.progress.evaluations.used)} of {count(run.progress.evaluations.budget)} evaluations. Best objective
                  so far: {withUnit(run.progress.best.objective, run.snapshot.objective.unit)}
                </span>
              </p>
              <Drawing project={run.snapshot} solution={run.progress.best.solution} curve={run.curve} />
              {!run.snapshot.view && (
                <p className="code small">{Object.entries(run.progress.best.solution).map(([name, value]) => `${name} = ${show(value)}`).join("; ").slice(0, 400)}</p>
              )}
            </div>
          )}
          {!running && stored && (
            <Result
              stored={stored} name={shown.name} onRerun={() => (setSaid(""), rerun(shown))}
              changed={definitionOf(stored.project) !== definitionOf(projectFor(project, shown))}
            />
          )}
          {!running && !stored && <p className="empty">"{shown.name}" has no result yet. Press Run to get one.</p>}
        </div>
      </div>
    </div>
  );
}
