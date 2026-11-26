// The drawings of the report: the solution drawn as the project's view asks, the best value
// during a run, and the charts of a comparison. The figures themselves are built and written by
// export/figures/, the same code that draws them in the app and in a saved picture. This file
// only sets each one on the page of the report, with its words twice: as the title of the
// picture, for a screen reader, and under it as a caption. The report draws in the light colors,
// on a light ground, whatever the theme of the screen, as a saved picture does.

import type { Comparison } from "../engine/compare.ts";
import type { PlainSolution, Project } from "../engine/project.ts";
import type { RunResult } from "../engine/run.ts";
import { comparisonFigures, historyFigure, solutionFigure } from "./figures/build.ts";
import { type Figure, figureSvg, type Words } from "./figures/figure.ts";
import { html, Markup } from "./report-html.ts";

/** A caption as markup: plain words, and names from the project as code. */
const captionOf = (words: Words): Markup[] => words.map((part) => (typeof part === "string" ? html`${part}` : html`<code>${part.code}</code>`));

/** A picture with its words: the title inside the picture and the caption under it. */
function figure(drawn: Figure, id: string, lead?: Markup): Markup {
  // figureSvg escapes every text of the figure, so its result is markup that is already safe
  return html`<figure><div class="figure-box">${new Markup(figureSvg(drawn, "report", id))}</div><figcaption>${lead}${captionOf(drawn.caption)}</figcaption></figure>`;
}

/**
 * The solution drawn as the project's view asks. A sentence instead of a picture when the
 * project has a view that this report cannot draw, or when the stored data do not fit the view.
 */
export function problemDrawing(project: Project, solution: PlainSolution, id: string, curve?: number[]): Markup | undefined {
  const drawn = solutionFigure(project, solution, curve);
  if (!drawn) return undefined;
  if ("figure" in drawn) return figure(drawn.figure, id);
  if ("words" in drawn) return html`<p class="note">${drawn.words}</p>`;
  if ("unknown" in drawn) return html`<p class="note">The project has a drawing of the kind "${drawn.unknown}", which this report cannot draw. The solution is in the table above.</p>`;
  return html`<p class="note">The drawing of the solution could not be made, because the stored data do not fit the view of the project.</p>`;
}

/** The chart of the history of a run. */
export function historyChart(result: RunResult, unit: string | undefined, id: string): Markup {
  const drawn = historyFigure(result, unit);
  return drawn ? figure(drawn, id) : html`<p class="note">The run recorded too few values to draw its history.</p>`;
}

/**
 * One chart for each experiment of a comparison, all with the same scales: the median of the
 * best value so far, and the band between the first and the third quartile.
 */
export function comparisonCharts(comparison: Comparison, id: string): Markup {
  const charts = comparisonFigures(comparison);
  if (!charts) return html`<p class="note">No experiment has a feasible run, so there is no chart.</p>`;
  return html`<div class="figures">${charts.map((chart, n) => (chart.figure
    ? figure(chart.figure, `${id}-${n}`, html`<strong>${chart.name}.</strong> `)
    : html`<figure><figcaption><strong>${chart.name}.</strong> ${chart.words}</figcaption></figure>`))}</div>`;
}
