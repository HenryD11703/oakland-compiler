import type { Span } from "../span";

/** `int`, `string[]`, `Person[][]`. `name` is a primitive, a struct name, or `void` (functions only). */
export interface TypeRef {
  readonly kind: "TypeRef";
  readonly name: string;
  /** Number of `[]` pairs. */
  readonly dims: number;
  readonly span: Span;
}

// ---------- expressions ----------

export type LiteralType = "int" | "float" | "string" | "char" | "boolean" | "null";

export interface Literal {
  readonly kind: "Literal";
  readonly literalType: LiteralType;
  readonly value: number | string | boolean | null;
  readonly span: Span;
}

export interface Identifier {
  readonly kind: "Identifier";
  readonly name: string;
  readonly span: Span;
}

export interface Group {
  readonly kind: "Group";
  readonly expression: Expression;
  readonly span: Span;
}

export type UnaryOp = "-" | "!" | "typeof";
export interface Unary {
  readonly kind: "Unary";
  readonly op: UnaryOp;
  readonly operand: Expression;
  readonly span: Span;
}

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
export interface Binary {
  readonly kind: "Binary";
  readonly op: BinaryOp;
  readonly left: Expression;
  readonly right: Expression;
  readonly span: Span;
}

export interface Ternary {
  readonly kind: "Ternary";
  readonly condition: Expression;
  readonly whenTrue: Expression;
  readonly whenFalse: Expression;
  readonly span: Span;
}

/** What can be on the left of `=`, `+=`, `-=`, `++` and `--`. */
export type LValue = Identifier | Index | Member;

export type AssignOp = "=" | "+=" | "-=";
export interface Assign {
  readonly kind: "Assign";
  readonly op: AssignOp;
  readonly target: LValue;
  readonly value: Expression;
  readonly span: Span;
}

export interface Call {
  readonly kind: "Call";
  readonly callee: Expression;
  readonly args: readonly Expression[];
  readonly span: Span;
}

/** `a[i]`. A matrix access `m[i][j]` is an Index of an Index. */
export interface Index {
  readonly kind: "Index";
  readonly target: Expression;
  readonly index: Expression;
  readonly span: Span;
}

/** `p.name`, `list.length`. `.indexOf(x)` and `.join()` are a Call whose callee is a Member. */
export interface Member {
  readonly kind: "Member";
  readonly object: Expression;
  readonly name: string;
  readonly nameSpan: Span;
  readonly span: Span;
}

/** `new int[5]`, `new int[2][3]`. `elementType` is the type name without dimensions. */
export interface NewArray {
  readonly kind: "NewArray";
  readonly elementType: string;
  readonly sizes: readonly Expression[];
  readonly span: Span;
}

/** `{1, 2, 3}` or `{{1, 2}, {3, 4}}`. Only valid as the initial value of a declaration. */
export interface ArrayLiteral {
  readonly kind: "ArrayLiteral";
  readonly elements: readonly Initializer[];
  readonly span: Span;
}

export interface FieldInit {
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: Expression;
}

/** `Person{name: "Ana", age: 20}` */
export interface StructLiteral {
  readonly kind: "StructLiteral";
  readonly structName: string;
  readonly fields: readonly FieldInit[];
  readonly span: Span;
}

export type Expression =
  | Literal
  | Identifier
  | Group
  | Unary
  | Binary
  | Ternary
  | Assign
  | Call
  | Index
  | Member
  | NewArray
  | StructLiteral;

export type Initializer = Expression | ArrayLiteral;

// ---------- statements and declarations ----------

export interface Block {
  readonly kind: "Block";
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface ExprStmt {
  readonly kind: "ExprStmt";
  readonly expression: Expression;
  readonly span: Span;
}

/** `i++;` `p.age--;` Only allowed as a statement and in the update part of a `for`. */
export interface Update {
  readonly kind: "Update";
  readonly op: "++" | "--";
  readonly target: LValue;
  readonly span: Span;
}

export interface Print {
  readonly kind: "Print";
  readonly args: readonly Expression[];
  readonly span: Span;
}

export interface If {
  readonly kind: "If";
  readonly condition: Expression;
  readonly then: Statement;
  readonly otherwise: Statement | null;
  readonly span: Span;
}

export interface While {
  readonly kind: "While";
  readonly condition: Expression;
  readonly body: Statement;
  readonly span: Span;
}

export interface For {
  readonly kind: "For";
  readonly init: VarDecl | ExprStmt | null;
  readonly condition: Expression;
  readonly update: Expression | Update;
  readonly body: Statement;
  readonly span: Span;
}

/** `for (int v : list)`. `varType` is null for `var`. */
export interface Foreach {
  readonly kind: "Foreach";
  readonly varType: TypeRef | null;
  readonly name: string;
  readonly nameSpan: Span;
  readonly iterable: Expression;
  readonly body: Statement;
  readonly span: Span;
}

export interface SwitchCase {
  readonly test: Expression;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface SwitchDefault {
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface Switch {
  readonly kind: "Switch";
  readonly discriminant: Expression;
  readonly cases: readonly SwitchCase[];
  readonly default: SwitchDefault | null;
  readonly span: Span;
}

export interface Break {
  readonly kind: "Break";
  readonly span: Span;
}

export interface Continue {
  readonly kind: "Continue";
  readonly span: Span;
}

export interface Return {
  readonly kind: "Return";
  readonly value: Expression | null;
  readonly span: Span;
}

/** `int x = 1;` `int[] a = {1, 2};` `var v = 2.5;` (`declaredType` is null for `var`) `Person p;` */
export interface VarDecl {
  readonly kind: "VarDecl";
  readonly declaredType: TypeRef | null;
  readonly name: string;
  readonly nameSpan: Span;
  readonly init: Initializer | null;
  readonly span: Span;
}

export interface Param {
  readonly type: TypeRef;
  readonly name: string;
  readonly nameSpan: Span;
}

export interface FuncDecl {
  readonly kind: "FuncDecl";
  readonly returnType: TypeRef;
  readonly name: string;
  readonly nameSpan: Span;
  readonly params: readonly Param[];
  readonly body: Block;
  readonly span: Span;
}

export interface FieldDecl {
  readonly type: TypeRef;
  readonly name: string;
  readonly nameSpan: Span;
}

export interface StructDecl {
  readonly kind: "StructDecl";
  readonly name: string;
  readonly nameSpan: Span;
  readonly fields: readonly FieldDecl[];
  readonly span: Span;
}

export type Statement =
  | Block
  | ExprStmt
  | Update
  | Print
  | If
  | While
  | For
  | Foreach
  | Switch
  | Break
  | Continue
  | Return
  | VarDecl
  | FuncDecl
  | StructDecl;

export interface Program {
  readonly kind: "Program";
  readonly body: readonly Statement[];
  readonly span: Span;
}

export type Node = Program | Statement | Expression | ArrayLiteral | TypeRef;
