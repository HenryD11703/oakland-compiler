import type { Trace } from "./types";

/** The value of one numeric variable at the end of every step; `NaN` before it exists. */
export interface Series {
  readonly name: string;
  readonly type: "int" | "float";
  readonly values: Float64Array;
  readonly min: number;
  readonly max: number;
}

const isNumber = (type: string): type is "int" | "float" => type === "int" || type === "float";

/**
 * The numeric variables that change most over the run, as one value per step, for the timeline.
 * Variables with the same name (a loop body declares its own each time round) are one series.
 */
export function numericSeries(trace: Trace, limit = 2): Series[] {
  const names = new Map<number, { name: string; type: "int" | "float" }>();
  const changes = new Map<string, number>();
  const types = new Map<string, "int" | "float">();

  for (const step of trace.steps) {
    for (const event of step.events) {
      if (event.t === "declare" && isNumber(event.variable.type)) {
        names.set(event.variable.id, { name: event.variable.name, type: event.variable.type });
        types.set(event.variable.name, event.variable.type);
        if ("text" in event.variable.value) changes.set(event.variable.name, (changes.get(event.variable.name) ?? 0) + 1);
      } else if (event.t === "set-var") {
        const known = names.get(event.id);
        if (known && "text" in event.value) changes.set(known.name, (changes.get(known.name) ?? 0) + 1);
      }
    }
  }

  const chosen = [...changes]
    .filter(([name]) => types.has(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
  if (chosen.length === 0) return [];

  const count = trace.steps.length;
  const columns = new Map(chosen.map((name) => [name, new Float64Array(count).fill(Number.NaN)]));
  const current = new Map<string, number>();
  const idNames = new Map<number, string>();

  for (let k = 0; k < count; k++) {
    for (const event of (trace.steps[k] as Trace["steps"][number]).events) {
      if (event.t === "declare") {
        idNames.set(event.variable.id, event.variable.name);
        if (columns.has(event.variable.name) && "text" in event.variable.value) {
          const value = Number(event.variable.value.text);
          if (!Number.isNaN(value)) current.set(event.variable.name, value);
        }
      } else if (event.t === "set-var") {
        const name = idNames.get(event.id);
        if (name !== undefined && columns.has(name) && "text" in event.value) {
          const value = Number(event.value.text);
          if (!Number.isNaN(value)) current.set(name, value);
        }
      }
    }
    for (const name of chosen) {
      const value = current.get(name);
      if (value !== undefined) (columns.get(name) as Float64Array)[k] = value;
    }
  }

  return chosen.map((name) => {
    const values = columns.get(name) as Float64Array;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of values) {
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { name, type: types.get(name) as "int" | "float", values, min, max };
  });
}
