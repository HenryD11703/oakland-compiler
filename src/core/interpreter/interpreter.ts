import { ClassTable, methodSignature, type ClassInfo, type CtorInfo, type FieldInfo, type MethodInfo } from "../classes";
import { diagnostic, type Diagnostic, type Phase } from "../diagnostics";
import type {
  ArrayLiteral,
  Assign,
  Binary,
  Call,
  ClassDecl,
  Expression,
  For,
  Foreach,
  FuncDecl,
  Identifier,
  Index,
  Initializer,
  LValue,
  Member,
  MethodDecl,
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
import { endOf, joinSpans, type Span } from "../span";
import { SymbolCollector, type SymbolEntry, type SymbolKind } from "../symbols";
import { TraceRecorder } from "../trace/recorder";
import type { Trace } from "../trace/types";
import { BUILTINS } from "./builtins";
import { Environment, type Binding, type Entry, type FunctionEntry, type StructEntry } from "./environment";
import { DEFAULT_LIMITS, MAX_DIAGNOSTICS, RunAbort, type RunLimits } from "./limits";
import {
  arrayTypeOf,
  baseTypeOf,
  elementTypeOf,
  INT_MAX,
  INT_MIN,
  isArrayType,
  isAssignable,
  isNumeric,
  isPrimitive,
  typeNameOf,
} from "../types";
import {
  deepCopyArray,
  defaultFor,
  display,
  ERROR,
  fieldDefault,
  isError,
  NULL,
  OakArray,
  OakObject,
  OakStruct,
  VOID,
  type StructField,
  type Value,
} from "./values";

export interface InterpretResult {
  /** Everything the program printed. */
  readonly stdout: string;
  /** Semantic and runtime problems, in the order they happened. */
  readonly diagnostics: Diagnostic[];
  /** Evaluation steps used. */
  readonly steps: number;
  /** True when a limit (steps, time, depth, output) ended the run early. */
  readonly stoppedEarly: boolean;
  /** Every name the program declared (AC-30). */
  readonly symbols: SymbolEntry[];
  /** Step-by-step record of the run, or null when tracing was turned off (AC-31). */
  readonly trace: Trace | null;
}

export interface InterpretOptions {
  readonly limits?: Partial<RunLimits>;
  /** A clock in milliseconds; tests pass a fake one. */
  readonly now?: () => number;
  /** Record the trace (default true). */
  readonly trace?: boolean;
  /** The static type of each expression, from the checker. Used where a run needs it: the type of `a ? b : c`. */
  readonly typeHints?: ReadonlyMap<Expression, string>;
}

/** The statements that make a step of their own in the trace. */
const STEP_STATEMENTS: ReadonlySet<string> = new Set(["ExprStmt", "Update", "Print", "Return", "Break", "Continue", "VarDecl"]);

type Completion =
  | { readonly kind: "normal" }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "return"; readonly value: Value | null };

const NORMAL: Completion = { kind: "normal" };
const BREAK: Completion = { kind: "break" };
const CONTINUE: Completion = { kind: "continue" };

/** A place that can be read and written: a variable, an array element or a struct field. */
interface Location {
  readonly type: string;
  get(): Value;
  set(value: Value): Value;
  /** Stores null after a failed assignment (the course rule: a failed store leaves null). */
  clear(): void;
}

/** What a bare name inside a method can mean besides a variable: a field of `this`. */
interface FieldRef {
  readonly kind: "field";
  readonly object: OakObject;
  readonly info: FieldInfo;
}

/** What a method or a constructor needs to look like a function when it runs. */
type Callable = Pick<MethodDecl, "returnType" | "name" | "nameSpan" | "params" | "body">;

const boolean = (value: boolean): Value => ({ type: "boolean", value });
const int = (value: number): Value => ({ type: "int", value });

/** Converts a raw value to what a variable of type `to` stores (char becomes its code when stored in a number). */
function coerce(value: Value, to: string): unknown {
  if (value.value === null) return null;
  if (value.type === "char" && (to === "int" || to === "float")) return (value.value as string).charCodeAt(0);
  return value.value;
}

function numberOf(value: Value): number {
  return value.type === "char" ? (value.value as string).charCodeAt(0) : (value.value as number);
}

/** Runs a parsed program. Never throws: problems become diagnostics. */
export function interpret(program: Program, options: InterpretOptions = {}): InterpretResult {
  return new Interpreter({ ...DEFAULT_LIMITS, ...options.limits }, options.now ?? Date.now, options.trace ?? true, options.typeHints ?? null).run(program);
}

class Interpreter {
  private readonly output: string[] = [];
  private outputLength = 0;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly seenDiagnostics = new Set<string>();
  private diagnosticsFull = false;
  private readonly global = new Environment(null, "global");
  /** Every class of the program by name. Classes live at the top level, so one table is enough. */
  private readonly table = new ClassTable({
    register: (info) => {
      if (this.global.declare(info)) return true;
      this.semantic(info.decl.nameSpan, `'${info.name}' is already declared in this scope`);
      return false;
    },
    typeExists: (type) => this.typeExists(type, this.global),
    isStruct: (name) => this.global.lookup(name)?.kind === "struct",
    report: (span, message) => void this.semantic(span, message),
  });
  private readonly classes = this.table.byName;
  private steps = 0;
  private depth = 0;
  private stoppedEarly = false;
  private readonly startedAt: number;
  private lastSpan: Span | null = null;
  private readonly symbols = new SymbolCollector();
  private readonly trace: TraceRecorder | null;

  constructor(
    private readonly limits: RunLimits,
    private readonly now: () => number,
    traceEnabled: boolean,
    private readonly hints: ReadonlyMap<Expression, string> | null,
  ) {
    this.startedAt = now();
    this.trace = traceEnabled ? new TraceRecorder(this.global) : null;
  }

  run(program: Program): InterpretResult {
    try {
      this.hoist(program.body, this.global);
      for (const statement of program.body) this.exec(statement, this.global);
    } catch (error) {
      if (error instanceof RunAbort) {
        this.stoppedEarly = true;
      } else if (error instanceof RangeError) {
        this.stoppedEarly = true;
        this.report("runtime", "stack overflow: the program nests too deeply", this.lastSpan ?? program.span);
      } else {
        this.stoppedEarly = true;
        const message = error instanceof Error ? error.message : String(error);
        this.report("runtime", `internal error: ${message}`, this.lastSpan ?? program.span);
      }
    }
    return {
      stdout: this.output.join(""),
      diagnostics: this.diagnostics,
      steps: this.steps,
      stoppedEarly: this.stoppedEarly,
      symbols: this.symbols.toArray(),
      trace: this.trace ? this.trace.finish(endOf(program.span)) : null,
    };
  }

  // ---------- scopes, symbols and trace helpers ----------

  /** A `{ }` block: a new scope that the trace is told about when it opens and closes. */
  private execScopedBlock(body: readonly Statement[], env: Environment): Completion {
    const scope = new Environment(env, "block");
    this.trace?.pushScope(scope, scope.label);
    try {
      return this.execBlock(body, scope);
    } finally {
      this.trace?.popScope();
    }
  }

  private scopePath(env: Environment): string {
    const labels: string[] = [];
    for (let scope: Environment | null = env; scope !== null; scope = scope.parent) labels.unshift(scope.label);
    return labels.length > 1 ? labels.slice(1).join(" > ") : "global";
  }

  private addSymbol(name: string, kind: SymbolKind, type: string, env: Environment, span: Span): void {
    this.symbols.add({ name, kind, type, scope: this.scopePath(env), span });
  }

  /** Evaluates a condition as a step of its own in the trace, noting whether it held. */
  private evalStepCondition(expression: Expression, env: Environment): boolean | null {
    this.trace?.beginStep("condition", expression.span);
    const result = this.evalCondition(expression, env);
    if (result !== null) this.trace?.note(String(result));
    return result;
  }

  // ---------- reporting and limits ----------

  /**
   * The same mistake on the same piece of code is listed once, however many times a loop runs it, and a run
   * lists at most MAX_DIAGNOSTICS problems.
   */
  private report(phase: Phase, message: string, span: Span): void {
    if (this.diagnosticsFull) return;
    const key = `${phase}|${span.start.offset}|${span.end.offset}|${message}`;
    if (this.seenDiagnostics.has(key)) return;
    this.seenDiagnostics.add(key);
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) {
      this.diagnosticsFull = true;
      this.diagnostics.push(diagnostic("runtime", `more than ${MAX_DIAGNOSTICS} problems: the rest are not listed`, span));
      return;
    }
    this.diagnostics.push(diagnostic(phase, message, span));
  }

  /** A mistake in the program (names, types, arguments). Returns ERROR so callers can `return this.semantic(...)`. */
  private semantic(span: Span, message: string): Value {
    this.report("semantic", message, span);
    return ERROR;
  }

  /** A failure while running (bounds, division by zero). */
  private runtime(span: Span, message: string): Value {
    this.report("runtime", message, span);
    return ERROR;
  }

  private abort(span: Span, message: string): never {
    this.report("runtime", message, span);
    throw new RunAbort();
  }

  private tick(span: Span): void {
    this.lastSpan = span;
    this.steps++;
    if (this.steps > this.limits.maxSteps) {
      this.abort(span, `step limit reached (${this.limits.maxSteps.toLocaleString("en-US")} steps): the program may be in an infinite loop`);
    }
    if ((this.steps & 1023) === 0 && this.now() - this.startedAt > this.limits.maxTimeMs) {
      this.abort(span, `time limit reached (${this.limits.maxTimeMs / 1000} s): the program may be in an infinite loop`);
    }
  }

  private emit(text: string, span: Span): void {
    this.outputLength += text.length;
    if (this.outputLength > this.limits.maxOutputChars) {
      this.abort(span, `output limit reached (${this.limits.maxOutputChars.toLocaleString("en-US")} characters)`);
    }
    this.output.push(text);
    this.trace?.output(this.outputLength);
  }

  // ---------- declarations ----------

  /** Makes functions and structs of a statement list callable before the line that declares them. */
  private hoist(statements: readonly Statement[], env: Environment): void {
    const classes: ClassDecl[] = [];
    for (const statement of statements) {
      if (statement.kind === "StructDecl") this.declareStruct(statement, env);
      else if (statement.kind === "FuncDecl") this.declareFunction(statement, env);
      else if (statement.kind === "ClassDecl") classes.push(statement);
    }
    // Every class is registered before any is completed, so a class may name one declared further down.
    if (classes.length > 0) this.declareClasses(classes, env);
  }

  // ---------- classes ----------

  private addSymbolAt(name: string, kind: SymbolKind, type: string, scope: string, span: Span): void {
    this.symbols.add({ name, kind, type, scope, span });
  }

  private declareClasses(decls: readonly ClassDecl[], env: Environment): void {
    // The rules for a class declaration are in classes.ts, shared with the type checker.
    const added = this.table.declare(decls.filter((decl) => env.firstVisit(decl)));
    for (const info of added) {
      const decl = info.decl;
      this.addSymbolAt(info.name, "class", decl.superName ? `${info.name} extends ${decl.superName}` : info.name, "global", decl.nameSpan);
      for (const field of info.fields) {
        if (field.owner === info) this.addSymbolAt(field.name, "field", field.type, `class ${info.name}`, field.decl.nameSpan);
      }
      for (const method of info.methods.values()) {
        this.addSymbolAt(method.name, "method", methodSignature(method.decl), `class ${info.name}`, method.decl.nameSpan);
      }
      for (const ctor of info.ctors) {
        this.addSymbolAt(ctor.decl.name, "method", `${info.name}(${ctor.decl.params.map((p) => typeNameOf(p.type)).join(", ")})`, `class ${info.name}`, ctor.decl.nameSpan);
      }
    }
  }

  private findMethod(cls: ClassInfo | null, name: string): MethodInfo | null {
    return this.table.findMethod(cls, name);
  }

  /** A `Dog` can go where an `Animal` is expected, and nothing else is added to the rules of types.ts. */
  private assignable(from: string, to: string): boolean {
    return isAssignable(from, to) || this.table.isSubclass(from, to);
  }

  /** The class whose method or constructor is running (the class that wrote that code), or null outside a class. */
  private currentClass(env: Environment): ClassInfo | null {
    const self = env.lookup("this");
    return self?.kind === "variable" ? (this.classes.get(self.type) ?? null) : null;
  }

  /** A private member can be used only by the code of the class that declares it. */
  private canUse(access: "public" | "private", owner: ClassInfo, env: Environment): boolean {
    return access === "public" || this.currentClass(env) === owner;
  }

  private declareStruct(decl: StructDecl, env: Environment): void {
    if (!env.firstVisit(decl)) return;
    const fields: StructField[] = [];
    for (const field of decl.fields) {
      if (fields.some((f) => f.name === field.name)) {
        this.semantic(field.nameSpan, `struct '${decl.name}' already has a field named '${field.name}'`);
        continue;
      }
      fields.push({ name: field.name, type: typeNameOf(field.type) });
    }
    const entry: StructEntry = { kind: "struct", name: decl.name, decl, fields, declaredAt: decl.nameSpan };
    if (!env.declare(entry)) {
      this.semantic(decl.nameSpan, `'${decl.name}' is already declared in this scope`);
      return;
    }
    this.addSymbol(decl.name, "struct", decl.name, env, decl.nameSpan);
    // Field types may name structs declared later in the same list, so they are checked on first use (see typeExists).
  }

  private declareFunction(decl: FuncDecl, env: Environment): void {
    if (!env.firstVisit(decl)) return;
    const entry: FunctionEntry = { kind: "function", name: decl.name, decl, closure: env, declaredAt: decl.nameSpan };
    if (!env.declare(entry)) {
      this.semantic(decl.nameSpan, `'${decl.name}' is already declared in this scope`);
      return;
    }
    const signature = `${typeNameOf(decl.returnType)}(${decl.params.map((p) => typeNameOf(p.type)).join(", ")})`;
    this.addSymbol(decl.name, "function", signature, env, decl.nameSpan);
  }

  private typeExists(type: string, env: Environment): boolean {
    const base = baseTypeOf(type);
    if (isPrimitive(base)) return true;
    const kind = env.lookup(base)?.kind;
    return kind === "struct" || kind === "class";
  }

  private execVarDecl(stmt: VarDecl, env: Environment): void {
    if (env.getOwn(stmt.name)) {
      this.semantic(stmt.nameSpan, `'${stmt.name}' is already declared in this scope`);
      return;
    }

    let type: string;
    let raw: unknown = null;
    let poisoned = false;

    if (stmt.declaredType === null) {
      // var x = expr;  the type is whatever the value has.
      const init = stmt.init as Expression;
      const value = this.evaluate(init, env);
      if (isError(value)) {
        type = "error";
        poisoned = true;
      } else if (value.type === "null") {
        this.semantic(init.span, `cannot infer the type of '${stmt.name}' from null`);
        type = "error";
        poisoned = true;
      } else {
        type = value.type;
        raw = this.copyIfArrayVariable(value, init);
      }
    } else {
      type = typeNameOf(stmt.declaredType);
      if (!this.typeExists(type, env)) {
        this.semantic(stmt.declaredType.span, `unknown type '${baseTypeOf(type)}'`);
        type = "error";
        poisoned = true;
      } else if (stmt.init !== null) {
        const value = this.evalInitializer(stmt.init, type, env);
        if (isError(value)) {
          poisoned = true;
        } else if (!this.assignable(value.type, type)) {
          this.semantic(stmt.init.span, `cannot assign ${value.type} to ${type}`);
          poisoned = true;
        } else {
          raw = coerce({ type: value.type, value: this.copyIfArrayVariable(value, stmt.init) }, type);
        }
      }
    }

    const binding: Binding = { kind: "variable", name: stmt.name, type, value: raw, poisoned, declaredAt: stmt.nameSpan };
    env.declare(binding);
    const shownType = type === "error" ? (stmt.declaredType ? typeNameOf(stmt.declaredType) : "var") : type;
    this.addSymbol(stmt.name, isArrayType(shownType) ? "array" : "variable", shownType, env, stmt.nameSpan);
    this.trace?.declare(binding);
  }

  /** `int[] b = a;` copies the array (the course's "por copia"); every other way of getting an array shares it. */
  private copyIfArrayVariable(value: Value, init: Initializer): unknown {
    if (init.kind === "Identifier" && value.value instanceof OakArray) return deepCopyArray(value.value);
    return value.value;
  }

  private evalInitializer(init: Initializer, expected: string, env: Environment): Value {
    if (init.kind !== "ArrayLiteral") return this.evaluate(init, env);
    if (!isArrayType(expected)) return this.semantic(init.span, `cannot use a list of values for type ${expected}`);
    return this.evalArrayLiteral(init, expected, env);
  }

  private evalArrayLiteral(literal: ArrayLiteral, type: string, env: Environment): Value {
    const elementType = elementTypeOf(type);
    const items: unknown[] = [];
    let failed = false;
    literal.elements.forEach((element, index) => {
      if (element.kind === "ArrayLiteral") {
        if (!isArrayType(elementType)) {
          this.semantic(element.span, `element ${index + 1} cannot be a list of values: the elements are ${elementType}`);
          failed = true;
          items.push(null);
          return;
        }
        const inner = this.evalArrayLiteral(element, elementType, env);
        if (isError(inner)) failed = true;
        items.push(inner.value);
        return;
      }
      const value = this.evaluate(element, env);
      if (isError(value)) {
        failed = true;
        items.push(null);
      } else if (!this.assignable(value.type, elementType)) {
        this.semantic(element.span, `element ${index + 1} must be ${elementType}, but it is ${value.type}`);
        failed = true;
        items.push(null);
      } else {
        items.push(coerce(value, elementType));
      }
    });
    return failed ? ERROR : { type, value: new OakArray(elementType, items) };
  }

  // ---------- statements ----------

  private execBlock(statements: readonly Statement[], env: Environment): Completion {
    this.hoist(statements, env);
    for (const statement of statements) {
      const completion = this.exec(statement, env);
      if (completion !== NORMAL) return completion;
    }
    return NORMAL;
  }

  private exec(stmt: Statement, env: Environment): Completion {
    this.tick(stmt.span);
    if (this.trace !== null && STEP_STATEMENTS.has(stmt.kind)) this.trace.beginStep("statement", stmt.span);
    switch (stmt.kind) {
      case "Block":
        return this.execScopedBlock(stmt.body, env);
      case "ExprStmt":
        // A super(...) statement in the right place is run by the constructor; in any other it was reported (placement.ts).
        if (stmt.expression.kind === "SuperCall") return NORMAL;
        if (stmt.expression.kind === "Call") {
          this.tick(stmt.expression.span);
          this.evalCall(stmt.expression, env);
        } else {
          this.evaluate(stmt.expression, env);
        }
        return NORMAL;
      case "Update":
        this.execUpdate(stmt, env);
        return NORMAL;
      case "Print": {
        const parts = stmt.args.map((arg) => {
          const value = this.evaluate(arg, env);
          return display(value.value, value.type);
        });
        this.emit(`${parts.join(" ")}\n`, stmt.span);
        return NORMAL;
      }
      case "If": {
        const condition = this.evalStepCondition(stmt.condition, env);
        if (condition === null) return NORMAL;
        if (condition) return this.exec(stmt.then, env);
        return stmt.otherwise ? this.exec(stmt.otherwise, env) : NORMAL;
      }
      case "While":
        return this.execWhile(stmt.condition, stmt.body, env);
      case "For":
        return this.execFor(stmt, env);
      case "Foreach":
        return this.execForeach(stmt, env);
      case "Switch":
        return this.execSwitch(stmt, env);
      case "Break":
        return BREAK;
      case "Continue":
        return CONTINUE;
      case "Return":
        return { kind: "return", value: stmt.value ? this.evaluate(stmt.value, env) : null };
      case "VarDecl":
        this.execVarDecl(stmt, env);
        return NORMAL;
      case "FuncDecl":
        this.declareFunction(stmt, env);
        return NORMAL;
      case "StructDecl":
        this.declareStruct(stmt, env);
        return NORMAL;
      case "ClassDecl":
        return NORMAL; // declared when its scope was entered (hoist)
    }
  }

  /** A condition must be a boolean. Returns null (after reporting, unless already reported) when it is not usable. */
  private evalCondition(expression: Expression, env: Environment): boolean | null {
    const value = this.evaluate(expression, env);
    if (isError(value)) return null;
    if (value.type !== "boolean") {
      this.semantic(expression.span, `the condition must be boolean, but it is ${value.type}`);
      return null;
    }
    if (value.value === null) {
      this.semantic(expression.span, "the condition is null");
      return null;
    }
    return value.value as boolean;
  }

  private execWhile(condition: Expression, body: Statement, env: Environment): Completion {
    while (this.evalStepCondition(condition, env) === true) {
      const completion = this.exec(body, env);
      if (completion.kind === "break") break;
      if (completion.kind === "return") return completion;
    }
    return NORMAL;
  }

  private execFor(stmt: For, env: Environment): Completion {
    const loopEnv = new Environment(env, "for");
    this.trace?.pushScope(loopEnv, loopEnv.label);
    try {
      if (stmt.init) this.exec(stmt.init, loopEnv);
      while (this.evalStepCondition(stmt.condition, loopEnv) === true) {
        const completion = this.exec(stmt.body, loopEnv);
        if (completion.kind === "break") break;
        if (completion.kind === "return") return completion;
        this.trace?.beginStep("statement", stmt.update.span);
        if (stmt.update.kind === "Update") this.execUpdate(stmt.update, loopEnv);
        else this.evaluate(stmt.update, loopEnv);
      }
      return NORMAL;
    } finally {
      this.trace?.popScope();
    }
  }

  private execForeach(stmt: Foreach, env: Environment): Completion {
    const iterable = this.evaluate(stmt.iterable, env);
    if (isError(iterable)) return NORMAL;
    if (!isArrayType(iterable.type)) {
      this.semantic(stmt.iterable.span, `a for-each loop needs an array, but this is ${iterable.type}`);
      return NORMAL;
    }
    if (!(iterable.value instanceof OakArray)) {
      this.runtime(stmt.iterable.span, "cannot loop over null");
      return NORMAL;
    }
    const array = iterable.value;
    const elementType = array.elementType;
    if (stmt.varType !== null) {
      const declared = typeNameOf(stmt.varType);
      if (!this.assignable(elementType, declared)) {
        this.semantic(stmt.varType.span, `the loop variable is ${declared}, but the elements are ${elementType}`);
        return NORMAL;
      }
    }
    const variableType = stmt.varType !== null ? typeNameOf(stmt.varType) : elementType;
    for (let i = 0; i < array.items.length; i++) {
      const iteration = new Environment(env, "for-each");
      const raw = array.items[i];
      const binding: Binding = {
        kind: "variable",
        name: stmt.name,
        type: variableType,
        value: coerce({ type: elementType, value: raw }, variableType),
        poisoned: false,
        declaredAt: stmt.nameSpan,
      };
      iteration.declare(binding);
      this.addSymbol(stmt.name, isArrayType(variableType) ? "array" : "variable", variableType, iteration, stmt.nameSpan);
      this.trace?.pushScope(iteration, iteration.label);
      let completion: Completion;
      try {
        this.trace?.beginStep("iteration", joinSpans(stmt.varType?.span ?? stmt.nameSpan, stmt.iterable.span));
        this.trace?.declare(binding);
        completion = this.exec(stmt.body, iteration);
      } finally {
        this.trace?.popScope();
      }
      if (completion.kind === "break") break;
      if (completion.kind === "return") return completion;
    }
    return NORMAL;
  }

  private execSwitch(stmt: Switch, env: Environment): Completion {
    this.trace?.beginStep("condition", stmt.discriminant.span);
    const subject = this.evaluate(stmt.discriminant, env);
    if (isError(subject)) return NORMAL;
    const switchEnv = new Environment(env, "switch");
    this.trace?.pushScope(switchEnv, switchEnv.label);
    try {
      return this.runSwitch(stmt, subject, switchEnv);
    } finally {
      this.trace?.popScope();
    }
  }

  private runSwitch(stmt: Switch, subject: Value, switchEnv: Environment): Completion {
    // Find the first case that matches; from there every statement runs until a break (fall-through).
    let start = -1;
    for (let i = 0; i < stmt.cases.length && start === -1; i++) {
      const branch = stmt.cases[i];
      if (!branch) continue;
      const candidate = this.evaluate(branch.test, switchEnv);
      if (isError(candidate)) continue;
      const equal = this.valuesEqual(subject, candidate);
      if (equal === undefined) {
        this.semantic(branch.test.span, `cannot compare ${subject.type} with ${candidate.type}`);
      } else if (equal) {
        start = i;
      }
    }

    const bodies: (readonly Statement[])[] = stmt.cases.map((branch) => branch.body);
    if (stmt.default) bodies.push(stmt.default.body);
    const first = start !== -1 ? start : stmt.default ? stmt.cases.length : -1;
    if (first === -1) return NORMAL;
    for (let i = first; i < bodies.length; i++) {
      const body = bodies[i] as readonly Statement[];
      this.hoist(body, switchEnv);
      for (const statement of body) {
        const completion = this.exec(statement, switchEnv);
        if (completion.kind === "break") return NORMAL;
        if (completion !== NORMAL) return completion;
      }
    }
    return NORMAL;
  }

  private execUpdate(stmt: Update, env: Environment): void {
    this.tick(stmt.span);
    const location = this.locate(stmt.target, env);
    if (location === null) return;
    const current = location.get();
    if (isError(current)) return;
    if (current.type !== "int" && current.type !== "float") {
      this.semantic(stmt.span, `'${stmt.op}' needs an int or a float, but this is ${current.type}`);
      return;
    }
    if (current.value === null) {
      this.semantic(stmt.span, `cannot apply '${stmt.op}' to null`);
      return;
    }
    const delta = stmt.op === "++" ? 1 : -1;
    const next = (current.value as number) + delta;
    location.set({ type: current.type, value: current.type === "int" ? next | 0 : next });
  }

  // ---------- locations (things that can be assigned to) ----------

  private locate(target: LValue, env: Environment): Location | null {
    switch (target.kind) {
      case "Identifier":
        return this.locateVariable(target, env);
      case "Index":
        return this.locateElement(target, env);
      case "Member":
        return this.locateField(target, env);
    }
  }

  /**
   * A name inside a method means, in this order: a variable or parameter of the method, a field of `this`, then
   * whatever is outside the class. So a field wins over a global variable of the same name.
   */
  private lookupName(name: string, env: Environment): Entry | FieldRef | undefined {
    for (let scope: Environment | null = env; scope !== null; scope = scope.parent) {
      const own = scope.getOwn(name);
      if (own !== undefined) return own;
      const self = scope.getOwn("this");
      if (self?.kind === "variable" && self.value instanceof OakObject) {
        const info = this.classes.get(self.type)?.fields.find((f) => f.name === name);
        if (info !== undefined) return { kind: "field", object: self.value, info };
      }
    }
    return undefined;
  }

  private fieldLocation(struct: OakStruct, field: { readonly name: string; readonly type: string }): Location {
    return {
      type: field.type,
      get: () => ({ type: field.type, value: struct.values.get(field.name) }),
      set: (value) => {
        struct.values.set(field.name, coerce(value, field.type));
        this.trace?.setField(struct, field.name);
        return { type: field.type, value: struct.values.get(field.name) };
      },
      clear: () => {
        struct.values.set(field.name, null);
        this.trace?.setField(struct, field.name);
      },
    };
  }

  private locateVariable(target: Identifier, env: Environment): Location | null {
    const entry = this.lookupName(target.name, env);
    if (entry === undefined) {
      this.semantic(target.span, `variable '${target.name}' is not declared`);
      return null;
    }
    if (entry.kind === "field") {
      if (!this.canUse(entry.info.access, entry.info.owner, env)) {
        this.semantic(target.span, `'${target.name}' is private in '${entry.info.owner.name}'`);
        return null;
      }
      return this.fieldLocation(entry.object, entry.info);
    }
    if (entry.kind !== "variable") {
      this.semantic(target.span, `'${target.name}' is a ${entry.kind}, not a variable`);
      return null;
    }
    const binding = entry;
    return {
      get type() {
        return binding.type;
      },
      get: () => (binding.poisoned ? ERROR : { type: binding.type, value: binding.value }),
      set: (value) => {
        if (binding.type === "error") binding.type = value.type;
        binding.value = coerce(value, binding.type);
        binding.poisoned = false;
        this.trace?.setVariable(binding);
        return { type: binding.type, value: binding.value };
      },
      clear: () => {
        binding.value = null;
        binding.poisoned = true;
        this.trace?.setVariable(binding);
      },
    };
  }

  private locateElement(target: Index, env: Environment): Location | null {
    const slot = this.resolveElement(target, env);
    if (slot === null) return null;
    const { array, position } = slot;
    const elementType = array.elementType;
    return {
      type: elementType,
      get: () => ({ type: elementType, value: array.items[position] }),
      set: (value) => {
        array.items[position] = coerce(value, elementType);
        this.trace?.setItem(array, position);
        return { type: elementType, value: array.items[position] };
      },
      clear: () => {
        array.items[position] = null;
        this.trace?.setItem(array, position);
      },
    };
  }

  private locateField(target: Member, env: Environment): Location | null {
    const object = this.evaluate(target.object, env);
    if (isError(object)) return null;
    const staticClass = this.classes.get(object.type);
    if (staticClass !== undefined) {
      // The fields are those of the type the variable was declared with, even if the object is a subclass.
      const info = staticClass.fields.find((f) => f.name === target.name);
      if (info === undefined) {
        this.semantic(target.nameSpan, `class '${staticClass.name}' has no field '${target.name}'`);
        return null;
      }
      if (!this.canUse(info.access, info.owner, env)) {
        this.semantic(target.nameSpan, `'${target.name}' is private in '${info.owner.name}'`);
        return null;
      }
      if (!(object.value instanceof OakObject)) {
        this.runtime(target.span, `cannot use field '${target.name}' of null`);
        return null;
      }
      return this.fieldLocation(object.value, info);
    }
    if (!(object.value instanceof OakStruct)) {
      if (object.value === null && !isArrayType(object.type) && !isPrimitive(object.type)) {
        this.runtime(target.span, `cannot use field '${target.name}' of null`);
      } else {
        this.semantic(target.span, `cannot assign to '${target.name}' of a value of type ${object.type}`);
      }
      return null;
    }
    const struct = object.value;
    const field = struct.fields.find((f) => f.name === target.name);
    if (field === undefined) {
      this.semantic(target.nameSpan, `struct '${struct.name}' has no field '${target.name}'`);
      return null;
    }
    return {
      type: field.type,
      get: () => ({ type: field.type, value: struct.values.get(field.name) }),
      set: (value) => {
        struct.values.set(field.name, coerce(value, field.type));
        this.trace?.setField(struct, field.name);
        return { type: field.type, value: struct.values.get(field.name) };
      },
      clear: () => {
        struct.values.set(field.name, null);
        this.trace?.setField(struct, field.name);
      },
    };
  }

  /** Evaluates `a[i]` down to the array and the checked position; reports every way it can go wrong. */
  private resolveElement(target: Index, env: Environment): { array: OakArray; position: number } | null {
    const base = this.evaluate(target.target, env);
    const index = this.evaluate(target.index, env);
    if (isError(base) || isError(index)) return null;
    if (!isArrayType(base.type)) {
      this.semantic(target.target.span, `cannot index a value of type ${base.type}`);
      return null;
    }
    if (!(base.value instanceof OakArray)) {
      this.runtime(target.span, "cannot index null");
      return null;
    }
    if (index.type !== "int" || index.value === null) {
      this.semantic(target.index.span, `an array index must be an int, but it is ${index.type}`);
      return null;
    }
    const position = index.value as number;
    const length = base.value.items.length;
    if (position < 0 || position >= length) {
      this.runtime(target.index.span, `index ${position} is out of range for an array of length ${length}`);
      return null;
    }
    return { array: base.value, position };
  }

  // ---------- expressions ----------

  private evaluate(expression: Expression, env: Environment): Value {
    this.tick(expression.span);
    switch (expression.kind) {
      case "Literal": {
        switch (expression.literalType) {
          case "int":
            if ((expression.value as number) > INT_MAX) {
              return this.semantic(expression.span, `the number ${expression.value} is too large for an int`);
            }
            return int(expression.value as number);
          case "null":
            return NULL;
          default:
            return { type: expression.literalType, value: expression.value };
        }
      }
      case "Identifier":
        return this.readVariable(expression, env);
      case "Group":
        return this.evaluate(expression.expression, env);
      case "Unary":
        return this.evalUnary(expression, env);
      case "Binary":
        return this.evalBinary(expression, env);
      case "Ternary":
        return this.evalTernary(expression, env);
      case "Assign":
        return this.evalAssign(expression, env);
      case "Call": {
        // Only a call can give back void, and void is not a value anywhere except in an expression statement.
        const result = this.evalCall(expression, env);
        return result.type === "void" ? this.semantic(expression.span, "this call returns no value") : result;
      }
      case "Index": {
        const slot = this.resolveElement(expression, env);
        if (slot === null) return ERROR;
        return { type: slot.array.elementType, value: slot.array.items[slot.position] };
      }
      case "Member":
        return this.evalMember(expression, env);
      case "NewArray":
        return this.evalNewArray(expression, env);
      case "StructLiteral":
        return this.evalStructLiteral(expression, env);
      case "NewObject":
        return this.evalNewObject(expression, env);
      case "This": {
        const self = env.lookup("this");
        if (self?.kind !== "variable") return this.semantic(expression.span, "'this' can only be used inside a method or a constructor of a class");
        return { type: self.type, value: self.value };
      }
      case "Super":
        return this.semantic(expression.span, "'super' can only be used as super(...) or as super.method(...)");
      case "SuperCall":
        return this.semantic(expression.span, "super(...) can only be the first statement of a constructor");
    }
  }

  private readVariable(node: Identifier, env: Environment): Value {
    const entry = this.lookupName(node.name, env);
    if (entry === undefined) return this.semantic(node.span, `variable '${node.name}' is not declared`);
    if (entry.kind === "field") {
      if (!this.canUse(entry.info.access, entry.info.owner, env)) return this.semantic(node.span, `'${node.name}' is private in '${entry.info.owner.name}'`);
      return { type: entry.info.type, value: entry.object.values.get(entry.info.name) };
    }
    if (entry.kind !== "variable") {
      return this.semantic(node.span, `'${node.name}' is a ${entry.kind}${entry.kind === "function" ? "; call it as " + node.name + "(...)" : ""}`);
    }
    if (entry.poisoned) return ERROR;
    return { type: entry.type, value: entry.value };
  }

  private evalUnary(node: Unary, env: Environment): Value {
    if (node.op === "-" && node.operand.kind === "Literal" && node.operand.literalType === "int" && node.operand.value === INT_MAX + 1) {
      this.tick(node.operand.span);
      return int(INT_MIN);
    }
    const operand = this.evaluate(node.operand, env);
    if (isError(operand)) return ERROR;
    if (node.op === "typeof") return { type: "string", value: operand.type };
    if (operand.value === null) return this.semantic(node.span, `cannot apply '${node.op}' to null`);
    if (node.op === "!") {
      if (operand.type !== "boolean") return this.semantic(node.span, `cannot apply '!' to ${operand.type}`);
      return boolean(!(operand.value as boolean));
    }
    if (operand.type === "float") return { type: "float", value: -(operand.value as number) };
    if (operand.type === "int" || operand.type === "char") return int((-numberOf(operand)) | 0);
    return this.semantic(node.span, `cannot apply '-' to ${operand.type}`);
  }

  private evalBinary(node: Binary, env: Environment): Value {
    if (node.op === "&&" || node.op === "||") return this.evalLogical(node, env);
    const left = this.evaluate(node.left, env);
    const right = this.evaluate(node.right, env);
    return this.binaryOp(node.op, left, right, node.span);
  }

  private evalLogical(node: Binary, env: Environment): Value {
    const left = this.evaluate(node.left, env);
    if (isError(left)) return ERROR;
    if (left.type !== "boolean" || left.value === null) {
      return this.semantic(node.left.span, `cannot apply '${node.op}' to ${left.value === null ? "null" : left.type}`);
    }
    // Short circuit: the right side is not evaluated when the left side decides.
    if (node.op === "&&" && left.value === false) return boolean(false);
    if (node.op === "||" && left.value === true) return boolean(true);
    const right = this.evaluate(node.right, env);
    if (isError(right)) return ERROR;
    if (right.type !== "boolean" || right.value === null) {
      return this.semantic(node.right.span, `cannot apply '${node.op}' to ${right.value === null ? "null" : right.type}`);
    }
    return boolean(right.value as boolean);
  }

  private binaryOp(op: Binary["op"], left: Value, right: Value, span: Span): Value {
    if (isError(left) || isError(right)) return ERROR;

    if (op === "==" || op === "!=") {
      const equal = this.valuesEqual(left, right);
      if (equal === undefined) return this.semantic(span, `cannot compare ${left.type} with ${right.type}`);
      return boolean(op === "==" ? equal : !equal);
    }

    // Anything added to a string is joined to it, like in Java.
    if (op === "+" && (left.type === "string" || right.type === "string")) {
      return { type: "string", value: display(left.value, left.type) + display(right.value, right.type) };
    }

    if (left.value === null || right.value === null) {
      return this.semantic(span, `cannot apply '${op}' to null`);
    }

    const isComparison = op === "<" || op === "<=" || op === ">" || op === ">=";
    if (isComparison && left.type === "string" && right.type === "string") {
      const a = left.value as string;
      const b = right.value as string;
      return boolean(op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);
    }

    if (!isNumeric(left.type) || !isNumeric(right.type)) {
      return this.semantic(span, `cannot apply '${op}' to ${left.type} and ${right.type}`);
    }
    const a = numberOf(left);
    const b = numberOf(right);

    if (isComparison) return boolean(op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);

    const wide = left.type === "float" || right.type === "float";
    if ((op === "/" || op === "%") && b === 0) return this.runtime(span, "division by zero");
    switch (op) {
      case "+":
        return wide ? { type: "float", value: a + b } : int((a + b) | 0);
      case "-":
        return wide ? { type: "float", value: a - b } : int((a - b) | 0);
      case "*":
        return wide ? { type: "float", value: a * b } : int(Math.imul(a, b));
      case "/":
        return wide ? { type: "float", value: a / b } : int(Math.trunc(a / b) | 0);
      case "%":
        return wide ? { type: "float", value: a % b } : int((a % b) | 0);
      default:
        return this.semantic(span, `cannot apply '${op}' to ${left.type} and ${right.type}`);
    }
  }

  /** `undefined` means the two types cannot be compared at all. */
  private valuesEqual(left: Value, right: Value): boolean | undefined {
    if (left.value === null || right.value === null) return left.value === null && right.value === null;
    if (isNumeric(left.type) && isNumeric(right.type)) return numberOf(left) === numberOf(right);
    if (left.type !== right.type && !this.assignable(left.type, right.type) && !this.assignable(right.type, left.type)) return undefined;
    return left.value === right.value;
  }

  private evalTernary(node: Ternary, env: Environment): Value {
    const condition = this.evalCondition(node.condition, env);
    if (condition === null) return ERROR;
    const value = this.evaluate(condition ? node.whenTrue : node.whenFalse, env);
    // `a ? b : c` has one type, whichever side is chosen: `true ? 1 : 2.5` is the float 1.0 (spec S-14).
    const unified = this.hints?.get(node);
    if (unified === undefined || isError(value) || value.value === null) return value;
    if (unified === "float" && (value.type === "int" || value.type === "char")) return { type: "float", value: numberOf(value) };
    if (unified === "int" && value.type === "char") return int(numberOf(value));
    return value;
  }

  private evalAssign(node: Assign, env: Environment): Value {
    const location = this.locate(node.target, env);
    if (location === null) return ERROR;
    let value = this.evaluate(node.value, env);
    if (node.op !== "=") {
      const current = location.get();
      value = this.binaryOp(node.op === "+=" ? "+" : "-", current, value, node.span);
    }
    if (isError(value)) {
      location.clear();
      return ERROR;
    }
    if (location.type !== "error" && !this.assignable(value.type, location.type)) {
      this.semantic(node.value.span, `cannot assign ${value.type} to ${location.type}`);
      location.clear();
      return ERROR;
    }
    return location.set(value);
  }

  private evalMember(node: Member, env: Environment): Value {
    const object = this.evaluate(node.object, env);
    if (isError(object)) return ERROR;
    if (isArrayType(object.type)) {
      if (node.name !== "length") return this.semantic(node.nameSpan, `arrays have no member '${node.name}' (they have length, indexOf and join)`);
      if (!(object.value instanceof OakArray)) return this.runtime(node.span, "cannot read length of null");
      return int(object.value.items.length);
    }
    const staticClass = this.classes.get(object.type);
    if (staticClass !== undefined) {
      const info = staticClass.fields.find((f) => f.name === node.name);
      if (info === undefined) {
        if (this.findMethod(staticClass, node.name) !== null) return this.semantic(node.nameSpan, `'${node.name}' is a method of '${staticClass.name}'; call it as ${node.name}(...)`);
        return this.semantic(node.nameSpan, `class '${staticClass.name}' has no field '${node.name}'`);
      }
      if (!this.canUse(info.access, info.owner, env)) return this.semantic(node.nameSpan, `'${node.name}' is private in '${info.owner.name}'`);
      if (!(object.value instanceof OakObject)) return this.runtime(node.span, `cannot read field '${node.name}' of null`);
      return { type: info.type, value: object.value.values.get(info.name) };
    }
    if (object.value instanceof OakStruct) {
      const field = object.value.fields.find((f) => f.name === node.name);
      if (field === undefined) return this.semantic(node.nameSpan, `struct '${object.value.name}' has no field '${node.name}'`);
      return { type: field.type, value: object.value.values.get(field.name) };
    }
    if (object.value === null && !isPrimitive(object.type)) return this.runtime(node.span, `cannot read field '${node.name}' of null`);
    return this.semantic(node.nameSpan, `a value of type ${object.type} has no member '${node.name}'`);
  }

  private evalNewArray(node: NewArray, env: Environment): Value {
    if (!this.typeExists(node.elementType, env)) return this.semantic(node.span, `unknown type '${node.elementType}'`);
    const sizes: number[] = [];
    for (const sizeExpression of node.sizes) {
      const size = this.evaluate(sizeExpression, env);
      if (isError(size)) return ERROR;
      if (size.type !== "int" || size.value === null) {
        return this.semantic(sizeExpression.span, `an array size must be an int, but it is ${size.type}`);
      }
      if ((size.value as number) < 0) return this.runtime(sizeExpression.span, `an array size cannot be negative (${size.value})`);
      sizes.push(size.value as number);
    }
    const total = sizes.reduce((product, size) => product * size, 1);
    if (total > this.limits.maxArrayElements) {
      return this.runtime(node.span, `the array is too large (limit: ${this.limits.maxArrayElements.toLocaleString("en-US")} elements)`);
    }
    const build = (level: number): OakArray => {
      const elementType = arrayTypeOf(node.elementType, sizes.length - 1 - level);
      const length = sizes[level] as number;
      if (level === sizes.length - 1) return new OakArray(elementType, new Array<unknown>(length).fill(defaultFor(elementType)));
      return new OakArray(elementType, Array.from({ length }, () => build(level + 1)));
    };
    return { type: arrayTypeOf(node.elementType, sizes.length), value: build(0) };
  }

  private evalStructLiteral(node: StructLiteral, env: Environment): Value {
    const entry = env.lookup(node.structName);
    if (entry?.kind !== "struct") return this.semantic(node.span, `unknown struct '${node.structName}'`);
    const values = new Map<string, unknown>(entry.fields.map((f) => [f.name, null]));
    const given = new Set<string>();
    for (const init of node.fields) {
      const field = entry.fields.find((f) => f.name === init.name);
      const value = this.evaluate(init.value, env);
      if (field === undefined) {
        this.semantic(init.nameSpan, `struct '${node.structName}' has no field '${init.name}'`);
        continue;
      }
      if (given.has(init.name)) {
        this.semantic(init.nameSpan, `the field '${init.name}' is given twice`);
        continue;
      }
      given.add(init.name);
      if (isError(value)) continue;
      if (!this.assignable(value.type, field.type)) {
        this.semantic(init.value.span, `the field '${init.name}' of '${node.structName}' must be ${field.type}, but it is ${value.type}`);
        continue;
      }
      values.set(field.name, coerce(value, field.type));
    }
    return { type: node.structName, value: new OakStruct(node.structName, entry.fields, values) };
  }

  // ---------- calls ----------

  private evalCall(node: Call, env: Environment): Value {
    if (node.callee.kind === "Member") return this.evalMethod(node, node.callee, env);
    if (node.callee.kind !== "Identifier") return this.semantic(node.callee.span, "only a function name can be called");

    const name = node.callee.name;
    // Inside a method, `speak()` means `this.speak()`; the methods of the class come before functions and built-ins.
    const self = env.lookup("this");
    if (self?.kind === "variable" && self.value instanceof OakObject) {
      const method = this.findMethod(this.classes.get(self.type) ?? null, name);
      if (method !== null) {
        const args = node.args.map((arg) => this.evaluate(arg, env));
        if (args.some(isError)) return ERROR;
        return this.callMethod(self.value, method, args, node, node.callee.span, env);
      }
    }

    const entry = env.lookup(name);
    const args = node.args.map((arg) => this.evaluate(arg, env));

    if (entry === undefined) {
      const builtin = BUILTINS.get(name);
      if (builtin === undefined) return this.semantic(node.callee.span, `function '${name}' is not declared`);
      if (args.length !== builtin.params) {
        return this.semantic(node.span, `${name} expects ${builtin.params} argument${builtin.params === 1 ? "" : "s"} but got ${args.length}`);
      }
      if (args.some(isError)) return ERROR;
      return builtin.call({ fail: (message) => this.semantic(node.span, message), now: () => new Date(this.now()) }, args, name);
    }
    if (entry.kind !== "function") return this.semantic(node.callee.span, `'${name}' is a ${entry.kind}, not a function`);
    return this.invoke(entry.decl, entry.closure, `function ${name}`, name, args, node, null);
  }

  /**
   * Runs a function, a method or a constructor body. `self` is the object of a method call: it becomes `this`,
   * whose type is the class that wrote the method (so what a method may use is decided by where it is written).
   */
  private invoke(decl: Callable, closure: Environment, label: string, frameName: string, args: Value[], node: Call, self: { readonly object: OakObject; readonly cls: ClassInfo } | null): Value {
    const name = decl.name;
    if (args.length !== decl.params.length) {
      return this.semantic(node.span, `'${name}' expects ${decl.params.length} argument${decl.params.length === 1 ? "" : "s"} but got ${args.length}`);
    }
    if (args.some(isError)) return ERROR;

    const scope = new Environment(closure, label);
    const bindings: Binding[] = [];
    if (self !== null) {
      const thisBinding: Binding = { kind: "variable", name: "this", type: self.cls.name, value: self.object, poisoned: false, declaredAt: self.cls.declaredAt };
      scope.declare(thisBinding);
      bindings.push(thisBinding);
    }
    const params = this.bindParameters(decl.params, scope, closure, args, node.args, name, node.span);
    if (params === null) return ERROR;
    bindings.push(...params);

    this.depth++;
    if (this.depth > this.limits.maxDepth) {
      this.abort(node.span, `stack overflow: more than ${this.limits.maxDepth} calls nested inside each other`);
    }
    const site = this.trace?.currentSpan() ?? node.span;
    if (this.trace !== null) {
      this.trace.pushFrame(frameName);
      this.trace.pushScope(scope, scope.label);
      for (const binding of bindings) this.trace.declare(binding, true);
    }
    let completion: Completion;
    try {
      completion = this.execBlock(decl.body.body, scope);
    } finally {
      this.depth--;
    }

    const result = this.callResult(decl, completion, node);
    this.trace?.endCall(site, result);
    return result;
  }

  /** Checks the arguments against the parameters and declares them in `scope`. Null after reporting a problem. */
  private bindParameters(params: readonly Param[], scope: Environment, closure: Environment, args: readonly Value[], argNodes: readonly Expression[], name: string, span: Span): Binding[] | null {
    const bindings: Binding[] = [];
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const arg = args[i];
      if (!param || !arg) continue;
      const type = typeNameOf(param.type);
      if (!this.typeExists(type, closure)) {
        this.semantic(param.type.span, `unknown type '${baseTypeOf(type)}'`);
        return null;
      }
      if (!this.assignable(arg.type, type)) {
        this.semantic(argNodes[i]?.span ?? span, `argument ${i + 1} of '${name}' must be ${type}, but it is ${arg.type}`);
        return null;
      }
      const binding: Binding = {
        kind: "variable",
        name: param.name,
        type,
        value: coerce(arg, type),
        poisoned: false,
        declaredAt: param.nameSpan,
      };
      if (!scope.declare(binding)) {
        this.semantic(param.nameSpan, `the parameter '${param.name}' is declared twice`);
        return null;
      }
      bindings.push(binding);
      this.addSymbol(param.name, isArrayType(type) ? "array" : "variable", type, scope, param.nameSpan);
    }
    return bindings;
  }

  /** What a finished call gives back, after checking it against the declared return type. */
  private callResult(decl: Callable, completion: Completion, node: Call): Value {
    const name = decl.name;
    const returnType = typeNameOf(decl.returnType);
    if (returnType === "void") {
      if (completion.kind === "return" && completion.value !== null && !isError(completion.value)) {
        this.semantic(node.span, `'${name}' is void and cannot return a value`);
      }
      return VOID;
    }
    if (completion.kind !== "return" || completion.value === null) {
      return this.runtime(decl.nameSpan, `'${name}' must return a value of type ${returnType}`);
    }
    const result = completion.value;
    if (isError(result)) return ERROR;
    if (!this.assignable(result.type, returnType)) {
      return this.semantic(node.span, `'${name}' must return ${returnType}, but it returned ${result.type}`);
    }
    return { type: returnType, value: coerce(result, returnType) };
  }

  // ---------- objects ----------

  /**
   * Calls `method` (found in the type the variable was declared with) on `receiver`. The version that runs is the
   * one of the object's real class: that is what makes `Animal a = new Dog(); a.speak();` run Dog's method.
   */
  private callMethod(receiver: OakObject, method: MethodInfo, args: Value[], node: Call, nameSpan: Span, env: Environment): Value {
    if (!this.canUse(method.access, method.owner, env)) return this.semantic(nameSpan, `'${method.name}' is private in '${method.owner.name}'`);
    const target = this.findMethod(receiver.cls, method.name) ?? method;
    const label = `${target.owner.name}.${target.name}`;
    return this.invoke(target.decl, this.global, `method ${label}`, label, args, node, { object: receiver, cls: target.owner });
  }

  private evalNewObject(node: NewObject, env: Environment): Value {
    const args = node.args.map((arg) => this.evaluate(arg, env));
    const cls = this.classes.get(node.className);
    if (cls === undefined) {
      const found = env.lookup(node.className);
      return this.semantic(node.classSpan, found?.kind === "struct" ? `'${node.className}' is a struct: create it with ${node.className}{...}, not with new` : `unknown class '${node.className}'`);
    }
    if (args.some(isError)) return ERROR;
    const values = new Map<string, unknown>(cls.fields.map((f) => [f.name, fieldDefault(f.type)]));
    const object = new OakObject(cls, cls.fields.map((f) => ({ name: f.name, type: f.type })), values);
    return this.construct(cls, object, args, node.args, node.span, env) ? { type: cls.name, value: object } : ERROR;
  }

  /**
   * Runs the constructor of `cls` on `object`: first the parent's (with super(...) or with no arguments), then the
   * initial values of this class's fields, then the rest of the body. False after reporting a problem.
   */
  private construct(cls: ClassInfo, object: OakObject, args: Value[], argNodes: readonly Expression[], span: Span, env: Environment): boolean {
    if (args.some(isError)) return false;
    let ctor: CtorInfo | null = null;
    if (cls.ctors.length === 0) {
      if (args.length !== 0) {
        this.semantic(span, `'${cls.name}' has no constructor with arguments, but ${args.length} ${args.length === 1 ? "was" : "were"} given`);
        return false;
      }
    } else {
      ctor = cls.ctors.find((c) => c.decl.params.length === args.length) ?? null;
      if (ctor === null) {
        const arities = cls.ctors.map((c) => c.decl.params.length).sort((a, b) => a - b);
        this.semantic(span, `no constructor of '${cls.name}' takes ${args.length} argument${args.length === 1 ? "" : "s"}; it takes ${arities.join(" or ")}`);
        return false;
      }
      if (!this.canUse(ctor.access, cls, env)) {
        this.semantic(span, `the constructor of '${cls.name}' is private`);
        return false;
      }
    }

    const scope = new Environment(this.global, `method ${cls.name}.new`);
    const self: Binding = { kind: "variable", name: "this", type: cls.name, value: object, poisoned: false, declaredAt: cls.declaredAt };
    scope.declare(self);
    const params = ctor === null ? [] : this.bindParameters(ctor.decl.params, scope, this.global, args, argNodes, cls.name, span);
    if (params === null) return false;

    this.depth++;
    if (this.depth > this.limits.maxDepth) {
      this.abort(span, `stack overflow: more than ${this.limits.maxDepth} calls nested inside each other`);
    }
    const site = this.trace?.currentSpan() ?? span;
    if (this.trace !== null) {
      this.trace.pushFrame(`new ${cls.name}`);
      this.trace.pushScope(scope, scope.label);
      this.trace.declare(self, true);
      for (const binding of params) this.trace.declare(binding, true);
    }

    let ok = true;
    try {
      const body = ctor === null ? [] : ctor.decl.body.body;
      const first = body[0];
      const superCall = first?.kind === "ExprStmt" && first.expression.kind === "SuperCall" ? first.expression : null;

      if (cls.parent !== null) {
        let superArgs: Value[] = [];
        if (superCall !== null && first !== undefined) {
          this.tick(first.span);
          this.trace?.beginStep("statement", first.span);
          superArgs = superCall.args.map((arg) => this.evaluate(arg, scope));
        }
        ok = this.construct(cls.parent, object, superArgs, superCall?.args ?? [], superCall?.span ?? cls.declaredAt, scope);
      }

      if (ok) {
        // An initial value sees `this` and the names outside the class, not the parameters of the constructor.
        const initScope = new Environment(this.global, scope.label);
        initScope.declare(self);
        for (const info of cls.fields) {
          if (info.owner !== cls || info.init === null) continue;
          const value = this.evalInitializer(info.init, info.type, initScope);
          if (isError(value)) continue;
          if (!this.assignable(value.type, info.type)) {
            this.semantic(info.init.span, `cannot assign ${value.type} to the field '${info.name}' of type ${info.type}`);
            continue;
          }
          object.values.set(info.name, coerce({ type: value.type, value: this.copyIfArrayVariable(value, info.init) }, info.type));
          this.trace?.setField(object, info.name);
        }

        const rest = superCall !== null ? body.slice(1) : body;
        this.hoist(rest, scope);
        for (const statement of rest) {
          const completion = this.exec(statement, scope);
          if (completion.kind === "return") {
            if (completion.value !== null && !isError(completion.value)) this.semantic(statement.span, "a constructor cannot return a value");
            break;
          }
          if (completion !== NORMAL) break;
        }
      }
    } finally {
      this.depth--;
    }
    this.trace?.endCall(site, VOID);
    return ok;
  }

  /** `array.indexOf(x)` and `array.join()`, and the methods of objects, including `super.method()`. */
  private evalMethod(node: Call, callee: Member, env: Environment): Value {
    if (callee.object.kind === "Super") return this.evalSuperMethod(node, callee, env);
    const object = this.evaluate(callee.object, env);
    const args = node.args.map((arg) => this.evaluate(arg, env));
    if (isError(object) || args.some(isError)) return ERROR;

    const staticClass = this.classes.get(object.type);
    if (staticClass !== undefined) {
      const method = this.findMethod(staticClass, callee.name);
      if (method === null) {
        const isField = staticClass.fields.some((f) => f.name === callee.name);
        return this.semantic(callee.nameSpan, isField ? `'${callee.name}' is a field of '${staticClass.name}', not a method` : `class '${staticClass.name}' has no method '${callee.name}'`);
      }
      if (!(object.value instanceof OakObject)) return this.runtime(node.span, `cannot call ${callee.name} on null`);
      return this.callMethod(object.value, method, args, node, callee.nameSpan, env);
    }
    if (!isArrayType(object.type)) {
      return this.semantic(callee.nameSpan, `a value of type ${object.type} has no method '${callee.name}'`);
    }
    if (!(object.value instanceof OakArray)) return this.runtime(node.span, `cannot call ${callee.name} on null`);
    const array = object.value;

    if (callee.name === "join") {
      if (args.length !== 0) return this.semantic(node.span, "join expects no arguments");
      return { type: "string", value: array.items.map((item) => display(item, array.elementType)).join(", ") };
    }
    if (callee.name === "indexOf") {
      if (args.length !== 1) return this.semantic(node.span, "indexOf expects 1 argument");
      const wanted = args[0] as Value;
      if (!this.assignable(wanted.type, array.elementType)) {
        return this.semantic(node.args[0]?.span ?? node.span, `indexOf needs a ${array.elementType}, but got ${wanted.type}`);
      }
      const position = array.items.findIndex((item) => {
        const equal = this.valuesEqual({ type: array.elementType, value: item }, wanted);
        return equal === true;
      });
      return int(position);
    }
    return this.semantic(callee.nameSpan, `arrays have no method '${callee.name}' (they have length, indexOf and join)`);
  }

  /** `super.method(args)`: the parent's version, whatever the real class overrides. */
  private evalSuperMethod(node: Call, callee: Member, env: Environment): Value {
    const self = env.lookup("this");
    if (self?.kind !== "variable" || !(self.value instanceof OakObject)) {
      return this.semantic(callee.object.span, "'super' can only be used inside a method or a constructor of a class");
    }
    const parent = this.classes.get(self.type)?.parent ?? null;
    if (parent === null) return this.semantic(callee.object.span, `'${self.type}' has no parent class, so 'super' cannot be used`);
    const method = this.findMethod(parent, callee.name);
    const args = node.args.map((arg) => this.evaluate(arg, env));
    if (method === null) return this.semantic(callee.nameSpan, `'${parent.name}' has no method '${callee.name}'`);
    if (args.some(isError)) return ERROR;
    if (!this.canUse(method.access, method.owner, env)) return this.semantic(callee.nameSpan, `'${method.name}' is private in '${method.owner.name}'`);
    const label = `${method.owner.name}.${method.name}`;
    return this.invoke(method.decl, this.global, `method ${label}`, label, args, node, { object: self.value, cls: method.owner });
  }
}
