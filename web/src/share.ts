// Files to share: their names, a chart as an SVG file of its own, and the two browser steps
// (saving a file, and a PNG picture of an SVG). The charts are the drawings of the report
// (export/report-drawings.ts), so a saved chart is the chart of the report.

import type { Comparison } from "../../engine/compare.ts";
import { comparisonCharts } from "../../export/report-drawings.ts";
import { escapeHtml } from "../../export/report-html.ts";
import { STYLE } from "../../export/report.ts";

/** A file name from the names of a project and an experiment: no character that a file system refuses, and no spaces. */
export const fileName = (...parts: string[]) => parts.map((part) => String(part).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).join("-") || "ypea-studio";

/**
 * The rules of the drawings with every color written out, in the light theme, and the color
 * of the page behind them. They are read from the style of the report, so there is one place
 * that says how a drawing looks. A file of its own cannot ask a page for its colors.
 */
export function drawingStyle(): { rules: string; surface: string } {
  const css = STYLE.text;
  const light = Object.fromEntries([...css.slice(0, css.indexOf("}")).matchAll(/(--[a-z0-9-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]));
  const font = css.match(/font-family: (system-ui[^;]*);/)?.[1] ?? "sans-serif";
  const rules = css.split("\n").filter((line) => /^(svg text|\.axes|\.mark-|\.band)/.test(line)).join(" ")
    .replace("svg text", "text").replace("font-family: inherit", `font-family: ${font}`)
    .replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => light[name] ?? "currentColor");
  return { rules, surface: light["--surface"] ?? "white" };
}

/** An SVG file from the inside of a drawing. The style and the background go after the text alternative, which stays first. */
function standalone(width: number, height: number, attributes: string, body: string): string {
  const { rules, surface } = drawingStyle();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"${attributes}>` +
    `${body.replace("</title>", `</title><style>${rules}</style><rect width="100%" height="100%" fill="${surface}"/>`)}</svg>\n`;
}

const DRAWING = /<svg viewBox="0 0 (\d+) (\d+)"([^>]*)>([\s\S]*?)<\/svg>/;

/**
 * The first drawing in markup of the report as an SVG file of its own: light theme, colors
 * written out, a background, and the words of the drawing as its text alternative. Undefined
 * when the markup holds no drawing (a sentence stands in its place).
 */
export function svgFile(markup: string): string | undefined {
  const found = markup.match(DRAWING);
  return found ? standalone(Number(found[1]), Number(found[2]), found[3], found[4]) : undefined;
}

/**
 * The charts of a comparison as one SVG file: one chart under the other in the order of the
 * comparison, each under the name of its experiment, all with the same scales. Undefined when
 * no experiment has a feasible run, because there is no chart then.
 */
export function comparisonSvg(comparison: Comparison): string | undefined {
  const figures = comparisonCharts(comparison, "chart").text.split("<figure>").slice(1);
  if (figures.length !== comparison.experiments.length) return undefined;
  const LINE = 20, GAP = 12, WIDTH = 440;
  let y = GAP;
  const parts: string[] = [], words: string[] = [];
  comparison.experiments.forEach((e, n) => {
    // the caption is markup that is already safe: only its emphasis is taken out
    const caption = (figures[n].match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1] ?? "").replace(/<\/?strong>/g, "");
    const name = e.name.length > 60 ? `${e.name.slice(0, 60)}...` : e.name, found = figures[n].match(DRAWING);
    words.push(caption);
    parts.push(`<g class="axes"><text class="title" x="8" y="${y + 14}">${escapeHtml(name)}: ${e.feasibleRuns} of ${e.runs} runs feasible</text></g>`);
    y += LINE;
    if (found) {
      parts.push(`<svg y="${y}" width="${found[1]}" height="${found[2]}" viewBox="0 0 ${found[1]} ${found[2]}">${found[4].replace(/<title[^>]*>[\s\S]*?<\/title>/, "")}</svg>`);
      y += Number(found[2]);
    } else {
      parts.push(`<text x="8" y="${y + 14}">No run was feasible, so there is nothing to draw.</text>`);
      y += LINE;
    }
    y += GAP;
  });
  return standalone(WIDTH, y, ` role="img" aria-labelledby="comparison-title"`, `<title id="comparison-title">${words.join(" ")}</title>${parts.join("")}`);
}

/** Hands a file to the browser, which saves it where the user keeps downloads. */
export function saveFile(name: string, content: string | Blob, type: string): void {
  const url = URL.createObjectURL(typeof content === "string" ? new Blob([content], { type }) : content);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function download(name: string, content: unknown): void {
  saveFile(`${String(name).replace(/[\\/:*?"<>|\s]+/g, "-")}.json`, JSON.stringify(content, null, 2), "application/json");
}

/** A PNG picture of an SVG file made here, at twice its size so that it stays sharp. */
export async function pngOf(svg: string, scale = 2): Promise<Blob> {
  const [, width, height] = svg.match(/ width="(\d+)" height="(\d+)"/)!;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Number(width) * scale;
    canvas.height = Number(height) * scale;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not make the picture."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
