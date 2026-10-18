import { describe, expect, it } from "vitest";
import { check } from "../../src/core/check/check";
import { parse } from "../../src/core/parser/parser";
import { run } from "../../src/core/run";
import { MAX_TRACE_STEPS } from "../../src/core/trace/types";
import { BASES, mulberry32, mutate, soup } from "../helpers/fuzz";

/**
 * AC-23: `run()` never throws and always returns a sound result, whatever the program says.
 * The programs are mutations of the seven samples and of a few programs that use every feature, plus random
 * soups of tokens. Everything is seeded, so a failure can be reproduced from the number in its name.
 */

/** Everything a caller may rely on, whatever the input was. */
function checkSound(source: string, label: string): void {
  let result: ReturnType<typeof run>;
  try {
    result = run(source, { limits: { maxSteps: 300_000, maxTimeMs: 2_000 } });
  } catch (error) {
    throw new Error(`run() threw for ${label}: ${String(error)}\n--- source ---\n${source.slice(0, 600)}`, { cause: error });
  }
  const where = `${label}\n--- source ---\n${source.slice(0, 600)}`;
  expect(typeof result.stdout, where).toBe("string");
  if (!result.ran) expect(result.stdout, where).toBe("");
  for (const d of result.diagnostics) {
    expect(d.message.length, where).toBeGreaterThan(0);
    expect(d.message.startsWith("internal error"), `${d.message}\n${where}`).toBe(false);
    expect(["lexical", "syntax", "semantic", "runtime"], where).toContain(d.phase);
    expect(d.span.start.offset, where).toBeGreaterThanOrEqual(0);
    expect(d.span.end.offset, where).toBeLessThanOrEqual(source.length);
    expect(d.span.start.offset, where).toBeLessThanOrEqual(d.span.end.offset);
    expect(d.span.start.line, where).toBeGreaterThanOrEqual(1);
    expect(d.span.start.column, where).toBeGreaterThanOrEqual(1);
  }
  if (result.ran) expect(result.ast.kind, where).toBe("Program");
  if (result.trace) expect(result.trace.steps.length, where).toBeLessThanOrEqual(MAX_TRACE_STEPS + 1);
  // A program with a syntax or lexical error never runs; one that ran has none.
  const broken = result.diagnostics.some((d) => d.phase === "lexical" || d.phase === "syntax");
  expect(result.ran, where).toBe(!broken);

  // The type checker is held to the same rule: it never throws, and a bug of its own never shows up as a diagnostic.
  const parsed = parse(source);
  if (parsed.diagnostics.length === 0) {
    const checked = check(parsed.program);
    for (const d of checked.diagnostics) {
      expect(d.message.startsWith("internal error"), `${d.message}\n${where}`).toBe(false);
      expect(d.span.start.offset, where).toBeGreaterThanOrEqual(0);
      expect(d.span.end.offset, where).toBeLessThanOrEqual(source.length);
    }
  }
}

describe("fuzzing (AC-23)", () => {
  it("never throws on 1,000 mutations of the sample programs", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const random = mulberry32(seed);
      checkSound(mutate(random), `mutation #${seed}`);
    }
  });

  it("never throws on 500 random soups of tokens", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 500; seed++) {
      const random = mulberry32(100_000 + seed);
      checkSound(soup(random), `soup #${seed}`);
    }
  });

  it("still runs the unmodified bases cleanly", () => {
    for (const [i, base] of BASES.entries()) {
      const result = run(base);
      expect(result.ran, `base #${i}`).toBe(true);
      expect(result.diagnostics.some((d) => d.message.startsWith("internal error")), `base #${i}`).toBe(false);
    }
  });

  it("is deterministic: the same seed makes the same program", () => {
    expect(mutate(mulberry32(42))).toBe(mutate(mulberry32(42)));
    expect(soup(mulberry32(7))).toBe(soup(mulberry32(7)));
  });
});
