import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";
import { run } from "../../src/core/run";
import { corpus } from "../helpers/corpus";

/**
 * The equivalence claim (spec S-17) over every program the project owns: if the compiler accepts a program and neither
 * mode meets a runtime mistake, the two print the same text. A program the compiler does not accept yet is skipped
 * here; the count below only goes up as the compiler learns more.
 */
describe("the whole corpus, compiled and interpreted", () => {
  const programs = corpus();
  const compiled = programs.map((p) => ({ ...p, result: compile(p.source) })).filter((p) => p.result.ok);

  it.each(compiled.map((p) => [p.name, p] as const))("%s prints the same text in both modes", (_name, program) => {
    // The interpreter goes first: a program that never ends is stopped by its step limit, and a compiled run has none here.
    const interpreted = run(program.source, { trace: false, limits: { maxSteps: 50_000_000, maxTimeMs: 20_000 } });
    if (interpreted.stoppedEarly) return;
    const ran = runCompiled(program.result);
    if (ran.diagnostics.length > 0 || interpreted.diagnostics.some((d) => d.phase === "runtime")) return;
    expect(ran.stdout).toBe(interpreted.stdout);
  });

  it("the compiler accepts at least as many corpus programs as it did at the last milestone", () => {
    // T48: numbers, control flow, functions, strings, arrays, structs and classes. Raise this number when a task makes more programs compile.
    expect(compiled.length).toBeGreaterThanOrEqual(40);
  });
});
