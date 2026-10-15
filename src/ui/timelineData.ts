import type { Series } from "../core/trace/series";
import type { Trace } from "../core/trace/types";

export interface LaneSeries {
  readonly name: string;
  /** The value at the end of each column, from 0 (the series minimum) to 1 (its maximum); NaN where it does not exist yet. */
  readonly value: Float32Array;
}

/**
 * The whole trace squeezed into `columns` columns, ready to draw. Every step belongs to exactly one column.
 * A column is summarised by what was true at its last step (the line, a variable) or by counting what happened
 * in it (conditions): with a dozen steps in a column, a min-max band would simply fill the lane.
 */
export interface LaneData {
  readonly columns: number;
  readonly steps: number;
  /** The source line running at the end of each column, from 0 (first line) to 1 (last line); NaN for an empty column. */
  readonly line: Float32Array;
  /** Of the conditions evaluated in each column, the share that held (0 to 1); NaN when there were none. */
  readonly heldShare: Float32Array;
  /** How much of the output had been printed by the end of the column, 0 to 1. */
  readonly output: Float32Array;
  readonly series: LaneSeries[];
}

export function columnOfStep(step: number, steps: number, columns: number): number {
  return Math.min(columns - 1, Math.floor((step * columns) / steps));
}

export function stepOfFraction(fraction: number, steps: number): number {
  return Math.max(0, Math.min(steps - 1, Math.floor(fraction * steps)));
}

export function computeLanes(trace: Trace, series: readonly Series[], lineCount: number, totalOutput: number, width: number): LaneData {
  const steps = trace.steps.length;
  const columns = Math.max(1, Math.min(Math.floor(width), steps));
  const line = new Float32Array(columns).fill(Number.NaN);
  const held = new Uint32Array(columns);
  const tested = new Uint32Array(columns);
  const output = new Float32Array(columns);
  const values = series.map(() => new Float32Array(columns).fill(Number.NaN));
  const lineSpan = Math.max(1, lineCount - 1);

  for (let k = 0; k < steps; k++) {
    const step = trace.steps[k] as Trace["steps"][number];
    const c = columnOfStep(k, steps, columns);
    if (step.kind !== "end") line[c] = (step.span.start.line - 1) / lineSpan;
    if (step.kind === "condition") {
      tested[c] = (tested[c] as number) + 1;
      if (step.note === "true") held[c] = (held[c] as number) + 1;
    }
    output[c] = totalOutput > 0 ? step.outputLength / totalOutput : 0;
    series.forEach((s, i) => {
      const v = s.values[k] as number;
      if (Number.isNaN(v)) return;
      (values[i] as Float32Array)[c] = (v - s.min) / (s.max - s.min || 1);
    });
  }
  const heldShare = new Float32Array(columns);
  for (let c = 0; c < columns; c++) heldShare[c] = (tested[c] as number) === 0 ? Number.NaN : (held[c] as number) / (tested[c] as number);
  return { columns, steps, line, heldShare, output, series: series.map((s, i) => ({ name: s.name, value: values[i] as Float32Array })) };
}
