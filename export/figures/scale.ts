// Axes: where the ticks go, whether the value axis is logarithmic, and how a tick is written.
// Pure arithmetic, the same in a browser and in Node.

/** A round step for about `target` intervals over `span`: 1, 2 or 5 times a power of ten. */
export function niceStep(span: number, target = 5): number {
  const raw = span / Math.max(1, target), power = 10 ** Math.floor(Math.log10(raw)), part = raw / power;
  return (part <= 1 ? 1 : part <= 2 ? 2 : part <= 5 ? 5 : 10) * power;
}

/**
 * Ticks at round values that cover [low, high]: the first is at or below `low`, the last at or
 * above `high`, so the axis runs from the first tick to the last and no value touches the frame
 * by accident. A flat range gets room on both sides. Never fewer than three ticks.
 */
export function niceTicks(low: number, high: number, target = 5): { ticks: number[]; step: number } {
  if (!(high > low)) {
    const room = low !== 0 ? Math.abs(low) * 0.1 : 1;
    [low, high] = [low - room, low + room];
  }
  for (;;) {
    const step = niceStep(high - low, target);
    const first = Math.floor(low / step + 1e-9), last = Math.ceil(high / step - 1e-9);
    // i * step, without the noise of binary fractions (0.30000000000000004)
    const ticks = Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
    if (ticks.length >= 3) return { ticks, step };
    target *= 2;
  }
}

/**
 * The value axis is logarithmic when every value is positive and the largest is more than 1,000
 * times the smallest: on a linear axis such a history is one vertical and one flat line. A zero
 * or a negative value keeps the axis linear, because a logarithmic axis cannot show it and
 * leaving it out would misstate the run. The rule does not ask whether the objective is
 * minimized or maximized: it reads the values only.
 */
export function useLog(values: number[]): boolean {
  let low = Infinity, high = -Infinity;
  for (const v of values) {
    if (!(v > 0) || !Number.isFinite(v)) return false;
    if (v < low) low = v;
    if (v > high) high = v;
  }
  return high / low > 1000;
}

/** Ticks of a logarithmic axis, as exponents of ten: whole decades, every 1, 2, 3, 5, 10... of them, at most seven. */
export function logTicks(low: number, high: number): number[] {
  const from = Math.floor(Math.log10(low) + 1e-9), to = Math.ceil(Math.log10(high) - 1e-9);
  let every = 1;
  for (const step of [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 400]) {
    every = step;
    if ((to - from) / step <= 6) break;
  }
  const first = Math.floor(from / every) * every, last = Math.ceil(to / every) * every;
  return Array.from({ length: (last - first) / every + 1 }, (_, i) => first + i * every);
}

/**
 * A tick of a linear axis as text: as many decimals as the step needs and no more, with
 * separators between the thousands. Very large and very small steps are written with an exponent.
 */
export function tickText(value: number, step: number): string {
  if (value === 0) return "0";
  const size = Math.max(Math.abs(value), step);
  if (size >= 1e9 || step < 1e-6) return Number(value.toPrecision(6)).toExponential().replace("e+", "e");
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A tick of a logarithmic axis: 1e-12, 1e0, 1e3. One form on the whole axis. */
export const logText = (exponent: number) => `1e${exponent}`;
