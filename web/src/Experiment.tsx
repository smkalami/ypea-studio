// An experiment: its setup form (solver, budget, seed and the solver's own settings), and
// the result panel of its last run.

import type { ReactNode } from "react";
import { METHODS, type SettingValue } from "../../engine/methods/index.ts";
import type { Project } from "../../engine/project.ts";
import { difference } from "../../export/report.ts";
import { ConstraintTable } from "./Candidate.tsx";
import { count, type Experiment, KIND_WORDS, SETTING_WORDS, show, unsuited, withUnit } from "./draft.ts";
import { Drawing, HistoryChart } from "./Drawing.tsx";
import type { Issue } from "./protocol.ts";
import type { StoredResult } from "./storage.ts";
import { Alert, Disclosure, Select } from "./ui/controls.tsx";
import { CheckField, Field, Num, Problems } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";

const methodOf = (id: string) => (Object.hasOwn(METHODS, id) ? METHODS[id] : undefined);
export const solverName = (id: string) => methodOf(id)?.name ?? id;
/** "a", "a and b", "a, b and c". */
const listed = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

interface FormProps {
  project: Project;
  experiment: Experiment;
  issues: Issue[];
  onChange: (experiment: Experiment) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Why the experiment cannot be deleted now, when it cannot: it is the only one, or a run is going on. */
  locked?: string;
}

export function ExperimentForm({ project, experiment, issues, onChange, onDuplicate, onDelete, locked }: FormProps) {
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
      <div className="section-head">
        <h3 id="panel-heading" tabIndex={-1}>Experiment</h3>
        <div className="row actions">
          <button type="button" className="btn btn-quiet btn-compact" onClick={onDuplicate}><Icon name="copy" />Duplicate</button>
          {/* shown also when it cannot be used, with the reason, so that the row does not change when a run starts */}
          <button type="button" className="btn btn-quiet btn-compact" aria-disabled={locked ? true : undefined} data-tip={locked} onClick={() => !locked && onDelete()}><Icon name="trash" />Delete</button>
        </div>
      </div>
      <p className="lead">An experiment is one solver with a budget and a seed. It keeps the result of its last run.</p>
      <Problems issues={issues.filter((issue) => !fields.some((field) => names(issue, field)))} />
      <div className="row">
        <Field label="Name of the experiment">
          {(tie) => <input {...tie} type="text" className="input" value={experiment.name} onChange={(event) => onChange({ ...experiment, name: event.target.value })} />}
        </Field>
        <Field label="Solver" issues={at("method")}>
          {(tie) => (
            // a new solver starts from its own defaults, because settings belong to one solver
            <Select
              {...tie} value={experiment.method} onChange={(id) => onChange({ ...experiment, method: id, settings: {} })}
              options={[
                ...(method ? [] : [{ value: experiment.method, label: `${experiment.method} (not known)` }]),
                ...Object.values(METHODS).map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
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
        // a calm note, not a warning: solvers designed for decimal numbers have done well on other kinds of values
        <Alert kind="neutral" role="note">
          <strong>Note:</strong> {method.name} was designed for {listed(method.suits.map((kind) => KIND_WORDS[kind]))}. This project
          has {listed(poor.map((kind) => KIND_WORDS[kind]))}, and the solver may still work well on them.{" "}
          {suited.length > 0
            ? <>Solvers designed for every kind of value in this project: {suited.join(", ")}.</>
            : <>No solver was designed for every kind of value in this project.</>}
        </Alert>
      )}
      {method && (
        // a problem in a setting opens the settings, so that it is seen
        <Disclosure summary={`Settings of ${method.name}`} open={settingProblem || undefined}>
          <div className="row">
            {Object.entries(method.params).map(([key, spec]) => {
              const value = Object.hasOwn(experiment.settings, key) ? experiment.settings[key] : spec.default;
              if (spec.kind === "boolean") {
                return <CheckField key={key} label={key} hint={spec.help} issues={at(key)} checked={value === true} onChange={(checked) => setting(key, checked)} />;
              }
              if (spec.kind === "choice") {
                // readable words where the own name of a setting says little. The project file keeps the names.
                const words = Object.hasOwn(SETTING_WORDS, key) ? SETTING_WORDS[key] : undefined;
                return (
                  <Field key={key} label={words?.label ?? key} hint={words?.hint ?? spec.help} className="setting" issues={at(key)}>
                    {(tie) => <Select {...tie} value={String(value)} options={spec.options.map((option) => ({ value: option, label: words?.options[option] ?? option }))} onChange={(option) => setting(key, option)} />}
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
            <p><button type="button" className="btn btn-quiet btn-compact" onClick={() => onChange({ ...experiment, settings: {} })}>Reset to the defaults of the solver</button></p>
          )}
        </Disclosure>
      )}
    </section>
  );
}

const time = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`);

interface ResultProps {
  stored: StoredResult;
  name: string;
  /** True when the project is no longer the definition this result ran. */
  changed: boolean;
  /** Absent while a run is going on. */
  onRerun?: () => void;
  /** The downloads that are offered next to the result. */
  children?: ReactNode;
}

export function Result({ stored, name, changed, onRerun, children }: ResultProps) {
  // everything here comes from the stored snapshot, not from the live project
  const { result, project } = stored;
  const { sense, unit } = project.objective;
  const { best, baseline, reference } = result;
  return (
    <section aria-labelledby="result-heading" className="result">
      <h3 id="result-heading">Result of "{name}"</h3>
      {changed && (
        <Alert kind="warning">
          <strong>Note:</strong> the project or this experiment has changed since this run. The result belongs to the definition as it was then.
        </Alert>
      )}
      <p className={best.feasible ? "outcome feasible" : "outcome"}><Icon name={best.feasible ? "circle-check" : "triangle-exclamation-point"} />{result.status}.</p>
      {!best.feasible && (
        <Alert kind="warning">The solution below is the candidate that breaks the constraints least. It is not feasible.</Alert>
      )}
      <dl className="facts">
        <dt>Objective ({sense === "min" ? "minimized" : "maximized"})</dt>
        <dd className="value">{withUnit(best.objective, unit)}</dd>
        {baseline && (
          <>
            <dt>In use today: {baseline.label}</dt>
            <dd>{withUnit(baseline.objective, unit)}{baseline.feasible === false ? " (it breaks a constraint)" : ""}</dd>
            <dt>Difference from what is in use today</dt>
            {/* the words of the report: "better" and "worse" are said only of two feasible solutions */}
            <dd>{difference(best.objective, baseline, sense, best.feasible, unit)}</dd>
          </>
        )}
        {reference && (
          <>
            <dt>Known answer: {reference.label ?? "reference"}</dt>
            <dd>{withUnit(reference.objective, unit)}{reference.feasible === false ? " (it breaks a constraint)" : ""}</dd>
            <dt>Difference from the known answer</dt>
            <dd>{difference(best.objective, reference, sense, best.feasible, unit)}</dd>
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
      <div className="table-box" tabIndex={0} role="group" aria-label="The solution, one variable per row">
        <table className="table">
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
      </div>
      <div className="figures">
        <Drawing project={project} solution={best.solution} curve={stored.curve} />
        <HistoryChart result={result} unit={unit} />
      </div>

      <div className="honest">
        <p>
          This is one run of a randomized solver ({solverName(result.method)}) with a recorded seed (seed {result.seed.base}, run{" "}
          {result.seed.runIndex}). A run with another seed can give a different answer.
        </p>
        {onRerun && <button type="button" className="btn btn-secondary" onClick={onRerun}>Run again with a new seed</button>}
      </div>
      <p className="hint">
        Finished {new Date(stored.finished).toLocaleString()}. App version {result.versions.app}, tested with ypea {result.versions.ypeaTested}.
        The project definition that produced this result is stored with it.
      </p>
      {children}
    </section>
  );
}
