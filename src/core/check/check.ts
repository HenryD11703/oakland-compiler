import { ClassTable, type ClassInfo, type FieldInfo, type MethodInfo } from "../classes";
import { compareDiagnostics, diagnostic, type Diagnostic } from "../diagnostics";
import { checkPlacement } from "../interpreter/placement";
import type {
  ArrayLiteral,
  Assign,
  Binary,
  Call,
  ClassDecl,
  CtorDecl,
  Expression,
  For,
  Foreach,
  FuncDecl,
  Identifier,
  Initializer,
  Member,
  NewArray,
  NewObject,
  Param,
  Program,
  Statement,
  StructDecl,
  StructLiteral,
  Switch,
  Ternary,
  Unary,
  Update,
  VarDecl,
} from "../parser/ast";
import type { Span } from "../span";
import { arrayTypeOf, baseTypeOf, elementTypeOf, INT_MAX, isArrayType, isAssignable, isNumeric, isPrimitive, typeNameOf } from "../types";
import { BUILTIN_SIGNATURES } from "./builtins";
import { Scope, type StructSym, type VarSym } from "./scope";

/** What `check()` found out about a program without running it. */
export interface CheckResult {
  /** Every mistake the checker can see, sorted by position: the ones the interpreter finds when it runs, and more. */
  readonly diagnostics: Diagnostic[];
  /** The static type of every expression it looked at (`error` when the expression was wrong). */
  readonly types: ReadonlyMap<Expression, string>;
  readonly classes: ClassTable;
  /** The functions declared at the top level of the program, by name. */
  readonly functions: ReadonlyMap<string, FuncDecl>;
}

const ERROR = "error";

/**
 * Reads a program and works out the type of every expression, without running anything. A program with no
 * diagnostics here is one a compiler can translate: every name is declared, every operation has operands it
 * accepts, a number is never read before it is assigned, and every function returns on every path.
 * It never throws.
 */
export function check(program: Program): CheckResult {
  const checker = new Checker();
  try {
    checker.run(program);
  } catch (error) {
    // The last line of defence of principle 2: a bug in the checker is reported, never thrown.
    checker.report(program.span, `internal error in the type checker: ${error instanceof Error ? error.message : String(error)}`);
  }
  const diagnostics = [...checker.diagnostics, ...checkPlacement(program)];
  const seen = new Set<string>();
  const unique = diagnostics.filter((d) => {
    const key = `${d.phase}|${d.span.start.offset}|${d.span.end.offset}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { diagnostics: unique.sort(compareDiagnostics), types: checker.types, classes: checker.table, functions: checker.functions };
}

/** What the function being checked allows a `return` to do. */
interface FunctionContext {
  readonly name: string;
  readonly returnType: string;
  readonly isConstructor: boolean;
}

/** A name inside a method can be a variable, or a field of `this`. */
type Found = { readonly kind: "sym"; readonly sym: NonNullable<ReturnType<Scope["lookup"]>> } | { readonly kind: "field"; readonly info: FieldInfo };

/** Which variables are certain to hold a value at this point; null when the point cannot be reached. */
type Flow = Set<VarSym> | null;

const cloneFlow = (flow: Flow): Flow => (flow === null ? null : new Set(flow));
const mergeFlows = (a: Flow, b: Flow): Flow => {
  if (a === null) return cloneFlow(b);
  if (b === null) return cloneFlow(a);
  return new Set([...a].filter((sym) => b.has(sym)));
};

/** int, float, boolean and char have no null in compiled code, so they must be assigned before they are read. */
const needsAssignment = (type: string): boolean => type === "int" || type === "float" || type === "boolean" || type === "char";

class Checker {
  readonly diagnostics: Diagnostic[] = [];
  readonly types = new Map<Expression, string>();
  readonly functions = new Map<string, FuncDecl>();
  private readonly seen = new Set<string>();
  private readonly global = new Scope(null);
  private scope: Scope = this.global;
  private flow: Flow = new Set();
  private context: FunctionContext | null = null;
  /** 0 at the top level of the program, one more inside each function, method or constructor. */
  private level = 0;
  private readonly levels = new WeakMap<VarSym, number>();

  readonly table = new ClassTable({
    register: (info) => {
      if (this.global.declare(info)) return true;
      this.report(info.decl.nameSpan, `'${info.name}' is already declared in this scope`);
      return false;
    },
    typeExists: (type) => this.typeExists(type),
    isStruct: (name) => this.global.lookup(name)?.kind === "struct",
    report: (span, message) => this.report(span, message),
  });

  report(span: Span, message: string): void {
    const key = `${span.start.offset}|${span.end.offset}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.diagnostics.push(diagnostic("semantic", message, span));
  }

  run(program: Program): void {
    this.hoist(program.body);
    for (const statement of program.body) this.statement(statement);
  }

  // ---------- types ----------

  private typeExists(type: string): boolean {
    const base = baseTypeOf(type);
    if (isPrimitive(base)) return true;
    const kind = this.scope.lookup(base)?.kind;
    return kind === "struct" || kind === "class";
  }

  private assignable(from: string, to: string): boolean {
    if (from === ERROR || to === ERROR) return true;
    return isAssignable(from, to) || this.table.isSubclass(from, to);
  }

  /** Can `null` be stored in a variable of this type? */
  private isReference(type: string): boolean {
    if (type === "string" || isArrayType(type)) return true;
    const kind = this.scope.lookup(type)?.kind;
    return kind === "struct" || kind === "class";
  }

  private related(a: string, b: string): boolean {
    return this.table.isSubclass(a, b) || this.table.isSubclass(b, a);
  }

  /** Can `==` compare these two types? */
  private comparable(left: string, right: string): boolean {
    if (left === ERROR || right === ERROR) return true;
    if (isNumeric(left) && isNumeric(right)) return true;
    if (left === right) return true;
    if (left === "null") return this.isReference(right);
    if (right === "null") return this.isReference(left);
    return this.related(left, right);
  }

  // ---------- scopes and the flow of assignments ----------

  private inScope<T>(scope: Scope, body: () => T): T {
    const saved = this.scope;
    this.scope = scope;
    try {
      return body();
    } finally {
      this.scope = saved;
    }
  }

  private declareVariable(name: string, type: string, span: Span, assigned: boolean): VarSym | null {
    const sym: VarSym = { kind: "variable", name, type, declaredAt: span, needsAssignment: !assigned && needsAssignment(type) };
    this.levels.set(sym, this.level);
    if (!this.scope.declare(sym)) {
      this.report(span, `'${name}' is already declared in this scope`);
      return null;
    }
    if (assigned || !sym.needsAssignment) this.flow?.add(sym);
    return sym;
  }

  private markAssigned(sym: VarSym): void {
    this.flow?.add(sym);
  }

  /** Reading a number that may not have a value yet is a mistake; so is anything outside the flow of this function. */
  private checkRead(sym: VarSym, span: Span): void {
    if (!sym.needsAssignment || this.flow === null) return;
    if (this.levels.get(sym) !== this.level) return; // a variable of an outer function: not followed across calls
    if (!this.flow.has(sym)) this.report(span, `variable '${sym.name}' is read before it is assigned a value`);
  }

  private lookupName(name: string): Found | undefined {
    for (let scope: Scope | null = this.scope; scope !== null; scope = scope.parent) {
      const own = scope.getOwn(name);
      if (own !== undefined) return { kind: "sym", sym: own };
      const info = scope.thisClass?.fields.find((f) => f.name === name);
      if (info !== undefined) return { kind: "field", info };
    }
    return undefined;
  }

  private canUse(access: "public" | "private", owner: ClassInfo): boolean {
    return access === "public" || this.scope.enclosingClass() === owner;
  }

  // ---------- declarations ----------

  /** Makes the functions, structs and classes of a statement list known before the line that declares them. */
  private hoist(statements: readonly Statement[]): void {
    const structs: { decl: StructDecl; sym: StructSym }[] = [];
    const classes: ClassDecl[] = [];
    for (const statement of statements) {
      if (statement.kind === "StructDecl") {
        const sym: StructSym = { kind: "struct", name: statement.name, decl: statement, fields: [] };
        if (this.scope.declare(sym)) structs.push({ decl: statement, sym });
        else this.report(statement.nameSpan, `'${statement.name}' is already declared in this scope`);
      } else if (statement.kind === "FuncDecl") {
        if (!this.scope.declare({ kind: "function", name: statement.name, decl: statement })) {
          this.report(statement.nameSpan, `'${statement.name}' is already declared in this scope`);
        } else if (this.scope === this.global) {
          this.functions.set(statement.name, statement);
        }
      } else if (statement.kind === "ClassDecl") {
        classes.push(statement);
      }
    }
    if (classes.length > 0) this.table.declare(classes);
    // A field may name a struct declared further down, so the fields are worked out once every struct is known.
    for (const { decl, sym } of structs) {
      for (const field of decl.fields) {
        const type = typeNameOf(field.type);
        if (sym.fields.some((f) => f.name === field.name)) {
          this.report(field.nameSpan, `struct '${decl.name}' already has a field named '${field.name}'`);
          continue;
        }
        if (!this.typeExists(type)) {
          this.report(field.type.span, `unknown type '${baseTypeOf(type)}'`);
          continue;
        }
        sym.fields.push({ name: field.name, type });
      }
    }
  }

  // ---------- statements ----------

  private block(body: readonly Statement[]): void {
    this.inScope(new Scope(this.scope), () => {
      this.hoist(body);
      for (const statement of body) this.statement(statement);
    });
  }

  private statement(stmt: Statement): void {
    switch (stmt.kind) {
      case "Block":
        this.block(stmt.body);
        return;
      case "ExprStmt":
        // A super(...) statement is checked with its constructor; one in a wrong place is reported by placement.ts.
        if (stmt.expression.kind === "SuperCall") return;
        this.expression(stmt.expression, true);
        return;
      case "Update":
        this.update(stmt);
        return;
      case "Print":
        for (const arg of stmt.args) this.expression(arg);
        return;
      case "If":
        this.ifStatement(stmt);
        return;
      case "While":
        this.loop(stmt.condition, () => this.statement(stmt.body), stmt.body);
        return;
      case "For":
        this.forStatement(stmt);
        return;
      case "Foreach":
        this.foreach(stmt);
        return;
      case "Switch":
        this.switchStatement(stmt);
        return;
      case "Break":
      case "Continue":
        this.flow = null;
        return;
      case "Return":
        this.returnStatement(stmt);
        return;
      case "VarDecl":
        this.varDecl(stmt);
        return;
      case "FuncDecl":
        this.callable(stmt, { name: stmt.name, returnType: typeNameOf(stmt.returnType), isConstructor: false }, null, this.scope);
        return;
      case "StructDecl":
        return; // declared by hoist
      case "ClassDecl":
        this.classDecl(stmt);
        return;
    }
  }

  private condition(expression: Expression): void {
    const type = this.expression(expression);
    if (type !== ERROR && type !== "boolean") this.report(expression.span, `the condition must be boolean, but it is ${type}`);
  }

  private ifStatement(stmt: Extract<Statement, { kind: "If" }>): void {
    this.condition(stmt.condition);
    const before = cloneFlow(this.flow);
    this.statement(stmt.then);
    const afterThen = this.flow;
    this.flow = cloneFlow(before);
    if (stmt.otherwise) this.statement(stmt.otherwise);
    this.flow = mergeFlows(afterThen, this.flow);
  }

  /** `while (true)` with no `break` never ends, and what follows it cannot be reached. */
  private loop(condition: Expression, body: () => void, bodyStatement: Statement): void {
    this.condition(condition);
    const before = cloneFlow(this.flow);
    body();
    const forever = condition.kind === "Literal" && condition.value === true && !containsBreak(bodyStatement);
    this.flow = forever ? null : before;
  }

  private forStatement(stmt: For): void {
    this.inScope(new Scope(this.scope), () => {
      if (stmt.init) this.statement(stmt.init);
      this.condition(stmt.condition);
      const before = cloneFlow(this.flow);
      this.statement(stmt.body);
      if (this.flow === null) this.flow = cloneFlow(before);
      if (stmt.update.kind === "Update") this.update(stmt.update);
      else this.expression(stmt.update, true);
      const forever = stmt.condition.kind === "Literal" && stmt.condition.value === true && !containsBreak(stmt.body);
      this.flow = forever ? null : before;
    });
  }

  private foreach(stmt: Foreach): void {
    const iterable = this.expression(stmt.iterable);
    this.inScope(new Scope(this.scope), () => {
      const before = cloneFlow(this.flow);
      let variableType = ERROR;
      if (iterable !== ERROR && !isArrayType(iterable)) {
        this.report(stmt.iterable.span, `a for-each loop needs an array, but this is ${iterable}`);
      } else if (iterable !== ERROR) {
        const elementType = elementTypeOf(iterable);
        variableType = elementType;
        if (stmt.varType !== null) {
          const declared = typeNameOf(stmt.varType);
          if (!this.typeExists(declared)) {
            this.report(stmt.varType.span, `unknown type '${baseTypeOf(declared)}'`);
            variableType = ERROR;
          } else if (!this.assignable(elementType, declared)) {
            this.report(stmt.varType.span, `the loop variable is ${declared}, but the elements are ${elementType}`);
            variableType = ERROR;
          } else {
            variableType = declared;
          }
        }
      }
      this.declareVariable(stmt.name, variableType, stmt.nameSpan, true);
      this.statement(stmt.body);
      this.flow = before;
    });
  }

  private switchStatement(stmt: Switch): void {
    const subject = this.expression(stmt.discriminant);
    this.inScope(new Scope(this.scope), () => {
      const start = cloneFlow(this.flow);
      let fallthrough: Flow = null;
      let broke = false;
      const run = (body: readonly Statement[]): void => {
        // A case is entered by the jump from the switch, or by falling out of the case before it.
        this.flow = mergeFlows(cloneFlow(start), fallthrough);
        this.hoist(body);
        for (const statement of body) {
          this.statement(statement);
          if (containsBreak(statement)) broke = true;
        }
        fallthrough = this.flow;
      };
      for (const branch of stmt.cases) {
        const test = this.expression(branch.test);
        if (subject !== ERROR && test !== ERROR && !this.comparable(subject, test)) this.report(branch.test.span, `cannot compare ${subject} with ${test}`);
        run(branch.body);
      }
      if (stmt.default) run(stmt.default.body);
      const completes = stmt.default === null || fallthrough !== null || broke;
      this.flow = completes ? start : null;
    });
  }

  private returnStatement(stmt: Extract<Statement, { kind: "Return" }>): void {
    const context = this.context;
    if (stmt.value) {
      const value = this.expression(stmt.value, false, context && !context.isConstructor ? context.returnType : undefined);
      if (context !== null && value !== ERROR) {
        if (context.isConstructor) this.report(stmt.span, "a constructor cannot return a value");
        else if (context.returnType === "void") this.report(stmt.span, `'${context.name}' is void and cannot return a value`);
        else if (!this.assignable(value, context.returnType)) this.report(stmt.span, `'${context.name}' must return ${context.returnType}, but it returned ${value}`);
      }
    } else if (context !== null && !context.isConstructor && context.returnType !== "void") {
      this.report(stmt.span, `'${context.name}' must return a value of type ${context.returnType}`);
    }
    this.flow = null;
  }

  private update(stmt: Update): void {
    const type = this.target(stmt.target, true);
    if (type !== ERROR && type !== "int" && type !== "float") this.report(stmt.span, `'${stmt.op}' needs an int or a float, but this is ${type}`);
  }

  private varDecl(stmt: VarDecl): void {
    let type = ERROR;
    let hasValue = stmt.init !== null;
    if (stmt.declaredType === null) {
      const init = stmt.init as Expression;
      const value = this.expression(init);
      if (value === "null") this.report(init.span, `cannot infer the type of '${stmt.name}' from null`);
      else type = value;
      hasValue = true;
    } else {
      type = typeNameOf(stmt.declaredType);
      if (!this.typeExists(type)) {
        this.report(stmt.declaredType.span, `unknown type '${baseTypeOf(type)}'`);
        type = ERROR;
        if (stmt.init !== null) this.initializer(stmt.init, ERROR);
      } else if (stmt.init !== null) {
        const value = this.initializer(stmt.init, type);
        if (value !== ERROR && !this.assignable(value, type)) this.report(stmt.init.span, `cannot assign ${value} to ${type}`);
      }
    }
    this.declareVariable(stmt.name, type, stmt.nameSpan, hasValue);
  }

  // ---------- functions, methods, constructors and classes ----------

  /** Checks a body with its parameters in scope. `closure` is where the function was declared. */
  private callable(
    decl: Pick<FuncDecl, "name" | "nameSpan" | "params" | "body"> & { returnType?: FuncDecl["returnType"] },
    context: FunctionContext,
    thisClass: ClassInfo | null,
    closure: Scope,
  ): void {
    const savedContext = this.context;
    const savedFlow = this.flow;
    this.context = context;
    this.flow = new Set();
    this.level++;
    try {
      if (decl.returnType && !this.inScope(closure, () => this.typeExists(context.returnType)) && context.returnType !== "void") {
        this.report(decl.returnType.span, `unknown type '${baseTypeOf(context.returnType)}'`);
      }
      this.inScope(new Scope(closure, thisClass), () => {
        this.declareParameters(decl.params);
        if (thisClass !== null && context.isConstructor) this.constructorSuper(decl as CtorDecl, thisClass);
        this.hoist(decl.body.body);
        for (const statement of decl.body.body) this.statement(statement);
      });
      if (!context.isConstructor && context.returnType !== "void" && this.flow !== null) {
        this.report(decl.nameSpan, `'${context.name}' must return a value of type ${context.returnType}`);
      }
    } finally {
      this.level--;
      this.context = savedContext;
      this.flow = savedFlow;
    }
  }

  private declareParameters(params: readonly Param[]): void {
    for (const param of params) {
      const type = typeNameOf(param.type);
      let known = type;
      if (!this.typeExists(type)) {
        this.report(param.type.span, `unknown type '${baseTypeOf(type)}'`);
        known = ERROR;
      }
      const sym: VarSym = { kind: "variable", name: param.name, type: known, declaredAt: param.nameSpan, needsAssignment: false };
      this.levels.set(sym, this.level);
      if (!this.scope.declare(sym)) this.report(param.nameSpan, `the parameter '${param.name}' is declared twice`);
    }
  }

  /** The arguments of `super(...)` are checked against the constructor of the parent they select. */
  private constructorSuper(ctor: CtorDecl, cls: ClassInfo): void {
    const first = ctor.body.body[0];
    if (first?.kind !== "ExprStmt" || first.expression.kind !== "SuperCall" || cls.parent === null) return;
    const args = first.expression.args;
    const types = args.map((arg) => this.expression(arg));
    const target = cls.parent.ctors.find((c) => c.decl.params.length === args.length);
    if (target) this.checkArguments(target.decl.params, args, types, cls.parent.name, first.expression.span);
  }

  private classDecl(decl: ClassDecl): void {
    const cls = this.table.get(decl.name);
    if (cls === undefined || cls.decl !== decl) return; // a duplicate declaration, reported by the table
    for (const member of decl.members) {
      if (member.kind === "ClassField") {
        const info = cls.fields.find((f) => f.decl === member);
        if (info === undefined || member.init === null) continue;
        this.inScope(new Scope(this.global, cls), () => {
          const value = this.initializer(member.init as Initializer, info.type);
          if (value !== ERROR && !this.assignable(value, info.type)) {
            this.report((member.init as Initializer).span, `cannot assign ${value} to the field '${info.name}' of type ${info.type}`);
          }
        });
      } else if (member.kind === "MethodDecl") {
        this.callable(member, { name: member.name, returnType: typeNameOf(member.returnType), isConstructor: false }, cls, this.global);
      } else {
        this.callable(member, { name: member.name, returnType: "void", isConstructor: true }, cls, this.global);
      }
    }
  }

  // ---------- expressions ----------

  private initializer(init: Initializer, expected: string): string {
    if (init.kind !== "ArrayLiteral") return this.expression(init, false, expected);
    if (expected !== ERROR && !isArrayType(expected)) {
      this.report(init.span, `cannot use a list of values for type ${expected}`);
      return ERROR;
    }
    return this.arrayLiteral(init, expected);
  }

  private arrayLiteral(literal: ArrayLiteral, type: string): string {
    const elementType = type === ERROR ? ERROR : elementTypeOf(type);
    let failed = false;
    literal.elements.forEach((element, index) => {
      if (element.kind === "ArrayLiteral") {
        if (elementType !== ERROR && !isArrayType(elementType)) {
          this.report(element.span, `element ${index + 1} cannot be a list of values: the elements are ${elementType}`);
          failed = true;
          return;
        }
        if (this.arrayLiteral(element, elementType) === ERROR) failed = true;
        return;
      }
      const value = this.expression(element, false, elementType);
      if (value === ERROR) failed = true;
      else if (elementType !== ERROR && !this.assignable(value, elementType)) {
        this.report(element.span, `element ${index + 1} must be ${elementType}, but it is ${value}`);
        failed = true;
      }
    });
    return failed ? ERROR : type;
  }

  /** The type of an expression. `allowVoid` is true only for an expression used as a statement. */
  private expression(expression: Expression, allowVoid = false, expected?: string): string {
    const type = this.typeOf(expression, allowVoid, expected);
    this.types.set(expression, type);
    return type;
  }

  private typeOf(e: Expression, allowVoid: boolean, expected?: string): string {
    switch (e.kind) {
      case "Literal":
        if (e.literalType === "int" && (e.value as number) > INT_MAX) {
          this.report(e.span, `the number ${e.value} is too large for an int`);
          return ERROR;
        }
        return e.literalType;
      case "Identifier":
        return this.read(e);
      case "Group":
        return this.expression(e.expression, false, expected);
      case "Unary":
        return this.unary(e);
      case "Binary":
        return this.binary(e);
      case "Ternary":
        return this.ternary(e, expected);
      case "Assign":
        return this.assign(e);
      case "Call": {
        const result = this.call(e);
        if (result === "void" && !allowVoid) {
          this.report(e.span, "this call returns no value");
          return ERROR;
        }
        return result;
      }
      case "Index":
        return this.index(e);
      case "Member":
        return this.member(e);
      case "NewArray":
        return this.newArray(e);
      case "StructLiteral":
        return this.structLiteral(e);
      case "NewObject":
        return this.newObject(e);
      case "This": {
        const cls = this.scope.enclosingClass();
        if (cls === null) {
          this.report(e.span, "'this' can only be used inside a method or a constructor of a class");
          return ERROR;
        }
        return cls.name;
      }
      case "Super":
        this.report(e.span, "'super' can only be used as super(...) or as super.method(...)");
        return ERROR;
      case "SuperCall":
        for (const arg of e.args) this.expression(arg);
        this.report(e.span, "super(...) can only be the first statement of a constructor");
        return ERROR;
    }
  }

  private read(node: Identifier): string {
    const found = this.lookupName(node.name);
    if (found === undefined) {
      this.report(node.span, `variable '${node.name}' is not declared`);
      return ERROR;
    }
    if (found.kind === "field") {
      if (!this.canUse(found.info.access, found.info.owner)) {
        this.report(node.span, `'${node.name}' is private in '${found.info.owner.name}'`);
        return ERROR;
      }
      return found.info.type;
    }
    const sym = found.sym;
    if (sym.kind !== "variable") {
      this.report(node.span, `'${node.name}' is a ${sym.kind}${sym.kind === "function" ? `; call it as ${node.name}(...)` : ""}`);
      return ERROR;
    }
    this.checkRead(sym, node.span);
    return sym.type;
  }

  private unary(node: Unary): string {
    if (node.op === "-" && node.operand.kind === "Literal" && node.operand.literalType === "int" && node.operand.value === INT_MAX + 1) {
      this.types.set(node.operand, "int");
      return "int";
    }
    const operand = this.expression(node.operand);
    if (operand === ERROR) return ERROR;
    if (node.op === "typeof") return "string";
    if (operand === "null") {
      this.report(node.span, `cannot apply '${node.op}' to null`);
      return ERROR;
    }
    if (node.op === "!") {
      if (operand === "boolean") return "boolean";
      this.report(node.span, `cannot apply '!' to ${operand}`);
      return ERROR;
    }
    if (operand === "float") return "float";
    if (operand === "int" || operand === "char") return "int";
    this.report(node.span, `cannot apply '-' to ${operand}`);
    return ERROR;
  }

  private binary(node: Binary): string {
    const left = this.expression(node.left);
    // The right side of && and || may not run, but its type is still checked.
    const right = this.expression(node.right);
    if (left === ERROR || right === ERROR) return ERROR;
    return this.binaryType(node.op, left, right, node.span, node);
  }

  private binaryType(op: Binary["op"], left: string, right: string, span: Span, node?: Binary): string {
    if (op === "&&" || op === "||") {
      if (left !== "boolean") {
        this.report(node?.left.span ?? span, `cannot apply '${op}' to ${left}`);
        return ERROR;
      }
      if (right !== "boolean") {
        this.report(node?.right.span ?? span, `cannot apply '${op}' to ${right}`);
        return ERROR;
      }
      return "boolean";
    }
    if (op === "==" || op === "!=") {
      if (!this.comparable(left, right)) {
        this.report(span, `cannot compare ${left} with ${right}`);
        return ERROR;
      }
      return "boolean";
    }
    if (op === "+" && (left === "string" || right === "string")) return "string";
    if (left === "null" || right === "null") {
      this.report(span, `cannot apply '${op}' to null`);
      return ERROR;
    }
    const isComparison = op === "<" || op === "<=" || op === ">" || op === ">=";
    if (isComparison && left === "string" && right === "string") return "boolean";
    if (!isNumeric(left) || !isNumeric(right)) {
      this.report(span, `cannot apply '${op}' to ${left} and ${right}`);
      return ERROR;
    }
    if (isComparison) return "boolean";
    return left === "float" || right === "float" ? "float" : "int";
  }

  private ternary(node: Ternary, expected?: string): string {
    this.condition(node.condition);
    const before = cloneFlow(this.flow);
    const whenTrue = this.expression(node.whenTrue, false, expected);
    const afterTrue = this.flow;
    this.flow = cloneFlow(before);
    const whenFalse = this.expression(node.whenFalse, false, expected);
    this.flow = mergeFlows(afterTrue, this.flow);
    if (whenTrue === ERROR || whenFalse === ERROR) return ERROR;
    if (whenTrue === whenFalse) return whenTrue;
    if (isNumeric(whenTrue) && isNumeric(whenFalse)) return whenTrue === "float" || whenFalse === "float" ? "float" : "int";
    if (whenTrue === "null" && this.isReference(whenFalse)) return whenFalse;
    if (whenFalse === "null" && this.isReference(whenTrue)) return whenTrue;
    if (this.table.isSubclass(whenTrue, whenFalse)) return whenFalse;
    if (this.table.isSubclass(whenFalse, whenTrue)) return whenTrue;
    this.report(node.span, `the two sides of ?: must have the same type, but they are ${whenTrue} and ${whenFalse}`);
    return ERROR;
  }

  // ---------- assignment ----------

  /**
   * The type of something that can be assigned to (a variable, an element, a field). `reading` is true when the
   * current value is also read (`x += 1`, `x++`), so a number must already have one.
   */
  private target(target: Assign["target"], reading: boolean): string {
    if (target.kind === "Identifier") {
      const found = this.lookupName(target.name);
      if (found === undefined) {
        this.report(target.span, `variable '${target.name}' is not declared`);
        return ERROR;
      }
      if (found.kind === "field") {
        if (!this.canUse(found.info.access, found.info.owner)) {
          this.report(target.span, `'${target.name}' is private in '${found.info.owner.name}'`);
          return ERROR;
        }
        this.types.set(target, found.info.type);
        return found.info.type;
      }
      const sym = found.sym;
      if (sym.kind !== "variable") {
        this.report(target.span, `'${target.name}' is a ${sym.kind}, not a variable`);
        return ERROR;
      }
      if (reading) this.checkRead(sym, target.span);
      this.types.set(target, sym.type);
      return sym.type;
    }
    return this.expression(target);
  }

  private assign(node: Assign): string {
    const target = this.target(node.target, node.op !== "=");
    const value = this.expression(node.value, false, target === ERROR ? undefined : target);
    if (node.target.kind === "Identifier" && node.op === "=") {
      const found = this.lookupName(node.target.name);
      if (found?.kind === "sym" && found.sym.kind === "variable") this.markAssigned(found.sym);
    }
    if (target === ERROR || value === ERROR) return target;
    let result = value;
    if (node.op !== "=") {
      result = this.binaryType(node.op === "+=" ? "+" : "-", target, value, node.span);
      if (result === ERROR) return target;
    }
    if (!this.assignable(result, target)) this.report(node.value.span, `cannot assign ${result} to ${target}`);
    return target;
  }

  private index(node: Extract<Expression, { kind: "Index" }>): string {
    const base = this.expression(node.target);
    const position = this.expression(node.index);
    if (base === ERROR || position === ERROR) return ERROR;
    if (!isArrayType(base)) {
      this.report(node.target.span, `cannot index a value of type ${base}`);
      return ERROR;
    }
    if (position !== "int") {
      this.report(node.index.span, `an array index must be an int, but it is ${position}`);
      return ERROR;
    }
    return elementTypeOf(base);
  }

  private member(node: Member): string {
    if (node.object.kind === "Super") {
      this.report(node.object.span, "'super' can only be used as super(...) or as super.method(...)");
      return ERROR;
    }
    const object = this.expression(node.object);
    if (object === ERROR) return ERROR;
    if (isArrayType(object)) {
      if (node.name === "length") return "int";
      this.report(node.nameSpan, `arrays have no member '${node.name}' (they have length, indexOf and join)`);
      return ERROR;
    }
    const cls = this.table.get(object);
    if (cls !== undefined) {
      const info = cls.fields.find((f) => f.name === node.name);
      if (info === undefined) {
        if (this.table.findMethod(cls, node.name) !== null) this.report(node.nameSpan, `'${node.name}' is a method of '${cls.name}'; call it as ${node.name}(...)`);
        else this.report(node.nameSpan, `class '${cls.name}' has no field '${node.name}'`);
        return ERROR;
      }
      if (!this.canUse(info.access, info.owner)) {
        this.report(node.nameSpan, `'${node.name}' is private in '${info.owner.name}'`);
        return ERROR;
      }
      return info.type;
    }
    const struct = this.scope.lookup(object);
    if (struct?.kind === "struct") {
      const field = struct.fields.find((f) => f.name === node.name);
      if (field === undefined) {
        this.report(node.nameSpan, `struct '${struct.name}' has no field '${node.name}'`);
        return ERROR;
      }
      return field.type;
    }
    this.report(node.nameSpan, `a value of type ${object} has no member '${node.name}'`);
    return ERROR;
  }

  private newArray(node: NewArray): string {
    let ok = true;
    if (!this.typeExists(node.elementType)) {
      this.report(node.span, `unknown type '${node.elementType}'`);
      ok = false;
    }
    for (const size of node.sizes) {
      const type = this.expression(size);
      if (type !== ERROR && type !== "int") {
        this.report(size.span, `an array size must be an int, but it is ${type}`);
        ok = false;
      }
    }
    return ok ? arrayTypeOf(node.elementType, node.sizes.length) : ERROR;
  }

  private structLiteral(node: StructLiteral): string {
    const struct = this.scope.lookup(node.structName);
    const given = new Set<string>();
    if (struct?.kind !== "struct") {
      for (const init of node.fields) this.expression(init.value);
      this.report(node.span, `unknown struct '${node.structName}'`);
      return ERROR;
    }
    for (const init of node.fields) {
      const field = struct.fields.find((f) => f.name === init.name);
      const value = this.expression(init.value, false, field?.type);
      if (field === undefined) {
        this.report(init.nameSpan, `struct '${node.structName}' has no field '${init.name}'`);
        continue;
      }
      if (given.has(init.name)) {
        this.report(init.nameSpan, `the field '${init.name}' is given twice`);
        continue;
      }
      given.add(init.name);
      if (value !== ERROR && !this.assignable(value, field.type)) {
        this.report(init.value.span, `the field '${init.name}' of '${node.structName}' must be ${field.type}, but it is ${value}`);
      }
    }
    return node.structName;
  }

  // ---------- calls ----------

  /** Checks arguments that were already typed against the parameters of a function, method or constructor. */
  private checkArguments(params: readonly Param[], args: readonly Expression[], types: readonly string[], name: string, span: Span): boolean {
    if (args.length !== params.length) {
      this.report(span, `'${name}' expects ${params.length} argument${params.length === 1 ? "" : "s"} but got ${args.length}`);
      return false;
    }
    let ok = true;
    params.forEach((param, i) => {
      const type = typeNameOf(param.type);
      const given = types[i] ?? ERROR;
      if (given !== ERROR && this.typeExists(type) && !this.assignable(given, type)) {
        this.report(args[i]?.span ?? span, `argument ${i + 1} of '${name}' must be ${type}, but it is ${given}`);
        ok = false;
      }
    });
    return ok;
  }

  private call(node: Call): string {
    if (node.callee.kind === "Member") return this.methodCall(node, node.callee);
    if (node.callee.kind !== "Identifier") {
      for (const arg of node.args) this.expression(arg);
      this.report(node.callee.span, "only a function name can be called");
      return ERROR;
    }
    const name = node.callee.name;
    const types = node.args.map((arg) => this.expression(arg));

    // Inside a method, `speak()` means `this.speak()`; the methods of the class come before functions and built-ins.
    const cls = this.scope.enclosingClass();
    const own = cls === null ? null : this.table.findMethod(cls, name);
    if (own !== null) return this.callMethod(own, node, types, node.callee.span);

    const sym = this.scope.lookup(name);
    if (sym === undefined) {
      const builtin = BUILTIN_SIGNATURES.get(name);
      if (builtin === undefined) {
        this.report(node.callee.span, `function '${name}' is not declared`);
        return ERROR;
      }
      if (types.length !== builtin.params) {
        this.report(node.span, `${name} expects ${builtin.params} argument${builtin.params === 1 ? "" : "s"} but got ${types.length}`);
        return ERROR;
      }
      if (types.includes(ERROR)) return ERROR;
      const result = builtin.check(name, types);
      if ("error" in result) {
        this.report(node.span, result.error);
        return ERROR;
      }
      return result.type;
    }
    if (sym.kind !== "function") {
      this.report(node.callee.span, `'${name}' is a ${sym.kind}, not a function`);
      return ERROR;
    }
    if (!this.checkArguments(sym.decl.params, node.args, types, name, node.span)) return typeNameOf(sym.decl.returnType) === "void" ? "void" : ERROR;
    return typeNameOf(sym.decl.returnType);
  }

  private callMethod(method: MethodInfo, node: Call, types: readonly string[], nameSpan: Span): string {
    if (!this.canUse(method.access, method.owner)) {
      this.report(nameSpan, `'${method.name}' is private in '${method.owner.name}'`);
      return ERROR;
    }
    const returns = typeNameOf(method.decl.returnType);
    if (!this.checkArguments(method.decl.params, node.args, types, method.name, node.span)) return returns === "void" ? "void" : ERROR;
    return returns;
  }

  private methodCall(node: Call, callee: Member): string {
    if (callee.object.kind === "Super") return this.superMethod(node, callee);
    const object = this.expression(callee.object);
    const types = node.args.map((arg) => this.expression(arg));
    if (object === ERROR) return ERROR;

    const cls = this.table.get(object);
    if (cls !== undefined) {
      const method = this.table.findMethod(cls, callee.name);
      if (method === null) {
        const isField = cls.fields.some((f) => f.name === callee.name);
        this.report(callee.nameSpan, isField ? `'${callee.name}' is a field of '${cls.name}', not a method` : `class '${cls.name}' has no method '${callee.name}'`);
        return ERROR;
      }
      return this.callMethod(method, node, types, callee.nameSpan);
    }
    if (!isArrayType(object)) {
      this.report(callee.nameSpan, `a value of type ${object} has no method '${callee.name}'`);
      return ERROR;
    }
    if (callee.name === "join") {
      if (types.length !== 0) {
        this.report(node.span, "join expects no arguments");
        return ERROR;
      }
      return "string";
    }
    if (callee.name === "indexOf") {
      if (types.length !== 1) {
        this.report(node.span, "indexOf expects 1 argument");
        return ERROR;
      }
      const wanted = types[0] as string;
      const elementType = elementTypeOf(object);
      if (wanted !== ERROR && !this.assignable(wanted, elementType)) {
        this.report(node.args[0]?.span ?? node.span, `indexOf needs a ${elementType}, but got ${wanted}`);
        return ERROR;
      }
      return "int";
    }
    this.report(callee.nameSpan, `arrays have no method '${callee.name}' (they have length, indexOf and join)`);
    return ERROR;
  }

  /** `super.method(args)`: the parent's version. */
  private superMethod(node: Call, callee: Member): string {
    const types = node.args.map((arg) => this.expression(arg));
    const cls = this.scope.enclosingClass();
    if (cls === null) {
      this.report(callee.object.span, "'super' can only be used inside a method or a constructor of a class");
      return ERROR;
    }
    if (cls.parent === null) {
      this.report(callee.object.span, `'${cls.name}' has no parent class, so 'super' cannot be used`);
      return ERROR;
    }
    const method = this.table.findMethod(cls.parent, callee.name);
    if (method === null) {
      this.report(callee.nameSpan, `'${cls.parent.name}' has no method '${callee.name}'`);
      return ERROR;
    }
    return this.callMethod(method, node, types, callee.nameSpan);
  }

  private newObject(node: NewObject): string {
    const types = node.args.map((arg) => this.expression(arg));
    const cls = this.table.get(node.className);
    if (cls === undefined) {
      const found = this.scope.lookup(node.className);
      this.report(node.classSpan, found?.kind === "struct" ? `'${node.className}' is a struct: create it with ${node.className}{...}, not with new` : `unknown class '${node.className}'`);
      return ERROR;
    }
    if (cls.ctors.length === 0) {
      if (types.length !== 0) {
        this.report(node.span, `'${cls.name}' has no constructor with arguments, but ${types.length} ${types.length === 1 ? "was" : "were"} given`);
        return ERROR;
      }
      return cls.name;
    }
    const ctor = cls.ctors.find((c) => c.decl.params.length === types.length);
    if (ctor === undefined) {
      const arities = cls.ctors.map((c) => c.decl.params.length).sort((a, b) => a - b);
      this.report(node.span, `no constructor of '${cls.name}' takes ${types.length} argument${types.length === 1 ? "" : "s"}; it takes ${arities.join(" or ")}`);
      return ERROR;
    }
    if (!this.canUse(ctor.access, cls)) {
      this.report(node.span, `the constructor of '${cls.name}' is private`);
      return ERROR;
    }
    this.checkArguments(ctor.decl.params, node.args, types, cls.name, node.span);
    return cls.name;
  }
}

/** Is there a `break` in this statement that leaves the loop or switch around it (not one of an inner loop)? */
function containsBreak(statement: Statement): boolean {
  switch (statement.kind) {
    case "Break":
      return true;
    case "Block":
      return statement.body.some(containsBreak);
    case "If":
      return containsBreak(statement.then) || (statement.otherwise !== null && containsBreak(statement.otherwise));
    default:
      return false; // an inner loop or switch owns its breaks
  }
}

