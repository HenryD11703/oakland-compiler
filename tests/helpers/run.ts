import { expect } from "vitest";
import type { RunLimits } from "../../src/core/interpreter/limits";
import { run, type RunResult } from "../../src/core/run";

export function runOak(source: string, limits: Partial<RunLimits> = {}): RunResult {
  return run(source, { limits });
}

/** Runs a program that must have no diagnostics and returns what it printed (without the final newline). */
export function out(source: string, limits: Partial<RunLimits> = {}): string {
  const result = runOak(source, limits);
  expect(result.diagnostics.map((d) => `${d.span.start.line}:${d.span.start.column} ${d.message}`)).toEqual([]);
  return result.stdout.replace(/\n$/, "");
}

/** Runs a program and returns its diagnostic messages. */
export function problems(source: string, limits: Partial<RunLimits> = {}): string[] {
  return runOak(source, limits).diagnostics.map((d) => d.message);
}
