// Compare experiments: the form that starts a comparison (which experiments, how many runs
// each, one budget for all, and Random Search as a reference), its progress, and the
// descriptive summary of the last one that finished. The summary describes the runs and never
// judges them: the experiments stay in the order of the project, and nothing is marked.

import { useMemo } from "react";
import { checkComparable, type Comparison, DEFAULT_RUNS, summarize } from "../../engine/compare.ts";
import type { Project } from "../../engine/project.ts";
import { comparisonFigures } from "../../export/figures/build.ts";
import { comparisonChanged, MAX_RUNS, type Plan, planComparison, REFERENCE, runsOf, type StoredComparison } from "./compare.ts";
import { count, experimentsOf, show, withUnit } from "./draft.ts";
import { Figure } from "./Drawing.tsx";
import { solverName } from "./Experiment.tsx";
import type { Issue } from "./protocol.ts";
import { Alert, Checkbox, Disclosure } from "./ui/controls.tsx";
import { CheckField, Field, Num, Problems } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";

/** What the form holds. It is kept while the user looks at other parts of the project. */
export interface CompareForm {
  /** The ids of the experiments that are left out. A new experiment is in until it is taken out. */
  left: string[];
  runs: unknown;
  /** The budget of every run, when the chosen experiments do not agree on one. Nothing until the user sets it. */
  budget?: unknown;
  reference: boolean;
}
export const COMPARE_FORM: CompareForm = { left: [], runs: DEFAULT_RUNS, reference: false };

const isCount = (v: unknown, max = Infinity): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
const number = (v: unknown) => (typeof v === "number" ? count(v) : String(v));
const problem = (message: string): Issue[] => [{ where: "", message }];

/** The summary of a stored comparison, or why its runs cannot be summarized. */
export function summaryOf(stored: StoredComparison | undefined): { comparison?: Comparison; problem?: string } {
  if (!stored) return {};
  try {
    const runs = runsOf(stored), problems = checkComparable(runs);
    return problems.length > 0 ? { problem: problems.join(" ") } : { comparison: summarize(runs) };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

interface Props {
  project: Project;
  form: CompareForm;
  setForm: (form: CompareForm) => void;
  /** True while a comparison runs. Its progress is in the run bar, which stays in view. */
  running: boolean;
  /** How the last comparison ended, when it did not finish: it was cancelled, or it could not run. */
  ended?: { failed: boolean; text: string };
  stored?: StoredComparison;
  onStart: (plan: Plan) => void;
  onCancel: () => void;
  onShare: () => void;
}

export function ComparePanel({ project, form, setForm, running, ended, stored, onStart, onCancel, onShare }: Props) {
  const experiments = experimentsOf(project);
  const chosen = experiments.filter((e) => !form.left.includes(e.id));
  const budgets = [...new Set(chosen.map((e) => e.budget))];
  const budget = budgets.length > 1 ? form.budget ?? chosen[0].budget : budgets[0];
  const ready = chosen.length > 0 && isCount(form.runs, MAX_RUNS) && isCount(budget);
  const total = ready ? (chosen.length + (form.reference ? 1 : 0)) * (form.runs as number) : 0;
  return (
    <>
      <section aria-labelledby="panel-heading">
        <h3 id="panel-heading" tabIndex={-1}>Compare experiments</h3>
        <p className="lead">
          One run of a randomized solver can be lucky or unlucky. Here each chosen experiment is run several times, every run with its own seed
          and with the same budget, and the runs are described side by side. A first result does not need this.
        </p>
        <fieldset className="checks">
          <legend className="field-label">Experiments to compare</legend>
          <div className="check-list">
            {experiments.map((e) => (
              <label key={e.id} className="check">
                <Checkbox
                  checked={!form.left.includes(e.id)}
                  onChange={(event) => setForm({ ...form, left: event.target.checked ? form.left.filter((id) => id !== e.id) : [...form.left, e.id] })}
                />
                {e.name || "Unnamed"} ({solverName(e.method)})
              </label>
            ))}
          </div>
          <p className="hint">One experiment is enough: its runs are then compared with each other.</p>
          {chosen.length === 0 && <Problems issues={problem("Choose at least one experiment.")} />}
        </fieldset>
        <div className="row">
          <Field
            label="Runs of each experiment" className="narrow" hint={`From 1 to ${MAX_RUNS}. Run 0 has the seed of the experiment's own run.`}
            issues={isCount(form.runs, MAX_RUNS) ? [] : problem(`The number of runs must be a whole number from 1 to ${MAX_RUNS}.`)}
          >
            {(tie) => <Num {...tie} value={form.runs} onChange={(runs) => setForm({ ...form, runs })} />}
          </Field>
          {budgets.length > 1 && (
            <Field
              label="Budget of every run (evaluations)" hint="The experiments keep their own budgets."
              issues={isCount(budget) ? [] : problem("The budget must be a positive whole number of evaluations.")}
            >
              {(tie) => <Num {...tie} value={budget} onChange={(next) => setForm({ ...form, budget: next })} />}
            </Field>
          )}
        </div>
        {/* the usual numbers of runs, one click away. The field takes any other number. */}
        <div className="row actions">
          {[DEFAULT_RUNS, 20, 30].map((runs) => (
            <button key={runs} type="button" className="btn btn-quiet btn-compact" onClick={() => setForm({ ...form, runs })}>{runs} runs</button>
          ))}
          <p className="hint">Papers in this field usually report 20 to 30 runs.</p>
        </div>
        {budgets.length > 1 ? (
          <Alert kind="neutral" role="note">
            <strong>Note:</strong> the chosen experiments have different budgets ({chosen.map((e) => `${e.name}: ${number(e.budget)}`).join(", ")}).
            A comparison gives every run the same number of evaluations, so one budget is set here for all of them.
          </Alert>
        ) : chosen.length > 0 && !isCount(budget) ? (
          // the field above is not shown when the experiments agree, so the reason is said here
          <Problems issues={problem(`The budget of ${chosen.length === 1 ? "the chosen experiment" : "the chosen experiments"} (${number(budget)}) must be a positive whole number of evaluations. Correct it on the experiment.`)} />
        ) : chosen.length > 0 && (
          <p className="hint">Every run gets {number(budget)} evaluations, the budget of {chosen.length === 1 ? "the chosen experiment" : "the chosen experiments"}.</p>
        )}
        <CheckField
          label="Add Random Search as a reference" checked={form.reference} onChange={(reference) => setForm({ ...form, reference })}
          hint="Random Search tries random candidates with the same budget and the same number of runs. It needs no experiment of its own."
        />
        <div className="row actions">
          {/* one button, so keyboard focus stays in place when a comparison starts or ends */}
          <button
            type="button" className="btn btn-secondary" aria-disabled={!running && !ready ? true : undefined} data-tip={!running && !ready ? "Fix the problem above first." : undefined}
            onClick={running ? onCancel : () => ready && onStart(planComparison(project, chosen, form.runs as number, budget as number, form.reference))}
          >
            <Icon name={running ? "square" : "play"} />{running ? "Cancel the comparison" : "Run the comparison"}
          </button>
        </div>
        {/* said to a screen reader when it changes. The progress in the run bar is not, so that not every run is read out. */}
        <div aria-live="polite">
          {running ? (
            <p className="hint">The comparison is running. You can keep working in this project. Leaving the project or closing the page stops it.</p>
          ) : ended ? (
            ended.failed ? <Alert kind="danger"><strong>Problem:</strong> {ended.text}</Alert> : <p className="hint">{ended.text}</p>
          ) : ready && (
            <p className="hint">This will do {count(total)} runs of {number(budget)} evaluations each, in the background.</p>
          )}
        </div>
      </section>
      <div className="output">
        {stored ? <Summary stored={stored} changed={comparisonChanged(stored, project)} onShare={onShare} /> : <p className="empty">No comparison yet. Run one to see its summary here.</p>}
      </div>
    </>
  );
}

function Summary({ stored, changed, onShare }: { stored: StoredComparison; changed: boolean; onShare: () => void }) {
  const { comparison, problem: unreadable } = useMemo(() => summaryOf(stored), [stored]);
  // the charts are the figures of the report and of the saved picture
  const charts = useMemo(() => comparison && comparisonFigures(comparison), [comparison]);
  const runs = stored.experiments[0].results.length, unit = comparison?.unit;
  return (
    <section aria-labelledby="comparison-heading" className="comparison">
      <h3 id="comparison-heading">Summary of the comparison</h3>
      {changed && (
        <Alert kind="warning">
          <strong>Note:</strong> the project or one of these experiments has changed since this comparison. The numbers belong to the definition as it was then.
        </Alert>
      )}
      {unreadable && <Alert kind="danger"><strong>Problem:</strong> the stored runs cannot be summarized. {unreadable} Run the comparison again.</Alert>}
      {comparison && (
        <>
          {/* above the table and not its caption: a caption is as wide as the table, which scrolls in a narrow window */}
          <p className="lead" id="comparison-words">
            Every experiment was run {count(runs)} {runs === 1 ? "time" : "times"}, each run with its own seed and with {count(comparison.budget)} evaluations.
            The objective is {comparison.sense === "min" ? "minimized" : "maximized"}{unit ? `, in ${unit}` : ""}. The median, the quartiles and the best
            value are over the feasible runs only, so read them together with the count of feasible runs.
          </p>
          <div className="table-box" tabIndex={0} role="group" aria-label="The summary, one experiment per row">
            <table className="table" aria-describedby="comparison-words">
              <thead>
                <tr>
                  <th scope="col">Experiment</th>
                  <th scope="col">Solver</th>
                  <th scope="col">Feasible runs</th>
                  <th scope="col">Evaluations used</th>
                  <th scope="col">Median</th>
                  <th scope="col">First to third quartile</th>
                  <th scope="col">Best value</th>
                </tr>
              </thead>
              <tbody>
                {comparison.experiments.map((e, n) => (
                  <tr key={n}>
                    <th scope="row">{e.name}</th>
                    <td>{solverName(e.method)}</td>
                    <td>{e.feasibleRuns} of {e.runs}</td>
                    <td>{e.evaluations.usedMin === e.evaluations.usedMax ? count(e.evaluations.usedMax) : `${count(e.evaluations.usedMin)} to ${count(e.evaluations.usedMax)}`} of {count(e.evaluations.budget)}</td>
                    {e.objective ? (
                      <>
                        <td>{withUnit(e.objective.median, unit)}</td>
                        <td>{show(e.objective.q1)} to {withUnit(e.objective.q3, unit)}</td>
                        <td>{withUnit(e.objective.best, unit)}</td>
                      </>
                    ) : <td colSpan={3}>No numbers, because no run was feasible</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>These numbers only describe the runs, and the conclusion is the reader's.</p>
          <p className="hint">Quartiles are found by linear interpolation between the sorted values. With few feasible runs they say little.</p>
          <h4>Best value during the runs</h4>
          <p className="lead">
            In each chart the thick line is the median of the best value so far, and the shaded band between the two thin lines holds the middle half
            of the feasible runs, from the first to the third quartile. Only runs that end feasible are counted, and each one counts from the
            evaluation at which it first had a feasible candidate. All charts share the same scales.
          </p>
          {charts ? (
            <div className="figures charts">
              {charts.map((chart, n) => (chart.figure
                ? <Figure key={n} figure={chart.figure} label={`Chart ${n + 1}`} lead={chart.name} />
                : <figure key={n} className="drawing"><figcaption><strong>{chart.name}.</strong> {chart.words}</figcaption></figure>))}
            </div>
          ) : <p className="empty">No experiment has a feasible run, so there is no chart.</p>}
        </>
      )}
      <Disclosure summary="What ran: the setups and the seeds">
        <div className="table-box" tabIndex={0} role="group" aria-label="The setup and the seeds of every experiment">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Experiment</th>
                <th scope="col">Solver and settings</th>
                <th scope="col">Base seed</th>
                <th scope="col">Seeds of runs 0 to {runs - 1}</th>
              </tr>
            </thead>
            <tbody>
              {stored.experiments.map((e, n) => (
                <tr key={n}>
                  <th scope="row">{e.name}</th>
                  <td>{solverName(e.setup.method)}{Object.entries(e.results[0].settings).map(([key, value]) => `, ${key} = ${value === null ? "chosen by the solver" : show(value)}`).join("")}</td>
                  <td>{e.setup.seed}</td>
                  <td>{e.results.map((r) => r.seed.run).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stored.experiments.some((e) => e.reference) && <p className="hint">{REFERENCE.name} was added by the comparison. It starts from the base seed of the first chosen experiment.</p>}
      </Disclosure>
      <p className="hint">
        Finished {new Date(stored.finished).toLocaleString()}. App version {stored.versions.app}, tested with ypea {stored.versions.ypeaTested}.
        The project definition that these runs used is stored with them.
      </p>
      {comparison && <p><button type="button" className="btn btn-quiet btn-compact" onClick={onShare}><Icon name="download" />Download the summary and the charts</button></p>}
    </section>
  );
}
