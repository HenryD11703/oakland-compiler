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
export function expectSameFailure(source: string, message: string, phase: "runtime" | "semantic" = "runtime"): void {
  const { compiled, ran, interpreted } = both(source);
  expect(compiled.diagnostics.map((d) => d.message), "the program did not compile").toEqual([]);
  const first = interpreted.diagnostics.find((d) => d.phase === phase);
  expect(first?.message, "the interpreter's first runtime mistake").toBe(message);
  expect(ran?.diagnostics).toHaveLength(1);
  expect(ran?.diagnostics[0]?.message).toBe(message);
  expect(ran?.diagnostics[0]?.phase).toBe(phase);
  expect(ran?.diagnostics[0]?.span, "the place of the mistake").toEqual(first?.span);
  expect(ran?.stoppedEarly).toBe(true);
  // The interpreter goes on after a mistake and the compiled program does not: what the compiled one printed is where they agree.
  expect(interpreted.stdout.startsWith(ran?.stdout ?? "\u0000")).toBe(true);
}

/** The limits of the interpreter that say "this program may never end"; a compiled run has none of them, so such a program is skipped. */
const NEVER_ENDS = /^(step|time) limit reached/;

export interface Verdict {
  /** Why the program was not compared, or null when it was. */
  readonly skipped: string | null;
  /** What differs between the two modes, or null when they agree. The program is not part of it; see `describe`. */
  readonly problem: string | null;
}

/**
 * The differential check (spec S-17 and S-18) as a value, so that the corpus test, the generator and the minimiser can
 * share it. A program the compiler does not take is skipped. When the interpreter meets a runtime mistake, the compiled
 * run must end with the same one (message, phase and place) and print what the interpreter printed up to it; when it
 * does not, the compiled run must meet none and print the same text. A program that prints the time of day cannot be
 * compared, only run.
 */
export function compareModes(source: string, compiledResult?: CompileResult): Verdict {
  const compiled = compiledResult ?? compile(source);
  if (!compiled.ok) return { skipped: "the compiler does not take it", problem: null };
  // The interpreter goes first: a program that never ends is stopped by its step limit, and a compiled run has none here.
  const interpreted = run(source, { trace: false, limits: { maxSteps: 50_000_000, maxTimeMs: 20_000 } });
  if (interpreted.diagnostics.some((d) => NEVER_ENDS.test(d.message))) return { skipped: "the interpreter's limit ended it", problem: null };
  const ran = runCompiled(compiled);
  const internal = ran.diagnostics.find((d) => d.message.startsWith("internal error"));
  if (internal) return { skipped: null, problem: `the compiled program reported: ${internal.message}` };
  const printsTime = /\btime\(\)/.test(source);

  const mistakes = interpreted.diagnostics.filter((d) => d.phase === "runtime" || d.phase === "semantic");
  if (mistakes.length === 0) {
    if (ran.diagnostics.length > 0) return { skipped: null, problem: `the compiled program met a mistake the interpreter did not: ${ran.diagnostics[0]?.message}` };
    if (!printsTime && ran.stdout !== interpreted.stdout) return { skipped: null, problem: firstDifference(ran.stdout, interpreted.stdout) };
    return { skipped: null, problem: null };
  }
  const got = ran.diagnostics[0];
  if (got === undefined) return { skipped: null, problem: `the interpreter met "${mistakes[0]?.message}" and the compiled program did not` };
  const same = mistakes.find((d) => d.message === got.message && d.phase === got.phase && JSON.stringify(d.span) === JSON.stringify(got.span));
  if (same === undefined) {
    const first = mistakes[0] as (typeof mistakes)[number];
    return { skipped: null, problem: `the first mistake differs: compiled "${got.message}" at ${got.span.start.line}:${got.span.start.column}, interpreted "${first.message}" at ${first.span.start.line}:${first.span.start.column}` };
  }
  if (!printsTime && !interpreted.stdout.startsWith(ran.stdout)) return { skipped: null, problem: `before the mistake: ${firstDifference(ran.stdout, interpreted.stdout)}` };
  return { skipped: null, problem: null };
}

/** The first line where two outputs differ, with both versions. */
function firstDifference(compiled: string, interpreted: string): string {
  const a = compiled.split("\n");
  const b = interpreted.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `output line ${i + 1} differs: compiled ${JSON.stringify(a[i] ?? "(nothing)")}, interpreted ${JSON.stringify(b[i] ?? "(nothing)")}`;
  }
  return "the outputs differ";
}

/** A failure message that carries the program, so that whoever reads it can run it. */
export function describe(name: string, problem: string, source: string): string {
  return `${name}: ${problem}\n--- program ---\n${source.length > 2000 ? `${source.slice(0, 2000)}\n…` : source}\n--- end ---`;
}
