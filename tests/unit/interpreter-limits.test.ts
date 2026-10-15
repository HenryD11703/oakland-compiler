import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../../src/core/interpreter/limits";
import { interpret } from "../../src/core/interpreter/interpreter";
import { parse } from "../../src/core/parser/parser";
import { runOak } from "../helpers/run";

describe("limits (AC-24, core part)", () => {
  it("stops an infinite loop with a diagnostic and keeps the output so far", () => {
    const started = Date.now();
    const result = runOak('System.out.println("before"); while (true) { } System.out.println("after");');
    expect(Date.now() - started).toBeLessThan(5500);
    expect(result.stdout).toBe("before\n");
    expect(result.stoppedEarly).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.phase).toBe("runtime");
    expect(result.diagnostics[0]?.message).toContain("step limit reached");
    expect(result.diagnostics[0]?.span.start.line).toBe(1);
  });

  it("points at the statement that was running", () => {
    const result = runOak("int i = 0;\nwhile (true) {\n  i = i + 1;\n}");
    expect(result.diagnostics[0]?.span.start.line).toBeGreaterThanOrEqual(2);
  });

  it("honours a lower step limit", () => {
    const result = runOak("int i = 0; while (i < 1000) { i++; }", { maxSteps: 100 });
    expect(result.stoppedEarly).toBe(true);
    expect(result.diagnostics[0]?.message).toContain("step limit reached (100 steps)");
  });

  it("stops on the time limit using the clock it is given", () => {
    const program = parse("while (true) { }").program;
    let time = 0;
    const result = interpret(program, { maxSteps: Number.MAX_SAFE_INTEGER, maxTimeMs: 5000 }, () => (time += 1000));
    expect(result.stoppedEarly).toBe(true);
    expect(result.diagnostics[0]?.message).toContain("time limit reached (5 s)");
  });

  it("stops when too much is printed, keeping what fit", () => {
    const result = runOak('while (true) { System.out.println("0123456789"); }', { maxOutputChars: 100 });
    expect(result.stoppedEarly).toBe(true);
    expect(result.diagnostics[0]?.message).toContain("output limit reached (100 characters)");
    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.stdout.length).toBeGreaterThan(80);
  });

  it("stops deep recursion at the depth limit", () => {
    const result = runOak("void f() { f(); } f();", { maxDepth: 50 });
    expect(result.diagnostics[0]?.message).toBe("stack overflow: more than 50 calls nested inside each other");
  });

  it("uses documented defaults", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxSteps: 20_000_000,
      maxTimeMs: 5_000,
      maxDepth: 1_000,
      maxOutputChars: 200_000,
      maxArrayElements: 1_000_000,
    });
  });

  it("reports how many steps a normal program used", () => {
    const result = runOak("int x = 1 + 2;");
    expect(result.steps).toBeGreaterThan(0);
    expect(result.stoppedEarly).toBe(false);
  });
});

describe("a program with syntax errors does not run", () => {
  it("returns the syntax diagnostics and no output", () => {
    const result = runOak('System.out.println("x"); int y = ;');
    expect(result.ran).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.diagnostics.map((d) => d.phase)).toEqual(["syntax"]);
  });
});

describe("nothing a user types escapes as an exception (principle 2)", () => {
  it("rejects absurd nesting of parentheses with a diagnostic", async () => {
    const { MAX_NESTING } = await import("../../src/core/parser/parser");
    const deep = `System.out.println(${"(".repeat(MAX_NESTING + 10)}1${")".repeat(MAX_NESTING + 10)});`;
    const result = runOak(deep);
    expect(result.ran).toBe(false);
    expect(result.diagnostics[0]?.phase).toBe("syntax");
    expect(result.diagnostics[0]?.message).toContain("nested too deeply");
  });

  it("rejects absurd nesting of blocks", () => {
    const result = runOak("{".repeat(400) + "}".repeat(400));
    expect(result.ran).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts reasonable nesting", () => {
    expect(runOak(`System.out.println(${"(".repeat(100)}1${")".repeat(100)});`).stdout).toBe("1\n");
  });

  it("reports a JavaScript stack overflow inside the interpreter as a diagnostic", () => {
    const heavy = `
      int deep(int n) {
        if (n == 0) { return 0; }
        for (int i = 0; i < 1; i++) { switch (n) { default: { if (true) { while (true) { return 1 + deep(n - 1); } } } } }
        return -1;
      }
      System.out.println(deep(990));`;
    const result = runOak(heavy);
    // Either it completes, or the host stack ran out first and that is said clearly; it never throws.
    if (result.diagnostics.length > 0) {
      expect(result.diagnostics[0]?.message).toMatch(/stack overflow/);
      expect(result.stoppedEarly).toBe(true);
    } else {
      expect(result.stdout).toBe("990\n");
    }
  });

  it("copes with a very long chain of operators", () => {
    const chain = Array.from({ length: 5000 }, () => "1").join(" + ");
    expect(runOak(`System.out.println(${chain});`).stdout).toBe("5000\n");
  });
});
