// Files to share: their names, the charts of a comparison as one SVG file, and the two browser
// steps (saving a file, and a PNG picture of an SVG). A saved chart is written by
// export/figures/, the code that draws it in the app and in the report.

import type { Comparison } from "../../engine/compare.ts";
import { comparisonFigures } from "../../export/figures/build.ts";
import { figureSvg, stack } from "../../export/figures/figure.ts";

/** A file name from the names of a project and an experiment: no character that a file system refuses, and no spaces. */
export const fileName = (...parts: string[]) => parts.map((part) => String(part).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).join("-") || "ypea-studio";

/**
 * The charts of a comparison as one SVG file: one chart under the other in the order of the
 * comparison, each under the name of its experiment, all with the same scales. Undefined when
 * no experiment has a feasible run, because there is no chart then.
 */
export function comparisonSvg(comparison: Comparison): string | undefined {
  const charts = comparisonFigures(comparison);
  if (!charts) return undefined;
  const heading = (name: string) => (name.length > 60 ? `${name.slice(0, 60)}...` : name);
  const sheet = stack(comparison.experiments.map((e, n) => ({
    heading: `${heading(e.name)}: ${e.feasibleRuns} of ${e.runs} runs feasible`, figure: charts[n].figure, note: "No run was feasible, so there is nothing to draw.",
  })), "Best value during the runs of a comparison");
  return figureSvg(sheet, "file", "comparison");
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
  const [, width, height] = svg.match(/ width="([\d.]+)" height="([\d.]+)"/)!;
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
