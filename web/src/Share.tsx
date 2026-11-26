// Share: every file a project can be taken away as. The project itself, with or without its
// stored results, and for the result of one experiment the report, the Python script, the
// result as data and the charts as pictures. A comparison adds its summary and its charts.
// The report, the script and the drawing of the solution are written by the helper worker,
// because each of them translates the text of the project.

import { useMemo, useState, type ReactNode } from "react";
import type { Comparison } from "../../engine/compare.ts";
import type { Project } from "../../engine/project.ts";
import { comparisonCsv, historyCsv, resultJson, solutionCsv } from "../../export/data.ts";
import { historyChart } from "../../export/report-drawings.ts";
import { sameProblem, type StoredComparison } from "./compare.ts";
import { summaryOf } from "./Compare.tsx";
import { type Experiment, experimentsOf } from "./draft.ts";
import type { HelpReply, HelpRequest } from "./protocol.ts";
import { comparisonSvg, download, fileName, pngOf, saveFile, svgFile } from "./share.ts";
import { projectWithResults, type StoredResult } from "./storage.ts";
import { Alert, Select } from "./ui/controls.tsx";
import { CheckField, Field } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";

type Help = (request: HelpRequest) => Promise<HelpReply>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The text that the helper worker wrote, or its message as an error. */
async function written(help: Help, request: HelpRequest): Promise<string> {
  const reply = await help(request);
  if (reply.type === "text") return reply.text;
  throw new Error(reply.type === "error" ? reply.message : "The file could not be written.");
}

/** The files of one stored result. `comparison` goes into the report and the result file when it is given. */
function resultFiles(help: Help, stored: StoredResult, name: string, comparison?: Comparison) {
  const base = fileName(stored.project.name, name), { project, result } = stored, unit = project.objective.unit;
  const report = () => written(help, { type: "report", input: { project, result, finished: stored.finished, experiment: name, curve: stored.curve, comparison } });
  const drawing = async () => svgFile(await written(help, { type: "drawing", project, solution: result.best.solution, curve: stored.curve })) ?? fail("This result has no drawing that can be saved.");
  const history = () => svgFile(historyChart(result, unit, "history-title").text) ?? fail("This run recorded too few values for a chart.");
  return {
    python: async () => saveFile(`${base}.py`, await written(help, { type: "python", project, result }), "text/x-python"),
    report: async () => saveFile(`${base}-report.html`, await report(), "text/html"),
    async print() {
      // The tab is opened at once, while the click still counts as the user's, and the report is shown in it when it is ready.
      const tab = window.open("", "_blank") ?? fail("The browser did not open a new tab. Allow it for this site, or download the report and print that file.");
      try {
        // shortcut: the address of this report is never given back. It goes when the app is closed.
        tab.location.href = URL.createObjectURL(new Blob([await report()], { type: "text/html" }));
      } catch (error) {
        tab.close();
        throw error;
      }
    },
    json: () => saveFile(`${base}-result.json`, resultJson({ project, result, finished: stored.finished, experiment: name, comparison }), "application/json"),
    solution: () => saveFile(`${base}-solution.csv`, solutionCsv(project, result), "text/csv"),
    history: () => saveFile(`${base}-history.csv`, historyCsv(result), "text/csv"),
    historySvg: () => saveFile(`${base}-history.svg`, history(), "image/svg+xml"),
    historyPng: async () => saveFile(`${base}-history.png`, await pngOf(history()), "image/png"),
    drawingSvg: async () => saveFile(`${base}-drawing.svg`, await drawing(), "image/svg+xml"),
    drawingPng: async () => saveFile(`${base}-drawing.png`, await pngOf(await drawing()), "image/png"),
  };
}

function fail(message: string): never {
  throw new Error(message);
}

/** Does the work of a button, and keeps the message of work that failed, to show it next to the buttons. */
function useWork() {
  const [failure, setFailure] = useState("");
  const work = (what: string, job: () => unknown) => async () => {
    setFailure("");
    try {
      await job();
    } catch (error) {
      setFailure(`${what} could not be made. ${messageOf(error)}`);
    }
  };
  return { failure, work };
}

const Save = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="btn btn-secondary btn-compact" onClick={onClick}><Icon name="download" />{label}</button>
);

/** The comparison, when it ran on the problem of this result. Another state of the project does not belong in the same report. */
const fitting = (stored: StoredResult, comparison?: StoredComparison) => (comparison && sameProblem(stored.project, comparison.project) ? summaryOf(comparison).comparison : undefined);

interface DownloadsProps {
  help: Help;
  stored: StoredResult;
  name: string;
  comparison?: StoredComparison;
  onMore: () => void;
}

/** Next to a result: the two files that are asked for most, and the way to all the others. */
export function ResultDownloads({ help, stored, name, comparison, onMore }: DownloadsProps) {
  const { failure, work } = useWork();
  const fits = useMemo(() => fitting(stored, comparison), [stored, comparison]);
  const files = resultFiles(help, stored, name, fits);
  return (
    <>
      <div className="row actions">
        <button type="button" className="btn btn-quiet btn-compact" onClick={work("The report", files.report)}><Icon name="download" />Download the report</button>
        <button type="button" className="btn btn-quiet btn-compact" onClick={work("The Python script", files.python)}><Icon name="download" />Download the Python script</button>
        <button type="button" className="btn btn-quiet btn-compact" onClick={onMore}>All downloads<Icon name="chevron-right" /></button>
      </div>
      {failure && <Alert kind="danger" role="alert"><strong>Problem:</strong> {failure}</Alert>}
    </>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <>
      <h4>{heading}</h4>
      {children}
    </>
  );
}

interface ShareProps {
  project: Project;
  results: Record<string, StoredResult>;
  comparison?: StoredComparison;
  /** The experiment whose result is shared, as last chosen. */
  experimentId: string;
  setExperimentId: (id: string) => void;
  help: Help;
}

export function SharePanel({ project, results, comparison, experimentId, setExperimentId, help }: ShareProps) {
  const { failure, work } = useWork();
  const [include, setInclude] = useState(true);
  const [leftOut, setLeftOut] = useState(0);
  const withResult: Experiment[] = experimentsOf(project).filter((e) => results[e.id]);
  const experiment = withResult.find((e) => e.id === experimentId) ?? withResult[0];
  const stored = experiment && results[experiment.id];
  const summary = useMemo(() => summaryOf(comparison).comparison, [comparison]);
  const charts = useMemo(() => summary && comparisonSvg(summary), [summary]);
  const fits = useMemo(() => stored && fitting(stored, comparison), [stored, comparison]);
  const files = stored && resultFiles(help, stored, experiment.name, include ? fits : undefined);
  const kept = [...withResult.map((e) => results[e.id]), comparison].filter(Boolean).length;
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Share</h3>
      <p className="lead">Every file is made in this browser and saved to this computer. Nothing is sent anywhere.</p>
      {failure && <Alert kind="danger" role="alert"><strong>Problem:</strong> {failure}</Alert>}

      <Group heading="The project">
        <p className="lead">
          A project file holds the whole definition and every experiment. With results, it also carries the stored result of each experiment and
          the comparison, each with the definition that produced it. A colleague opens the file with "Open a project" and can run it again.
        </p>
        <div className="row actions">
          <Save label="Download the project" onClick={() => download(project.name, project)} />
          {kept > 0 && (
            <Save
              label="Download the project with results"
              onClick={work("The project file", () => {
                const made = projectWithResults(project, withResult.map((e) => results[e.id]), comparison);
                setLeftOut(made.leftOut);
                download(`${project.name} with results`, made.file);
              })}
            />
          )}
        </div>
        {leftOut > 0 && <Alert kind="warning"><strong>Note:</strong> {leftOut} of the {kept} stored results could not be put into the file and {leftOut === 1 ? "was" : "were"} left out.</Alert>}
      </Group>

      {!files ? (
        <p className="empty">No experiment has a result yet. Press Run to get one. Its report, its Python script and its charts are then offered here.</p>
      ) : (
        <>
          <Group heading="The result of one experiment">
            <Field label="Result to share" hint={`From the run that finished ${new Date(stored.finished).toLocaleString()}.`}>
              {(tie) => <Select {...tie} value={experiment.id} options={withResult.map((e) => ({ value: e.id, label: e.name || "Unnamed" }))} onChange={setExperimentId} />}
            </Field>
          </Group>

          <Group heading="Report">
            <p className="lead">One page with the result, its drawings and the definition that produced it. It needs nothing but a browser, and it prints well.</p>
            {fits ? (
              <CheckField label="Include the comparison in the report and in the result file" checked={include} onChange={setInclude} />
            ) : comparison && (
              <p className="hint">The comparison ran on another state of the project than this result, so the report leaves it out.</p>
            )}
            <div className="row actions">
              <Save label="Download the report" onClick={work("The report", files.report)} />
              <button type="button" className="btn btn-secondary btn-compact" onClick={work("The report", files.print)}>Open the report to print</button>
            </div>
            <p className="hint">The report opens in a new tab. Print it from there with the print command of the browser.</p>
          </Group>

          <Group heading="Python script">
            <p className="lead">
              One file that repeats this run with the <code>ypea</code> package: the same solver, settings, budget and seed. The Python run follows
              the app closely: number for number with most solvers, and within the last digits with CMA-ES or with functions such as exp and log.
              The start of the script says exactly how.
            </p>
            <div className="row actions"><Save label="Download the Python script" onClick={work("The Python script", files.python)} /></div>
          </Group>

          <Group heading="Results as data">
            <div className="row actions">
              <Save label="Result (JSON)" onClick={work("The result file", files.json)} />
              <Save label="Solution (CSV)" onClick={work("The solution file", files.solution)} />
              <Save label="History of the run (CSV)" onClick={work("The history file", files.history)} />
            </div>
          </Group>

          <Group heading="Charts as pictures">
            <div className="row actions">
              <Save label="History chart (SVG)" onClick={work("The chart", files.historySvg)} />
              <Save label="History chart (PNG)" onClick={work("The chart", files.historyPng)} />
              {stored.project.view && <Save label="Drawing of the solution (SVG)" onClick={work("The drawing", files.drawingSvg)} />}
              {stored.project.view && <Save label="Drawing of the solution (PNG)" onClick={work("The drawing", files.drawingPng)} />}
            </div>
            <p className="hint">Pictures are saved in the light theme, whatever theme the app has, so that they read well in a document.</p>
          </Group>
        </>
      )}

      {summary && (
        <Group heading="The comparison">
          <div className="row actions">
            <Save label="Summary (CSV)" onClick={work("The summary file", () => saveFile(`${fileName(project.name)}-comparison.csv`, comparisonCsv(summary), "text/csv"))} />
            {charts && <Save label="Comparison charts (SVG)" onClick={work("The chart", () => saveFile(`${fileName(project.name)}-comparison.svg`, charts, "image/svg+xml"))} />}
            {charts && <Save label="Comparison charts (PNG)" onClick={work("The chart", async () => saveFile(`${fileName(project.name)}-comparison.png`, await pngOf(charts), "image/png"))} />}
          </div>
        </Group>
      )}
    </section>
  );
}
