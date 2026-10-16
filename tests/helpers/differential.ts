import { expect } from "vitest";
import { compile, runCompiled, type CompiledRun, type CompileResult } from "../../src/core/compile/index";
import { run, type RunResult } from "../../src/core/run";

export interface Both {
  readonly compiled: CompileResult;
  readonly ran: CompiledRun | null;
  readonly interpreted: RunResult;
}

/** Runs a program in both ways: through the interpreter, and compiled to WebAssembly and run by the engine. */
export function both(source: string): Both {
  const compiled = compile(source);
  const interpreted = run(source, { trace: false, limits: { maxSteps: 50_000_000, maxTimeMs: 20_000 } });
  return { compiled, ran: compiled.ok ? runCompiled(compiled) : null, interpreted };
}

/**
 * The central claim of the compiler (spec S-17): a program the checker accepts, run without a runtime mistake, prints
 * the same text compiled as it does interpreted. Passing `expected` pins that text as well, so that the two cannot
 * agree on something wrong.
 */
export function expectSame(source: string, expected?: string): void {
  const { compiled, ran, interpreted } = both(source);
  expect(compiled.diagnostics.map((d) => `${d.span.start.line}:${d.span.start.column} ${d.message}`), "the program did not compile").toEqual([]);
  expect(ran?.diagnostics.map((d) => d.message), "the compiled program reported a mistake").toEqual([]);
  expect(interpreted.diagnostics.map((d) => d.message), "the interpreter reported a mistake").toEqual([]);
  expect(ran?.stdout).toBe(interpreted.stdout);
  if (expected !== undefined) expect(ran?.stdout).toBe(expected);
}

/** For a program that fails at run time: both report the same first mistake at the same place, and the compiled one stops there. */
export function expectSameFailure(source: string, message: string): void {
  const { compiled, ran, interpreted } = both(source);
  expect(compiled.diagnostics.map((d) => d.message), "the program did not compile").toEqual([]);
  const first = interpreted.diagnostics.find((d) => d.phase === "runtime");
  expect(first?.message, "the interpreter's first runtime mistake").toBe(message);
  expect(ran?.diagnostics).toHaveLength(1);
  expect(ran?.diagnostics[0]?.message).toBe(message);
  expect(ran?.diagnostics[0]?.span, "the place of the mistake").toEqual(first?.span);
  expect(ran?.stoppedEarly).toBe(true);
  // The interpreter goes on after a mistake and the compiled program does not: what the compiled one printed is where they agree.
  expect(interpreted.stdout.startsWith(ran?.stdout ?? "\u0000")).toBe(true);
}
