// The panels that define the problem: overview, data, variables, objective, constraints,
// functions and the drawing. Each one edits its part of the project and shows the problems
// of that part next to the field they belong to.

import { useState, type ReactNode } from "react";
import type { Constraint, DataTable, Project, View } from "../../engine/project.ts";
import type { VariableSpec } from "../../engine/variables.ts";
import type { Texts } from "./Candidate.tsx";
import { tableFromCsv } from "./csv.ts";
import { EXPERIMENT, FIRST, partOf, show } from "./draft.ts";
import { columnsOf, CONSTRAINT_PRESETS, helpersNote, OBJECTIVE_PRESETS, optionsFor, type Preset, presetConstraint, withHelpers } from "./presets.ts";
import { defNames, isName, type NameKind, renamedTexts, renameUses, usesOf } from "./names.ts";
import type { Issue } from "./protocol.ts";
import { Alert, Disclosure, Select } from "./ui/controls.tsx";
import { ConfirmDialog } from "./ui/Dialog.tsx";
import { Field, FileButton, issuesAt, Num, parseNumber, Pick, Problems } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";

export interface PanelProps {
  project: Project;
  /** Stores a changed project. `note` says what was removed or replaced, and is then shown with Undo. */
  set: (project: Project, note?: string) => void;
  /** The candidate that is being typed, by the name of each variable. It counts as a use of a variable. */
  texts: Texts;
  setTexts: (texts: Texts) => void;
  /** Every problem of the project. */
  issues: Issue[];
  /** Shows another entry of the sidebar. */
  go: (key: string) => void;
}

const replaceAt = <T,>(items: T[], index: number, item: T) => items.map((old, i) => (i === index ? item : old));
const removeAt = <T,>(items: T[], index: number) => items.filter((_, i) => i !== index);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** An optional text of the project: an empty field removes it. */
const optional = (text: string) => (text === "" ? undefined : text);

function Text(props: { label: string; value: string | undefined; onChange: (value: string) => void; issues?: Issue[]; hint?: ReactNode; code?: boolean; className?: string; onFocus?: () => void }) {
  return (
    <Field label={props.label} issues={props.issues} hint={props.hint} className={props.className}>
      {(tie) => (
        <input {...tie} type="text" autoComplete="off" spellCheck={!props.code} className={props.code ? "input code" : "input"} value={props.value ?? ""} onChange={(event) => props.onChange(event.target.value)} onFocus={props.onFocus} />
      )}
    </Field>
  );
}

/** After a removal the button that had the focus is gone. The Remove button that took its place gets the focus, so the place in the list is kept. */
const refocus = (index: number) => setTimeout(() => {
  const buttons = document.querySelectorAll<HTMLElement>(".panel .item-head .btn");
  (buttons[Math.min(index, buttons.length - 1)] ?? document.getElementById("panel-heading"))?.focus();
});

/**
 * Removing something that has a name. When nothing uses the name it goes at once. When
 * something does, a dialog names each place first, and nothing in those places is changed:
 * after the removal they show their problem, which is the honest state.
 */
function useRemoval(project: Project, texts: Texts) {
  const [asking, setAsking] = useState<{ what: string; found: { name: string; place: string }[]; apply: () => void }>();
  const remove = (what: string, names: [string, NameKind][], apply: () => void) => {
    const found = names.flatMap(([name, kind]) => usesOf(project, name, kind, texts).map((use) => ({ name, place: use.place })));
    if (found.length === 0) apply();
    else setAsking({ what, found, apply });
  };
  const dialog = asking && (
    <ConfirmDialog
      heading={`Remove ${asking.what}?`} action="Remove anyway"
      body="Other parts of the project use it. Nothing in them is changed, so each will show a problem until you change it. Undo brings it back."
      onDone={(confirmed) => {
        setAsking(undefined);
        if (confirmed) asking.apply();
      }}
    >
      <ul className="uses">
        {asking.found.map((use, n) => <li key={n}>{use.place} uses <code>{use.name}</code>.</li>)}
      </ul>
    </ConfirmDialog>
  );
  return [remove, dialog] as const;
}

/**
 * A new name for something that expressions use. The old name is the one the field had when
 * it took the focus, not the one before the last key. While other parts still use the old
 * name, a line under the field offers to carry the new name there.
 */
function useRenames({ project, set, texts, setTexts }: PanelProps, claimed: string[]) {
  const [was, setWas] = useState<Record<string, string>>({});
  const pending = (key: string, now: string, kind: NameKind) =>
    was[key] !== undefined && was[key] !== now && !claimed.includes(was[key]) ? usesOf(project, was[key], kind, texts).length : 0;
  return {
    was,
    /** Every field starts again from the name it has now. */
    reset: (fields: [key: string, now: string][]) => setWas(Object.fromEntries(fields)),
    /** Fields take the focus: the name of each is its old name from here on, unless its offer is still open. */
    focus(fields: [key: string, now: string][], kind: NameKind) {
      const next = { ...was };
      for (const [key, now] of fields) if (pending(key, now, kind) === 0) next[key] = now;
      setWas(next);
    },
    /** Names moved to other places, after a removal: nothing is on offer any more. */
    forget: () => setWas({}),
    /** The line under the field, when there is something to offer. */
    offer(key: string, now: string, kind: NameKind): ReactNode {
      const places = pending(key, now, kind), old = was[key];
      // a name that cannot be used, or that something else has, is not carried anywhere
      if (places === 0 || !isName(now) || claimed.filter((name) => name === now).length !== 1) return undefined;
      return (
        <>
          {places === 1 ? "1 place still uses" : `${places} places still use`} the old name <code>{old}</code>.{" "}
          <button
            type="button" className="btn btn-quiet btn-compact"
            onClick={(event) => {
              const field = event.currentTarget.closest(".field")?.querySelector<HTMLElement>("input, textarea");
              // stored while the button has the focus, so that the carried name is a step of its own and not part of the typing
              set(renameUses(project, old, now, kind));
              if (kind === "variable") setTexts(renamedTexts(texts, old, now));
              setWas({ ...was, [key]: now });
              // the button goes away with the offer, so the field gets the focus
              field?.focus();
            }}
          >
            Rename there too
          </button>
        </>
      );
    },
  };
}

/** One table, variable or constraint: a bordered group with its name and its Remove button on the first line. */
function Item({ heading, removeLabel, onRemove, children }: { heading: string; removeLabel: string; onRemove: () => void; children: ReactNode }) {
  return (
    <fieldset className="item">
      <legend className="visually-hidden">{heading}</legend>
      <div className="item-head">
        <span className="item-title" aria-hidden="true">{heading}</span>
        <button type="button" className="btn btn-quiet btn-compact" aria-label={removeLabel} onClick={onRemove}><Icon name="trash" />Remove</button>
      </div>
      {children}
    </fieldset>
  );
}

const STEPS = [
  ["data", "Data", "Import the numbers the problem uses, from CSV files."],
  ["variables", "Variables", "Say what the solver may change, and within which limits."],
  ["objective", "Objective", "Write the value to make as small or as large as possible. Presets write the common ones."],
  ["constraints", "Constraints", "Add the limits that a solution must keep."],
  ["candidate", "Test a candidate", "Test a solution by hand before any run, to see that the problem says what you mean."],
  [EXPERIMENT + FIRST, "Experiments", "Run a solver with a budget and read its result."],
];

export function OverviewPanel({ project, set, issues, go }: PanelProps) {
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Overview</h3>
      <Problems issues={issues.filter((i) => i.where === "overview")} />
      <Text label="Project name" value={project.name} onChange={(name) => set({ ...project, name })} className="wide" />
      <Field label="Description" className="wide">
        {(tie) => <textarea {...tie} className="textarea" rows={3} value={project.description ?? ""} onChange={(event) => set({ ...project, description: optional(event.target.value) })} />}
      </Field>
      <h4>How a project is built</h4>
      <ol className="cards steps">
        {STEPS.map(([key, label, text]) => {
          // the first problem of a part is said here, so that a project that cannot run shows where to go
          const problem = issues.find((i) => partOf(i.where).startsWith(key.startsWith(EXPERIMENT) ? EXPERIMENT : key));
          return (
            <li key={key} className="card">
              <button type="button" className="card-link" aria-describedby={`step-${key}`} onClick={() => go(key)}>
                <span className="card-title">{label}</span>
                <Icon name="chevron-right" />
              </button>
              <span className="card-text" id={`step-${key}`}>{text}</span>
              {problem && <span className="card-problem"><Icon name="circle-exclamation-point" /><span><strong>To fix:</strong> {problem.message}</span></span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Data

const PREVIEW_ROWS = 5, PREVIEW_COLUMNS = 8;

export function DataPanel(props: PanelProps) {
  const { project, set, issues, texts } = props;
  const [failure, setFailure] = useState("");
  const tables = project.data ?? [];
  const [remove, removal] = useRemoval(project, texts);
  const renames = useRenames(props, tables.flatMap((t) => [t.name, ...(t.kind === "columns" ? t.columns.map((c) => c.name) : [])]));
  const add = async (file: File, header: boolean) => {
    setFailure("");
    try {
      set({ ...project, data: [...tables, tableFromCsv(await file.text(), file.name, header)] });
    } catch (error) {
      setFailure(`${file.name} was not imported. ${messageOf(error)}`);
    }
  };
  const change = (index: number, table: DataTable, note?: string) => set({ ...project, data: replaceAt(tables, index, table) }, note);

  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Data</h3>
      <p className="lead">
        Data are tables of numbers from CSV files. An expression uses a column by its name, and a matrix by the name of its table.
        Units are labels only. Nothing is converted.
      </p>
      <Problems issues={issues.filter((i) => i.where === "data")} />
      {removal}
      {tables.length === 0 && <p className="empty">No data yet. Import a CSV file below. A problem that needs no data, such as a formula of its variables, works without.</p>}

      {tables.map((table, t) => {
        const own = issues.filter((i) => i.where === `data.${t}`);
        return (
          <Item
            key={t} heading={`Table ${t}`} removeLabel={`Remove table ${table.name}`}
            onRemove={() => remove(`the table ${table.name}`, [table.name, ...(table.kind === "columns" ? table.columns.map((c) => c.name) : [])].map((name) => [name, "data"]), () => {
              set({ ...project, data: removeAt(tables, t) }, `The table ${table.name} was removed.`);
              renames.forget();
              refocus(t);
            })}
          >
            <div className="row">
              <Text
                label="Table name" code value={table.name} issues={own} hint={renames.offer(`data.${t}`, table.name, "data")}
                onFocus={() => renames.focus([[`data.${t}`, table.name]], "data")} onChange={(name) => change(t, { ...table, name })}
              />
              {table.kind === "matrix" && <Text label="Unit" value={table.unit} className="narrow" onChange={(unit) => change(t, { ...table, unit: optional(unit) })} />}
            </div>
            {table.kind === "matrix" ? <MatrixPreview table={table} /> : (
              <>
                {table.columns.map((column, c) => (
                  <div className="row" key={c}>
                    <Text
                      label={`Name of column ${c}`} code value={column.name} issues={issuesAt(issues, `data.${t}.column.${c}`)}
                      hint={renames.offer(`data.${t}.column.${c}`, column.name, "data")} onFocus={() => renames.focus([[`data.${t}.column.${c}`, column.name]], "data")}
                      onChange={(name) => change(t, { ...table, columns: replaceAt(table.columns, c, { ...column, name }) })}
                    />
                    <Text
                      label={`Unit of column ${c}`} value={column.unit} className="narrow"
                      onChange={(unit) => change(t, { ...table, columns: replaceAt(table.columns, c, { ...column, unit: optional(unit) }) })}
                    />
                    {/* shown also when it cannot be used, with the reason: a table needs at least one column */}
                    <button
                      type="button" className="btn btn-quiet btn-compact beside-field" aria-label={`Remove column ${column.name}`}
                      aria-disabled={table.columns.length === 1 ? true : undefined}
                      data-tip={table.columns.length === 1 ? "A table needs at least one column. Remove the table instead." : undefined}
                      onClick={() => table.columns.length > 1 && remove(`the column ${column.name}`, [[column.name, "data"]], () => {
                        change(t, { ...table, columns: removeAt(table.columns, c) }, `The column ${column.name} was removed.`);
                        renames.forget();
                        refocus(t);
                      })}
                    >
                      <Icon name="trash" />Remove column
                    </button>
                  </div>
                ))}
                <ColumnsPreview table={table} />
              </>
            )}
          </Item>
        );
      })}

      <div className="row">
        <FileButton id="csv-table" accept=".csv,text/csv,text/plain" label="Import a table" hint="A CSV file of numbers. Its first row holds the names of the columns." onFile={(file) => add(file, true)} />
        <FileButton id="csv-matrix" accept=".csv,text/csv,text/plain" label="Import a matrix" hint="A CSV file of numbers only, without a header row." onFile={(file) => add(file, false)} />
      </div>
      {failure && <Alert kind="danger" role="alert">{failure}</Alert>}
    </section>
  );
}

function ColumnsPreview({ table }: { table: Extract<DataTable, { kind: "columns" }> }) {
  const rows = Math.max(0, ...table.columns.map((c) => c.values.length));
  return (
    <div className="table-box" tabIndex={0} role="group" aria-label={`The first rows of ${table.name}`}>
      <table className="table preview">
        <caption>
          {rows} rows. {rows > PREVIEW_ROWS ? `The first ${PREVIEW_ROWS} are shown.` : ""} Positions start at 0.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="num">Position</th>
            {table.columns.map((c, i) => <th scope="col" className="num" key={i}><code>{c.name}</code>{c.unit ? ` (${c.unit})` : ""}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.min(rows, PREVIEW_ROWS) }, (_, r) => (
            <tr key={r}>
              <th scope="row" className="num">{r}</th>
              {table.columns.map((c, i) => <td className="num" key={i}>{show(c.values[r])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixPreview({ table }: { table: Extract<DataTable, { kind: "matrix" }> }) {
  const rows = table.values.length, columns = table.values[0]?.length ?? 0;
  const shown = Array.from({ length: Math.min(columns, PREVIEW_COLUMNS) }, (_, c) => c);
  return (
    <div className="table-box" tabIndex={0} role="group" aria-label={`The first corner of ${table.name}`}>
      <table className="table preview">
        <caption>
          A matrix of {rows} rows and {columns} columns{table.unit ? `, in ${table.unit}` : ""}.
          {rows > PREVIEW_ROWS || columns > PREVIEW_COLUMNS ? " Its first corner is shown." : ""} Positions start at 0.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="num">Row</th>
            {shown.map((c) => <th scope="col" className="num" key={c}>Column {c}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.values.slice(0, PREVIEW_ROWS).map((row, r) => (
            <tr key={r}>
              <th scope="row" className="num">{r}</th>
              {shown.map((c) => <td className="num" key={c}>{show(row[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Variables

type VariableType = VariableSpec["type"];
/** The 11 types of variable, each by what it holds. */
export const TYPE_LABELS: Record<VariableType, string> = {
  real: "Decimal numbers within limits",
  integer: "Whole numbers within limits",
  binary: "Yes or no values (0 or 1)",
  permutation: "An ordering of n items",
  selection: "k items picked out of n, in order",
  binary_selection: "Exactly k of n switched on (0 or 1)",
  partition: "Ordered groups (n items in k groups)",
  binary_partition: "Groups without order (n items in k groups), as a table of 0 and 1",
  fixed_sum: "Shares of a fixed total",
  fixed_row_sum: "A table in which every row adds up to a fixed total",
  fixed_column_sum: "A table in which every column adds up to a fixed total",
};
/** One sentence more for the two types of groups, which are easy to take for each other. */
const TYPE_HELP: Partial<Record<VariableType, string>> = {
  partition:
    "For the routes of several vehicles or the jobs on several machines. An ordering of all items is cut into groups by separators, and the order inside a group counts.",
  binary_partition: "Only the group of each item counts, not the order inside a group. Row j of the table marks the items of group j with 1.",
};
/** How many dimensions the value of each type may have: 0 is one number, 1 a list, 2 a table. */
const DIMS: Partial<Record<VariableType, number[]>> = {
  real: [0, 1, 2], integer: [0, 1, 2], binary: [0, 1, 2], fixed_sum: [1, 2], fixed_row_sum: [2], fixed_column_sum: [2],
};
const DIM_LABELS = ["One number", "A list", "A table"];
const DEFAULT_SHAPES = [[], [3], [2, 3]];

/** The variable as another type. It keeps the name and every field that the new type also has. */
function asType(old: Record<string, any>, type: VariableType): VariableSpec {
  const dims = DIMS[type];
  if (!dims) {
    const n = old.n ?? 5;
    return type === "permutation" ? { name: old.name, type, n } : { name: old.name, type: type as "selection", n, k: old.k ?? 2 };
  }
  const shape = Array.isArray(old.shape) && dims.includes(old.shape.length) ? old.shape : DEFAULT_SHAPES[dims[0]];
  const unit = old.unit ? { unit: old.unit } : {};
  if (type === "real" || type === "integer") return { name: old.name, type, shape, lb: old.lb ?? 0, ub: old.ub ?? (type === "real" ? 1 : 10), ...unit };
  if (type === "binary") return { name: old.name, type, shape, ...unit };
  return { name: old.name, type: type as "fixed_sum", shape, target: old.target ?? 1, ...unit };
}

export function VariablesPanel(props: PanelProps) {
  const { project, set, issues, texts } = props;
  const variables = project.variables as (VariableSpec & Record<string, any>)[];
  const [remove, removal] = useRemoval(project, texts);
  const renames = useRenames(props, variables.map((v) => v.name));
  const change = (index: number, variable: object) => set({ ...project, variables: replaceAt(variables, index, variable as VariableSpec) });
  const add = () => {
    const names = new Set(variables.map((v) => v.name));
    let name = "x";
    for (let n = 2; names.has(name); n++) name = `x${n}`;
    set({ ...project, variables: [...variables, { name, type: "real", shape: [], lb: 0, ub: 1 }] });
  };

  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Variables</h3>
      <p className="lead">Variables are what the solver may change. An expression uses a variable by its name. Positions in a list start at 0.</p>
      <Problems issues={issues.filter((i) => i.where === "variables")} />
      {removal}
      {variables.length === 0 && <p className="empty">No variables yet. Add the first one below. A project needs at least one to run.</p>}
      {variables.map((v, i) => {
        const at = (key: string) => issues.filter((issue) => issue.where === `variable.${i}.${key}`);
        const dims = DIMS[v.type];
        const shape: unknown[] = Array.isArray(v.shape) ? v.shape : [];
        const list = "One number for all, or one per value, separated by commas.";
        return (
          <Item
            key={i} heading={`Variable ${i}`} removeLabel={`Remove variable ${v.name}`}
            onRemove={() => remove(`the variable ${v.name}`, [[v.name, "variable"]], () => {
              set({ ...project, variables: removeAt(variables, i) }, `The variable ${v.name} was removed.`);
              renames.forget();
              refocus(i);
            })}
          >
            <Problems issues={issues.filter((issue) => issue.where === `variable.${i}`)} />
            <div className="row">
              <Text
                label="Name" code value={v.name} issues={at("name")} hint={renames.offer(`variable.${i}`, v.name, "variable")}
                onFocus={() => renames.focus([[`variable.${i}`, v.name]], "variable")} onChange={(name) => change(i, { ...v, name })}
              />
              <Field label="What it holds" issues={at("type")} hint={TYPE_HELP[v.type]} className="grow">
                {(tie) => (
                  <Select
                    {...tie} value={v.type} onChange={(type) => change(i, asType(v, type as VariableType))}
                    options={[
                      ...(v.type in TYPE_LABELS ? [] : [{ value: v.type, label: `${String(v.type)} (not known)` }]),
                      ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                )}
              </Field>
            </div>
            <div className="row">
              {dims && (
                <>
                  <Field label="Shape" issues={at("shape")} className="narrow">
                    {(tie) => (
                      <Select
                        {...tie} value={String(shape.length)} options={dims.map((d) => ({ value: String(d), label: DIM_LABELS[d] }))}
                        onChange={(d) => change(i, { ...v, shape: DEFAULT_SHAPES[Number(d)] })}
                      />
                    )}
                  </Field>
                  {shape.map((size, d) => (
                    <Field key={d} label={shape.length === 1 ? "Number of values" : d === 0 ? "Rows" : "Columns"} className="narrow">
                      {(tie) => <Num {...tie} value={size} onChange={(value) => change(i, { ...v, shape: replaceAt(shape, d, value) })} />}
                    </Field>
                  ))}
                </>
              )}
              {(v.type === "real" || v.type === "integer") && (
                <>
                  <Field label="Lowest value" issues={at("lb")} hint={shape.length ? list : undefined} className="narrow">
                    {(tie) => <Num {...tie} list value={v.lb} onChange={(lb) => change(i, { ...v, lb })} />}
                  </Field>
                  <Field label="Highest value" issues={at("ub")} className="narrow">
                    {(tie) => <Num {...tie} list value={v.ub} onChange={(ub) => change(i, { ...v, ub })} />}
                  </Field>
                </>
              )}
              {String(v.type).startsWith("fixed") && (
                <Field label="Total" issues={at("target")} hint={v.type === "fixed_sum" ? undefined : "One number for all, or one per row or column, separated by commas."} className="narrow">
                  {(tie) => <Num {...tie} list value={v.target} onChange={(target) => change(i, { ...v, target })} />}
                </Field>
              )}
              {!dims && (
                <Field label="Number of items (n)" issues={at("n")} className="narrow">
                  {(tie) => <Num {...tie} value={v.n} onChange={(n) => change(i, { ...v, n })} />}
                </Field>
              )}
              {!dims && v.type !== "permutation" && (
                <Field label={String(v.type).includes("partition") ? "Number of groups (k)" : "Number picked (k)"} issues={at("k")} className="narrow">
                  {(tie) => <Num {...tie} value={v.k} onChange={(k) => change(i, { ...v, k })} />}
                </Field>
              )}
              {dims && <Text label="Unit" value={v.unit} issues={at("unit")} className="narrow" onChange={(unit) => change(i, { ...v, unit: optional(unit) })} />}
            </div>
          </Item>
        );
      })}
      <p><button type="button" className="btn btn-secondary" onClick={add}><Icon name="plus" />Add a variable</button></p>
    </section>
  );
}

// Presets

/** A small form that asks for the names a preset needs, and hands them over. */
function PresetForm({ heading, presets, project, action, onUse }: { heading: string; presets: Preset[]; project: Project; action: string; onUse: (preset: Preset, names: Record<string, string>, functions: string | undefined) => void }) {
  const [id, setId] = useState(presets[0].id);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");
  const preset = presets.find((p) => p.id === id) ?? presets[0];
  const typed = (need: Preset["needs"][number]) => need.from === "number" || need.from === "text";
  // every need starts on a name of its own: the second column for the second need that asks for a column
  const names = Object.fromEntries(preset.needs.map((need, n) => {
    const options = optionsFor(project, need.from), nth = preset.needs.slice(0, n).filter((other) => other.from === need.from).length;
    const kept = chosen[`${id}.${need.key}`];
    return [need.key, kept !== undefined && (typed(need) || options.includes(kept)) ? kept : options[nth] ?? options[0] ?? need.initial ?? ""];
  }));
  const use = () => {
    const missing = preset.needs.find((need) => !need.optional && names[need.key].trim() === "");
    const problem = missing
      ? `This preset needs: ${missing.label.toLowerCase()}. ${typed(missing) ? "Type a value." : "The project has none yet."}`
      : preset.refuse?.(names, project) ?? "";
    setFailure(problem);
    setDone("");
    if (problem) return;
    // helper functions are only added: a function of the same name that is already there stays as it is
    const helped = withHelpers(project.functions, preset.helpers?.(names) ?? []);
    onUse(preset, names, helped.functions);
    setDone(helpersNote(helped.added, helped.kept));
  };
  return (
    <Disclosure summary={heading}>
      {presets.length > 1 && (
        <Field label="Preset">
          {(tie) => <Select {...tie} value={id} options={presets.map((p) => ({ value: p.id, label: p.label }))} onChange={(next) => (setId(next), setFailure(""), setDone(""))} />}
        </Field>
      )}
      <p className="hint">{preset.help}</p>
      <div className="row">
        {preset.needs.map((need) => {
          const pick = (value: string) => setChosen({ ...chosen, [`${id}.${need.key}`]: value });
          return need.from === "number"
            ? <Field key={need.key} label={need.label} hint={need.hint} className="narrow">{(tie) => <Num {...tie} value={parseNumber(names[need.key])} onChange={(value) => pick(value === undefined ? "" : String(value))} />}</Field>
            : need.from === "text"
              ? <Text key={need.key} label={need.label} hint={need.hint} value={names[need.key]} className="narrow" onChange={pick} />
              : <Pick key={need.key} label={need.label} value={names[need.key]} options={optionsFor(project, need.from)} onChange={pick} />;
        })}
      </div>
      {failure && <Alert kind="danger" role="alert">{failure}</Alert>}
      {/* what the preset did to the functions, which are another part of the project and not on this screen */}
      {done && <Alert kind="info">{done}</Alert>}
      <p><button type="button" className="btn btn-secondary" onClick={use}>{action}</button></p>
    </Disclosure>
  );
}

// Objective, constraints, functions

export function ObjectivePanel({ project, set, issues }: PanelProps) {
  const objective = project.objective;
  const own = issues.filter((i) => i.where === "objective");
  const change = (next: object) => set({ ...project, objective: { ...objective, ...next } });
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Objective</h3>
      <div className="row">
        <Field label="Goal" className="narrow">
          {(tie) => <Select {...tie} value={objective.sense} options={[{ value: "min", label: "Minimize" }, { value: "max", label: "Maximize" }]} onChange={(sense) => change({ sense })} />}
        </Field>
        <Text label="Unit" value={objective.unit} className="narrow" onChange={(unit) => change({ unit: optional(unit) })} />
      </div>
      <Field label="Expression" issues={own} className="wide" hint="One expression that gives one number. It can use the variables, the data, the functions, and sum, min, max, abs, len and ops.">
        {(tie) => <textarea {...tie} className="textarea code" rows={3} spellCheck={false} value={objective.source} onChange={(event) => change({ source: event.target.value })} />}
      </Field>
      {/* The line is kept when it is empty, so that the check does not move the page. */}
      <p className="ok">{issues.length === 0 && <><Icon name="circle-check" />Checked: this gives one number.</>}</p>
      <PresetForm
        heading="Write the expression from a preset" presets={OBJECTIVE_PRESETS} project={project} action="Write the expression"
        // one change for the expression and the functions: two would each start from the same project, and the first would be lost
        onUse={(preset, names, functions) => set(
          { ...project, functions, objective: { ...objective, source: preset.write(names) } },
          objective.source.trim() === "" ? undefined : "The expression of the objective was replaced by the preset.",
        )}
      />
    </section>
  );
}

const COMPARISONS = [{ value: "<=", label: "at most (<=)" }, { value: ">=", label: "at least (>=)" }, { value: "==", label: "equal to (==)" }];

export function ConstraintsPanel({ project, set, issues }: PanelProps) {
  const constraints = project.constraints ?? [];
  const change = (index: number, constraint: Constraint) => set({ ...project, constraints: replaceAt(constraints, index, constraint) });
  const add = (constraint: Constraint) => set({ ...project, constraints: [...constraints, constraint] });
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Constraints</h3>
      <p className="lead">A constraint is a limit that a solution must keep: a left side, a comparison and a right side. Results show both sides in the unit you give here.</p>
      <Problems issues={issues.filter((i) => i.where === "constraints")} />
      {constraints.length === 0 && <p className="empty">No constraints. Every candidate is allowed. Add one below if a solution must keep a limit.</p>}
      {constraints.map((c, i) => {
        const at = (side: string) => issues.filter((issue) => issue.where === `constraint.${i}.${side}`);
        return (
          <Item
            key={i} heading={`Constraint ${i}`} removeLabel={`Remove constraint ${c.name}`}
            onRemove={() => (set({ ...project, constraints: removeAt(constraints, i) }, `The constraint "${c.name}" was removed.`), refocus(i))}
          >
            <Problems issues={issues.filter((issue) => issue.where === `constraint.${i}`)} />
            <div className="row">
              <Text label="Name" value={c.name} onChange={(name) => change(i, { ...c, name })} />
              <Text label="Unit" value={c.unit} className="narrow" onChange={(unit) => change(i, { ...c, unit: optional(unit) })} />
            </div>
            <div className="row">
              <Text label="Left side" code value={c.left} issues={at("left")} className="grow" onChange={(left) => change(i, { ...c, left })} />
              <Field label="Comparison" className="narrow">
                {(tie) => (
                  <Select
                    {...tie} value={c.op} options={COMPARISONS}
                    onChange={(op) => {
                      // only "equal to" can have a tolerance
                      const { tolerance, ...rest } = c;
                      change(i, { ...rest, op: op as Constraint["op"] });
                    }}
                  />
                )}
              </Field>
              <Text label="Right side" code value={c.right} issues={at("right")} className="grow" onChange={(right) => change(i, { ...c, right })} />
              {c.op === "==" && (
                <Field label="Tolerance" className="narrow" hint="How far apart the two sides may be and still count as equal.">
                  {(tie) => <Num {...tie} value={c.tolerance} onChange={(tolerance) => change(i, { ...c, tolerance: tolerance as number | undefined })} />}
                </Field>
              )}
            </div>
          </Item>
        );
      })}
      <p><button type="button" className="btn btn-secondary" onClick={() => add({ name: `Constraint ${constraints.length}`, left: "", op: "<=", right: "" })}><Icon name="plus" />Add a constraint</button></p>
      <PresetForm
        heading="Add a constraint from a preset" presets={CONSTRAINT_PRESETS} project={project} action="Add the constraint"
        onUse={(preset, names, functions) => set({ ...project, functions, constraints: [...constraints, presetConstraint(preset, names, project)] })}
      />
    </section>
  );
}

export function FunctionsPanel(props: PanelProps) {
  const { project, set, issues } = props;
  const names = defNames(project.functions);
  const renames = useRenames(props, names);
  // A function is renamed in the text itself, so each function has its own old name, by its place in the text.
  // That holds only while the text has as many functions as when it took the focus: after one was added or
  // deleted the places no longer say which function is which, and nothing is offered.
  const fields: [string, string][] = [...names.map((name, n): [string, string] => [`function.${n}`, name]), ["function.count", String(names.length)]];
  const same = renames.was["function.count"] === String(names.length);
  const offers = same ? names.map((name, n) => renames.offer(`function.${n}`, name, "function")).filter(Boolean) : [];
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Functions</h3>
      <p className="lead">
        Helper functions for logic that one expression cannot hold. They are written in a small part of Python: <code>def</code>, assignment,{" "}
        <code>if</code>, <code>for</code> and <code>return</code>. A function gets the variables it needs as arguments, and positions start at 0.
      </p>
      <Field label="Function definitions" issues={issues.filter((i) => i.where === "functions")} className="wide" hint={offers.length ? offers.map((offer, n) => <span key={n}>{offer} </span>) : undefined}>
        {(tie) => (
          <textarea
            {...tie} className="textarea code" rows={14} spellCheck={false} value={project.functions ?? ""}
            onFocus={() => (same ? renames.focus(fields, "function") : renames.reset(fields))}
            onChange={(event) => set({ ...project, functions: optional(event.target.value) })}
          />
        )}
      </Field>
    </section>
  );
}

// The drawing

const DRAWINGS = [
  { value: "", label: "No drawing" }, { value: "route", label: "A route through points" },
  { value: "routes", label: "Several routes from one depot" },
  { value: "line", label: "A fitted line over data points" }, { value: "selection", label: "Which items are chosen" },
];

export function ViewPanel({ project, set, issues }: PanelProps) {
  const view = project.view as (View & Record<string, any>) | undefined;
  const columns = columnsOf(project).map((c) => c.name);
  const orderings = project.variables.filter((v) => v.type === "permutation").map((v) => v.name);
  const choices = optionsFor(project, "yes-no-variable");
  const groups = optionsFor(project, "groups-variable");
  // The table of distances is optional. With one, the drawing gives the length that the table gives.
  const distance = (rows: string) => (
    <Pick
      label="Table of distances" value={view?.distance} options={optionsFor(project, "matrix")} none="None, show no length"
      hint={`A square table with a row and a column for every ${rows}. The drawing then gives the length of each route from it.`}
      onChange={(table) => change({ distance: optional(table) })}
    />
  );
  const start = (kind: string): View | undefined =>
    kind === "route" ? { kind, variable: orderings[0] ?? "", x: columns[0] ?? "", y: columns[1] ?? columns[0] ?? "" }
    : kind === "routes" ? { kind, variable: groups[0] ?? "", x: columns[0] ?? "", y: columns[1] ?? columns[0] ?? "", depot: 0 }
    : kind === "line" ? { kind, x: columns[0] ?? "", y: columns[1] ?? columns[0] ?? "", expression: "" }
    : kind === "selection" ? { kind, variable: choices[0] ?? "" }
    : undefined;
  const change = (next: object) => set({ ...project, view: { ...view, ...next } as View });
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading" tabIndex={-1}>Drawing</h3>
      <p className="lead">A drawing shows a solution as a picture, while a run improves it and in its result. Without one, a solution is shown as a table.</p>
      <Field label="What to draw">
        {(tie) => <Select {...tie} value={view?.kind ?? ""} options={DRAWINGS} onChange={(kind) => set({ ...project, view: start(kind) }, kind === "" ? "The drawing was removed." : undefined)} />}
      </Field>
      <Problems issues={issues.filter((i) => i.where === "view" && !i.line)} />
      {view?.kind === "route" && (
        <div className="row">
          <Pick label="Ordering variable" value={view.variable} options={orderings} onChange={(variable) => change({ variable })} />
          <Pick label="Column with the x position" value={view.x} options={columns} onChange={(x) => change({ x })} />
          <Pick label="Column with the y position" value={view.y} options={columns} onChange={(y) => change({ y })} />
          {distance("row of the two columns")}
        </div>
      )}
      {view?.kind === "routes" && (
        <>
          <p className="hint">Every group is drawn as one route from the depot and back. The two columns hold the depot in one row and the items in the other rows, in their order.</p>
          <div className="row">
            <Pick label="Ordered groups variable" value={view.variable} options={groups} onChange={(variable) => change({ variable })} />
            <Pick label="Column with the x position" value={view.x} options={columns} onChange={(x) => change({ x })} />
            <Pick label="Column with the y position" value={view.y} options={columns} onChange={(y) => change({ y })} />
            <Field label="Row of the depot" className="narrow" hint="Rows start at 0.">
              {(tie) => <Num {...tie} value={view.depot} onChange={(depot) => change({ depot })} />}
            </Field>
            {distance("row of the two columns, the depot included")}
          </div>
        </>
      )}
      {view?.kind === "line" && (
        <>
          <div className="row">
            <Pick label="Column along the bottom (x)" value={view.x} options={columns} onChange={(x) => change({ x })} />
            <Pick label="Column up the side (y)" value={view.y} options={columns} onChange={(y) => change({ y })} />
          </div>
          <Text
            label="Expression of the line" code className="wide" value={view.expression} issues={issues.filter((i) => i.where === "view" && i.line)}
            hint="It gives one value for each row of the x column, for example offset + gain * voltage."
            onChange={(expression) => change({ expression })}
          />
        </>
      )}
      {view?.kind === "selection" && (
        <div className="row">
          <Pick label="Yes or no variable" value={view.variable} options={choices} onChange={(variable) => change({ variable })} />
          <Pick label="Column for the size of each item" value={view.size} options={columns} none="All the same size" onChange={(size) => change({ size: optional(size) })} />
        </div>
      )}
    </section>
  );
}
