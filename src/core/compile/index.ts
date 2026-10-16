import { check } from "../check/check";
import { diagnostic, type Diagnostic } from "../diagnostics";
import { parse } from "../parser/parser";
import type { Span } from "../span";
import { encode } from "./encode";
import { DEFAULT_HOST_LIMITS, makeHost, RunFailure, type FailSite, type HostLimits } from "./host";
import { lower } from "./lower";
import { printWat } from "./wat";

/** What `compile` gives back. `wasm` is the module itself; `wat` is the same module as text. */
export interface CompileResult {
  /** True when there is a module to run. */
  readonly ok: boolean;
  /** Syntax mistakes, type mistakes and the constructs that cannot be compiled yet, sorted by position. */
  readonly diagnostics: Diagnostic[];
  readonly wasm: Uint8Array<ArrayBuffer> | null;
  readonly wat: string | null;
  /** The places in the module that can fail at run time, and what each says. The module refers to them by number. */
  readonly sites: readonly FailSite[];
}

const NOWHERE: Span = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } };

const failed = (diagnostics: Diagnostic[]): CompileResult => ({ ok: false, diagnostics, wasm: null, wat: null, sites: [] });

/**
 * Turns an OakLand program into a WebAssembly module (spec S-16). A program with syntax or type mistakes is not
 * compiled; its mistakes are returned. It never throws: a bug of the compiler is reported as a diagnostic too, and
 * a module that the engine would reject is never returned.
 */
export function compile(source: string): CompileResult {
  try {
    const parsed = parse(source);
    if (parsed.diagnostics.length > 0) return failed(parsed.diagnostics);
    const checked = check(parsed.program);
    if (checked.diagnostics.length > 0) return failed(checked.diagnostics);
    const lowered = lower(parsed.program, checked);
    if (lowered.diagnostics.length > 0) return failed(lowered.diagnostics);
    const wasm = encode(lowered.module);
    if (!WebAssembly.validate(wasm)) return failed([diagnostic("semantic", "internal error in the compiler: the module it made is not valid", NOWHERE)]);
    return { ok: true, diagnostics: [], wasm, wat: printWat(lowered.module), sites: lowered.sites };
  } catch (error) {
    return failed([diagnostic("semantic", `internal error in the compiler: ${error instanceof Error ? error.message : String(error)}`, NOWHERE)]);
  }
}

/** How a compiled program ended. */
export interface CompiledRun {
  readonly stdout: string;
  /** Empty when the program ran to the end. A runtime mistake ends the run and is reported here (spec S-18). */
  readonly diagnostics: Diagnostic[];
  /** True when a mistake or a limit ended the run before the end of the program. */
  readonly stoppedEarly: boolean;
}

export interface RunOptions {
  readonly limits?: Partial<HostLimits>;
}

/** Runs the module of a successful `compile`. Never throws. */
export function runCompiled(result: CompileResult, options: RunOptions = {}): CompiledRun {
  if (!result.ok || result.wasm === null) return { stdout: "", diagnostics: [diagnostic("runtime", "there is no compiled program to run", NOWHERE)], stoppedEarly: true };
  const output = { stdout: "" };
  let memory: WebAssembly.Memory | null = null;
  try {
    const host = makeHost(result.sites, { ...DEFAULT_HOST_LIMITS, ...options.limits }, () => memory as WebAssembly.Memory, output);
    const instance = new WebAssembly.Instance(new WebAssembly.Module(result.wasm), { env: host });
    memory = instance.exports.memory as WebAssembly.Memory;
    (instance.exports.main as () => void)();
    return { stdout: output.stdout, diagnostics: [], stoppedEarly: false };
  } catch (error) {
    if (error instanceof RunFailure) return { stdout: output.stdout, diagnostics: [error.failure], stoppedEarly: true };
    if (error instanceof RangeError) {
      return { stdout: output.stdout, diagnostics: [diagnostic("runtime", "stack overflow: the program nests too deeply", NOWHERE)], stoppedEarly: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: output.stdout, diagnostics: [diagnostic("runtime", `internal error in the compiled program: ${message}`, NOWHERE)], stoppedEarly: true };
  }
}
