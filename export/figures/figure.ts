// A figure as data, and the one function that writes it as SVG. The app, the report and the
// saved pictures all draw through this file, so a figure looks the same everywhere and is
// changed in one place. Nothing here needs a page: it runs in a browser and in Node.
//
// A figure is a list of plain shapes. A shape names its colors by role, never by value. The
// writer then paints in one of two ways:
//   - on the screen of the app, a role becomes a class that reads a design token, so the
//     figure follows the light and the dark theme;
//   - in the report and in a saved picture, a role becomes its light color, written out. Such
//     a picture carries its own colors, background, typeface and words, and depends on nothing.
// Widths, dashes and sizes do not change with the theme, so they are always written out.

import { escapeHtml } from "../report-html.ts";

/**
 * The colors a figure can use, by role: the design token of the app, and the value in the light
 * theme. The series are the palette of Okabe and Ito (Color Universal Design, 2008), which
 * people with the common kinds of color blindness can tell apart, darkened where needed to
 * stand out from a white page by at least 3 to 1. They are in the order of use: each one is as
 * far as possible from all the ones before it. The last series is the neutral ink.
 */
export const PAINTS = {
  ink: ["--ink", "#0f172a"],
  muted: ["--ink-3", "#475569"],
  surface: ["--surface", "#ffffff"],
  grid: ["--line", "#e2e8f0"],
  axis: ["--control-border", "#64748b"],
  accent: ["--accent-ink", "#1d4ed8"],
  band: ["--accent", "#2563eb"],
  "series-1": ["--series-1", "#003f66"],
  "series-2": ["--series-2", "#996800"],
  "series-3": ["--series-3", "#2f6788"],
  "series-4": ["--series-4", "#8d3c00"],
  "series-5": ["--series-5", "#008f68"],
  "series-6": ["--series-6", "#cc79a7"],
  "series-7": ["--series-7", "#000000"],
} as const;
export type Paint = keyof typeof PAINTS;

export const SERIES_COLORS = 7;
// After the colors are used up they start again with dashes, then with dots, and so on.
const DASHES = [undefined, "7 4", "2 4", "10 4 2 4"];
/** How series n is drawn: solid colors first, and a dash pattern only from the eighth series on. */
export function seriesStyle(n: number): { paint: Paint; dash?: string } {
  return { paint: `series-${(n % SERIES_COLORS) + 1}` as Paint, dash: DASHES[Math.floor(n / SERIES_COLORS) % DASHES.length] };
}

interface Stroke { stroke?: Paint; width?: number; dash?: string; cap?: "round" }
/** Marks a shape as part of a series, or a text as a tick of an axis, so that a check can find them. */
interface Tag { series?: number; tick?: "x" | "y" }
export type Shape =
  | ({ kind: "line"; x1: number; y1: number; x2: number; y2: number } & Stroke & Tag)
  | ({ kind: "path"; d: string; fill?: Paint; opacity?: number } & Stroke & Tag)
  | ({ kind: "circle"; cx: number; cy: number; r: number; fill?: Paint } & Stroke & Tag)
  | ({ kind: "rect"; x: number; y: number; w: number; h: number; rx?: number; fill?: Paint } & Stroke & Tag)
  /** Shapes that are drawn lower by dy: how one figure is put under another. */
  | { kind: "group"; dy: number; shapes: Shape[] }
  | ({ kind: "text"; x: number; y: number; text: string; anchor?: "start" | "middle" | "end"; fill?: Paint; bold?: boolean; halo?: boolean; turned?: boolean } & Tag);

/** A piece of a caption: plain words, or a name from the project shown as code. */
export type Words = (string | { code: string })[];

export interface Figure {
  width: number;
  height: number;
  /** A short name of the figure. */
  title: string;
  /** The text alternative: everything the figure shows, for someone who cannot see it. */
  words: string;
  /** What is shown and how to read it. */
  caption: Words;
  shapes: Shape[];
  /** Places on a chart where a value can be read: the position in the figure and the words. */
  probes?: { x: number; y: number; text: string }[];
}

export const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
export const TEXT_SIZE = 12;

/** A coordinate: two decimals, and never anything but a number. */
const c = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
/** A straight path through points. */
export const pathOf = (points: number[][]) => points.map(([x, y], n) => `${n ? "L" : "M"}${c(x)},${c(y)}`).join(" ");

/** The class of a role on the screen of the app. */
const className = (use: "fill" | "stroke", paint: Paint) => `fig-${use}-${paint}`;

/** The style rules of the classes: each reads the token of its role. The stylesheet of the app holds exactly this text. */
export function figureCss(): string {
  return (Object.keys(PAINTS) as Paint[]).map((paint) => `.${className("fill", paint)} { fill: var(${PAINTS[paint][0]}); }\n.${className("stroke", paint)} { stroke: var(${PAINTS[paint][0]}); }\n`).join("");
}

function shapeSvg(shape: Shape, themed: boolean): string {
  if (shape.kind === "group") return `<g transform="translate(0 ${c(shape.dy)})">${shape.shapes.map((inner) => shapeSvg(inner, themed)).join("")}</g>`;
  const classes: string[] = [];
  let attributes = "";
  const paint = (use: "fill" | "stroke", role: Paint | undefined) => {
    if (!role) attributes += use === "fill" ? ` fill="none"` : "";
    else if (themed) classes.push(className(use, role));
    else attributes += ` ${use}="${PAINTS[role][1]}"`;
  };
  if (shape.kind === "text") {
    paint("fill", shape.fill ?? "muted");
    // a halo in the color of the page keeps a label readable where it must cross a line
    if (shape.halo) {
      paint("stroke", "surface");
      attributes += ` stroke-width="3" stroke-linejoin="round" paint-order="stroke"`;
    }
    if (shape.anchor && shape.anchor !== "start") attributes += ` text-anchor="${shape.anchor}"`;
    if (shape.bold) attributes += ` font-weight="600"`;
    if (shape.turned) attributes += ` transform="rotate(-90 ${c(shape.x)} ${c(shape.y)})"`;
  } else {
    paint("fill", shape.kind === "line" ? undefined : shape.fill);
    paint("stroke", shape.stroke);
    if (shape.stroke) attributes += ` stroke-width="${shape.width ?? 1}"`;
    if (shape.dash) attributes += ` stroke-dasharray="${shape.dash}"`;
    if (shape.cap) attributes += ` stroke-linecap="round" stroke-linejoin="round"`;
    if (shape.kind === "path" && shape.opacity !== undefined) attributes += ` fill-opacity="${shape.opacity}"`;
  }
  if (shape.series !== undefined) attributes += ` data-series="${Math.trunc(shape.series)}"`;
  if (shape.tick) attributes += ` data-tick="${shape.tick}"`;
  const head = `${classes.length ? ` class="${classes.join(" ")}"` : ""}${attributes}`;
  switch (shape.kind) {
    case "line": return `<line${head} x1="${c(shape.x1)}" y1="${c(shape.y1)}" x2="${c(shape.x2)}" y2="${c(shape.y2)}"/>`;
    case "path": return `<path${head} d="${escapeHtml(shape.d)}"/>`;
    case "circle": return `<circle${head} cx="${c(shape.cx)}" cy="${c(shape.cy)}" r="${c(shape.r)}"/>`;
    case "rect": return `<rect${head} x="${c(shape.x)}" y="${c(shape.y)}" width="${c(shape.w)}" height="${c(shape.h)}"${shape.rx ? ` rx="${c(shape.rx)}"` : ""}/>`;
    case "text": return `<text${head} x="${c(shape.x)}" y="${c(shape.y)}">${escapeHtml(shape.text)}</text>`;
  }
}

/**
 * A figure as SVG text.
 *   "screen": colors by class from the tokens of the app, and the words as the label of the picture.
 *   "report": light colors written out, and the words as the title of the picture, under `id`.
 *   "file":   a picture that stands on its own: light colors, its own background and typeface,
 *             its size, a title and a description.
 * Every text of the figure is escaped here, so the result is safe to put on a page.
 */
export function figureSvg(figure: Figure, target: "screen" | "report" | "file", id = "figure"): string {
  const { width, height } = figure, themed = target === "screen";
  const body = figure.shapes.map((shape) => shapeSvg(shape, themed)).join("");
  const box = `viewBox="0 0 ${c(width)} ${c(height)}"`, text = `font-size="${TEXT_SIZE}"`;
  if (target === "screen") return `<svg ${box} role="img" aria-label="${escapeHtml(figure.words)}" ${text}>${body}</svg>`;
  const ground = `<rect width="${c(width)}" height="${c(height)}" fill="${PAINTS.surface[1]}"/>`;
  if (target === "report") return `<svg ${box} role="img" aria-labelledby="${escapeHtml(id)}" ${text}><title id="${escapeHtml(id)}">${escapeHtml(figure.words)}</title>${ground}${body}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${box} width="${c(width)}" height="${c(height)}" role="img" aria-labelledby="${escapeHtml(id)}-title ${escapeHtml(id)}-desc" ${text} font-family="${FONT}">` +
    `<title id="${escapeHtml(id)}-title">${escapeHtml(figure.title)}</title><desc id="${escapeHtml(id)}-desc">${escapeHtml(figure.words)}</desc>${ground}${body}</svg>\n`;
}

/** Several figures as one, each under the one before, with a line of words above each. */
export function stack(figures: { heading: string; figure?: Figure; note?: string }[], title: string): Figure {
  const GAP = 12, LINE = 20;
  const shapes: Shape[] = [];
  let y = GAP, width = 440;
  for (const { heading, figure, note } of figures) {
    shapes.push({ kind: "text", x: 8, y: y + 14, text: heading, fill: "ink", bold: true });
    y += LINE;
    if (figure) {
      width = Math.max(width, figure.width);
      shapes.push({ kind: "group", dy: y, shapes: figure.shapes });
      y += figure.height;
    } else {
      shapes.push({ kind: "text", x: 8, y: y + 14, text: note ?? "" });
      y += LINE;
    }
    y += GAP;
  }
  return { width, height: y, title, words: figures.map((f) => f.figure?.words ?? `${f.heading}. ${f.note ?? ""}`).join(" "), caption: [], shapes };
}
