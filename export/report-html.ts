// Building HTML text safely. Names, labels, units and code come from a project file that a
// stranger may have shared, and a stored result is no more trusted. So nothing reaches the page
// without passing through `html`, which escapes every value it is given. The only text that is
// not escaped is markup that `html` itself has already built.
//
// Two more rules keep the page inert, and the report follows both:
//   1. Every attribute value is written inside double quotes in a template of this code.
//   2. Text from a project never goes into an attribute at all, only into the content of an element.

/** Markup that is already safe: it came out of `html`. */
export class Markup {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

/**
 * Text that is safe as the content of an element and inside a quoted attribute value. Control
 * characters that HTML does not allow are replaced, so that they cannot hide anything.
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "�")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function place(value: unknown): string {
  if (value instanceof Markup) return value.text;
  if (Array.isArray(value)) return value.map(place).join("");
  if (value === undefined || value === null || value === false) return "";
  return escapeHtml(value);
}

/** A template of markup. Every value is escaped, except markup from this function. Lists are joined, and nothing is left out for undefined, null and false. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Markup {
  return new Markup(strings.reduce((text, part, i) => text + place(values[i - 1]) + part));
}

/** A number with at most six significant digits, a list of them in brackets, or the value as text. */
export function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  if (value === null || value === undefined) return "no number";
  return typeof value === "number" && !Number.isInteger(value) ? String(Number(value.toPrecision(6))) : String(value);
}

/** A whole number with separators between the thousands. */
export const count = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));
export const withUnit = (value: unknown, unit?: string) => `${show(value)}${unit ? ` ${unit}` : ""}`;
