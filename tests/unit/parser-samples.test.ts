import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/core/lexer/lexer";
import { parse } from "../../src/core/parser/parser";
import type { Span } from "../../src/core/span";

const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
const programs = readdirSync(fixtures).map((file) => [file, readFileSync(join(fixtures, file), "utf8")] as const);

/** Every `span` found under `node` must sit inside the span of the closest enclosing node that has one. */
function checkNesting(node: unknown, parent: Span, path: string, problems: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => checkNesting(child, parent, `${path}[${i}]`, problems));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  let span = parent;
  const own = record["span"] as Span | undefined;
  if (own) {
    if (own.start.offset > own.end.offset) problems.push(`${path}: span ends before it starts`);
    if (own.start.offset < parent.start.offset || own.end.offset > parent.end.offset) {
      problems.push(`${path}: span ${own.start.offset}-${own.end.offset} is outside its parent ${parent.start.offset}-${parent.end.offset}`);
    }
    span = own;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "span" || key === "nameSpan") continue;
    checkNesting(value, span, `${path}.${key}`, problems);
  }
}

describe("the seven original programs (AC-19, parsing part)", () => {
  it.each(programs)("%s parses with no diagnostics", (_file, source) => {
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.program.body.length).toBeGreaterThan(0);
  });

  it.each(programs)("%s: every node's span is well formed and nested", (_file, source) => {
    const { program } = parse(source);
    expect(program.span.start.offset).toBeGreaterThanOrEqual(0);
    expect(program.span.end.offset).toBeLessThanOrEqual(source.length);
    const problems: string[] = [];
    checkNesting(program, program.span, "program", problems);
    expect(problems).toEqual([]);
  });

  it.each(programs)("%s tokenizes without lexical errors", (_file, source) => {
    expect(tokenize(source).diagnostics).toEqual([]);
  });

  it("finds the functions of funciones.oak", () => {
    const source = programs.find(([file]) => file === "funciones.oak")?.[1] ?? "";
    const names = parse(source).program.body.flatMap((s) => (s.kind === "FuncDecl" ? [s.name] : []));
    expect(names.length).toBeGreaterThan(3);
  });
});
