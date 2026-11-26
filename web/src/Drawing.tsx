// The drawings on screen: a solution drawn as the project's view asks, the chart of the best
// value against evaluations, and the charts of a comparison. The figures are built and written
// as SVG by export/figures/, the same code that draws them in the report and in a saved picture.
// This file only sets a figure on the page, with its caption, and adds what a page can do: the
// chart of a run gives its value at each checkpoint to the pointer and to the arrow keys.

import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PlainSolution, Project } from "../../engine/project.ts";
import type { RunResult } from "../../engine/run.ts";
import { historyFigure, solutionFigure } from "../../export/figures/build.ts";
import { type Figure as FigureData, figureSvg, type Words } from "../../export/figures/figure.ts";

const Caption = ({ words }: { words: Words }) => <>{words.map((part, n) => (typeof part === "string" ? part : <code key={n}>{part.code}</code>))}</>;

/**
 * A figure in its box, with its caption under it. The box keeps the natural width of the figure
 * and scrolls on its own in a narrow window, so it can take the focus. The markup comes from
 * figureSvg, which escapes every text of the figure.
 */
export function Figure({ figure, label = "Drawing", lead, box }: { figure: FigureData; label?: string; lead?: string; box?: object }) {
  const svg = useMemo(() => figureSvg(figure, "screen"), [figure]);
  return (
    <figure className="drawing">
      <div className="drawing-box" tabIndex={0} role="group" aria-label={label} {...box} dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>{lead && <strong>{lead}. </strong>}<Caption words={figure.caption} /></figcaption>
    </figure>
  );
}

/** A solution drawn as the project's view asks. Nothing when the project has no view, or when the view no longer fits. */
export function Drawing({ project, solution, curve }: { project: Project; solution: PlainSolution; curve?: number[] }) {
  const drawn = useMemo(() => solutionFigure(project, solution, curve), [project, solution, curve]);
  if (!drawn) return null;
  if ("figure" in drawn) return <Figure figure={drawn.figure} />;
  // too many items to draw: the words alone
  return "words" in drawn ? <figure className="drawing"><figcaption>{drawn.words}</figcaption></figure> : null;
}

/**
 * The best value at the checkpoints of a run, against evaluations. Pointing at the chart shows
 * the value at the nearest checkpoint. So do the arrow keys while the chart has the focus: left
 * and right step through the checkpoints, Home and End go to the first and the last, and Escape
 * clears the mark. The value is written under the chart, in a line that is always there.
 */
export function HistoryChart({ result, unit }: { result: RunResult; unit?: string }) {
  const [at, setAt] = useState<number>();
  const figure = useMemo(() => historyFigure(result, unit, at), [result, unit, at]);
  const box = useRef<HTMLDivElement>(null), byKey = useRef(false);
  // In a narrow window the chart is wider than its box. The arrow keys read values here, so they no longer scroll the box:
  // the box follows the checkpoint that is read instead, and the whole chart can still be reached.
  useEffect(() => {
    const svg = box.current?.querySelector("svg"), probe = at === undefined ? undefined : figure?.probes?.[at];
    if (!box.current || !svg || !probe || !byKey.current) return;
    const x = (probe.x / figure!.width) * svg.getBoundingClientRect().width;
    box.current.scrollLeft = Math.max(0, x - box.current.clientWidth / 2);
  }, [at, figure]);
  // The picture under the pointer is written again at every checkpoint, and React does not see the pointer leave a picture
  // that is no longer on the page. The browser itself tells the box, so the box listens to it directly.
  const drawn = figure !== undefined;
  useEffect(() => {
    const element = box.current, clear = () => setAt(undefined);
    element?.addEventListener("pointerleave", clear);
    return () => element?.removeEventListener("pointerleave", clear);
  }, [drawn]);
  if (!figure) return null;
  const probes = figure.probes!, last = probes.length - 1;
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const svg = event.currentTarget.querySelector("svg");
    if (!svg) return;
    const box = svg.getBoundingClientRect(), x = ((event.clientX - box.left) / box.width) * figure.width;
    byKey.current = false;
    setAt(probes.reduce((best, probe, n) => (Math.abs(probe.x - x) < Math.abs(probes[best].x - x) ? n : best), 0));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowRight: Math.min(last, (at ?? -1) + 1), ArrowLeft: Math.max(0, (at ?? probes.length) - 1), Home: 0, End: last }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      byKey.current = true;
      setAt(next);
    } else if (event.key === "Escape") setAt(undefined);
  };
  return (
    <div className="chart-read">
      <Figure figure={figure} label="Chart of the best value. The left and right arrow keys read the value at each checkpoint." box={{ ref: box, onPointerMove: point, onKeyDown: key }} />
      <p className="hint" aria-live="polite">{at === undefined ? "Point at the chart, or focus it and press the left or right arrow key, to read a value." : `${probes[at].text}.`}</p>
    </div>
  );
}
