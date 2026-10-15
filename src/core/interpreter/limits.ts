/** Bounds on a single run (docs/02-plan.md, D6). Reaching one ends the run with a diagnostic; output so far is kept. */
export interface RunLimits {
  /** Statements and expressions evaluated. */
  readonly maxSteps: number;
  readonly maxTimeMs: number;
  /** Nested user-function calls. */
  readonly maxDepth: number;
  /** Characters printed. */
  readonly maxOutputChars: number;
  /** Elements in one array (all dimensions together). */
  readonly maxArrayElements: number;
}

/** A run lists at most this many distinct problems; the rest are summarised in one last diagnostic. */
export const MAX_DIAGNOSTICS = 200;

export const DEFAULT_LIMITS: RunLimits = {
  maxSteps: 20_000_000,
  maxTimeMs: 5_000,
  maxDepth: 400,
  maxOutputChars: 200_000,
  maxArrayElements: 1_000_000,
};

/** Thrown inside the interpreter to unwind the whole run after a limit was reported. Never leaves `interpret`. */
export class RunAbort extends Error {
  constructor() {
    super("run aborted");
  }
}
