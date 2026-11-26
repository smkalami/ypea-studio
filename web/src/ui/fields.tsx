// The form controls every panel uses: a labeled field with its hint and its problems, a
// number field, a choice among names of the project, and the file button.

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import type { Issue } from "../protocol.ts";
import { Checkbox, Select } from "./controls.tsx";
import { Icon } from "./Icon.tsx";

/** The problems of one part of the editor: its own, and those of the parts inside it. */
export const issuesAt = (issues: Issue[], where: string) => issues.filter((i) => i.where === where || i.where.startsWith(`${where}.`));

export function Problems({ id, issues }: { id?: string; issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="problems" id={id}>
      {issues.map((issue, k) => (
        <li key={k}>
          <Icon name="circle-exclamation-point" />
          <span><strong>Problem{issue.line ? ` on line ${issue.line}, column ${issue.column}` : ""}:</strong> {issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a control needs to be tied to its label, its hint and its problems. The label has the id `${id}-label`. */
export interface Tie {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  issues?: Issue[];
  className?: string;
  children: (tie: Tie) => ReactNode;
}

export function Field({ label, hint, issues = [], className = "", children }: FieldProps) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", issues.length ? `${id}-problems` : ""].filter(Boolean).join(" ");
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id} id={`${id}-label`}>{label}</label>
      {children({ id, "aria-describedby": described || undefined, "aria-invalid": issues.length ? true : undefined })}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      <Problems id={`${id}-problems`} issues={issues} />
    </div>
  );
}

/** A check box with its label beside it, and the hint and the problems below. */
export function CheckField({ label, hint, issues = [], checked, onChange }: { label: string; hint?: ReactNode; issues?: Issue[]; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", issues.length ? `${id}-problems` : ""].filter(Boolean).join(" ");
  return (
    <div className="field setting">
      <label className="check">
        <Checkbox id={id} checked={checked} aria-describedby={described || undefined} aria-invalid={issues.length ? true : undefined} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      <Problems id={`${id}-problems`} issues={issues} />
    </div>
  );
}

/**
 * What a number field holds: a number, a list of numbers where lists are allowed, nothing
 * when it is empty, or the text as typed when it is not a number. The check of the project
 * then refuses that text with its own message, and the work in progress is kept.
 */
export function parseNumber(text: string, list = false): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const one = (part: string) => (part.trim() === "" ? NaN : Number(part));
  if (list && trimmed.includes(",")) {
    const all = trimmed.split(",").map(one);
    return all.every(Number.isFinite) ? all : trimmed;
  }
  return Number.isFinite(one(trimmed)) ? one(trimmed) : trimmed;
}

const numberText = (value: unknown) => (value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value));
const keyOf = (value: unknown) => JSON.stringify(value ?? null);

/** A text field for a number. It keeps what is typed, such as "1." on the way to "1.5". */
export function Num(props: { value: unknown; onChange: (value: unknown) => void; list?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list">) {
  const { value, onChange, list, ...rest } = props;
  const [text, setText] = useState(numberText(value));
  const [seen, setSeen] = useState(value);
  // The value changed, by typing here or from outside (a preset, another field). The text is
  // replaced only when it no longer says the same as the value. It is compared with the last
  // value seen, because some values, such as a list of one number, do not read back the same.
  if (keyOf(seen) !== keyOf(value)) {
    setSeen(value);
    if (keyOf(parseNumber(text, list)) !== keyOf(value)) setText(numberText(value));
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      className="input number"
      autoComplete="off"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseNumber(event.target.value, list));
      }}
      {...rest}
    />
  );
}

/** A choice among names. A stored name that no longer exists stays visible, marked as missing. */
export function Pick(props: { label: string; value: string | undefined; options: string[]; onChange: (value: string) => void; none?: string; issues?: Issue[]; hint?: string }) {
  const { label, value, options, onChange, none, issues, hint } = props;
  const missing = value !== undefined && value !== "" && !options.includes(value);
  const all = [
    ...(none !== undefined || !value ? [{ value: "", label: none ?? "Choose" }] : []),
    ...(missing ? [{ value, label: `${value} (missing)` }] : []),
    ...options.map((option) => ({ value: option, label: option })),
  ];
  return (
    <Field label={label} issues={issues} hint={hint ?? (options.length === 0 && none === undefined ? "Nothing in this project fits here yet." : undefined)}>
      {(tie) => <Select {...tie} value={value ?? ""} options={all} onChange={onChange} />}
    </Field>
  );
}

/**
 * A button that opens the file chooser of the system. The file is used at once, so the name
 * shown under the button is the file that was chosen last. `hint` says what kind of file fits.
 */
export function FileButton(props: { label: string; accept: string; id?: string; hint?: string; onFile: (file: File) => void }) {
  const ownId = useId(), id = props.id ?? ownId;
  const [name, setName] = useState("");
  return (
    <div className="file">
      <button type="button" className="btn btn-secondary" aria-describedby={props.hint ? `${id}-hint` : undefined} onClick={() => document.getElementById(id)?.click()}>
        <Icon name="upload" />
        {props.label}
      </button>
      <input
        id={id}
        type="file"
        accept={props.accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // so the same file can be chosen again
          if (!file) return;
          setName(file.name);
          props.onFile(file);
        }}
      />
      {props.hint && <p className="hint" id={`${id}-hint`}>{props.hint}</p>}
      {name && <p className="file-name">Chosen: <span>{name}</span></p>}
    </div>
  );
}
