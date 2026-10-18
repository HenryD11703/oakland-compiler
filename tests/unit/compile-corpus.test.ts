import { describe, expect, it } from "vitest";
import { compile } from "../../src/core/compile/index";
import { corpus } from "../helpers/corpus";
import { compareModes, describe as show } from "../helpers/differential";

/**
 * The equivalence claim (spec S-17, S-18) over every program the project owns: if the compiler accepts a program, the two
 * modes print the same text and meet the same first mistake. A program the checker rejects is not compiled, so it is
 * skipped here. A failure prints the program.
 */
describe("the whole corpus, compiled and interpreted", () => {
  const programs = corpus();
  let spent = 0; // milliseconds spent comparing, added up by the test below
  const compiled = programs.map((p) => ({ ...p, result: compile(p.source) })).filter((p) => p.result.ok);

  it.each(compiled.map((p) => [p.name, p] as const))("%s prints the same text in both modes", (name, program) => {
    const started = performance.now();
    const verdict = compareModes(program.source, program.result);
    spent += performance.now() - started;
    expect(verdict.problem, verdict.problem === null ? undefined : show(name, verdict.problem, program.source)).toBeNull();
  });

  it("comparing the whole corpus takes under 30 seconds (T52)", () => {
    expect(spent).toBeLessThan(30_000);
  });

  it("the compiler accepts at least as many corpus programs as it did at the last milestone", () => {
    // Everything the checker accepts compiles (Phase C): numbers, control flow, functions, strings, arrays, structs, classes,
    // the built-in functions and functions inside functions. This number only goes up as programs are added to the corpus.
    expect(compiled.length).toBeGreaterThanOrEqual(45);
  });
});
