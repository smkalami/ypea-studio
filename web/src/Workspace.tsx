// One open project: a sidebar with the parts of the problem, the test of a candidate and the
// experiments, and a main area that edits the selected part. Above it, always in view, is the
// run bar: the Run button, what it will run, and the progress of a run. An experiment shows
// its setup with its live preview and its result under it.
//
// Edits are saved as the user works, also while the project cannot run yet. Every change is
// checked in a helper worker, and runs happen in a run worker: the text of a project becomes
// code, and that code never runs on the page.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../../engine/project.ts";
import type { Progress } from "../../engine/run.ts";
import { CandidatePanel, candidateTexts, type Outcome, type Texts } from "./Candidate.tsx";
import { comparableRun, COMPARISON_VERSION, jobsOf, type Plan, poolSize, type StoredComparison } from "./compare.ts";
import { COMPARE_FORM, ComparePanel } from "./Compare.tsx";
import {
  count, definitionOf, EXPERIMENT, type Experiment, experimentsOf, FIRST, newExperimentId, partOf, projectFor, show, tidy,
  withExperiment, withoutExperiment, withUnit,
} from "./draft.ts";
import { Drawing } from "./Drawing.tsx";
import { ExperimentForm, Result, solverName } from "./Experiment.tsx";
import { type History, record as recordStep, redo, startHistory, undo } from "./history.ts";
import { ConstraintsPanel, DataPanel, FunctionsPanel, ObjectivePanel, OverviewPanel, VariablesPanel, ViewPanel } from "./Problem.tsx";
import { ask, type HelpRequest, type Issue, type RunMessage, type RunRequest, runJobs, TIME_LIMIT_MS, tooLong } from "./protocol.ts";
import { download } from "./share.ts";
import { ResultDownloads, SharePanel } from "./Share.tsx";
import { follow, suggest, suggestionSentence } from "./suggest.ts";
import { deleteResult, loadComparison, loadResults, RESULT_VERSION, saveComparison, saveProject, saveResult, type StoredProject, type StoredResult } from "./storage.ts";
import { Alert, Loading } from "./ui/controls.tsx";
import { ConfirmDialog } from "./ui/Dialog.tsx";
import { Icon } from "./ui/Icon.tsx";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One request to a fresh helper worker, ended after its answer or at the time limit. */
const help = (request: HelpRequest) => ask(new Worker(new URL("./helper.ts", import.meta.url), { type: "module" }), request);

/** A fresh run worker. One does one run at a time, and a comparison uses several. */
const runWorker = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

const PARTS = [
  ["overview", "Overview"], ["data", "Data"], ["variables", "Variables"], ["objective", "Objective"],
  ["constraints", "Constraints"], ["functions", "Functions"], ["view", "Drawing"],
] as const;
/** What "Back to" calls each part. */
const PART_NAMES: Record<string, string> = { ...Object.fromEntries(PARTS), candidate: "Test a candidate", compare: "Compare", share: "Share" };
const PANELS = {
  overview: OverviewPanel, data: DataPanel, variables: VariablesPanel, objective: ObjectivePanel,
  constraints: ConstraintsPanel, functions: FunctionsPanel, view: ViewPanel,
};

/** True while the window is too narrow for a sidebar next to the main area. The sidebar is then a drawer. */
function useNarrow(): boolean {
  const query = "(max-width: 1179px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** What the undo history holds: the definition, and the ids of the experiments that still follow the suggested solver. */
interface Draft {
  project: Project;
  following: string[];
}
/** A message in the status line of the run bar, with the step it offers. */
interface Notice {
  text: string;
  offer?: "undo" | "redo";
}
const TYPED = "input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea";
/** Everything in the main area that can take the focus, in its order. */
const focusable = () => [...document.querySelectorAll<HTMLElement>(".panel :is(button, input:not([hidden]), textarea, summary, [tabindex])")];

type RunState =
  | { state: "idle" }
  | { state: "running"; id: string; snapshot: Project; progress?: Progress; curve?: number[] }
  | { state: "done" | "cancelled"; id: string }
  | { state: "error"; id: string; message: string };

export function Workspace({ record, onBack }: { record: StoredProject; onBack: () => void }) {
  // The definition with its undo history. The history lasts while the project is open, and a reload starts a new one.
  const [history, setHistory] = useState<History<Draft>>(() => {
    const project = tidy(record.project), ids = new Set(experimentsOf(project).map((e) => e.id));
    return startHistory({ project, following: (Array.isArray(record.suggested) ? record.suggested : []).filter((id) => ids.has(id)) });
  });
  const steps = useRef(history);
  const { project, following } = history.present;
  const [notice, setNotice] = useState<Notice>();
  /** Where the last run was started from, when that was another part than its experiment. */
  const [origin, setOrigin] = useState<{ key: string; experiment: string; scroll: number; focus: number }>();
  /** The place of the control in the main area that had the focus last. */
  const lastFocus = useRef(-1);
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
  /** A short text for screen readers only: what the test of a candidate found. The panel shows the same on screen. */
  const [said, setSaid] = useState("");
  const [loadFailure, setLoadFailure] = useState("");
  const [removing, setRemoving] = useState<Experiment>();
  // The comparison: the last one that finished, the one that runs, how the last try ended, and the form.
  const [comparison, setComparison] = useState<StoredComparison>();
  const [comparing, setComparing] = useState<{ done: number; total: number }>();
  const [compareEnded, setCompareEnded] = useState<{ failed: boolean; text: string }>();
  const [compareForm, setCompareForm] = useState(COMPARE_FORM);
  const stopComparing = useRef<() => void>(undefined);
  /** The experiment whose result the Share part shows. Nothing until the user chooses: then it is the one of the run bar. */
  const [shared, setShared] = useState<string>();
  const worker = useRef<Worker | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const narrow = useNarrow();

  // Saving. The latest project is written a moment after the last change, when the user
  // leaves the project, and when the page is hidden or closed.
  const latest = useRef(history.present), dirty = useRef(false), first = useRef(true), checkNumber = useRef(0);
  latest.current = history.present;
  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await saveProject(latest.current.project, record.id, latest.current.following);
      if (!dirty.current) setSaving("saved");
    } catch {
      dirty.current = true;
      setSaving("failed");
    }
  }, [record.id]);
  /** Stores a state of the history as the project that is open. */
  const commit = (next: History<Draft>) => {
    steps.current = next;
    dirty.current = true;
    setSaving("saving");
    setHistory(next);
    setOutcome(undefined);
  };
  /**
   * One edit. Experiments that still follow the suggested solver get the suggestion for the
   * variables as they now are. `note` says what was removed or replaced, and is shown with Undo.
   */
  const update = (next: Project, note?: string) => {
    const before = steps.current.present, followed = follow(before.project, next, before.following);
    // typing in one field is one step of the history
    const active = document.activeElement, field = active?.matches(TYPED) ? active.id || "field" : undefined;
    commit(recordStep(steps.current, { project: followed.project, following: followed.following }, field, Date.now()));
    const told = followed.changed.map((e) => (experimentsOf(before.project).find((old) => old.id === e.id)?.method === e.method
      ? `The suggested settings of "${e.name}" changed with the variables.`
      : `The suggested solver of "${e.name}" is now ${solverName(e.method)}.`));
    setNotice(note || told.length ? { text: [note, ...told].filter(Boolean).join(" "), offer: note ? "undo" : undefined } : undefined);
    if (note || told.length) setSaid("");
  };
  /** One step back or forward in the history. Runs and stored results are not in it, so they stay. */
  const travel = (way: "undo" | "redo") => {
    const next = way === "undo" ? undo(steps.current) : redo(steps.current);
    if (next === steps.current) return;
    commit(next);
    // an experiment that the step took away cannot stay on screen
    if (selected.startsWith(EXPERIMENT) && !experimentsOf(next.present.project).some((e) => EXPERIMENT + e.id === selected)) select(EXPERIMENT + FIRST);
    setSaid("");
    setNotice(way === "undo" ? { text: "The last change was undone.", offer: "redo" } : { text: "The change was made again.", offer: "undo" });
  };
  const traveling = useRef(travel);
  traveling.current = travel;
  // Ctrl+Z and Ctrl+Y (Cmd on a Mac, and Shift+Z). Inside a text field the keys belong to the
  // browser, which undoes the typing there, and a dialog is finished first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (key !== "z" && key !== "y")) return;
      if ((event.target as Element | null)?.closest?.(`${TYPED}, [contenteditable]`) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      traveling.current(key === "y" || event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      (error) => setLoadFailure(`The stored results could not be read. ${messageOf(error)}`),
    );
    // a comparison that cannot be read counts as none
    loadComparison(record.id).then(setComparison, () => {});
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
      // leaving the project cancels its run and its comparison
      worker.current?.terminate();
      stopComparing.current?.();
    };
  }, [record.id, flush]);

  // The height of the run bar is published to the styles, so that scrolling to a focused control stops below the bar.
  const runbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = runbar.current!, root = document.documentElement;
    const publish = () => root.style.setProperty("--runbar-h", getComputedStyle(bar).position === "sticky" ? `${bar.offsetHeight}px` : "0px");
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--runbar-h");
    };
  }, []);

  const known = issues ?? [];
  const experiments = experimentsOf(project);
  const running = run.state === "running";
  // the run bar shows the experiment that runs, or else the one last selected
  const shown = experiments.find((e) => e.id === (running ? run.id : current)) ?? experiments[0];
  const marked = new Set(known.map((i) => partOf(i.where)));

  const select = (key: string) => {
    setSelected(key);
    // a way back belongs to the run that offered it, and any other step takes it away
    setOrigin(undefined);
    lastFocus.current = -1;
    if (key.startsWith(EXPERIMENT)) setCurrent(key.slice(EXPERIMENT.length));
    if (drawer.current?.open) drawer.current.close();
  };
  /** Shows a part from a button that goes away with the part it was on, and gives the focus to the heading of the new part. */
  const go = (key: string) => {
    select(key);
    setTimeout(() => document.getElementById("panel-heading")?.focus());
  };
  const start = (experiment: Experiment, base: Project = project) => {
    // the status line belongs to the run from here on: a message about an earlier edit must not hide a refusal or the end of the run
    setNotice(undefined);
    // Problems found in an older state of the project do not refuse a run. The run worker
    // checks the project again, and its message is shown if it still cannot run.
    const blocking = known.find((i) => !i.where.startsWith(EXPERIMENT) || i.where === EXPERIMENT + experiment.id);
    if (base === checked && blocking) {
      setRun({ state: "error", id: experiment.id, message: `This project cannot run yet. ${blocking.message}` });
      select(partOf(blocking.where));
      return;
    }
    // the snapshot: the definition this run starts from, with this experiment's setup as its run
    const snapshot = projectFor(base, experiment);
    const w = runWorker();
    worker.current = w;
    setRun({ state: "running", id: experiment.id, snapshot });
    // the experiment that runs comes into view, with its live preview and then its result
    const from = { key: selected, experiment: experiment.id, scroll: window.scrollY, focus: lastFocus.current };
    select(EXPERIMENT + experiment.id);
    if (from.key !== EXPERIMENT + experiment.id) setOrigin(from);
    const end = (next: RunState) => {
      w.terminate();
      worker.current = null;
      setRun(next);
      setSaid(""); // the end of a run is said, also after a candidate was tested meanwhile
      setNotice(undefined); // and also after an edit during the run
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
    setNotice(undefined);
    setRun({ state: "cancelled", id: run.id });
  };
  // A comparison runs beside everything else: in workers of its own, from a snapshot of the
  // project, so the user can go on editing and can still press Run.
  const compare = (plan: Plan) => {
    const blocking = known.find((i) => !i.where.startsWith(EXPERIMENT));
    if (project === checked && blocking) return setCompareEnded({ failed: true, text: `This project cannot run yet. ${blocking.message}` });
    const jobs = jobsOf(plan), slots = plan.experiments.map(() => [] as ReturnType<typeof comparableRun>[]);
    let done = 0;
    const end = (ended: { failed: boolean; text: string }) => {
      stopComparing.current = undefined;
      setComparing(undefined);
      setCompareEnded(ended);
    };
    setCompareEnded(undefined);
    setComparing({ done: 0, total: jobs.length });
    stopComparing.current = runJobs(jobs.map((job) => job.request), poolSize(navigator.hardwareConcurrency, jobs.length), runWorker, {
      error: (message) => end({ failed: true, text: `The comparison stopped, and nothing was kept from it. ${message}` }),
      async result(index, result) {
        // each result goes to the place of its own run, whatever order the workers finish in
        slots[jobs[index].experiment][jobs[index].runIndex] = comparableRun(result);
        if (++done < jobs.length) return setComparing({ done, total: jobs.length });
        const stored: StoredComparison = {
          v: COMPARISON_VERSION, projectId: record.id, finished: Date.now(), versions: result.versions, project: plan.project,
          experiments: plan.experiments.map((e, n) => ({ ...e, results: slots[n] })),
        };
        setComparison(stored);
        try {
          await saveComparison(stored);
          end({ failed: false, text: "Comparison finished." });
        } catch (error) {
          end({ failed: true, text: `The comparison finished, but it could not be saved: ${messageOf(error)}` });
        }
      },
    });
  };
  const cancelComparing = () => {
    stopComparing.current?.();
    stopComparing.current = undefined;
    setComparing(undefined);
    setCompareEnded({ failed: false, text: "Comparison cancelled. Nothing was kept from it." });
  };
  /** Back to the part that the run was started from, with the page and the focus where they were, as far as the part is still the same. */
  const back = () => {
    if (!origin) return;
    select(origin.key);
    setTimeout(() => {
      (focusable()[origin.focus] ?? document.getElementById("panel-heading"))?.focus({ preventScroll: true });
      window.scrollTo(0, origin.scroll);
    });
  };
  const rerun = (experiment: Experiment) => {
    // the new seed is written into the experiment, so the form and the result agree
    const next = { ...experiment, seed: Number.isInteger(experiment.seed) ? (experiment.seed + 1) % 2 ** 32 : 1 };
    const changed = withExperiment(project, next);
    update(changed);
    start(next, changed);
  };

  const addExperiment = (from?: Experiment) => {
    const id = newExperimentId(project), suggested = suggest(project.variables);
    // a copy is the user's own. An experiment that starts from nothing starts as the suggestion, and follows it until it is changed by hand
    const copy: Experiment = from
      ? { ...from, settings: { ...from.settings }, id, name: `${from.name} copy` }
      : { method: suggested.method, settings: { ...suggested.settings }, budget: suggested.budget, seed: 1, id, name: `Experiment ${experiments.length + 1}` };
    // an id can come back after an undo, and the result of the experiment that had it before must not
    void deleteResult(record.id, id);
    setResults(({ [id]: gone, ...kept }) => kept);
    commit(recordStep(steps.current, { project: withExperiment(project, copy), following: from ? following : [...following, id] }, undefined, Date.now()));
    setNotice(undefined);
    select(EXPERIMENT + id);
  };
  const removeExperiment = (experiment: Experiment) => {
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
    // The history starts again here: an undo would bring the experiment back without its result,
    // and after the first one was deleted it would show the result of another experiment under it.
    const promoted = experiment.id === FIRST ? experiments[1]?.id : undefined;
    const still = following.filter((id) => id !== experiment.id).map((id) => (id === promoted ? FIRST : id));
    commit(startHistory({ project: next, following: still }));
    setNotice(undefined);
    select(EXPERIMENT + FIRST);
    // the button that had the focus is gone with its experiment
    setTimeout(() => document.getElementById("panel-heading")?.focus());
  };

  const status =
    notice ? notice.text
    : said ? said
    : run.state === "running" ? `Running "${shown.name}".`
    : run.state === "done" ? `Run finished. ${results[run.id]?.result.status ?? ""}.`
    : run.state === "cancelled" ? "Run cancelled. Nothing was kept from it."
    : run.state === "error" ? run.message
    : "";
  const failed = run.state === "error" && !said && !notice;
  const say = (text: string) => (setNotice(undefined), setSaid(text));
  // a constraint that is off is still counted, and the count says how many are off
  const off = (project.constraints ?? []).filter((c) => c?.enabled === false).length;
  const counts: Record<string, number | string | undefined> = {
    data: (project.data ?? []).length, variables: project.variables.length,
    constraints: off ? `${(project.constraints ?? []).length}, ${off} off` : (project.constraints ?? []).length,
  };
  const entry = (key: string, label: string, extra?: number | string) => (
    <li key={key}>
      <button type="button" className="nav-item" aria-current={selected === key ? "true" : undefined} onClick={() => select(key)}>
        <span className="label">{label}</span>
        {extra !== undefined && <span className="count">{extra}</span>}
        {marked.has(key) && <span className="mark" role="img" aria-label="has a problem"><Icon name="circle-exclamation-point" /></span>}
      </button>
    </li>
  );
  const Panel = PANELS[selected as keyof typeof PANELS];
  const edited = selected.startsWith(EXPERIMENT) ? experiments.find((e) => EXPERIMENT + e.id === selected) ?? experiments[0] : undefined;
  const sidebar = (
    <nav className="sidebar" aria-label="Parts of the project">
      <p className="nav-group" id="group-problem">Problem</p>
      <ul aria-labelledby="group-problem">{PARTS.map(([key, label]) => entry(key, label, counts[key]))}</ul>
      <ul aria-label="Test">{entry("candidate", "Test a candidate")}</ul>
      <p className="nav-group" id="group-experiments">Experiments</p>
      <ul aria-labelledby="group-experiments">
        {experiments.map((e) => entry(EXPERIMENT + e.id, e.name || "Unnamed"))}
        <li><button type="button" className="nav-item new" onClick={() => addExperiment(edited)}><Icon name="plus" />New experiment</button></li>
      </ul>
      <ul aria-label="Compare and share">{entry("compare", "Compare experiments")}{entry("share", "Share")}</ul>
    </nav>
  );

  return (
    <div className="workspace">
      {createPortal(
        <div className="project-bar">
          {narrow && (
            <button type="button" className="btn btn-quiet btn-icon" aria-label="Show the parts of the project" data-tip="Parts of the project" onClick={() => drawer.current?.showModal()}>
              <Icon name="menu" />
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={async () => { await flush(); onBack(); }}><Icon name="chevron-left" />All projects</button>
          <h2>{project.name}</h2>
          <span className="saving" data-state={saving}>
            <Icon name={saving === "failed" ? "circle-exclamation-point" : saving === "saved" ? "check" : "loader-circle"} />
            {saving === "saved" ? "All changes saved" : saving === "saving" ? "Saving" : "Could not save. Download the project to keep it."}
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => download(project.name, project)}><Icon name="download" />Download project</button>
        </div>,
        document.getElementById("bar-project")!,
      )}
      {removing && (
        <ConfirmDialog
          heading="Delete this experiment?" action="Delete" body={<>"{removing.name}" and its result will be deleted. This cannot be undone.</>}
          onDone={(confirmed) => {
            setRemoving(undefined);
            if (confirmed) removeExperiment(removing);
          }}
        />
      )}

      {narrow ? (
        // a click on the veil around the drawer closes it
        <dialog ref={drawer} className="drawer" aria-label="Parts of the project" onClick={(event) => event.target === event.currentTarget && drawer.current?.close()}>
          <div className="drawer-body">
            <button type="button" className="btn btn-quiet btn-icon btn-compact" aria-label="Close" data-tip="Close" onClick={() => drawer.current?.close()}><Icon name="x" /></button>
            {sidebar}
          </div>
        </dialog>
      ) : sidebar}

      <div className="main">
        <div className="runbar" ref={runbar}>
          {/* one button, so keyboard focus stays in place when a run starts or ends */}
          <button type="button" className={`btn run ${running ? "btn-secondary" : "btn-primary"}`} onClick={running ? cancel : () => (setSaid(""), start(shown))}>
            <Icon name={running ? "square" : "play"} />{running ? "Cancel" : "Run"}
          </button>
          <div className="run-info">
            <p className="setup">
              <strong>{shown.name}</strong>: {solverName(shown.method)}, {Number.isFinite(shown.budget) ? count(shown.budget) : String(shown.budget)} evaluations, seed {String(shown.seed)}
            </p>
            {/* The line is kept when it is empty, so that a message does not move the page. */}
            <div className="run-status" data-state={failed ? "error" : undefined}>
              {failed && <Icon name="circle-exclamation-point" />}
              <p role="status" aria-live="polite" className={said && !notice ? "visually-hidden" : undefined}>{status}</p>
              {/* one button for both ways, so that the focus stays on it after it was used */}
              {notice?.offer && <button type="button" className="btn btn-quiet btn-compact" onClick={() => travel(notice.offer!)}>{notice.offer === "undo" ? "Undo" : "Redo"}</button>}
              {/* outside the live region: a screen reader should not read every update */}
              {run.state === "running" && run.progress && (
                <p className="progress">
                  <progress aria-label="Evaluations used" max={run.progress.evaluations.budget} value={run.progress.evaluations.used} />
                  <span>
                    {count(run.progress.evaluations.used)} of {count(run.progress.evaluations.budget)} evaluations. Best objective
                    so far: {withUnit(run.progress.best.objective, run.snapshot.objective.unit)}
                  </span>
                </p>
              )}
              {issues === undefined && !status && <span className="hint">Checking the project.</span>}
            </div>
          </div>
          {/* One place for two ways: back to where the run was started, shown on its experiment, and on to the result, shown everywhere else. */}
          {origin && selected === EXPERIMENT + origin.experiment ? (
            <button type="button" className="btn btn-quiet" onClick={back}><Icon name="chevron-left" />Back to {PART_NAMES[origin.key] ?? "the last part"}</button>
          ) : !running && results[shown.id] && selected !== EXPERIMENT + shown.id && (
            <button type="button" className="btn btn-quiet" onClick={() => select(EXPERIMENT + shown.id)}>Show the result<Icon name="chevron-right" /></button>
          )}
          {/* a comparison shows here from every part, for as long as it runs */}
          {comparing && (
            <div className="comparing">
              <p className="progress">
                <progress aria-label="Runs of the comparison that are done" max={comparing.total} value={comparing.done} />
                <span>Comparison: {count(comparing.done)} of {count(comparing.total)} runs done</span>
              </p>
              {selected !== "compare" && <button type="button" className="btn btn-quiet" onClick={() => go("compare")}>Show the comparison<Icon name="chevron-right" /></button>}
            </div>
          )}
        </div>

        <div className="panel" onFocus={(event) => (lastFocus.current = focusable().indexOf(event.target as HTMLElement))}>
          {loadFailure && <Alert kind="danger"><strong>Problem:</strong> {loadFailure} Reload the page to try again.</Alert>}
          {Panel && <Panel project={project} set={update} issues={known} go={select} texts={texts} setTexts={setTexts} />}
          {selected === "candidate" && (
            <CandidatePanel
              project={project} set={update} issues={known} texts={texts} outcome={outcome} help={help} say={say}
              setTexts={setTexts} setOutcome={(next) => (setOutcome(next), next === undefined && setSaid(""))}
            />
          )}
          {selected === "compare" && (
            <ComparePanel
              project={project} form={compareForm} setForm={setCompareForm} running={comparing !== undefined} ended={compareEnded} stored={comparison}
              onStart={compare} onCancel={cancelComparing} onShare={() => go("share")}
            />
          )}
          {selected === "share" && (
            <SharePanel project={project} results={results} comparison={comparison} experimentId={shared ?? current} setExperimentId={setShared} help={help} />
          )}
          {edited && (
            <>
              <ExperimentForm
                key={edited.id} project={project} experiment={edited} issues={known.filter((i) => i.where === EXPERIMENT + edited.id)}
                suggested={following.includes(edited.id) ? suggestionSentence(project.variables) : undefined}
                onChange={(next) => update(withExperiment(project, next))}
                onDuplicate={() => addExperiment(edited)}
                onDelete={() => setRemoving(edited)}
                locked={experiments.length === 1 ? "The only experiment of a project cannot be deleted." : running ? "An experiment cannot be deleted while a run is going on." : undefined}
              />
              <div className="output">
                {run.state === "running" && run.id === edited.id ? (
                  <div className="live">
                    <h4>Best solution so far</h4>
                    {!run.progress && <Loading>Starting the run.</Loading>}
                    {run.progress && <Drawing project={run.snapshot} solution={run.progress.best.solution} curve={run.curve} />}
                    {run.progress && !run.snapshot.view && (
                      <p className="code solution-text">{Object.entries(run.progress.best.solution).map(([name, value]) => `${name} = ${show(value)}`).join("; ").slice(0, 400)}</p>
                    )}
                  </div>
                ) : results[edited.id] ? (
                  <Result
                    stored={results[edited.id]} name={edited.name} onRerun={running ? undefined : () => (setSaid(""), rerun(edited))}
                    changed={definitionOf(results[edited.id].project) !== definitionOf(projectFor(project, edited))}
                  >
                    <ResultDownloads help={help} stored={results[edited.id]} name={edited.name} comparison={comparison} onMore={() => (setShared(edited.id), go("share"))} />
                  </Result>
                ) : (
                  <p className="empty">"{edited.name}" has no result yet. Press Run to get one.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
