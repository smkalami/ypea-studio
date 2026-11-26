// Constraint violations and their scales. A constraint is `left op right`. Its
// violation is zero when it holds and positive otherwise, divided by a scale that is fixed
// once per run, so that constraints in different units weigh fairly. The user never sees the
// scaled numbers, only both sides in their own unit.
//
// The rule is written here once, and everything that judges a constraint goes through `gap`.
// The gap says how far a constraint is from holding, in its own unit. It holds when the gap is
// zero or negative:
//   left <= right   gap = left - right
//   left >= right   gap = right - left
//   left == right   gap = abs(left - right) - (tolerance + relative_tolerance * abs(right))
// So two sides count as equal when they differ by no more than a fixed amount plus a fraction of
// the size of the right side, as in NumPy's isclose. Only == has tolerances. Both are 0 unless the
// project sets them, and then == is exact. On a right side of 0 the relative part adds nothing.
// An == constraint with a side that is not a finite number never holds.
//
// The order of arithmetic for == is fixed, because an exported script must compute the same bits:
//   1. allowed = tolerance + relative_tolerance * abs(right)   (the product, then the sum)
//   2. gap = abs(left - right) - allowed
//
// An exported script writes each constraint for ypea as one number g = gap / scale, satisfied
// when g <= 0. ypea then adds max(g, 0) over the constraints, which is what `total` does here.
// A constraint that is turned off takes no part in any of this.

import { npSum } from "./numpy.ts";

export type Op = "<=" | ">=" | "==";

/** How far `left op right` is from holding, in the constraint's own unit. Zero or negative when it holds. */
export function gap(op: Op, left: number, right: number, tolerance = 0, relativeTolerance = 0): number {
  if (op === "<=") return left - right;
  if (op === ">=") return right - left;
  const allowed = tolerance + relativeTolerance * Math.abs(right);
  return Math.abs(left - right) - allowed;
}

/** What a person is told about one constraint, in the constraint's own unit. */
export interface Measure {
  /** The gap: how far past what is allowed. Positive when the constraint is broken. For == it is counted after the tolerances. */
  excess: number;
  /** The plain difference between the two sides, left minus right. No tolerance is taken off. */
  difference: number;
  /** The size of that difference as a percentage of the size of the right side. Absent when the right side is 0 or the value is not finite. */
  differencePercent?: number;
}

export function measure(op: Op, left: number, right: number, tolerance = 0, relativeTolerance = 0): Measure {
  const difference = left - right, percent = (Math.abs(difference) / Math.abs(right)) * 100;
  const result: Measure = { excess: gap(op, left, right, tolerance, relativeTolerance), difference };
  // a right side of 0 gives a percentage that is not finite
  if (Number.isFinite(percent)) result.differencePercent = percent;
  return result;
}

/** The scaled violation of one constraint: never negative, and infinite when a side is not a number. */
export function violation(op: Op, left: number, right: number, scale: number, tolerance = 0, relativeTolerance = 0): number {
  const g = gap(op, left, right, tolerance, relativeTolerance) / scale;
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
export function scaleOf(op: Op, lefts: ArrayLike<number>, rights: ArrayLike<number>, tolerance = 0, relativeTolerance = 0): number {
  const gaps: number[] = [], sizes: number[] = [];
  for (let i = 0; i < lefts.length; i++) {
    const g = gap(op, lefts[i], rights[i], tolerance, relativeTolerance), size = Math.max(Math.abs(lefts[i]), Math.abs(rights[i]));
    if (g > 0 && Number.isFinite(g)) gaps.push(g);
    if (size > 0 && Number.isFinite(size)) sizes.push(size);
  }
  const scale = gaps.length ? median(gaps) : sizes.length ? median(sizes) : 1;
  return Math.max(scale, SCALE_FLOOR);
}
