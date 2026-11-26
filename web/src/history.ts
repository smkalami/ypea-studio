// The undo history of one open project: the states of its definition, one after another.
// It holds only what it is given. The app gives it the project and the list of experiments
// that still follow the suggestion, never a run or a stored result, so those cannot be undone.
// It lives in memory for as long as the project is open. No browser code.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The field that the last step was typed in, when it was typing. */
  group?: string;
  /** The time of the last step, in milliseconds. */
  at: number;
}

/** Typing in one field counts as one step while the pauses are no longer than this. */
export const GROUP_MS = 1000;
/** The number of steps that can be undone. Older ones are forgotten. */
export const LIMIT = 100;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], at: 0 });

/**
 * A new state after an edit. `group` names the text field that was typed in: an edit in the
 * same field soon after the last one joins its step. An edit without a group is a step of its own.
 */
export function record<T>(history: History<T>, next: T, group: string | undefined, now: number): History<T> {
  const joins = group !== undefined && group === history.group && now - history.at <= GROUP_MS;
  const past = joins ? history.past : [...history.past, history.present].slice(-LIMIT);
  return { past, present: next, future: [], group, at: now };
}

/** One step back. The same history comes back when there is nothing to undo. */
export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future], at: history.at };
}

/** One step forward again. The same history comes back when there is nothing to redo. */
export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), at: history.at };
}
