import type { Span } from "../span";

/** The trace keeps at most this many steps; after that the run goes on but is no longer recorded (AC-31). */
export const MAX_TRACE_STEPS = 20_000;
/** Only the first items of an array are kept in the trace; its length is always exact. */
export const MAX_TRACE_ITEMS = 100;

/**
 * A value as the trace shows it: either text that is final (`10`, `hi`, `null`, `[...]`) or a reference to an
 * array or struct kept apart, so that two variables holding the same array show the same contents.
 */
export type Part = { readonly text: string } | { readonly ref: number };

export interface TraceVar {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly value: Part;
}

export interface TraceField {
  readonly name: string;
  readonly type: string;
  readonly value: Part;
}

/** An array (`items`) or a struct (`fields`) on the heap. */
export interface TraceObject {
  readonly id: number;
  /** `int[]`, `Person`... */
  readonly type: string;
  /** Real length of an array (`items` may hold fewer); 0 for structs. */
  readonly length: number;
  readonly items: readonly Part[] | null;
  readonly fields: readonly TraceField[] | null;
}

/**
 * What a step changed. Replaying every event from the start rebuilds the state at any step.
 * Scope and frame events take effect at the start of the next step, so that the variables of a block are
 * still visible while its last statement is highlighted.
 */
export type TraceEvent =
  | { readonly t: "push-frame"; readonly name: string }
  | { readonly t: "pop-frame"; readonly returned: string | null }
  | { readonly t: "push-scope"; readonly id: number; readonly label: string }
  | { readonly t: "pop-scope" }
  | { readonly t: "declare"; readonly variable: TraceVar }
  | { readonly t: "set-var"; readonly id: number; readonly value: Part }
  | { readonly t: "alloc"; readonly object: TraceObject }
  | { readonly t: "set-item"; readonly object: number; readonly index: number; readonly value: Part }
  | { readonly t: "set-field"; readonly object: number; readonly name: string; readonly value: Part };

/**
 * - `statement`: a statement was executed (its effects are in `events`)
 * - `condition`: an `if`, `while`, `for` or `switch` evaluated its condition (`note` is the result)
 * - `iteration`: a for-each loop took its next element
 * - `return`: control came back to the calling line after a function returned (`note` says what it returned)
 * - `end`: the program finished
 */
export type StepKind = "statement" | "condition" | "iteration" | "return" | "end";

export interface TraceStep {
  readonly kind: StepKind;
  /** The source to highlight. */
  readonly span: Span;
  readonly events: TraceEvent[];
  /** How many characters of stdout had been printed when the step ended. */
  outputLength: number;
  note: string | null;
}

export interface Trace {
  readonly steps: TraceStep[];
  /** True when the run had more steps than MAX_TRACE_STEPS; the output is still complete. */
  readonly truncated: boolean;
}
