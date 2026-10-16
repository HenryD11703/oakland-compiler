import type { Program, Statement, TypeRef } from "./parser/ast";
import type { Span } from "./span";

export type SymbolKind = "variable" | "array" | "function" | "struct" | "class" | "field" | "method";

/** One name the program declared (AC-30). */
export interface SymbolEntry {
  readonly name: string;
  readonly kind: SymbolKind;
  /** `int`, `string[]`, `Person`; for a function, its signature: `int(int, int)`. */
  readonly type: string;
  /** Where it lives: `global`, `function total`, `function total > for`... */
  readonly scope: string;
  /** Where its name is written in the source. */
  readonly span: Span;
}

/**
 * Collects the symbols as they are declared. A declaration inside a loop runs many times but is one symbol,
 * so entries are told apart by the place they are written.
 */
export class SymbolCollector {
  private readonly entries: SymbolEntry[] = [];
  private readonly seen = new Set<string>();

  add(entry: SymbolEntry): void {
    const key = `${entry.span.start.offset}:${entry.name}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.entries.push(entry);
  }

  toArray(): SymbolEntry[] {
    return this.entries;
  }
}

const typeText = (ref: TypeRef): string => ref.name + "[]".repeat(ref.dims);

/**
 * Every name the source declares, found by reading it, so that functions that are never called and branches
 * that never run still appear (AC-30). Scope names follow the ones the interpreter creates.
 */
export function collectSymbols(program: Program): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  const path = (labels: readonly string[]): string => (labels.length > 1 ? labels.slice(1).join(" > ") : "global");
  const add = (name: string, kind: SymbolKind, type: string, labels: readonly string[], span: Span): void => {
    entries.push({ name, kind, type, scope: path(labels), span });
  };
  const variableKind = (type: string): SymbolKind => (type.endsWith("[]") ? "array" : "variable");

  const visit = (statement: Statement, labels: readonly string[]): void => {
    switch (statement.kind) {
      case "Block":
        statement.body.forEach((child) => visit(child, [...labels, "block"]));
        return;
      case "VarDecl": {
        const type = statement.declaredType ? typeText(statement.declaredType) : "var";
        add(statement.name, variableKind(type), type, labels, statement.nameSpan);
        return;
      }
      case "FuncDecl": {
        const inner = [...labels, `function ${statement.name}`];
        add(statement.name, "function", `${typeText(statement.returnType)}(${statement.params.map((p) => typeText(p.type)).join(", ")})`, labels, statement.nameSpan);
        for (const param of statement.params) add(param.name, variableKind(typeText(param.type)), typeText(param.type), inner, param.nameSpan);
        statement.body.body.forEach((child) => visit(child, inner));
        return;
      }
      case "StructDecl":
        add(statement.name, "struct", statement.name, labels, statement.nameSpan);
        return;
      case "ClassDecl": {
        add(statement.name, "class", statement.superName ? `${statement.name} extends ${statement.superName}` : statement.name, labels, statement.nameSpan);
        const own = [...labels, `class ${statement.name}`];
        for (const member of statement.members) {
          if (member.kind === "ClassField") {
            add(member.name, "field", typeText(member.type), own, member.nameSpan);
            continue;
          }
          const isMethod = member.kind === "MethodDecl";
          const signature = `${isMethod ? typeText(member.returnType) : statement.name}(${member.params.map((p) => typeText(p.type)).join(", ")})`;
          add(member.name, "method", signature, own, member.nameSpan);
          const inner = [...labels, `method ${statement.name}.${isMethod ? member.name : "new"}`];
          for (const param of member.params) add(param.name, variableKind(typeText(param.type)), typeText(param.type), inner, param.nameSpan);
          member.body.body.forEach((child) => visit(child, inner));
        }
        return;
      }
      case "If":
        visit(statement.then, labels);
        if (statement.otherwise) visit(statement.otherwise, labels);
        return;
      case "While":
        visit(statement.body, labels);
        return;
      case "For": {
        const inner = [...labels, "for"];
        if (statement.init?.kind === "VarDecl") visit(statement.init, inner);
        visit(statement.body, inner);
        return;
      }
      case "Foreach": {
        const inner = [...labels, "for-each"];
        const type = statement.varType ? typeText(statement.varType) : "var";
        add(statement.name, variableKind(type), type, inner, statement.nameSpan);
        visit(statement.body, inner);
        return;
      }
      case "Switch": {
        const inner = [...labels, "switch"];
        for (const branch of statement.cases) branch.body.forEach((child) => visit(child, inner));
        statement.default?.body.forEach((child) => visit(child, inner));
        return;
      }
      default:
        return;
    }
  };

  program.body.forEach((statement) => visit(statement, ["global"]));
  return entries;
}

/** The source-order list, with the types the run worked out (`var x = 2.5;` is a float) where it got that far. */
export function mergeSymbols(fromSource: readonly SymbolEntry[], fromRun: readonly SymbolEntry[]): SymbolEntry[] {
  const key = (entry: SymbolEntry): string => `${entry.span.start.offset}:${entry.name}`;
  const ran = new Map(fromRun.map((entry) => [key(entry), entry]));
  return fromSource.map((entry) => ran.get(key(entry)) ?? entry);
}
