import { describe, expect, it } from "vitest";
import { check } from "../../src/core/check/check";
import { compile } from "../../src/core/compile/index";
import { parse } from "../../src/core/parser/parser";
import { compareModes, describe as show } from "../helpers/differential";
import { generateProgram } from "../helpers/generate";
import { minimise } from "../helpers/minimise";
import { compileMutant, MUTANTS } from "../helpers/mutants";

const SEEDS = 200;

/**
 * T53: programs made by a seeded generator, run in both modes. The generator only writes programs the checker accepts
 * and that end, so every one of them must compile and agree. A second test breaks the compiler on purpose, one
 * instruction at a time, and requires the same 200 programs to notice.
 */
describe("generated programs, compiled and interpreted (S-17)", () => {
  it("every seed makes a program the checker accepts", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const source = generateProgram(seed);
      const parsed = parse(source);
      const diagnostics = parsed.diagnostics.length > 0 ? parsed.diagnostics : check(parsed.program).diagnostics;
      expect(diagnostics.map((d) => `${d.span.start.line}:${d.message}`), `seed ${seed}`).toEqual([]);
    }
  });

  it("is deterministic: the same seed is the same program, and different seeds differ", () => {
    expect(generateProgram(42)).toBe(generateProgram(42));
    expect(generateProgram(1)).not.toBe(generateProgram(2));
  });

  it(`${SEEDS} seeds print the same text in both modes`, { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const source = generateProgram(seed);
      const compiled = compile(source);
      expect(compiled.diagnostics.map((d) => d.message), `seed ${seed} did not compile`).toEqual([]);
      const verdict = compareModes(source, compiled);
      if (verdict.problem === null) continue;
      const small = minimise(source, (candidate) => compareModes(candidate).problem !== null);
      expect.fail(show(`seed ${seed}`, verdict.problem, small));
    }
  });

  it.each(MUTANTS.map((m) => [m.name, m] as const))("a compiler where %s is caught within the seeds", { timeout: 120_000 }, (_name, mutant) => {
    let caught: number | null = null;
    for (let seed = 1; seed <= SEEDS && caught === null; seed++) {
      const source = generateProgram(seed);
      const broken = compileMutant(source, mutant);
      if (broken !== null && compareModes(source, broken).problem !== null) caught = seed;
    }
    expect(caught, "no seed noticed the broken compiler").not.toBeNull();
  });

  it("the minimiser keeps what still fails and drops what does not", () => {
    const source = ["a", "b", "BAD", "c", "d"].join("\n");
    expect(minimise(source, (candidate) => candidate.includes("BAD"))).toBe("BAD");
  });
});
