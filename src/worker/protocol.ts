import type { AstNode } from "../core/astView";
import type { Diagnostic } from "../core/diagnostics";
import type { RunResult } from "../core/run";
import type { ReplayState } from "../core/trace/replay";
import type { Series } from "../core/trace/series";

/**
 * What the page asks the worker to do. One request at a time; the id tells the answer which one it belongs to.
 * `run` interprets with the trace (the timeline), `compile` compiles to WebAssembly and runs the module, and `compare`
 * does both without the trace and says whether they agree.
 */
export type WorkerRequest = RunRequest | CompileRequest | CompareRequest;

export interface RunRequest {
  readonly type: "run";
  readonly id: number;
  readonly source: string;
}
export interface CompileRequest {
  readonly type: "compile";
  readonly id: number;
  readonly source: string;
}
export interface CompareRequest {
  readonly type: "compare";
  readonly id: number;
  readonly source: string;
}

/** Everything the interface needs after a run, as plain data. */
export interface RunOutcome {
  readonly result: RunResult;
  /** The numeric variables that change most, one value per trace step, for the timeline lanes. */
  readonly series: Series[];
  /** The state after the last step, computed here so that the page does not replay the whole trace to show it. */
  readonly finalState: ReplayState | null;
}

/** One function of the compiled module: its WebAssembly text, and the source lines it came from when that is known. */
export interface CompiledFunction {
  readonly name: string;
  /** "yours" for the program's own functions, "runtime" for what every module carries. */
  readonly origin: "yours" | "runtime";
  readonly lines: readonly string[];
  readonly source: { readonly from: number; readonly to: number } | null;
}

/** What compiling a program, and running the module, gave. */
export interface CompileOutcome {
  /** True when there is a module (the program had no syntax or type mistakes). */
  readonly ok: boolean;
  /** The mistakes that stopped the compiler, sorted by position; empty when `ok`. */
  readonly diagnostics: Diagnostic[];
  readonly bytes: number;
  readonly watLines: number;
  readonly functions: CompiledFunction[];
  readonly compileMs: number;
  /** The syntax tree, so that the tree view works in Compile mode too. */
  readonly ast: AstNode | null;
  /** What the module printed and how it ended; null when there was no module. */
  readonly ran: { readonly stdout: string; readonly diagnostics: Diagnostic[]; readonly stoppedEarly: boolean } | null;
  readonly runMs: number | null;
}

/** The two modes on one program, each timed once, as they are in the page. */
export interface CompareOutcome {
  readonly interpreted: { readonly stdout: string; readonly diagnostics: Diagnostic[]; readonly stoppedEarly: boolean; readonly ms: number };
  readonly compiled: CompileOutcome;
  /** `identical`, `different`, or why they cannot be compared. */
  readonly outputs: "identical" | "different" | "not comparable";
  readonly note: string | null;
}

export type WorkerResponse = ResultResponse | CompiledResponse | ComparedResponse;

export interface ResultResponse {
  readonly type: "result";
  readonly id: number;
  readonly outcome: RunOutcome;
}
export interface CompiledResponse {
  readonly type: "compiled";
  readonly id: number;
  readonly outcome: CompileOutcome;
}
export interface ComparedResponse {
  readonly type: "compared";
  readonly id: number;
  readonly outcome: CompareOutcome;
}
