// Constraint violations and their scales. A constraint is `left op right`. Its
// violation is zero when it holds and positive otherwise, divided by a scale that is fixed
// once per run, so that constraints in different units weigh fairly. The user never sees the
// scaled numbers, only both sides in their own unit.
//
// An exported script writes each constraint for ypea as one number g, satisfied when g <= 0:
//   left <= right   g = (left - right) / scale
//   left >= right   g = (right - left) / scale
//   left == right   g = (abs(left - right) - tolerance) / scale
// ypea then adds max(g, 0) over the constraints, which is what `total` does here.

import { npSum } from "./numpy.ts";

export type Op = "<=" | ">=" | "==";

/** How far `left op right` is from holding, in the constraint's own unit. Zero or negative when it holds. */
export function gap(op: Op, left: number, right: number, tolerance = 0): number {
  return op === "<=" ? left - right : op === ">=" ? right - left : Math.abs(left - right) - tolerance;
}

/** The scaled violation of one constraint: never negative, and infinite when a side is not a number. */
export function violation(op: Op, left: number, right: number, scale: number, tolerance = 0): number {
  const g = gap(op, left, right, tolerance) / scale;
  return Number.isNaN(g) ? Infinity : Math.max(g, 0);
}

/** The total violation of a candidate, added as NumPy adds (ypea: `np.maximum(g, 0).sum()`). */
export function total(violations: ArrayLike<number>): number {
  return npSum(violations);
}

const SCALE_FLOOR = 1e-12;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b), mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * The scale of one constraint, from its two sides on a sample of random candidates:
 * the median of the positive gaps. With none, the typical size of the two sides, then 1.
 * It never goes below a tiny positive floor.
 */
export function scaleOf(op: Op, lefts: ArrayLike<number>, rights: ArrayLike<number>, tolerance = 0): number {
  const gaps: number[] = [], sizes: number[] = [];
  for (let i = 0; i < lefts.length; i++) {
    const g = gap(op, lefts[i], rights[i], tolerance), size = Math.max(Math.abs(lefts[i]), Math.abs(rights[i]));
    if (g > 0 && Number.isFinite(g)) gaps.push(g);
    if (size > 0 && Number.isFinite(size)) sizes.push(size);
  }
  const scale = gaps.length ? median(gaps) : sizes.length ? median(sizes) : 1;
  return Math.max(scale, SCALE_FLOOR);
}
