// The form controls every panel uses: a labeled field with its hint and its problems, a
// number field, and a choice among names of the project.

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import type { Issue } from "./protocol.ts";

/** The problems of one part of the editor: its own, and those of the parts inside it. */
export const issuesAt = (issues: Issue[], where: string) => issues.filter((i) => i.where === where || i.where.startsWith(`${where}.`));

export function Problems({ id, issues }: { id?: string; issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="problems" id={id}>
      {issues.map((issue, k) => (
        <li key={k}>
          <strong>Problem{issue.line ? ` on line ${issue.line}, column ${issue.column}` : ""}:</strong> {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** What a control needs to be tied to its label, its hint and its problems. */
export interface Tie {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export function Field(props: { label: string; hint?: ReactNode; issues?: Issue[]; className?: string; children: (tie: Tie) => ReactNode }) {
  const { label, hint, issues = [], className = "", children } = props;
  const id = useId();
  const described = [hint ? `${id}-hint` : "", issues.length ? `${id}-problems` : ""].filter(Boolean).join(" ");
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": described || undefined, "aria-invalid": issues.length ? true : undefined })}
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
      className="number"
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
  return (
    <Field label={label} issues={issues} hint={hint ?? (options.length === 0 && none === undefined ? "Nothing in this project fits here yet." : undefined)}>
      {(tie) => (
        <select {...tie} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
          {(none !== undefined || !value) && <option value="">{none ?? "Choose"}</option>}
          {missing && <option value={value}>{value} (missing)</option>}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      )}
    </Field>
  );
}

/** A hidden file input behind a button, as the project list uses for project files. */
export function FileButton(props: { label: string; accept: string; id?: string; className?: string; onFile: (file: File) => void }) {
  const inputId = useId();
  return (
    <>
      <button type="button" className={props.className} onClick={() => document.getElementById(props.id ?? inputId)?.click()}>{props.label}</button>
      <input
        id={props.id ?? inputId}
        type="file"
        accept={props.accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // so the same file can be chosen again
          if (file) props.onFile(file);
        }}
      />
    </>
  );
}
