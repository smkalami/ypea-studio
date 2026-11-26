// The panels that define the problem: overview, data, variables, objective, constraints,
// functions and the drawing. Each one edits its part of the project and shows the problems
// of that part next to the field they belong to.

import { useState } from "react";
import type { Constraint, DataTable, Project, View } from "../../engine/project.ts";
import type { VariableSpec } from "../../engine/variables.ts";
import { tableFromCsv } from "./csv.ts";
import { show } from "./draft.ts";
import { Field, FileButton, issuesAt, Num, parseNumber, Pick, Problems } from "./fields.tsx";
import { CAPACITY_PRESET, capacityConstraint, columnsOf, OBJECTIVE_PRESETS, optionsFor, type Preset } from "./presets.ts";
import type { Issue } from "./protocol.ts";

export interface PanelProps {
  project: Project;
  /** Stores a changed project. */
  set: (project: Project) => void;
  /** Every problem of the project. Undefined while the first check runs. */
  issues: Issue[];
}

const replaceAt = <T,>(items: T[], index: number, item: T) => items.map((old, i) => (i === index ? item : old));
const removeAt = <T,>(items: T[], index: number) => items.filter((_, i) => i !== index);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** An optional text of the project: an empty field removes it. */
const optional = (text: string) => (text === "" ? undefined : text);

function Text(props: { label: string; value: string | undefined; onChange: (value: string) => void; issues?: Issue[]; hint?: string; code?: boolean; className?: string }) {
  return (
    <Field label={props.label} issues={props.issues} hint={props.hint} className={props.className}>
      {(tie) => (
        <input {...tie} type="text" autoComplete="off" spellCheck={!props.code} className={props.code ? "code" : undefined} value={props.value ?? ""} onChange={(event) => props.onChange(event.target.value)} />
      )}
    </Field>
  );
}

export function OverviewPanel({ project, set, issues }: PanelProps) {
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Overview</h3>
      <Problems issues={issues.filter((i) => i.where === "overview")} />
      <Text label="Project name" value={project.name} onChange={(name) => set({ ...project, name })} className="wide" />
      <Field label="Description" className="wide">
        {(tie) => <textarea {...tie} rows={3} value={project.description ?? ""} onChange={(event) => set({ ...project, description: optional(event.target.value) })} />}
      </Field>
      <h4>How a project is built</h4>
      <ol className="guide">
        <li><strong>Data.</strong> Import the numbers the problem uses, from CSV files.</li>
        <li><strong>Variables.</strong> Say what the solver may change, and within which limits.</li>
        <li><strong>Objective.</strong> Write the value to make as small or as large as possible. Presets write the common ones.</li>
        <li><strong>Constraints.</strong> Add the limits that a solution must keep.</li>
        <li><strong>Candidate.</strong> Test a solution by hand before any run, to see that the problem says what you mean.</li>
        <li><strong>Experiments.</strong> Run a solver with a budget and read its result.</li>
      </ol>
    </section>
  );
}

// Data

const PREVIEW_ROWS = 5, PREVIEW_COLUMNS = 8;

export function DataPanel({ project, set, issues }: PanelProps) {
  const [failure, setFailure] = useState("");
  const tables = project.data ?? [];
  const add = async (file: File, header: boolean) => {
    setFailure("");
    try {
      set({ ...project, data: [...tables, tableFromCsv(await file.text(), file.name, header)] });
    } catch (error) {
      setFailure(`${file.name} was not imported. ${messageOf(error)}`);
    }
  };
  const change = (index: number, table: DataTable) => set({ ...project, data: replaceAt(tables, index, table) });

  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Data</h3>
      <p>
        Data are tables of numbers from CSV files. An expression uses a column by its name, and a matrix by the name of its table.
        Units are labels only. Nothing is converted.
      </p>
      <p className="row">
        <FileButton id="csv-table" accept=".csv,text/csv,text/plain" label="Import a table (CSV with a header row)" onFile={(file) => add(file, true)} />
        <FileButton id="csv-matrix" accept=".csv,text/csv,text/plain" label="Import a matrix (CSV without a header)" onFile={(file) => add(file, false)} />
      </p>
      {failure && <p className="notice" role="alert">{failure}</p>}
      <Problems issues={issues.filter((i) => i.where === "data")} />
      {tables.length === 0 && <p className="empty">No data yet. A problem that needs none, such as a formula of its variables, works without.</p>}

      {tables.map((table, t) => {
        const own = issues.filter((i) => i.where === `data.${t}`);
        return (
          <fieldset key={t} className="card">
            <legend>Table {t}</legend>
            <div className="row">
              <Text label="Table name" code value={table.name} issues={own} onChange={(name) => change(t, { ...table, name })} />
              {table.kind === "matrix" && <Text label="Unit" value={table.unit} onChange={(unit) => change(t, { ...table, unit: optional(unit) })} />}
              <button type="button" className="quiet end" onClick={() => set({ ...project, data: removeAt(tables, t) })}>Remove table {table.name}</button>
            </div>
            {table.kind === "matrix" ? <MatrixPreview table={table} /> : (
              <>
                {table.columns.map((column, c) => (
                  <div className="row" key={c}>
                    <Text
                      label={`Name of column ${c}`} code value={column.name} issues={issuesAt(issues, `data.${t}.column.${c}`)}
                      onChange={(name) => change(t, { ...table, columns: replaceAt(table.columns, c, { ...column, name }) })}
                    />
                    <Text
                      label={`Unit of column ${c}`} value={column.unit}
                      onChange={(unit) => change(t, { ...table, columns: replaceAt(table.columns, c, { ...column, unit: optional(unit) }) })}
                    />
                  </div>
                ))}
                <ColumnsPreview table={table} />
              </>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}

function ColumnsPreview({ table }: { table: Extract<DataTable, { kind: "columns" }> }) {
  const rows = Math.max(0, ...table.columns.map((c) => c.values.length));
  return (
    <table className="preview">
      <caption>
        {rows} rows. {rows > PREVIEW_ROWS ? `The first ${PREVIEW_ROWS} are shown.` : ""} Positions start at 0.
      </caption>
      <thead>
        <tr>
          <th scope="col">Position</th>
          {table.columns.map((c, i) => <th scope="col" key={i}><code>{c.name}</code>{c.unit ? ` (${c.unit})` : ""}</th>)}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: Math.min(rows, PREVIEW_ROWS) }, (_, r) => (
          <tr key={r}>
            <th scope="row">{r}</th>
            {table.columns.map((c, i) => <td key={i}>{show(c.values[r])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MatrixPreview({ table }: { table: Extract<DataTable, { kind: "matrix" }> }) {
  const rows = table.values.length, columns = table.values[0]?.length ?? 0;
  const shown = Array.from({ length: Math.min(columns, PREVIEW_COLUMNS) }, (_, c) => c);
  return (
    <table className="preview">
      <caption>
        A matrix of {rows} rows and {columns} columns{table.unit ? `, in ${table.unit}` : ""}.
        {rows > PREVIEW_ROWS || columns > PREVIEW_COLUMNS ? " Its first corner is shown." : ""} Positions start at 0.
      </caption>
      <thead>
        <tr>
          <th scope="col">Row</th>
          {shown.map((c) => <th scope="col" key={c}>Column {c}</th>)}
        </tr>
      </thead>
      <tbody>
        {table.values.slice(0, PREVIEW_ROWS).map((row, r) => (
          <tr key={r}>
            <th scope="row">{r}</th>
            {shown.map((c) => <td key={c}>{show(row[c])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
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
  partition: "n items split into k groups",
  binary_partition: "n items split into k groups, as a table of 0 and 1",
  fixed_sum: "Shares of a fixed total",
  fixed_row_sum: "A table in which every row adds up to a fixed total",
  fixed_column_sum: "A table in which every column adds up to a fixed total",
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

export function VariablesPanel({ project, set, issues }: PanelProps) {
  const variables = project.variables as (VariableSpec & Record<string, any>)[];
  const change = (index: number, variable: object) => set({ ...project, variables: replaceAt(variables, index, variable as VariableSpec) });
  const add = () => {
    const names = new Set(variables.map((v) => v.name));
    let name = "x";
    for (let n = 2; names.has(name); n++) name = `x${n}`;
    set({ ...project, variables: [...variables, { name, type: "real", shape: [], lb: 0, ub: 1 }] });
  };

  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Variables</h3>
      <p>Variables are what the solver may change. An expression uses a variable by its name. Positions in a list start at 0.</p>
      <Problems issues={issues.filter((i) => i.where === "variables")} />
      {variables.map((v, i) => {
        const at = (key: string) => issues.filter((issue) => issue.where === `variable.${i}.${key}`);
        const dims = DIMS[v.type];
        const shape: unknown[] = Array.isArray(v.shape) ? v.shape : [];
        const list = "One number for all, or one per value, separated by commas.";
        return (
          <fieldset key={i} className="card">
            <legend>Variable {i}</legend>
            <Problems issues={issues.filter((issue) => issue.where === `variable.${i}`)} />
            <div className="row">
              <Text label="Name" code value={v.name} issues={at("name")} onChange={(name) => change(i, { ...v, name })} />
              <Field label="What it holds" issues={at("type")}>
                {(tie) => (
                  <select {...tie} value={v.type} onChange={(event) => change(i, asType(v, event.target.value as VariableType))}>
                    {!(v.type in TYPE_LABELS) && <option value={v.type}>{String(v.type)} (not known)</option>}
                    {Object.entries(TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                  </select>
                )}
              </Field>
              <button type="button" className="quiet end" onClick={() => set({ ...project, variables: removeAt(variables, i) })}>Remove variable {v.name}</button>
            </div>
            <div className="row">
              {dims && (
                <>
                  <Field label="Shape" issues={at("shape")}>
                    {(tie) => (
                      <select {...tie} value={shape.length} onChange={(event) => change(i, { ...v, shape: DEFAULT_SHAPES[Number(event.target.value)] })}>
                        {dims.map((d) => <option key={d} value={d}>{DIM_LABELS[d]}</option>)}
                      </select>
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
          </fieldset>
        );
      })}
      <p><button type="button" onClick={add}>Add a variable</button></p>
    </section>
  );
}

// Presets

/** A small form that asks for the names a preset needs, and hands them over. */
function PresetForm({ title, presets, project, action, onUse }: { title: string; presets: Preset[]; project: Project; action: string; onUse: (preset: Preset, names: Record<string, string>) => void }) {
  const [id, setId] = useState(presets[0].id);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const preset = presets.find((p) => p.id === id) ?? presets[0];
  // every need starts on a name of its own: the second column for the second need that asks for a column
  const names = Object.fromEntries(preset.needs.map((need, n) => {
    const options = optionsFor(project, need.from), nth = preset.needs.slice(0, n).filter((other) => other.from === need.from).length;
    const kept = chosen[`${id}.${need.key}`];
    return [need.key, kept !== undefined && (need.from === "number" || options.includes(kept)) ? kept : options[nth] ?? options[0] ?? ""];
  }));
  const use = () => {
    const missing = preset.needs.find((need) => names[need.key].trim() === "");
    setFailure(missing ? `This preset needs: ${missing.label.toLowerCase()}. ${missing.from === "number" ? "Type a value." : "The project has none yet."}` : "");
    if (!missing) onUse(preset, names);
  };
  return (
    <details className="preset">
      <summary>{title}</summary>
      {presets.length > 1 && (
        <Field label="Preset">
          {(tie) => (
            <select {...tie} value={id} onChange={(event) => (setId(event.target.value), setFailure(""))}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </Field>
      )}
      <p className="hint">{preset.help}</p>
      <div className="row">
        {preset.needs.map((need) => {
          const pick = (value: string) => setChosen({ ...chosen, [`${id}.${need.key}`]: value });
          return need.from === "number"
            ? <Field key={need.key} label={need.label} className="narrow">{(tie) => <Num {...tie} value={parseNumber(names[need.key])} onChange={(value) => pick(value === undefined ? "" : String(value))} />}</Field>
            : <Pick key={need.key} label={need.label} value={names[need.key]} options={optionsFor(project, need.from)} onChange={pick} />;
        })}
      </div>
      {failure && <p className="notice" role="alert">{failure}</p>}
      <p><button type="button" onClick={use}>{action}</button></p>
    </details>
  );
}

// Objective, constraints, functions

export function ObjectivePanel({ project, set, issues }: PanelProps) {
  const objective = project.objective;
  const own = issues.filter((i) => i.where === "objective");
  const change = (next: object) => set({ ...project, objective: { ...objective, ...next } });
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Objective</h3>
      <div className="row">
        <Field label="Goal">
          {(tie) => (
            <select {...tie} value={objective.sense} onChange={(event) => change({ sense: event.target.value })}>
              <option value="min">Minimize</option>
              <option value="max">Maximize</option>
            </select>
          )}
        </Field>
        <Text label="Unit" value={objective.unit} className="narrow" onChange={(unit) => change({ unit: optional(unit) })} />
      </div>
      <Field label="Expression" issues={own} className="wide" hint="One expression that gives one number. It can use the variables, the data, the functions, and sum, min, max, abs, len and ops.">
        {(tie) => <textarea {...tie} className="code" rows={3} spellCheck={false} value={objective.source} onChange={(event) => change({ source: event.target.value })} />}
      </Field>
      {issues.length === 0 && <p className="ok">Checked: this gives one number.</p>}
      <PresetForm
        title="Write the expression from a preset" presets={OBJECTIVE_PRESETS} project={project} action="Write the expression"
        onUse={(preset, names) => change({ source: preset.write(names) })}
      />
    </section>
  );
}

export function ConstraintsPanel({ project, set, issues }: PanelProps) {
  const constraints = project.constraints ?? [];
  const change = (index: number, constraint: Constraint) => set({ ...project, constraints: replaceAt(constraints, index, constraint) });
  const add = (constraint: Constraint) => set({ ...project, constraints: [...constraints, constraint] });
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Constraints</h3>
      <p>A constraint is a limit that a solution must keep: a left side, a comparison and a right side. Results show both sides in the unit you give here.</p>
      <Problems issues={issues.filter((i) => i.where === "constraints")} />
      {constraints.length === 0 && <p className="empty">No constraints. Every candidate is allowed.</p>}
      {constraints.map((c, i) => {
        const at = (side: string) => issues.filter((issue) => issue.where === `constraint.${i}.${side}`);
        return (
          <fieldset key={i} className="card">
            <legend>Constraint {i}</legend>
            <Problems issues={issues.filter((issue) => issue.where === `constraint.${i}`)} />
            <div className="row">
              <Text label="Name" value={c.name} onChange={(name) => change(i, { ...c, name })} />
              <Text label="Unit" value={c.unit} className="narrow" onChange={(unit) => change(i, { ...c, unit: optional(unit) })} />
              <button type="button" className="quiet end" onClick={() => set({ ...project, constraints: removeAt(constraints, i) })}>Remove constraint {c.name}</button>
            </div>
            <div className="row">
              <Text label="Left side" code value={c.left} issues={at("left")} className="grow" onChange={(left) => change(i, { ...c, left })} />
              <Field label="Comparison" className="narrow">
                {(tie) => (
                  <select
                    {...tie} value={c.op}
                    onChange={(event) => {
                      // only "equal to" can have a tolerance
                      const { tolerance, ...rest } = c;
                      change(i, { ...rest, op: event.target.value as Constraint["op"] });
                    }}
                  >
                    <option value="<=">at most (&lt;=)</option>
                    <option value=">=">at least (&gt;=)</option>
                    <option value="==">equal to (==)</option>
                  </select>
                )}
              </Field>
              <Text label="Right side" code value={c.right} issues={at("right")} className="grow" onChange={(right) => change(i, { ...c, right })} />
              {c.op === "==" && (
                <Field label="Tolerance" className="narrow" hint="How far apart the two sides may be and still count as equal.">
                  {(tie) => <Num {...tie} value={c.tolerance} onChange={(tolerance) => change(i, { ...c, tolerance: tolerance as number | undefined })} />}
                </Field>
              )}
            </div>
          </fieldset>
        );
      })}
      <p><button type="button" onClick={() => add({ name: `Constraint ${constraints.length}`, left: "", op: "<=", right: "" })}>Add a constraint</button></p>
      <PresetForm
        title="Add a capacity limit from a preset" presets={[CAPACITY_PRESET]} project={project} action="Add the capacity limit"
        onUse={(_, names) => add(capacityConstraint(names, project))}
      />
    </section>
  );
}

export function FunctionsPanel({ project, set, issues }: PanelProps) {
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Functions</h3>
      <p>
        Helper functions for logic that one expression cannot hold. They are written in a small part of Python: <code>def</code>, assignment,{" "}
        <code>if</code>, <code>for</code> and <code>return</code>. A function gets the variables it needs as arguments, and positions start at 0.
      </p>
      <Field label="Function definitions" issues={issues.filter((i) => i.where === "functions")} className="wide">
        {(tie) => (
          <textarea {...tie} className="code" rows={14} spellCheck={false} value={project.functions ?? ""} onChange={(event) => set({ ...project, functions: optional(event.target.value) })} />
        )}
      </Field>
    </section>
  );
}

// The drawing

export function ViewPanel({ project, set, issues }: PanelProps) {
  const view = project.view as (View & Record<string, any>) | undefined;
  const columns = columnsOf(project).map((c) => c.name);
  const orderings = project.variables.filter((v) => v.type === "permutation").map((v) => v.name);
  const choices = optionsFor(project, "yes-no-variable");
  const start = (kind: string): View | undefined =>
    kind === "route" ? { kind, variable: orderings[0] ?? "", x: columns[0] ?? "", y: columns[1] ?? columns[0] ?? "" }
    : kind === "line" ? { kind, x: columns[0] ?? "", y: columns[1] ?? columns[0] ?? "", expression: "" }
    : kind === "selection" ? { kind, variable: choices[0] ?? "" }
    : undefined;
  const change = (next: object) => set({ ...project, view: { ...view, ...next } as View });
  return (
    <section aria-labelledby="panel-heading">
      <h3 id="panel-heading">Drawing</h3>
      <p>A drawing shows a solution as a picture, while a run improves it and in its result. Without one, a solution is shown as a table.</p>
      <Field label="What to draw">
        {(tie) => (
          <select {...tie} value={view?.kind ?? ""} onChange={(event) => set({ ...project, view: start(event.target.value) })}>
            <option value="">No drawing</option>
            <option value="route">A route through points</option>
            <option value="line">A fitted line over data points</option>
            <option value="selection">Which items are chosen</option>
          </select>
        )}
      </Field>
      <Problems issues={issues.filter((i) => i.where === "view" && !i.line)} />
      {view?.kind === "route" && (
        <div className="row">
          <Pick label="Ordering variable" value={view.variable} options={orderings} onChange={(variable) => change({ variable })} />
          <Pick label="Column with the x position" value={view.x} options={columns} onChange={(x) => change({ x })} />
          <Pick label="Column with the y position" value={view.y} options={columns} onChange={(y) => change({ y })} />
        </div>
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
