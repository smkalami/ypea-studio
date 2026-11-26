// The Test part: a candidate typed by hand, taken from the baseline or drawn at random, and
// what the problem says about it. Also the two comparison values of a project: the baseline
// (the solution in use today) and the reference (a known answer).

import { useState } from "react";
import type { PlainSolution, Project } from "../../engine/project.ts";
import type { Inspection } from "../../engine/run.ts";
import type { VariableSpec } from "../../engine/variables.ts";
import { show, withUnit } from "./draft.ts";
import { Drawing } from "./Drawing.tsx";
import { Field, Num, Problems } from "./fields.tsx";
import type { HelpReply, HelpRequest, Issue } from "./protocol.ts";

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
  set: (project: Project) => void;
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
  const setReference = (next: NonNullable<Project["reference"]>) => {
    const { reference: old, ...rest } = project;
    set(next.objective === undefined && next.solution === undefined ? rest : { ...rest, reference: next });
  };

  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Candidate</h3>
      <p>
        Test one solution before any run. Its objective value and each constraint show whether the problem says what you mean.
        Positions start at 0.
      </p>
      {blocked.length > 0 && <p className="notice">The problem has something to fix before a candidate can be tested: {blocked[0].message}</p>}
      {project.variables.length === 0 && <p className="empty">The project has no variables yet.</p>}

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
              <legend><code>{label}</code>: check the positions that are 1{v.type === "binary_selection" ? ` (exactly ${v.k})` : ""}</legend>
              {Array.from({ length: size }, (_, i) => (
                <label key={i}><input type="checkbox" checked={values[i] === 1} onChange={() => toggle(i)} /> {i}</label>
              ))}
            </fieldset>
          );
        }
        return (
          <Field key={v.name} label={label} hint={valuesHint(v)} className={layout === "number" ? "narrow" : "wide"}>
            {(tie) => layout === "rows" || layout === "groups"
              ? <textarea {...tie} className="code" rows={Math.min(8, Math.max(2, Number(v.k ?? v.shape?.[0]) || 2))} spellCheck={false} value={text} onChange={(event) => type(v.name, event.target.value)} />
              : <input {...tie} type="text" className="code" autoComplete="off" spellCheck={false} value={text} onChange={(event) => type(v.name, event.target.value)} />}
          </Field>
        );
      })}

      <p className="row">
        <button type="button" className="primary" onClick={() => void test()}>Test this candidate</button>
        {project.baseline && <button type="button" onClick={() => fill(project.baseline!.solution)}>Fill from the baseline</button>}
        <button type="button" onClick={() => void random()}>Fill with a random candidate</button>
        {busy && <span className="hint">Testing.</span>}
      </p>

      {outcome && "failure" in outcome && <p className="notice" role="alert"><strong>Problem:</strong> {outcome.failure}</p>}
      {outcome && "inspection" in outcome && (
        <div className="tested">
          <h4>What the problem says about this candidate</h4>
          <dl>
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

      <h4>In use today (baseline)</h4>
      <p>The baseline is the solution in use today. Every result is compared with it.</p>
      <Problems issues={issues.filter((i) => i.where === "baseline")} />
      {project.baseline && (
        <p>
          Stored: <strong>{String(project.baseline.label)}</strong>, {Object.entries(project.baseline.solution ?? {}).map(([name, value]) => `${name} = ${show(value)}`).join(", ")}.{" "}
          <button type="button" className="quiet" onClick={() => { const { baseline, ...rest } = project; set(rest); }}>Remove the baseline</button>
        </p>
      )}
      <div className="row">
        <Field label="Name of the baseline">
          {(tie) => <input {...tie} type="text" value={baselineLabel} onChange={(event) => setBaselineLabel(event.target.value)} />}
        </Field>
        <button
          type="button" className="end"
          onClick={async () => {
            const solution = await test();
            if (solution) set({ ...project, baseline: { label: baselineLabel, solution } });
          }}
        >
          Store this candidate as the baseline
        </button>
      </div>

      <h4>Known answer (reference)</h4>
      <p>A reference is an answer that is already known, such as the best value a problem can reach. Every result is compared with it too.</p>
      <Problems issues={issues.filter((i) => i.where === "reference")} />
      {reference?.solution && (
        <p>
          Stored solution: {Object.entries(reference.solution).map(([name, value]) => `${name} = ${show(value)}`).join(", ")}.{" "}
          <button type="button" className="quiet" onClick={() => { const { solution, ...rest } = reference; setReference(rest); }}>Remove the known solution</button>
        </p>
      )}
      <div className="row">
        <Field label="Name of the reference">
          {(tie) => <input {...tie} type="text" value={reference?.label ?? ""} onChange={(event) => reference && setReference({ ...reference, label: event.target.value || undefined })} disabled={!reference} />}
        </Field>
        <Field label={`Known objective value${unit ? ` (${unit})` : ""}`} className="narrow">
          {(tie) => <Num {...tie} value={reference?.objective} onChange={(objective) => setReference({ ...reference, objective: objective as number | undefined })} />}
        </Field>
        <button
          type="button" className="end"
          onClick={async () => {
            const solution = await test();
            if (solution) setReference({ ...reference, solution });
          }}
        >
          Store this candidate as the known solution
        </button>
      </div>
    </section>
  );
}

/** Each constraint with both sides in its own unit, and whether it holds. */
export function ConstraintTable({ constraints }: { constraints: Inspection["constraints"] }) {
  if (constraints.length === 0) return null;
  const words = { "<=": "at most", ">=": "at least", "==": "equal to" };
  return (
    <table className="constraints">
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
            <td className={c.satisfied ? "holds" : "broken"}>{c.satisfied ? "Yes" : "No, broken"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
