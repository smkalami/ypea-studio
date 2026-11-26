// NumPy's way of adding numbers, reproduced so that the engine gets the same last digit as ypea.
// Checked against NumPy 2.4 for lengths 1 to 20000 (spec/parity/numpy.json).
//
// - np.sum and np.mean of a 1-D array, and of each row with axis=-1, add in pairs: npSum.
// - np.sum with axis=0 adds row after row, in index order: a plain loop.
// - Python's built-in sum() on an array adds in index order: a plain loop.

/** np.sum(a[start:end]) for a contiguous run of numbers. */
export function npSum(a: ArrayLike<number>, start = 0, end = a.length): number {
  // NumPy starts from zero, so a sum of negative zeros is +0
  return pairwise(a, start, end) + 0;
}

function pairwise(a: ArrayLike<number>, start: number, end: number): number {
  const n = end - start;
  if (n < 8) {
    let s = 0;
    for (let i = start; i < end; i++) s += a[i];
    return s;
  }
  if (n <= 128) {
    let r0 = a[start], r1 = a[start + 1], r2 = a[start + 2], r3 = a[start + 3];
    let r4 = a[start + 4], r5 = a[start + 5], r6 = a[start + 6], r7 = a[start + 7];
    let i = start + 8;
    for (const stop = end - (n % 8); i < stop; i += 8) {
      r0 += a[i], r1 += a[i + 1], r2 += a[i + 2], r3 += a[i + 3];
      r4 += a[i + 4], r5 += a[i + 5], r6 += a[i + 6], r7 += a[i + 7];
    }
    let s = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (; i < end; i++) s += a[i];
    return s;
  }
  let half = Math.floor(n / 2);
  half -= half % 8;
  return pairwise(a, start, start + half) + pairwise(a, start + half, end);
}

/** np.mean(a[start:end]). */
export function npMean(a: ArrayLike<number>, start = 0, end = a.length): number {
  return npSum(a, start, end) / (end - start);
}
