// Where the labels of a figure go, so that none runs into another.
//
// The rule, in the order it is applied:
//   1. Labels are placed one after another in the order they are asked for (the order of the
//      data), and a placed label never moves. So the same data give the same figure, and a
//      small change of the data moves few labels.
//   2. A label tries eight places around its point, in a fixed order (upper right first), at
//      three distances. At the two larger distances a thin leader line joins it to its point.
//   3. A place is refused when the label would leave the figure, cover another label, or cover
//      the mark of a point.
//   4. Among the places that are left, the one that crosses the fewest lines wins. Ties go to
//      the nearer distance and then to the earlier direction.
//   5. A label with no place left is not drawn. The caller counts these and says so in words.
//
// There is no randomness and no page: the width of a text is estimated from its characters.

export interface Box { x: number; y: number; w: number; h: number }
export type Segment = [x1: number, y1: number, x2: number, y2: number];
export interface Mark { x: number; y: number; r: number }
export interface Placed {
  text: string;
  /** Where the text starts, on its baseline. */
  x: number;
  y: number;
  box: Box;
  /** From the mark to the label, when the label had to move away. */
  leader?: Segment;
  /** How many lines the label crosses where it stands. */
  crossings: number;
}

// the box of one line of text at this size, as a browser lays it out with the system fonts
const SIZE = 12, HEIGHT = 16, ASCENT = 12;
// Widths in parts of the font size, a little wider than the system fonts draw them, so that an
// estimate errs toward more room. Digits have one width.
const WIDE = /[mwMW@%]/, NARROW = /[ijlt.,:;'|!()\[\] ]/, UPPER = /[A-Z]/;

/** The width of a text in the units of the figure, estimated without a page. */
export function textWidth(text: string, size = SIZE, bold = false): number {
  let parts = 0;
  for (const ch of text) parts += /\d/.test(ch) ? 0.6 : WIDE.test(ch) ? 0.9 : NARROW.test(ch) ? 0.33 : UPPER.test(ch) ? 0.7 : 0.58;
  return parts * size * (bold ? 1.06 : 1);
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether a segment passes through a box (Liang and Barsky). */
export function crosses([x1, y1, x2, y2]: Segment, box: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - box.x], [dx, box.x + box.w - x1], [-dy, y1 - box.y], [dy, box.y + box.h - y1]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// upper right, lower right, upper left, lower left, right, left, above, below
const DIRECTIONS: [number, number][] = [[1, -1], [1, 1], [-1, -1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]];
const DISTANCES = [3, 11, 21];
const GAP = 4, CROSSING = 10, FARTHER = 3, LATER = 0.1;

/** Places labels one at a time in a figure with known lines and marks. */
export class LabelPlacer {
  readonly placed: Placed[] = [];
  private readonly taken: Box[];
  private readonly bounds: Box;
  private readonly segments: Segment[];
  private readonly marks: Mark[];
  constructor(bounds: Box, segments: Segment[], marks: Mark[], taken: Box[] = []) {
    this.bounds = bounds;
    this.segments = segments;
    this.marks = marks;
    this.taken = [...taken];
  }

  /**
   * Places one label at the first anchor that has a free place without a crossing, or else at
   * the best place over all anchors. Undefined when no place is left.
   */
  place(text: string, anchors: Mark[], bold = false): Placed | undefined {
    const w = textWidth(text, SIZE, bold) + 2, h = HEIGHT;
    let best: { cost: number; box: Box; anchor: Mark; ring: number; crossings: number } | undefined;
    search: for (const anchor of anchors) {
      for (let ring = 0; ring < DISTANCES.length; ring++) {
        const reach = anchor.r + DISTANCES[ring];
        for (let d = 0; d < DIRECTIONS.length; d++) {
          const [dx, dy] = DIRECTIONS[d], k = dx && dy ? Math.SQRT1_2 : 1;
          const box = {
            x: dx > 0 ? anchor.x + reach * k : dx < 0 ? anchor.x - reach * k - w : anchor.x - w / 2,
            y: dy > 0 ? anchor.y + reach * k : dy < 0 ? anchor.y - reach * k - h : anchor.y - h / 2,
            w, h,
          };
          if (box.x < this.bounds.x || box.y < this.bounds.y || box.x + w > this.bounds.x + this.bounds.w || box.y + h > this.bounds.y + this.bounds.h) continue;
          // two labels keep a gap between them, so that "2" and "14" never read as "214"
          if (this.taken.some((other) => overlaps({ x: box.x - GAP, y: box.y, w: w + 2 * GAP, h }, other))) continue;
          if (this.marks.some((m) => m !== anchor && overlaps(box, { x: m.x - m.r, y: m.y - m.r, w: 2 * m.r, h: 2 * m.r }))) continue;
          let crossings = 0;
          for (const segment of this.segments) if (crosses(segment, box)) crossings++;
          const cost = crossings * CROSSING + ring * FARTHER + d * LATER;
          if (!best || cost < best.cost) best = { cost, box, anchor, ring, crossings };
          if (crossings === 0 && ring === 0) break search;
        }
      }
    }
    if (!best) return undefined;
    const { box, anchor } = best;
    const label: Placed = { text, x: box.x + 1, y: box.y + ASCENT, box, crossings: best.crossings };
    if (best.ring > 0) {
      // from the edge of the mark to the nearest point of the label
      const tx = Math.min(Math.max(anchor.x, box.x), box.x + box.w), ty = Math.min(Math.max(anchor.y, box.y), box.y + box.h);
      const length = Math.hypot(tx - anchor.x, ty - anchor.y) || 1;
      label.leader = [anchor.x + ((tx - anchor.x) / length) * anchor.r, anchor.y + ((ty - anchor.y) / length) * anchor.r, tx, ty];
    }
    this.taken.push(box);
    this.placed.push(label);
    return label;
  }
}

/** Which of n things get a label when there is no room for all: every k-th, so that at most `limit` are labeled. */
export const everyNth = (n: number, limit: number) => Math.max(1, Math.ceil(n / limit));
