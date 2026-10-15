import { compareDiagnostics, diagnostic, type Diagnostic } from "./diagnostics";
import { interpret } from "./interpreter/interpreter";
import type { RunLimits } from "./interpreter/limits";
import { checkPlacement } from "./interpreter/placement";
import { parse } from "./parser/parser";
import { LineIndex } from "./span";

export interface RunResult {
  /** What the program printed. Empty when the program has syntax errors and never ran. */
  readonly stdout: string;
  /** Every problem found, sorted by position. */
  readonly diagnostics: Diagnostic[];
  /** False when the program had lexical or syntax errors. */
  readonly ran: boolean;
  /** True when a limit ended the run early. */
  readonly stoppedEarly: boolean;
  readonly steps: number;
}

/**
 * Parses and runs an OakLand program. Never throws, whatever the input (principle 2).
 * A program with lexical or syntax errors is not executed (AC-21).
 */
export function run(source: string, limits: Partial<RunLimits> = {}): RunResult {
  try {
    return runUnguarded(source, limits);
  } catch (error) {
    // Last line of defence for principle 2: nothing a user types may escape as an exception.
    const message =
      error instanceof RangeError ? "the program is nested too deeply to be processed" : `internal error: ${error instanceof Error ? error.message : String(error)}`;
    const span = new LineIndex(source).spanOf(0, 0);
    return { stdout: "", diagnostics: [diagnostic("runtime", message, span)], ran: false, stoppedEarly: true, steps: 0 };
  }
}

function runUnguarded(source: string, limits: Partial<RunLimits>): RunResult {
  const parsed = parse(source);
  if (parsed.diagnostics.length > 0) {
    return { stdout: "", diagnostics: parsed.diagnostics, ran: false, stoppedEarly: false, steps: 0 };
  }
  const misplaced = checkPlacement(parsed.program);
  const result = interpret(parsed.program, limits);
  const diagnostics = [...misplaced, ...result.diagnostics].sort(compareDiagnostics);
  return { stdout: result.stdout, diagnostics, ran: true, stoppedEarly: result.stoppedEarly, steps: result.steps };
}
