// The Test part: a candidate typed by hand, taken from the baseline or drawn at random, and
// what the problem says about it. Also the two comparison values of a project: the baseline
// (the solution in use today) and the reference (a known answer).

import { useState } from "react";
import type { PlainSolution, Project } from "../../engine/project.ts";
import type { Inspection } from "../../engine/run.ts";
import type { VariableSpec } from "../../engine/variables.ts";
import { show, withUnit } from "./draft.ts";
import { Drawing } from "./Drawing.tsx";
import type { HelpReply, HelpRequest, Issue } from "./protocol.ts";
import { Alert, Checkbox } from "./ui/controls.tsx";
import { Field, Num, Problems } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";

/** The candidate as typed: one text for each variable, by its name. */
export type Texts = Record<string, string>;
/** What the last test found, with the candidate it was about. */
export type Outcome = { solution: PlainSolution; inspection: Inspection; curve?: number[] } | { failure: string };

type Layout = "number" | "list" | "rows" | "groups";
function layoutOf(v: VariableSpec): Layout {
  if (v.type === "partition") return "groups";
  if (v.type === "binary_partition") return "rows";
  if (!("shape" in v) || !Array.isArray(v.shape)) return "list";
  return (["number", "list", "rows"] as const)[v.shape.length] ?? "list";
}

const numbers = (text: string) => text.split(/[\s,]+/).filter(Boolean).map(Number);
/** For a list of yes or no values that is short enough for check boxes: its length. Otherwise 0. */
function checkSize(v: VariableSpec): number {
  const size = v.type === "binary" && Array.isArray(v.shape) && v.shape.length === 1 ? v.shape[0] : v.type === "binary_selection" ? v.n : 0;
  return Number.isInteger(size) && size > 0 && size <= 60 ? size : 0;
}
// a last empty line is not a group, but an empty line between others is an empty group
const lines = (text: string) => text.replace(/\n+$/, "").split("\n");

/** The typed candidate as a solution. Text that is not a number becomes NaN, which the engine refuses by name. */
export function parseCandidate(project: Project, texts: Texts): PlainSolution {
  return Object.fromEntries(project.variables.map((v) => {
    const text = texts[v.name] ?? "", layout = layoutOf(v);
    // check boxes that were never touched are zeros
    const boxes = checkSize(v), listed = numbers(text);
    const list = boxes ? Array.from({ length: Math.max(boxes, listed.length) }, (_, i) => listed[i] ?? 0) : listed;
    const value = layout === "number" ? (text.trim() === "" ? NaN : Number(text)) : layout === "list" ? list : lines(text).map(numbers);
    return [v.name, value];
  }));
}

/** A solution as the texts of the form. */
export function candidateTexts(solution: PlainSolution): Texts {
  const text = (value: unknown): string =>
    Array.isArray(value) ? (value.some(Array.isArray) || value.length === 0 ? value.map(text).join("\n") : value.join(", ")) : String(value ?? "");
  return Object.fromEntries(Object.entries(solution).map(([name, value]) => [name, text(value)]));
}

const HINTS: Record<Layout, string> = {
  number: "One number.",
  list: "Numbers separated by commas.",
  rows: "One row per line, with the numbers of a row separated by commas.",
  groups: "One group per line, with the positions of a group separated by commas. An empty line is an empty group.",
};

function valuesHint(v: VariableSpec & Record<string, any>): string {
  const range = (v.type === "real" || v.type === "integer") && typeof v.lb === "number" && typeof v.ub === "number" ? ` From ${v.lb} to ${v.ub}.` : "";
  switch (v.type) {
    case "permutation": return `Every position from 0 to ${v.n - 1}, each once, separated by commas.`;
    case "selection": return `${v.k} different positions from 0 to ${v.n - 1}, separated by commas.`;
    case "binary_selection": return `${v.n} values of 0 or 1, with exactly ${v.k} ones.`;
    case "partition": return `${v.k} groups that share the positions 0 to ${v.n - 1}. ${HINTS.groups}`;
    case "binary_partition": return `${v.k} rows of ${v.n} values of 0 or 1, with one 1 in every column. ${HINTS.rows}`;
    default: return `${Array.isArray(v.shape) && v.shape.length ? `${v.shape.join(" by ")} values. ` : ""}${HINTS[layoutOf(v)]}${range}`;
  }
}

interface Props {
  project: Project;
  set: (project: Project, note?: string) => void;
  issues: Issue[];
  texts: Texts;
  setTexts: (texts: Texts) => void;
  outcome: Outcome | undefined;
  setOutcome: (outcome: Outcome | undefined) => void;
  /** Asks the helper worker, with the time limit. */
  help: (request: HelpRequest) => Promise<HelpReply>;
  /** Says a short status for screen readers. */
  say: (text: string) => void;
}

export function CandidatePanel({ project, set, issues, texts, setTexts, outcome, setOutcome, help, say }: Props) {
  const [busy, setBusy] = useState(false);
  const [baselineLabel, setBaselineLabel] = useState(project.baseline?.label ?? "Current solution");
  const unit = project.objective.unit;
  const blocked = issues.filter((i) => i.where !== "baseline" && i.where !== "reference" && !i.where.startsWith("experiment"));

  /** Tests a candidate and gives the solution when it is a valid one. */
  const test = async (candidate: Texts = texts): Promise<PlainSolution | undefined> => {
    const solution = parseCandidate(project, candidate);
    setBusy(true);
    // the comparison values are left out, so that a baseline that no longer fits does not block the test
    const { baseline, reference, ...rest } = project;
    const reply = await help({ type: "test", project: rest, solution });
    setBusy(false);
    if (reply.type === "tested") {
      setOutcome({ solution, inspection: reply.inspection, curve: reply.curve });
      say(`Candidate tested. Objective ${withUnit(reply.inspection.objective, unit)}. ${reply.inspection.feasible ? "Every constraint holds." : "A constraint is broken."}`);
      return solution;
    }
    const failure = reply.type === "error" ? reply.message.replace(/^Project file: /, "") : "The test gave no answer.";
    setOutcome({ failure });
    say(`The candidate could not be tested. ${failure}`);
    return undefined;
  };
  const fill = (solution: PlainSolution) => {
    const next = candidateTexts(solution);
    setTexts(next);
    void test(next);
  };
  const random = async () => {
    const { baseline, reference, ...rest } = project;
    const reply = await help({ type: "random", project: rest, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    if (reply.type === "candidate") fill(reply.solution);
    else setOutcome({ failure: reply.type === "error" ? reply.message.replace(/^Project file: /, "") : "No candidate was drawn." });
  };
  const type = (name: string, text: string) => {
    setTexts({ ...texts, [name]: text });
    setOutcome(undefined);
  };
  const reference = project.reference;
  const setReference = (next: NonNullable<Project["reference"]>, note?: string) => {
    const { reference: old, ...rest } = project;
    set(next.objective === undefined && next.solution === undefined ? rest : { ...rest, reference: next }, note);
  };

  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Test a candidate</h3>
      <p className="lead">
        Test one solution before any run. Its objective value and each constraint show whether the problem says what you mean.
        Positions start at 0.
      </p>
      {blocked.length > 0 && <Alert kind="warning"><strong>Fix this first:</strong> {blocked[0].message}</Alert>}
      {project.variables.length === 0 && <p className="empty">The project has no variables yet. Add one under Variables, then test a candidate here.</p>}

      {(project.variables as (VariableSpec & Record<string, any>)[]).map((v) => {
        const layout = layoutOf(v), text = texts[v.name] ?? "";
        const size = checkSize(v);
        const label = `${v.name}${v.unit ? ` (${v.unit})` : ""}`;
        if (size > 0) {
          // yes or no values as check boxes, one for each position
          const values = numbers(text);
          const toggle = (i: number) => type(v.name, Array.from({ length: size }, (_, k) => ((k === i ? !values[k] : values[k] === 1) ? 1 : 0)).join(", "));
          return (
            <fieldset key={v.name} className="checks">
              <legend className="field-label"><code>{label}</code>: check the positions that are 1{v.type === "binary_selection" ? ` (exactly ${v.k})` : ""}</legend>
              <div className="check-list">
                {Array.from({ length: size }, (_, i) => (
                  <label key={i} className="check"><Checkbox checked={values[i] === 1} onChange={() => toggle(i)} />{i}</label>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <Field key={v.name} label={label} hint={valuesHint(v)} className={layout === "number" ? "" : "wide"}>
            {(tie) => layout === "rows" || layout === "groups"
              ? <textarea {...tie} className="textarea code" rows={Math.min(8, Math.max(2, Number(v.k ?? v.shape?.[0]) || 2))} spellCheck={false} value={text} onChange={(event) => type(v.name, event.target.value)} />
              : <input {...tie} type="text" className="input code" autoComplete="off" spellCheck={false} value={text} onChange={(event) => type(v.name, event.target.value)} />}
          </Field>
        );
      })}

      <div className="row actions">
        <button type="button" className="btn btn-secondary" aria-busy={busy || undefined} onClick={() => !busy && void test()}><Icon name="check" />Test this candidate</button>
        {project.baseline && <button type="button" className="btn btn-quiet" onClick={() => fill(project.baseline!.solution)}>Fill from the baseline</button>}
        <button type="button" className="btn btn-quiet" onClick={() => void random()}>Fill with a random candidate</button>
        {busy && <span className="hint">Testing.</span>}
      </div>

      {outcome && "failure" in outcome && <Alert kind="danger" role="alert"><strong>Problem:</strong> {outcome.failure}</Alert>}
      {outcome && "inspection" in outcome && (
        <div className="tested">
          <h4>What the problem says about this candidate</h4>
          <dl className="facts">
            <dt>Objective ({project.objective.sense === "min" ? "to minimize" : "to maximize"})</dt>
            <dd className="value">{withUnit(outcome.inspection.objective, unit)}</dd>
            <dt>Constraints</dt>
            <dd>
              {outcome.inspection.constraints.length === 0 ? "None."
                : outcome.inspection.feasible ? "Every constraint holds."
                : `${outcome.inspection.constraints.filter((c) => !c.satisfied).length} of ${outcome.inspection.constraints.length} broken.`}
            </dd>
          </dl>
          <ConstraintTable constraints={outcome.inspection.constraints} />
          <Drawing project={project} solution={outcome.solution} curve={outcome.curve} />
        </div>
      )}

      <h4>Comparison values</h4>
      <p className="lead">Every result is compared with these two values, when they are given. Both are stored from the candidate above.</p>
      <div className="pair">
        <fieldset className="item">
          <legend className="visually-hidden">In use today (baseline)</legend>
          <p className="item-title" aria-hidden="true">In use today (baseline)</p>
          <p>The baseline is the solution in use today.</p>
          <Problems issues={issues.filter((i) => i.where === "baseline")} />
          {project.baseline && (
            <div className="stored">
              <p>Stored: <strong>{String(project.baseline.label)}</strong>, {Object.entries(project.baseline.solution ?? {}).map(([name, value]) => `${name} = ${show(value)}`).join(", ")}.</p>
              <button type="button" className="btn btn-quiet btn-compact" onClick={() => { const { baseline, ...rest } = project; set(rest, "The baseline was removed."); }}><Icon name="trash" />Remove the baseline</button>
            </div>
          )}
          <Field label="Name of the baseline">
            {(tie) => <input {...tie} type="text" className="input" value={baselineLabel} onChange={(event) => setBaselineLabel(event.target.value)} />}
          </Field>
          <p>
            <button
              type="button" className="btn btn-secondary"
              onClick={async () => {
                const solution = await test();
                if (solution) set({ ...project, baseline: { label: baselineLabel, solution } });
              }}
            >
              Store this candidate as the baseline
            </button>
          </p>
        </fieldset>

        <fieldset className="item">
          <legend className="visually-hidden">Known answer (reference)</legend>
          <p className="item-title" aria-hidden="true">Known answer (reference)</p>
          <p>A reference is an answer that is already known, such as the best value a problem can reach.</p>
          <Problems issues={issues.filter((i) => i.where === "reference")} />
          {reference?.solution && (
            <div className="stored">
              <p>Stored solution: {Object.entries(reference.solution).map(([name, value]) => `${name} = ${show(value)}`).join(", ")}.</p>
              <button type="button" className="btn btn-quiet btn-compact" onClick={() => { const { solution, ...rest } = reference; setReference(rest, "The known solution was removed."); }}><Icon name="trash" />Remove the known solution</button>
            </div>
          )}
          <div className="row">
            <Field label={`Known objective value${unit ? ` (${unit})` : ""}`}>
              {(tie) => <Num {...tie} value={reference?.objective} onChange={(objective) => setReference({ ...reference, objective: objective as number | undefined })} />}
            </Field>
            <Field label="Name of the reference" hint={reference ? undefined : "Give a known value or store a known solution first."}>
              {(tie) => <input {...tie} type="text" className="input" value={reference?.label ?? ""} onChange={(event) => reference && setReference({ ...reference, label: event.target.value || undefined })} disabled={!reference} />}
            </Field>
          </div>
          <p>
            <button
              type="button" className="btn btn-secondary"
              onClick={async () => {
                const solution = await test();
                if (solution) setReference({ ...reference, solution });
              }}
            >
              Store this candidate as the known solution
            </button>
          </p>
        </fieldset>
      </div>
    </section>
  );
}

/** Each constraint with both sides in its own unit, and whether it holds. */
export function ConstraintTable({ constraints }: { constraints: Inspection["constraints"] }) {
  if (constraints.length === 0) return null;
  const words = { "<=": "at most", ">=": "at least", "==": "equal to" };
  return (
    <div className="table-box" tabIndex={0} role="group" aria-label="Constraints, each with its value and its limit">
    <table className="table constraints">
      <thead>
        <tr>
          <th scope="col">Constraint</th>
          <th scope="col">Value</th>
          <th scope="col">Limit</th>
          <th scope="col">Holds</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((c, i) => (
          <tr key={i}>
            <th scope="row">{c.name}</th>
            <td>{withUnit(c.left, c.unit)}</td>
            <td>{words[c.op]} {withUnit(c.right, c.unit)}{c.op === "==" && c.tolerance > 0 ? `, within ${withUnit(c.tolerance, c.unit)}` : ""}</td>
            <td className={c.satisfied ? "holds" : "broken"}><Icon name={c.satisfied ? "check" : "x"} />{c.satisfied ? "Yes" : "No, broken"}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
