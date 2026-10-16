import { expect } from "vitest";
import { check, type CheckResult } from "../../src/core/check/check";
import { parse } from "../../src/core/parser/parser";

/** Checks a program that must have no syntax errors. */
export function checked(source: string): CheckResult {
  const parsed = parse(source);
  expect(parsed.diagnostics.map((d) => d.message), `syntax of ${JSON.stringify(source)}`).toEqual([]);
  return check(parsed.program);
}

/** The messages the checker reports for a program. */
export function mistakes(source: string): string[] {
  return checked(source).diagnostics.map((d) => d.message);
}

/** The checker's diagnostics as `line:column message`, for tests that pin the place. */
export function mistakesAt(source: string): string[] {
  return checked(source).diagnostics.map((d) => `${d.span.start.line}:${d.span.start.column} ${d.message}`);
}

/** The static type of one expression (the last statement), with some declarations before it. */
export function typeOf(expression: string, prelude = ""): string {
  const parsed = parse(`${prelude}\n${expression};`);
  expect(parsed.diagnostics.map((d) => d.message), `syntax of ${expression}`).toEqual([]);
  const result = check(parsed.program);
  expect(result.diagnostics.map((d) => d.message), `mistakes in ${expression}`).toEqual([]);
  const last = parsed.program.body[parsed.program.body.length - 1];
  if (last?.kind !== "ExprStmt") throw new Error(`not an expression statement: ${expression}`);
  const type = result.types.get(last.expression);
  if (type === undefined) throw new Error(`no type recorded for ${expression}`);
  return type;
}
