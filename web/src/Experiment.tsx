// An experiment: its setup form (solver, budget, seed and the solver's own settings), and
// the result panel of its last run.

import { METHODS, type SettingValue } from "../../engine/methods/index.ts";
import type { Project } from "../../engine/project.ts";
import { ConstraintTable } from "./Candidate.tsx";
import { count, type Experiment, KIND_WORDS, percentChange, show, unsuited, withUnit } from "./draft.ts";
import { Drawing, HistoryChart } from "./Drawing.tsx";
import { Field, Num, Problems } from "./fields.tsx";
import type { Issue } from "./protocol.ts";
import type { StoredResult } from "./storage.ts";

const methodOf = (id: string) => (Object.hasOwn(METHODS, id) ? METHODS[id] : undefined);
export const solverName = (id: string) => methodOf(id)?.name ?? id;

interface FormProps {
  project: Project;
  experiment: Experiment;
  issues: Issue[];
  onChange: (experiment: Experiment) => void;
  onDuplicate: () => void;
  /** Absent when the experiment cannot be deleted: it is the only one, or it is running. */
  onDelete?: () => void;
}

export function ExperimentForm({ project, experiment, issues, onChange, onDuplicate, onDelete }: FormProps) {
  const method = methodOf(experiment.method);
  const poor = unsuited(project, experiment.method);
  const suited = Object.values(METHODS).filter((m) => unsuited(project, m.id).length === 0).map((m) => m.name);
  const setting = (key: string, value: SettingValue | undefined) => {
    const { [key]: old, ...rest } = experiment.settings;
    onChange({ ...experiment, settings: value === undefined ? rest : { ...rest, [key]: value } });
  };
  // A problem names the field it is about, as "run.budget", "budget" or the name of a setting.
  const fields = ["method", "budget", "seed", ...Object.keys(method?.params ?? {})];
  const names = (issue: Issue, key: string) => new RegExp(`[".]${key}"`).test(issue.message) || (key === "method" && /^Unknown solver/.test(issue.message));
  const at = (key: string) => issues.filter((issue) => fields.find((field) => names(issue, field)) === key);
  const settingProblem = Object.keys(method?.params ?? {}).some((key) => at(key).length > 0);
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Experiment</h3>
      <p>An experiment is one solver with a budget and a seed. It keeps the result of its last run.</p>
      <Problems issues={issues.filter((issue) => !fields.some((field) => names(issue, field)))} />
      <div className="row">
        <Field label="Name of the experiment">
          {(tie) => <input {...tie} type="text" value={experiment.name} onChange={(event) => onChange({ ...experiment, name: event.target.value })} />}
        </Field>
        <button type="button" className="quiet end" onClick={onDuplicate}>Duplicate</button>
        {onDelete && <button type="button" className="quiet end" onClick={onDelete}>Delete</button>}
      </div>
      <div className="row">
        <Field label="Solver" issues={at("method")}>
          {(tie) => (
            // a new solver starts from its own defaults, because settings belong to one solver
            <select {...tie} value={experiment.method} onChange={(event) => onChange({ ...experiment, method: event.target.value, settings: {} })}>
              {!method && <option value={experiment.method}>{experiment.method} (not known)</option>}
              {Object.values(METHODS).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Budget (evaluations)" className="narrow" hint="How many candidates the solver may try." issues={at("budget")}>
          {(tie) => <Num {...tie} value={experiment.budget} onChange={(budget) => onChange({ ...experiment, budget: budget as number })} />}
        </Field>
        <Field label="Seed" className="narrow" hint="The same seed gives the same run again." issues={at("seed")}>
          {(tie) => <Num {...tie} value={experiment.seed} onChange={(seed) => onChange({ ...experiment, seed: seed as number })} />}
        </Field>
      </div>
      {method && poor.length > 0 && (
        <p className="notice" role="note">
          <strong>Note:</strong> {method.name} is not made for {poor.map((kind) => KIND_WORDS[kind]).join(" or ")}, which this project has. It will
          run, but it may give a weak result. {suited.length > 0 && <>Solvers that suit every variable of this project: {suited.join(", ")}.</>}
        </p>
      )}
      {method && (
        // a problem in a setting opens the settings, so that it is seen
        <details className="settings" open={settingProblem || undefined}>
          <summary>Settings of {method.name}</summary>
          <div className="row">
            {Object.entries(method.params).map(([key, spec]) => {
              const value = Object.hasOwn(experiment.settings, key) ? experiment.settings[key] : spec.default;
              if (spec.kind === "boolean") {
                return (
                  <Field key={key} label={key} hint={spec.help} className="setting check" issues={at(key)}>
                    {(tie) => <input {...tie} type="checkbox" checked={value === true} onChange={(event) => setting(key, event.target.checked)} />}
                  </Field>
                );
              }
              if (spec.kind === "choice") {
                return (
                  <Field key={key} label={key} hint={spec.help} className="setting" issues={at(key)}>
                    {(tie) => (
                      <select {...tie} value={String(value)} onChange={(event) => setting(key, event.target.value)}>
                        {spec.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    )}
                  </Field>
                );
              }
              const range = `${spec.integer ? "A whole number" : "A number"} from ${show(spec.min)} to ${show(spec.max)}${spec.nullable ? ", or empty to let the solver choose" : ""}.`;
              return (
                <Field key={key} label={key} hint={`${spec.help} ${range}`} className="setting" issues={at(key)}>
                  {/* an empty field is "let the solver choose" where that is allowed, and otherwise text that the check refuses */}
                  {(tie) => <Num {...tie} value={value} onChange={(next) => setting(key, next === undefined ? (spec.nullable ? null : "") : (next as SettingValue))} />}
                </Field>
              );
            })}
          </div>
          {Object.keys(experiment.settings).length > 0 && (
            <p><button type="button" className="quiet" onClick={() => onChange({ ...experiment, settings: {} })}>Reset to the solver's defaults</button></p>
          )}
        </details>
      )}
    </section>
  );
}

const time = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`);

/** How the result stands against a comparison value: the difference in objective units, and a percent change where it means something. */
function difference(value: number, other: { objective: number; difference: number }, sense: "min" | "max", unit?: string): string {
  const percent = percentChange(value, other.objective);
  const d = other.difference;
  const verdict = d === 0 ? "the same" : (d < 0) === (sense === "min") ? "better" : "worse";
  return `${withUnit(d, unit)}${percent === undefined || d === 0 ? "" : ` (${show(Number(Math.abs(percent).toPrecision(3)))}% ${d < 0 ? "lower" : "higher"})`}, which is ${verdict}`;
}

interface ResultProps {
  stored: StoredResult;
  name: string;
  /** True when the project is no longer the definition this result ran. */
  changed: boolean;
  /** Absent while a run is going on. */
  onRerun?: () => void;
}

export function Result({ stored, name, changed, onRerun }: ResultProps) {
  // everything here comes from the stored snapshot, not from the live project
  const { result, project } = stored;
  const { sense, unit } = project.objective;
  const { best, baseline, reference } = result;
  return (
    <section aria-labelledby="result-heading" className="result">
      <h3 id="result-heading">Result of "{name}"</h3>
      {changed && (
        <p className="notice">
          <strong>Note:</strong> the project or this experiment has changed since this run. The result belongs to the definition as it was then.
        </p>
      )}
      <p className="outcome">{result.status}.</p>
      {!best.feasible && (
        <p className="notice">The solution below is the candidate that breaks the constraints least. It is not feasible.</p>
      )}
      <dl>
        <dt>Objective ({sense === "min" ? "minimized" : "maximized"})</dt>
        <dd className="value">{withUnit(best.objective, unit)}</dd>
        {baseline && (
          <>
            <dt>In use today: {baseline.label}</dt>
            <dd>{withUnit(baseline.objective, unit)}{baseline.feasible === false ? " (it breaks a constraint)" : ""}</dd>
            <dt>Difference from what is in use today</dt>
            <dd>{difference(best.objective, baseline, sense, unit)}</dd>
          </>
        )}
        {reference && (
          <>
            <dt>Known answer: {reference.label ?? "reference"}</dt>
            <dd>{withUnit(reference.objective, unit)}{reference.feasible === false ? " (it breaks a constraint)" : ""}</dd>
            <dt>Difference from the known answer</dt>
            <dd>{difference(best.objective, reference, sense, unit)}</dd>
          </>
        )}
        <dt>Evaluations</dt>
        <dd>{count(result.evaluations.used)} of {count(result.evaluations.budget)}</dd>
        <dt>Time</dt>
        <dd>{time(result.timeMs)}</dd>
      </dl>

      {best.constraints.length > 0 && (
        <>
          <h4>Constraints</h4>
          <ConstraintTable constraints={best.constraints} />
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
              <th scope="row"><code>{v.name}</code></th>
              <td>{show(best.solution[v.name])}</td>
              <td>{("unit" in v && v.unit) || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="figures">
        <Drawing project={project} solution={best.solution} curve={stored.curve} />
        <HistoryChart history={result.history} unit={unit} />
      </div>

      <div className="honest">
        <p>
          This is one run of a randomized solver ({solverName(result.method)}) with a recorded seed (seed {result.seed.base}, run{" "}
          {result.seed.runIndex}). A run with another seed can give a different answer.
        </p>
        {onRerun && <button type="button" onClick={onRerun}>Run again with a new seed</button>}
      </div>
      <p className="small">
        Finished {new Date(stored.finished).toLocaleString()}. App version {result.versions.app}, tested with ypea {result.versions.ypeaTested}.
        The project definition that produced this result is stored with it.
      </p>
    </section>
  );
}
