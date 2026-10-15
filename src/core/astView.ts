import type { Expression, Initializer, Node, Program, Statement, TypeRef } from "./parser/ast";
import type { Span } from "./span";

/** The syntax tree in a form the interface can draw and send between threads (AC-29). */
export interface AstNode {
  /** The node kind: `VarDecl`, `Binary`... */
  readonly kind: string;
  /** A short description: `int x`, `+`, `10`. */
  readonly label: string;
  readonly span: Span;
  readonly children: AstNode[];
}

const type = (ref: TypeRef | null): string => (ref === null ? "var" : ref.name + "[]".repeat(ref.dims));

function leaf(kind: string, label: string, span: Span): AstNode {
  return { kind, label, span, children: [] };
}

function node(kind: string, label: string, span: Span, children: readonly (AstNode | null)[]): AstNode {
  return { kind, label, span, children: children.filter((child): child is AstNode => child !== null) };
}

function literalText(expression: Extract<Expression, { kind: "Literal" }>): string {
  if (expression.literalType === "string") return JSON.stringify(expression.value);
  if (expression.literalType === "char") return `'${String(expression.value)}'`;
  return String(expression.value);
}

function expressionView(expression: Initializer): AstNode {
  const { span } = expression;
  switch (expression.kind) {
    case "Literal":
      return leaf("Literal", literalText(expression), span);
    case "Identifier":
      return leaf("Identifier", expression.name, span);
    case "Group":
      return node("Group", "( )", span, [expressionView(expression.expression)]);
    case "Unary":
      return node("Unary", expression.op, span, [expressionView(expression.operand)]);
    case "Binary":
      return node("Binary", expression.op, span, [expressionView(expression.left), expressionView(expression.right)]);
    case "Ternary":
      return node("Ternary", "?:", span, [
        expressionView(expression.condition),
        expressionView(expression.whenTrue),
        expressionView(expression.whenFalse),
      ]);
    case "Assign":
      return node("Assign", expression.op, span, [expressionView(expression.target), expressionView(expression.value)]);
    case "Call":
      return node("Call", "call", span, [expressionView(expression.callee), ...expression.args.map(expressionView)]);
    case "Index":
      return node("Index", "[ ]", span, [expressionView(expression.target), expressionView(expression.index)]);
    case "Member":
      return node("Member", `.${expression.name}`, span, [expressionView(expression.object)]);
    case "NewArray":
      return node("NewArray", `new ${expression.elementType}${"[]".repeat(expression.sizes.length)}`, span, expression.sizes.map(expressionView));
    case "StructLiteral":
      return node(
        "StructLiteral",
        expression.structName,
        span,
        expression.fields.map((field) => node("Field", field.name, field.nameSpan, [expressionView(field.value)])),
      );
    case "ArrayLiteral":
      return node("ArrayLiteral", `{ } ${expression.elements.length}`, span, expression.elements.map(expressionView));
  }
}

function statementView(statement: Statement): AstNode {
  const { span } = statement;
  switch (statement.kind) {
    case "Block":
      return node("Block", "{ }", span, statement.body.map(statementView));
    case "ExprStmt":
      return node("ExprStmt", "expression", span, [expressionView(statement.expression)]);
    case "Update":
      return node("Update", statement.op, span, [expressionView(statement.target)]);
    case "Print":
      return node("Print", "System.out.println", span, statement.args.map(expressionView));
    case "If":
      return node("If", "if", span, [
        expressionView(statement.condition),
        statementView(statement.then),
        statement.otherwise ? statementView(statement.otherwise) : null,
      ]);
    case "While":
      return node("While", "while", span, [expressionView(statement.condition), statementView(statement.body)]);
    case "For":
      return node("For", "for", span, [
        statement.init ? statementView(statement.init) : null,
        expressionView(statement.condition),
        statement.update.kind === "Update" ? statementView(statement.update) : expressionView(statement.update),
        statementView(statement.body),
      ]);
    case "Foreach":
      return node("Foreach", `for ${type(statement.varType)} ${statement.name} :`, span, [
        expressionView(statement.iterable),
        statementView(statement.body),
      ]);
    case "Switch":
      return node("Switch", "switch", span, [
        expressionView(statement.discriminant),
        ...statement.cases.map((branch) =>
          node("Case", "case", branch.span, [expressionView(branch.test), ...branch.body.map(statementView)]),
        ),
        statement.default ? node("Default", "default", statement.default.span, statement.default.body.map(statementView)) : null,
      ]);
    case "Break":
      return leaf("Break", "break", span);
    case "Continue":
      return leaf("Continue", "continue", span);
    case "Return":
      return node("Return", "return", span, [statement.value ? expressionView(statement.value) : null]);
    case "VarDecl":
      return node("VarDecl", `${type(statement.declaredType)} ${statement.name}`, span, [statement.init ? expressionView(statement.init) : null]);
    case "FuncDecl":
      return node(
        "FuncDecl",
        `${type(statement.returnType)} ${statement.name}(${statement.params.map((p) => `${type(p.type)} ${p.name}`).join(", ")})`,
        span,
        [statementView(statement.body)],
      );
    case "StructDecl":
      return node(
        "StructDecl",
        `struct ${statement.name}`,
        span,
        statement.fields.map((field) => leaf("Field", `${type(field.type)} ${field.name}`, field.nameSpan)),
      );
  }
}

export function toAstView(program: Program): AstNode {
  return node("Program", "program", program.span, program.body.map(statementView));
}

/** How many nodes the tree has (used by tests and by the interface to warn about huge trees). */
export function countNodes(view: AstNode): number {
  return 1 + view.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export type { Node };
