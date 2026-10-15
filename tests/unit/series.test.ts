import { describe, expect, it } from "vitest";
import { run } from "../../src/core/run";
import { numericSeries } from "../../src/core/trace/series";
import type { Trace } from "../../src/core/trace/types";

const seriesOf = (source: string, limit?: number) => {
  const trace = run(source).trace as Trace;
  return { trace, series: numericSeries(trace, limit) };
};

describe("numeric series for the timeline", () => {
  it("gives the value of a variable at the end of every step", () => {
    const { trace, series } = seriesOf("int x = 1; x = 5; x = 5 + 2;");
    expect(series).toHaveLength(1);
    expect(series[0]?.name).toBe("x");
    expect([...(series[0]?.values ?? [])]).toEqual([1, 5, 7, 7]);
    expect(series[0]?.values.length).toBe(trace.steps.length);
    expect([series[0]?.min, series[0]?.max]).toEqual([1, 7]);
  });

  it("is not a number before the variable exists", () => {
    const { series } = seriesOf("System.out.println(1); int late = 4;");
    expect(Number.isNaN(series[0]?.values[0] ?? 0)).toBe(true);
    expect(series[0]?.values[1]).toBe(4);
  });

  it("keeps the ones that change most, and ignores text", () => {
    const { series } = seriesOf('string s = "a"; int a = 0; int b = 0; for (int i = 0; i < 5; i++) { a += 1; }', 2);
    expect(series.map((s) => s.name).sort()).toEqual(["a", "i"]);
  });

  it("treats a variable a loop re-declares each time as one series", () => {
    const { series } = seriesOf("for (int r = 0; r < 3; r++) { float j = r * 10; j = j + 1; }", 3);
    const j = series.find((s) => s.name === "j");
    expect(j).toBeDefined();
    expect(j?.max).toBe(21);
  });

  it("is empty when nothing numeric changes", () => {
    expect(seriesOf('string s = "a";').series).toEqual([]);
  });
});
