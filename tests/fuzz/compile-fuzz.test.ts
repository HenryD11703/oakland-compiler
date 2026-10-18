import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";
import { check } from "../../src/core/check/check";
import { parse } from "../../src/core/parser/parser";
import { run } from "../../src/core/run";
import { BASES, mulberry32, mutate, soup } from "../helpers/fuzz";

/**
 * S-16: `compile()` never throws, whatever the program says, and every module it returns is one the engine accepts.
 * The programs are the mutations and the soups of the interpreter's fuzz test. A program that compiles is also run, but
 * only when the interpreter ended it quickly (a compiled program has no step limit): then neither mode may report an
 * internal error, and when neither reports a mistake they print the same text (S-17).
 */

function checkCompiles(source: string, label: string): void {
  const where = `${label}\n--- source ---\n${source.slice(0, 600)}`;
  let compiled: ReturnType<typeof compile>;
  try {
    compiled = compile(source);
  } catch (error) {
    throw new Error(`compile() threw for ${where}: ${String(error)}`, { cause: error });
  }
  for (const d of compiled.diagnostics) {
    expect(d.message.startsWith("internal error"), `${d.message}\n${where}`).toBe(false);
    expect(d.span.start.offset, where).toBeGreaterThanOrEqual(0);
    expect(d.span.end.offset, where).toBeLessThanOrEqual(source.length);
  }
  expect(compiled.ok, where).toBe(compiled.diagnostics.length === 0);
  if (!compiled.ok) {
    expect(compiled.wasm, where).toBeNull();
    return;
  }
  expect(compiled.wasm, where).not.toBeNull();
  expect(WebAssembly.validate(compiled.wasm as Uint8Array<ArrayBuffer>), where).toBe(true);
  expect(typeof compiled.wat, where).toBe("string");

  const interpreted = run(source, { trace: false, limits: { maxSteps: 300_000, maxTimeMs: 2_000 } });
  if (interpreted.stoppedEarly) return; // it may never end; the compiled program would not stop either
  const ran = runCompiled(compiled);
  for (const d of ran.diagnostics) expect(d.message.startsWith("internal error"), `${d.message}\n${where}`).toBe(false);
  // A program that prints the time of day cannot print the same text twice.
  const printsTime = /\btime\(\)/.test(source);
  if (!printsTime && ran.diagnostics.length === 0 && interpreted.diagnostics.length === 0) expect(ran.stdout, where).toBe(interpreted.stdout);
}

describe("fuzzing the compiler (S-16, S-17)", () => {
  it("never throws, and returns only valid modules, on 1,000 mutations of the sample programs", { timeout: 180_000 }, () => {
    for (let seed = 1; seed <= 1000; seed++) checkCompiles(mutate(mulberry32(seed)), `mutation #${seed}`);
  });

  it("never throws on 500 random soups of tokens", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 500; seed++) checkCompiles(soup(mulberry32(100_000 + seed)), `soup #${seed}`);
  });

  it("compiles every unmodified base program that the type checker accepts", () => {
    let accepted = 0;
    for (const [i, base] of BASES.entries()) {
      const parsed = parse(base);
      if (parsed.diagnostics.length > 0 || check(parsed.program).diagnostics.length > 0) continue; // a sample that is wrong on purpose
      accepted++;
      const compiled = compile(base);
      expect(compiled.diagnostics.map((d) => d.message), `base #${i}`).toEqual([]);
      expect(compiled.ok, `base #${i}`).toBe(true);
    }
    expect(accepted).toBeGreaterThan(5);
  });

  it("answers a very long or deeply nested program with diagnostics, not an exception", () => {
    expect(() => compile("(".repeat(5000))).not.toThrow();
    expect(() => compile("{".repeat(5000) + "}".repeat(5000))).not.toThrow();
    expect(() => compile("int x = " + "1 + ".repeat(20_000) + "1;")).not.toThrow();
    expect(() => compile("System.out.println(1);\n".repeat(20_000))).not.toThrow();
    expect(() => compile("")).not.toThrow();
  });
});
