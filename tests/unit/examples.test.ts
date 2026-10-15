import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../src/examples";
import { run } from "../../src/core/run";

const byId = (id: string) => (EXAMPLES.find((e) => e.id === id) as (typeof EXAMPLES)[number]).source;

describe("the examples menu (AC-32)", () => {
  it("has the planned examples, each named and described", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(["hello", "basics", "control-flow", "arrays", "functions", "structs", "heart", "mistakes"]);
    for (const example of EXAMPLES) {
      expect(example.title.length).toBeGreaterThan(0);
      expect(example.blurb.length).toBeGreaterThan(10);
    }
  });

  it.each(EXAMPLES.filter((e) => e.id !== "mistakes").map((e) => [e.id, e.source] as const))("%s runs cleanly", (_id, source) => {
    const result = run(source);
    expect(result.ran).toBe(true);
    expect(result.diagnostics.map((d) => d.message)).toEqual([]);
    expect(result.stoppedEarly).toBe(false);
    expect(result.trace?.truncated).toBe(false);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("hello prints its greeting", () => {
    expect(run(byId("hello")).stdout.split("\n")[0]).toBe("Hello from OakLand!");
  });

  it("basics shows 32-bit and decimal arithmetic", () => {
    const out = run(byId("basics")).stdout;
    expect(out).toContain("7 / 2 = 3");
    expect(out).toContain("7.0 / 2 = 3.5");
    expect(out).toContain("overflow: -2147483648");
  });

  it("functions solves hanoi with seven moves", () => {
    const moves = run(byId("functions")).stdout.split("\n").filter((l) => l.startsWith("move disk"));
    expect(moves).toHaveLength(7);
    expect(run(byId("functions")).stdout).toContain("4! = 24");
  });

  it("structs prints the shared change", () => {
    expect(run(byId("structs")).stdout).toContain("Ana is now 22");
  });

  it("heart draws the same figure as the original sample program", () => {
    const original = readFileSync(join(import.meta.dirname, "..", "golden", "current", "1-ciclos.stdout.txt"), "utf8");
    expect(run(byId("heart")).stdout).toBe(original);
  });

  it("heart has about 13,000 steps, the one to replay", () => {
    const steps = run(byId("heart")).trace?.steps.length ?? 0;
    expect(steps).toBeGreaterThan(12_000);
    expect(steps).toBeLessThan(20_000);
  });

  it("mistakes reports each of its mistakes once and still finishes", () => {
    const result = run(byId("mistakes"));
    expect(result.ran).toBe(true);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "cannot assign string to int",
      "index 5 is out of range for an array of length 3",
      "variable 'total' is not declared",
      "division by zero",
      "'add' expects 2 arguments but got 1",
      "argument 2 of 'add' must be int, but it is string",
      "'count' is already declared in this scope",
    ]);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("done");
  });
});
