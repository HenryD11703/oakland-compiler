import { describe, expect, it } from "vitest";
import { run } from "../../src/core/run";
import { numericSeries } from "../../src/core/trace/series";
import type { Trace } from "../../src/core/trace/types";
import { assignedNames } from "../../src/ui/inlineValues";
import { columnOfStep, computeLanes, stepOfFraction } from "../../src/ui/timelineData";

describe("variables shown next to the code", () => {
  it("finds what each line declares or assigns", () => {
    const source = ["int a = 1;", "a = a + 1;", "int[] xs = {1};", "xs[0] = 5;", "a++;", "System.out.println(a);", "float f; f = 2;"].join("\n");
    const names = assignedNames(run(source).ast);
    expect(names.get(1)).toEqual(["a"]);
    expect(names.get(2)).toEqual(["a"]);
    expect(names.get(3)).toEqual(["xs"]);
    expect(names.has(4)).toBe(false); // an element, not a variable
    expect(names.get(5)).toEqual(["a"]);
    expect(names.has(6)).toBe(false);
    expect(names.get(7)).toEqual(["f"]);
  });

  it("looks inside blocks, loops and functions", () => {
    const names = assignedNames(run("int f(int n) {\n  int r = n;\n  return r;\n}\nfor (int i = 0; i < 2; i++) {\n  int k = i;\n}").ast);
    expect(names.get(2)).toEqual(["r"]);
    expect(names.get(5)).toEqual(["i"]);
    expect(names.get(6)).toEqual(["k"]);
  });
});

describe("timeline lanes", () => {
  const source = "int total = 0;\nfor (int i = 0; i < 4; i++) {\n  total += i;\n  System.out.println(total);\n}";
  const result = run(source);
  const trace = result.trace as Trace;
  const series = numericSeries(trace);
  const lanes = computeLanes(trace, series, 5, result.stdout.length, 1000);

  it("has one column per step when there are fewer steps than pixels", () => {
    expect(lanes.columns).toBe(trace.steps.length);
    expect(lanes.steps).toBe(trace.steps.length);
  });

  it("squeezes into the given width when there are more steps", () => {
    const narrow = computeLanes(trace, series, 5, result.stdout.length, 6);
    expect(narrow.columns).toBe(6);
    expect(narrow.output).toHaveLength(6);
  });

  it("records the line running at the end of each column, from 0 (first line) to 1 (last line)", () => {
    const known = [...lanes.line].filter((v) => !Number.isNaN(v));
    expect(Math.min(...known)).toBe(0);
    expect(Math.max(...known)).toBe(3 / 4); // the last line that runs is line 4 of 5
    expect(Number.isNaN(lanes.line[lanes.columns - 1] as number)).toBe(true); // the "end" step runs no line
  });

  it("gives the share of conditions that held in each column", () => {
    const shares = [...lanes.heldShare].filter((v) => !Number.isNaN(v));
    expect(shares).toHaveLength(5); // four tests that held and the one that ended the loop
    expect(shares.filter((v) => v === 1)).toHaveLength(4);
    expect(shares.filter((v) => v === 0)).toHaveLength(1);
  });

  it("averages conditions when many steps share a column", () => {
    const narrow = computeLanes(trace, series, 5, result.stdout.length, 1);
    expect(narrow.heldShare[0]).toBeCloseTo(4 / 5);
  });

  it("accumulates the output up to 1", () => {
    for (let c = 1; c < lanes.columns; c++) expect(lanes.output[c] as number).toBeGreaterThanOrEqual(lanes.output[c - 1] as number);
    expect(lanes.output[lanes.columns - 1]).toBe(1);
  });

  it("normalises each series between its smallest and largest value", () => {
    const total = lanes.series.find((s) => s.name === "total");
    expect(total).toBeDefined();
    const known = [...(total?.value ?? new Float32Array())].filter((v) => !Number.isNaN(v));
    expect(Math.max(...known)).toBe(1);
    expect(Math.min(...known)).toBe(0);
  });

  it("maps steps to columns and positions to steps", () => {
    expect(columnOfStep(0, 100, 10)).toBe(0);
    expect(columnOfStep(99, 100, 10)).toBe(9);
    expect(columnOfStep(50, 100, 10)).toBe(5);
    expect(stepOfFraction(0, 100)).toBe(0);
    expect(stepOfFraction(1, 100)).toBe(99);
    expect(stepOfFraction(0.5, 100)).toBe(50);
    expect(stepOfFraction(-1, 100)).toBe(0);
  });
});
