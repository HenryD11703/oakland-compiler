import type { ArrayLiteral, ClassMember, Initializer, Program, Statement, TypeRef } from "../../src/core/parser/ast";
import { parse } from "../../src/core/parser/parser";

const typeText = (type: TypeRef): string => type.name + "[]".repeat(type.dims);

/** A compact, readable rendering of a syntax tree, used to assert the shape of parse results. */
export function showExpression(node: Initializer): string {
  switch (node.kind) {
    case "Literal":
      if (node.literalType === "string") return JSON.stringify(node.value);
      if (node.literalType === "char") return `'${JSON.stringify(node.value).slice(1, -1)}'`;
      return String(node.value);
    case "Identifier":
      return node.name;
    case "Group":
      return `(group ${showExpression(node.expression)})`;
    case "Unary":
      return `(${node.op} ${showExpression(node.operand)})`;
    case "Binary":
      return `(${node.op} ${showExpression(node.left)} ${showExpression(node.right)})`;
    case "Ternary":
      return `(? ${showExpression(node.condition)} ${showExpression(node.whenTrue)} ${showExpression(node.whenFalse)})`;
    case "Assign":
      return `(${node.op} ${showExpression(node.target)} ${showExpression(node.value)})`;
    case "Call":
      return `(call ${[node.callee, ...node.args].map(showExpression).join(" ")})`;
    case "Index":
      return `(idx ${showExpression(node.target)} ${showExpression(node.index)})`;
    case "Member":
      return `(. ${showExpression(node.object)} ${node.name})`;
    case "NewArray":
      return `(new ${[node.elementType, ...node.sizes.map(showExpression)].join(" ")})`;
    case "StructLiteral":
      return `(struct ${[node.structName, ...node.fields.map((f) => `${f.name}:${showExpression(f.value)}`)].join(" ")})`;
    case "ArrayLiteral":
      return `{${(node as ArrayLiteral).elements.map(showExpression).join(" ")}}`;
    case "This":
      return "this";
    case "Super":
      return "super";
    case "SuperCall":
      return `(super ${node.args.map(showExpression).join(" ")})`.replace("(super )", "(super)");
    case "NewObject":
      return `(new ${[node.className, ...node.args.map(showExpression)].join(" ")})`;
  }
}

export function showMember(node: ClassMember): string {
  const params = (list: readonly { type: TypeRef; name: string }[]): string => list.map((p) => `${typeText(p.type)} ${p.name}`).join(" ");
  const access = node.access === "private" ? "private " : "";
  switch (node.kind) {
    case "ClassField":
      return `(${access}field ${typeText(node.type)} ${node.name}${node.init ? " " + showExpression(node.init) : ""})`;
    case "MethodDecl":
      return `(${access}method ${typeText(node.returnType)} ${node.name} (${params(node.params)}) ${showStatement(node.body)})`;
    case "CtorDecl":
      return `(${access}ctor ${node.name} (${params(node.params)}) ${showStatement(node.body)})`;
  }
}

export function showStatement(node: Statement): string {
  const list = (items: readonly Statement[]): string => items.map(showStatement).join(" ");
  const join = (...parts: string[]): string => parts.filter((p) => p !== "").join(" ");
  switch (node.kind) {
    case "Block":
      return `(${join("block", list(node.body))})`;
    case "ExprStmt":
      return `(expr ${showExpression(node.expression)})`;
    case "Update":
      return `(${node.op} ${showExpression(node.target)})`;
    case "Print":
      return `(${join("print", node.args.map(showExpression).join(" "))})`;
    case "If":
      return `(${join("if", showExpression(node.condition), showStatement(node.then), node.otherwise ? showStatement(node.otherwise) : "")})`;
    case "While":
      return `(while ${showExpression(node.condition)} ${showStatement(node.body)})`;
    case "For": {
      const init = node.init ? showStatement(node.init) : "_";
      const update = node.update.kind === "Update" ? showStatement(node.update) : showExpression(node.update);
      return `(for ${init} ${showExpression(node.condition)} ${update} ${showStatement(node.body)})`;
    }
    case "Foreach":
      return `(foreach ${node.varType ? typeText(node.varType) : "var"} ${node.name} ${showExpression(node.iterable)} ${showStatement(node.body)})`;
    case "Switch": {
      const cases = node.cases.map((c) => `(${join("case", showExpression(c.test), list(c.body))})`);
      const fallback = node.default ? [`(${join("default", list(node.default.body))})`] : [];
      return `(${join("switch", showExpression(node.discriminant), ...cases, ...fallback)})`;
    }
    case "Break":
      return "(break)";
    case "Continue":
      return "(continue)";
    case "Return":
      return `(${join("return", node.value ? showExpression(node.value) : "")})`;
    case "VarDecl":
      return `(${join("var", node.declaredType ? typeText(node.declaredType) : "var", node.name, node.init ? showExpression(node.init) : "")})`;
    case "FuncDecl": {
      const params = node.params.map((p) => `${typeText(p.type)} ${p.name}`).join(" ");
      return `(func ${typeText(node.returnType)} ${node.name} (${params}) ${showStatement(node.body)})`;
    }
    case "StructDecl":
      return `(${join("struct", node.name, ...node.fields.map((f) => `(${typeText(f.type)} ${f.name})`))})`;
    case "ClassDecl":
      return `(${join("class", node.name, node.superName ? `extends ${node.superName}` : "", ...node.members.map(showMember))})`;
  }
}

export function showProgram(program: Program): string {
  return program.body.map(showStatement).join(" ");
}

/** Parses `source`, requires zero diagnostics, and returns the rendered program. */
export function parsesTo(source: string): string {
  const result = parse(source);
  if (result.diagnostics.length > 0) {
    throw new Error(`unexpected diagnostics for ${JSON.stringify(source)}: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return showProgram(result.program);
}

/** Renders a single expression statement (the source must be one expression, without `;`). */
export function expressionOf(source: string): string {
  const result = parse(`${source};`);
  if (result.diagnostics.length > 0) {
    throw new Error(`unexpected diagnostics for ${JSON.stringify(source)}: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  }
  const statement = result.program.body[0];
  if (statement?.kind !== "ExprStmt") throw new Error(`not an expression statement: ${JSON.stringify(source)}`);
  return showExpression(statement.expression);
}
