import { diagnostic, type Diagnostic, type Phase } from "../diagnostics";
import type {
  ArrayLiteral,
  Assign,
  Binary,
  Call,
  Expression,
  For,
  Foreach,
  FuncDecl,
  Identifier,
  Index,
  Initializer,
  LValue,
  Member,
  NewArray,
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
import { Environment, type Binding, type FunctionEntry, type StructEntry } from "./environment";
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
} from "./types";
import {
  deepCopyArray,
  defaultFor,
  display,
  ERROR,
  isError,
  NULL,
  OakArray,
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
  return new Interpreter({ ...DEFAULT_LIMITS, ...options.limits }, options.now ?? Date.now, options.trace ?? true).run(program);
}

class Interpreter {
  private readonly output: string[] = [];
  private outputLength = 0;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly seenDiagnostics = new Set<string>();
  private diagnosticsFull = false;
  private readonly global = new Environment(null, "global");
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
    for (const statement of statements) {
      if (statement.kind === "StructDecl") this.declareStruct(statement, env);
      else if (statement.kind === "FuncDecl") this.declareFunction(statement, env);
    }
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
    return env.lookup(base)?.kind === "struct";
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
        } else if (!isAssignable(value.type, type)) {
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
      } else if (!isAssignable(value.type, elementType)) {
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
      if (!isAssignable(elementType, declared)) {
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

  private locateVariable(target: Identifier, env: Environment): Location | null {
    const entry = env.lookup(target.name);
    if (entry === undefined) {
      this.semantic(target.span, `variable '${target.name}' is not declared`);
      return null;
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
    }
  }

  private readVariable(node: Identifier, env: Environment): Value {
    const entry = env.lookup(node.name);
    if (entry === undefined) return this.semantic(node.span, `variable '${node.name}' is not declared`);
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
    if (left.type !== right.type) return undefined;
    return left.value === right.value;
  }

  private evalTernary(node: Ternary, env: Environment): Value {
    const condition = this.evalCondition(node.condition, env);
    if (condition === null) return ERROR;
    return this.evaluate(condition ? node.whenTrue : node.whenFalse, env);
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
    if (location.type !== "error" && !isAssignable(value.type, location.type)) {
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
      if (!isAssignable(value.type, field.type)) {
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
    return this.callFunction(entry, args, node);
  }

  private callFunction(entry: FunctionEntry, args: Value[], node: Call): Value {
    const decl = entry.decl;
    const name = decl.name;
    if (args.length !== decl.params.length) {
      return this.semantic(node.span, `'${name}' expects ${decl.params.length} argument${decl.params.length === 1 ? "" : "s"} but got ${args.length}`);
    }
    if (args.some(isError)) return ERROR;

    const scope = new Environment(entry.closure, `function ${name}`);
    const bindings: Binding[] = [];
    for (let i = 0; i < decl.params.length; i++) {
      const param = decl.params[i];
      const arg = args[i];
      if (!param || !arg) continue;
      const type = typeNameOf(param.type);
      if (!this.typeExists(type, entry.closure)) return this.semantic(param.type.span, `unknown type '${baseTypeOf(type)}'`);
      if (!isAssignable(arg.type, type)) {
        return this.semantic(node.args[i]?.span ?? node.span, `argument ${i + 1} of '${name}' must be ${type}, but it is ${arg.type}`);
      }
      const binding: Binding = {
        kind: "variable",
        name: param.name,
        type,
        value: coerce(arg, type),
        poisoned: false,
        declaredAt: param.nameSpan,
      };
      if (!scope.declare(binding)) return this.semantic(param.nameSpan, `the parameter '${param.name}' is declared twice`);
      bindings.push(binding);
      this.addSymbol(param.name, isArrayType(type) ? "array" : "variable", type, scope, param.nameSpan);
    }

    this.depth++;
    if (this.depth > this.limits.maxDepth) {
      this.abort(node.span, `stack overflow: more than ${this.limits.maxDepth} calls nested inside each other`);
    }
    const site = this.trace?.currentSpan() ?? node.span;
    if (this.trace !== null) {
      this.trace.pushFrame(name);
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

  /** What a finished call gives back, after checking it against the declared return type. */
  private callResult(decl: FuncDecl, completion: Completion, node: Call): Value {
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
    if (!isAssignable(result.type, returnType)) {
      return this.semantic(node.span, `'${name}' must return ${returnType}, but it returned ${result.type}`);
    }
    return { type: returnType, value: coerce(result, returnType) };
  }

  /** `array.indexOf(x)` and `array.join()`. */
  private evalMethod(node: Call, callee: Member, env: Environment): Value {
    const object = this.evaluate(callee.object, env);
    const args = node.args.map((arg) => this.evaluate(arg, env));
    if (isError(object) || args.some(isError)) return ERROR;
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
      if (!isAssignable(wanted.type, array.elementType)) {
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
}
