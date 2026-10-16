import { toAstView, type AstNode } from "./astView";
import { check } from "./check/check";
import { compareDiagnostics, diagnostic, type Diagnostic } from "./diagnostics";
import { interpret } from "./interpreter/interpreter";
import type { RunLimits } from "./interpreter/limits";
import { checkPlacement } from "./interpreter/placement";
import { parse } from "./parser/parser";
import { LineIndex } from "./span";
import { collectSymbols, mergeSymbols, type SymbolEntry } from "./symbols";
import type { Trace } from "./trace/types";

export interface RunOptions {
  /** Overrides for the defaults in DEFAULT_LIMITS. */
  readonly limits?: Partial<RunLimits>;
  /** Record the step-by-step trace (default true). */
  readonly trace?: boolean;
  /** A clock in milliseconds; tests pass a fake one. */
  readonly now?: () => number;
}

/** Everything one run produces. Plain data: it can be sent from a Worker to the page as it is. */
export interface RunResult {
  /** What the program printed. Empty when the program has syntax errors and never ran. */
  readonly stdout: string;
  /** Every problem found, sorted by position. */
  readonly diagnostics: Diagnostic[];
  /** False when the program had lexical or syntax errors. */
  readonly ran: boolean;
  /** True when a limit ended the run early. */
  readonly stoppedEarly: boolean;
  /** Evaluation steps used. */
  readonly steps: number;
  /** The parsed program (what could be parsed, if there were syntax errors). */
  readonly ast: AstNode;
  /** Every name the program declares, in source order. Empty if it did not run. */
  readonly symbols: SymbolEntry[];
  /** The step-by-step record. Null if the program did not run or tracing was off. */
  readonly trace: Trace | null;
}

/**
 * Parses and runs an OakLand program. Never throws, whatever the input (principle 2).
 * A program with lexical or syntax errors is not executed (AC-21).
 */
export function run(source: string, options: RunOptions = {}): RunResult {
  try {
    return runUnguarded(source, options);
  } catch (error) {
    // Last line of defence for principle 2: nothing a user types may escape as an exception.
    const message =
      error instanceof RangeError ? "the program is nested too deeply to be processed" : `internal error: ${error instanceof Error ? error.message : String(error)}`;
    const span = new LineIndex(source).spanOf(0, 0);
    return {
      stdout: "",
      diagnostics: [diagnostic("runtime", message, span)],
      ran: false,
      stoppedEarly: true,
      steps: 0,
      ast: { kind: "Program", label: "program", span, children: [] },
      symbols: [],
      trace: null,
    };
  }
}

function runUnguarded(source: string, options: RunOptions): RunResult {
  const parsed = parse(source);
  const ast = toAstView(parsed.program);
  if (parsed.diagnostics.length > 0) {
    return { stdout: "", diagnostics: parsed.diagnostics, ran: false, stoppedEarly: false, steps: 0, ast, symbols: [], trace: null };
  }
  const misplaced = checkPlacement(parsed.program);
  const result = interpret(parsed.program, {
    typeHints: check(parsed.program).types,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.trace !== undefined ? { trace: options.trace } : {}),
  });
  const diagnostics = [...misplaced, ...result.diagnostics].sort(compareDiagnostics);
  return {
    stdout: result.stdout,
    diagnostics,
    ran: true,
    stoppedEarly: result.stoppedEarly,
    steps: result.steps,
    ast,
    symbols: mergeSymbols(collectSymbols(parsed.program), result.symbols),
    trace: result.trace,
  };
}
