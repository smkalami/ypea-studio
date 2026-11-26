// The shared controls that are more than a styled element: the select, the check box, the
// disclosure, the callout, the icon button and the theme choice.

import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import { applyTheme, storedTheme, type Theme } from "./theme.ts";

export interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  /** The id of the trigger. Its label has the id `${id}-label` (see Field). */
  id: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/**
 * A choice of one value from a list that opens under the field. The keyboard works as in a
 * system select: arrows, Home, End, Enter or Space to choose, Escape to close, and typing
 * the start of a label jumps to it.
 */
export function Select({ id, value, options, onChange, disabled, ...described }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const chosen = options.findIndex((option) => option.value === value);

  const show = (at = Math.max(chosen, 0)) => {
    const box = root.current!.getBoundingClientRect(), below = window.innerHeight - box.bottom;
    // the list opens upward only when there is little room below and more above
    setAbove(below < 280 && box.top > below);
    setActive(at);
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  };
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = options.length - 1;
    const move = (to: number) => {
      event.preventDefault();
      if (open) setActive(Math.max(0, Math.min(last, to)));
      else show(Math.max(0, Math.min(last, to)));
    };
    if (event.key === "ArrowDown") move(open ? active + 1 : Math.max(chosen, 0));
    else if (event.key === "ArrowUp") move(open ? active - 1 : Math.max(chosen, 0));
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else show();
    } else if (event.key === "Escape" && open) {
      event.preventDefault(); // only the list closes, not a dialog around it
      setOpen(false);
    } else if (event.key === "Tab" && open) choose(active);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + event.key.toLowerCase(), at: now };
      const found = options.findIndex((option) => option.label.toLowerCase().startsWith(typed.current.text));
      if (found >= 0) move(found);
    }
  };

  return (
    <div className="select" ref={root}>
      <button
        type="button" role="combobox" id={id} className="input select-trigger" disabled={disabled} data-value={value}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined} {...described}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}
      >
        <span className="select-value">{options[chosen]?.label ?? ""}</span>
        <Icon name="chevron-down" className="chevron" />
      </button>
      {open && (
        <ul role="listbox" id={`${id}-list`} className={above ? "listbox above" : "listbox"} aria-labelledby={`${id}-label`}>
          {options.map((option, index) => (
            <li
              key={option.value} role="option" id={`${id}-option-${index}`} data-value={option.value} aria-selected={index === chosen}
              className={index === active ? "active" : undefined}
              // the pointer must not take the focus away from the trigger
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {index === chosen && <Icon name="check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A check box: the real input, with a drawn box and check mark over it. */
export function Checkbox(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="check-box">
      <input type="checkbox" {...props} />
      <Icon name="check" />
    </span>
  );
}

/** A part that opens and closes, with one chevron that turns. */
export function Disclosure({ summary, className = "", open, children }: { summary: string; className?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className={`disclosure ${className}`} open={open}>
      <summary>
        <span>{summary}</span>
        <Icon name="chevron-down" className="chevron" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

const GLYPH: Record<string, IconName> = {
  info: "info", success: "circle-check", warning: "triangle-exclamation-point", danger: "circle-exclamation-point", neutral: "info",
};

/** A callout: a tint, a glyph and words. The words say what kind it is, so the color is never the only sign. */
export function Alert({ kind, role, className = "", children }: { kind: "info" | "success" | "warning" | "danger" | "neutral"; role?: "alert" | "note"; className?: string; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind} ${className}`} role={role}>
      <Icon name={GLYPH[kind]} />
      <div>{children}</div>
    </div>
  );
}

/** A button that shows only an icon. `label` is its full name, and `tip` the short one shown on hover and focus. */
export function IconButton({ icon, label, tip, onClick }: { icon: IconName; label: string; tip: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-quiet btn-icon btn-compact" aria-label={label} data-tip={tip} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="loading">
      <Icon name="loader-circle" />
      {children}
    </p>
  );
}

const THEMES: [Theme, string, IconName][] = [["system", "Same as the system", "monitor"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];

/** The choice of theme: three named choices, one tab stop, arrow keys move. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState(storedTheme);
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">Theme</legend>
      {THEMES.map(([value, label, icon]) => (
        <label key={value} data-tip={`Theme: ${label}`}>
          <input type="radio" name="theme" className="visually-hidden" checked={theme === value} onChange={() => (applyTheme(value), setTheme(value))} />
          <Icon name={icon} />
          <span className="visually-hidden">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
