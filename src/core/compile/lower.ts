import type { CheckResult } from "../check/check";
import { superCallOf, type ClassInfo, type MethodInfo } from "../classes";
import { diagnostic, type Diagnostic } from "../diagnostics";
import type {
  ArrayLiteral,
  Assign,
  Binary,
  Call,
  CtorDecl,
  Expression,
  For,
  Foreach,
  FuncDecl,
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
  StructLiteral,
  Switch,
  Ternary,
  Unary,
  Update,
  VarDecl,
} from "../parser/ast";
import type { Span } from "../span";
import { INT_MAX, INT_MIN, typeNameOf } from "../types";
import { DEFAULT_LIMITS } from "../interpreter/limits";
import { HOST_IMPORTS, type FailSite, type HostName } from "./host";
import { ARRAY_HEADER, HEAP, MAX_PAGES, MEMORY_RUNTIME_NAMES, memoryRuntime, type MemoryRuntimeName } from "./runtime";
import { emptyModule, ir, type DataSegment, type Expr, type Func, type Global, type Import, type Local, type Module, type ValType } from "./ir";

/** What `lower` produces: the module, the table of places that can fail, and what it could not translate. */
export interface LowerResult {
  readonly module: Module;
  readonly sites: readonly FailSite[];
  /** Constructs the compiler does not translate (yet). A program with any is not compiled. */
  readonly diagnostics: Diagnostic[];
}

/**
 * Translates a program that the type checker accepted into the IR (plan D15). The checker has already decided the
 * type of every expression; here each one becomes instructions of that type. Nothing the user can write makes this
 * throw: what cannot be translated is reported as a diagnostic.
 */
export function lower(program: Program, checked: CheckResult): LowerResult {
  return new Lowerer(checked).run(program);
}

/** A name in the program and where it lives in the module. */
interface Binding {
  readonly wasm: string;
  readonly type: string;
  readonly kind: "local" | "global" | "field" | "frame" | "function";
  /** For a field: where it is inside the object that `this` points to. For a variable in a frame: where it is in the frame. */
  readonly offset?: number;
  /** For a variable in a frame: the function that declared it. */
  readonly owner?: FnInfo;
  /** For a function declared inside another: what is needed to call it. */
  readonly target?: FuncBinding;
}

/**
 * One function being lowered. A variable that a function declared inside it mentions (a name that appears in the inner
 * body, which is a safe over-estimate) cannot stay in a local of WebAssembly: it lives in a *frame*, a small record in
 * memory made when the function starts, and the inner function is given a pointer to it. A frame's first word points to
 * the frame of the function around it, so that a function can reach the variables of every function that encloses it.
 */
interface FnInfo {
  readonly parent: FnInfo | null;
  /** True for a function declared inside another: it takes the enclosing frame as its parameter `$up`. */
  readonly nested: boolean;
  /** The names that need a place in a frame. */
  readonly boxed: ReadonlySet<string>;
  /** Does this function make a frame? (It declares at least one variable that an inner function mentions.) */
  readonly hasFrame: boolean;
  slots: number;
  /** What runs after the frame is made: the parameters that live in it are copied there. */
  readonly prologue: Expr[];
}

/** A function declared inside another: the name of its WebAssembly function and the function it sits in. */
interface FuncBinding {
  readonly wasm: string;
  readonly decl: FuncDecl;
  readonly parent: FnInfo;
}

interface LoopLabels {
  readonly brk: string;
  readonly cont: string | null;
}

/** Where the first free address is, once the static strings have been placed. Address 0 is `null`. */
const FIRST_ADDRESS = 8;
/** An object or a struct is `[vtable base: i32][mark: i32][fields]`. The mark is set while it is being shown, to find cycles. */
const OBJECT_HEADER = 8;
const MARK = 4;
/** The global that counts how many calls are open at the moment. */
const DEPTH = "depth";
const PAGE = 65536;

const valType = (type: string): ValType => (type === "float" ? "f64" : "i32");

const isArray = (type: string): boolean => type.endsWith("[]");
const elementOf = (type: string): string => type.slice(0, -2);
/** The size of an element as a power of two: a float takes 8 bytes, everything else (ints, chars, booleans, addresses) 4. */
const shiftOf = (elementType: string): number => (elementType === "float" ? 3 : 2);
const loadOf = (elementType: string): "f64.load" | "i32.load" => (elementType === "float" ? "f64.load" : "i32.load");
const storeOf = (elementType: string): "f64.store" | "i32.store" => (elementType === "float" ? "f64.store" : "i32.store");
/** A type name made safe to use inside the name of a function. */
const mangle = (type: string): string => type.replace(/\[\]/g, "_arr");

/** A place an assignment or an update can write: a variable or an element. `setup` runs first (it works out an element's address once). */
interface Place {
  readonly type: string;
  readonly setup: Expr[];
  read(): Expr;
  write(value: Expr): Expr;
}

/** Where the fields of a struct or a class are, and how much memory an instance takes. */
interface Layout {
  readonly fields: Map<string, { readonly offset: number; readonly type: string }>;
  readonly order: readonly { readonly name: string; readonly type: string; readonly offset: number }[];
  readonly size: number;
}

/** A class: its fields, the names of its virtual methods (slot k + 1 of its vtable), and where the vtable is once one exists. */
interface ClassLayout extends Layout {
  readonly slots: readonly string[];
  vbase: number | null;
}

const paramType = (param: Param): string => typeNameOf(param.type);


class Lowerer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly sites: FailSite[] = [];
  private readonly functions: Func[] = [];
  private readonly globals: Global[] = [];
  private readonly data: DataSegment[] = [];
  private readonly strings = new Map<string, number>();
  private readonly used = new Set<HostName>();
  private readonly runtime = new Map<string, Func>();
  private readonly structs = new Map<string, Layout>();
  private readonly classLayouts = new Map<string, ClassLayout>();
  private readonly table: string[] = [];
  private usesTable = false;
  private readonly building = new Set<string>();
  private dataEnd = FIRST_ADDRESS;
  private counter = 0;

  // The function being lowered.
  private locals: Local[] = [];
  private scopes: Map<string, Binding>[] = [];
  private loops: LoopLabels[] = [];
  private returnType = "void";
  private owner: ClassInfo | null = null;
  private fn: FnInfo = { parent: null, nested: false, boxed: new Set(), hasFrame: false, slots: 0, prologue: [] };
  private promoted = new Set<string>();
  private topScope = new Map<string, Binding>();

  constructor(private readonly checked: CheckResult) {}

  run(program: Program): LowerResult {
    // A top-level variable that a function mentions has to be a global; the others stay locals of main, which is faster.
    for (const statement of program.body) {
      if (statement.kind === "FuncDecl") collectNames(statement.body, this.promoted);
      else if (statement.kind === "ClassDecl") collectNames(statement, this.promoted);
      else if (statement.kind === "StructDecl") this.structs.set(statement.name, this.layoutOf(statement.fields.map((field) => ({ name: field.name, type: typeNameOf(field.type) }))));
    }

    // The globals exist before any function is lowered: a function may mention one declared further down.
    const topScope = new Map<string, Binding>();
    for (const statement of program.body) {
      if (statement.kind !== "VarDecl" || !this.promoted.has(statement.name)) continue;
      const type = statement.declaredType === null ? this.typeOf(statement.init as Expression) : statement.declaredType.name + "[]".repeat(statement.declaredType.dims);
      const wasm = `g.${statement.name}`;
      this.globals.push({ name: wasm, type: valType(type), mutable: true, init: 0 });
      topScope.set(statement.name, { wasm, type, kind: "global" });
    }
    this.topScope = topScope;

    const topLevel = program.body.filter((s) => s.kind !== "FuncDecl" && s.kind !== "StructDecl");
    for (const statement of program.body) {
      if (statement.kind === "FuncDecl") this.functionDecl(statement);
      else if (statement.kind === "ClassDecl") this.classDecl(statement);
    }

    this.locals = [];
    this.scopes = [topScope];
    this.loops = [];
    this.returnType = "void";
    this.owner = null;
    this.fn = this.makeFn(null, false, [], topLevel);
    this.registerFunctions(topLevel);
    const body: Expr[] = [];
    for (const statement of topLevel) body.push(...this.statement(statement, true));
    this.functions.unshift({ name: "main", export: "main", params: [], results: [], locals: this.locals, body: this.withFrame(body, program.span) });

    return { module: this.build(), sites: this.sites, diagnostics: this.diagnostics };
  }

  private build(): Module {
    const imports: Import[] = [...this.used].map((name) => ({
      module: "env",
      field: name,
      name: `env:${name}`,
      signature: { params: HOST_IMPORTS[name].params as readonly ValType[], results: HOST_IMPORTS[name].results as readonly ValType[] },
    }));
    // A call through the table needs a table even when no object was ever made (every such call then meets a null first).
    if (this.usesTable && this.table.length === 0) {
      this.table.push("rt:trap");
      this.runtime.set("rt:trap", { name: "rt:trap", params: [], results: [], locals: [], body: [ir.unreachable()] });
    }
    const pages = Math.max(1, Math.ceil(this.dataEnd / PAGE));
    // The first free address is right after the static data, rounded up to a multiple of 8.
    const heapStart = (this.dataEnd + 7) & ~7;
    const globals = this.globals.map((g) => (g.name === HEAP ? { ...g, init: heapStart } : g));
    return { ...emptyModule, imports, functions: [...this.functions, ...this.runtime.values()], globals, memory: { min: pages, max: MAX_PAGES }, data: this.data, table: this.table };
  }

  // ---------- small helpers ----------

  private unsupported(span: Span, what: string): void {
    this.diagnostics.push(diagnostic("semantic", `${what} cannot be compiled yet`, span));
  }

  private host(name: HostName): string {
    this.used.add(name);
    return `env:${name}`;
  }

  private site(span: Span, message: string, phase?: "semantic"): number {
    this.sites.push(phase === undefined ? { span, message } : { span, message, phase });
    return this.sites.length - 1;
  }

  private fresh(prefix: string): string {
    return `${prefix}.${++this.counter}`;
  }

  private typeOf(e: Expression): string {
    const type = this.checked.types.get(e);
    if (type === undefined) throw new Error(`the checker recorded no type for an expression at line ${e.span.start.line}`);
    return type;
  }

  /** A string literal lives in the data segment as a string object: its length, then its 16-bit code units. */
  private stringLiteral(text: string): number {
    const known = this.strings.get(text);
    if (known !== undefined) return known;
    const bytes = new Uint8Array(4 + text.length * 2);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, text.length, true);
    for (let i = 0; i < text.length; i++) view.setUint16(4 + i * 2, text.charCodeAt(i), true);
    const address = this.dataEnd;
    this.data.push({ offset: address, bytes });
    this.dataEnd = (address + bytes.length + 7) & ~7;
    this.strings.set(text, address);
    return address;
  }

  /** The numeric conversions of an assignment or an operation: int and char widen to float, the rest stay as they are. */
  private convert(e: Expr, from: string, to: string): Expr {
    if (to === "float" && from !== "float") {
      return e.kind === "const" && e.type === "i32" ? ir.f64(e.value) : ir.op("f64.convert_i32_s", e);
    }
    return e;
  }

  // ---------- scopes ----------

  private lookup(name: string): Binding {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i]?.get(name);
      if (found !== undefined) return found;
    }
    throw new Error(`the checker accepted a name that has no variable: ${name}`);
  }

  /** Declares a variable in the current scope: a local of the function, or a global when it is a top-level one a function uses. */
  private declare(name: string, type: string, topLevel: boolean): Binding {
    let binding: Binding;
    const existing = topLevel && this.scopes.length === 1 ? this.topScope.get(name) : undefined;
    if (existing !== undefined) {
      binding = existing; // a top-level variable a function uses: its global was made before the functions were lowered
    } else if (this.fn.boxed.has(name)) {
      binding = { wasm: "", type, kind: "frame", offset: 8 + 8 * this.fn.slots++, owner: this.fn };
    } else {
      const wasm = `${name}.${++this.counter}`;
      this.locals.push({ name: wasm, type: valType(type) });
      binding = { wasm, type, kind: "local" };
    }
    this.scopes[this.scopes.length - 1]?.set(name, binding);
    return binding;
  }

  private read(binding: Binding): Expr {
    if (binding.kind === "field") return ir.load(loadOf(binding.type), ir.get("this"), binding.offset);
    if (binding.kind === "frame") return ir.load(loadOf(binding.type), this.envOf(binding.owner as FnInfo), binding.offset);
    return binding.kind === "local" ? ir.get(binding.wasm) : ir.getGlobal(binding.wasm);
  }

  private write(binding: Binding, value: Expr): Expr {
    if (binding.kind === "field") return ir.store(storeOf(binding.type), ir.get("this"), value, binding.offset);
    if (binding.kind === "frame") return ir.store(storeOf(binding.type), this.envOf(binding.owner as FnInfo), value, binding.offset);
    return binding.kind === "local" ? ir.set(binding.wasm, value) : ir.setGlobal(binding.wasm, value);
  }

  private inScope<T>(body: () => T): T {
    this.scopes.push(new Map());
    try {
      return body();
    } finally {
      this.scopes.pop();
    }
  }

  // ---------- functions ----------

  /** A function, or a method when `owner` is given: then `this` is its first parameter and the fields are in scope. */
  private functionDecl(decl: FuncDecl | MethodDecl, owner: ClassInfo | null = null): void {
    this.lowerFunction(decl, owner === null ? decl.name : `${owner.name}.${decl.name}`, owner, null);
  }

  /**
   * Lowers one function: a top-level one, a method, or (with `inside`) one declared inside another, which also takes the
   * frame of the function around it. A function sees the top-level variables that were made global and, inside another
   * function, the variables declared before it in the functions around it; nothing else outside it.
   */
  private lowerFunction(decl: FuncDecl | MethodDecl, wasmName: string, owner: ClassInfo | null, inside: FnInfo | null): void {
    const saved = { locals: this.locals, scopes: this.scopes, loops: this.loops, returnType: this.returnType, owner: this.owner, fn: this.fn };
    this.locals = [];
    this.scopes = inside !== null ? [...saved.scopes, new Map()] : owner === null ? [this.topScope, new Map()] : [this.topScope, this.fieldScope(owner), new Map()];
    this.loops = [];
    this.owner = owner;
    this.fn = this.makeFn(inside, inside !== null, decl.params, decl.body.body);
    this.returnType = typeNameOfReturn(decl);
    const own = this.scopes[this.scopes.length - 1] as Map<string, Binding>;
    const params: Local[] = decl.params.map((param) => this.bindParameter(own, param));
    if (inside !== null) params.unshift({ name: "$up", type: "i32" });
    if (owner !== null) params.unshift({ name: "this", type: "i32" });
    this.registerFunctions(decl.body.body);
    const body: Expr[] = [];
    for (const statement of decl.body.body) body.push(...this.statement(statement, false));
    // A function that is not void returns on every path (the checker saw to it); this tells the engine the end is not reached.
    if (this.returnType !== "void") body.push(ir.unreachable());
    this.functions.push({
      name: wasmName,
      params,
      results: this.returnType === "void" ? [] : [valType(this.returnType)],
      locals: this.locals,
      body: this.withFrame(body, decl.span),
    });
    ({ locals: this.locals, scopes: this.scopes, loops: this.loops, returnType: this.returnType, owner: this.owner, fn: this.fn } = saved);
  }

  /** What is known about a function before its body is lowered: which of its variables live in a frame. */
  private makeFn(parent: FnInfo | null, nested: boolean, params: readonly Param[], body: readonly Statement[]): FnInfo {
    const boxed = new Set<string>();
    for (const inner of nestedFunctions(body)) collectNames(inner, boxed);
    const hasFrame = [...params.map((p) => p.name), ...declaredNames(body)].some((name) => boxed.has(name));
    return { parent, nested, boxed, hasFrame, slots: 0, prologue: [] };
  }

  /** A parameter is a local of the function, unless an inner function mentions it: then it is copied into the frame. */
  private bindParameter(scope: Map<string, Binding>, param: Param): Local {
    const type = paramType(param);
    if (this.fn.boxed.has(param.name)) {
      const offset = 8 + 8 * this.fn.slots++;
      scope.set(param.name, { wasm: "", type, kind: "frame", offset, owner: this.fn });
      this.fn.prologue.push(ir.store(storeOf(type), ir.get("$frame"), ir.get(param.name), offset));
    } else {
      scope.set(param.name, { wasm: param.name, type, kind: "local" });
    }
    return { name: param.name, type: valType(type) };
  }

  /** The body of the function being lowered, with the making of its frame in front when it has one. */
  private withFrame(body: Expr[], span: Span): Expr[] {
    if (!this.fn.hasFrame) return body;
    this.locals.push({ name: "$frame", type: "i32" });
    const make = ir.call(this.runtimeFunction("alloc"), ir.i32(8 + 8 * this.fn.slots), ir.i32(this.site(span, "out of memory")));
    return [ir.set("$frame", make), ir.store("i32.store", ir.get("$frame"), this.fn.nested ? ir.get("$up") : ir.i32(0)), ...this.fn.prologue, ...body];
  }

  /** The frame (or the nearest one above) that belongs to `target`, as seen from the function being lowered. */
  private envOf(target: FnInfo): Expr {
    const current = this.fn;
    if (current === target) return target.hasFrame ? ir.get("$frame") : target.nested ? ir.get("$up") : ir.i32(0);
    let pointer: Expr = ir.get("$up");
    for (let f = current.parent; f !== null && f !== target; f = f.parent) if (f.hasFrame) pointer = ir.load("i32.load", pointer);
    return pointer;
  }

  /** The functions declared directly in a list of statements can be called from anywhere in it, before their line too. */
  private registerFunctions(statements: readonly Statement[]): void {
    const scope = this.scopes[this.scopes.length - 1] as Map<string, Binding>;
    for (const statement of statements) {
      if (statement.kind !== "FuncDecl" || scope.has(`fn ${statement.name}`)) continue;
      scope.set(`fn ${statement.name}`, { wasm: "", type: "", kind: "function", target: { wasm: `${statement.name}.${++this.counter}`, decl: statement, parent: this.fn } });
    }
  }

  private lookupFunction(name: string): FuncBinding | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i]?.get(`fn ${name}`);
      if (found?.target !== undefined) return found.target;
    }
    return null;
  }

  /** A call to a function declared inside another: the frame it needs goes with the arguments. */
  private callNested(e: Call, target: FuncBinding): Expr {
    const decl = target.decl;
    const hidden: Expr[] = [...(this.owner === null ? [] : [ir.get("this")]), this.envOf(target.parent)];
    const types: ValType[] = [...hidden.map(() => "i32" as ValType), ...decl.params.map((param) => valType(paramType(param)))];
    const returns = typeNameOfReturn(decl);
    return this.guarded(ir.call(target.wasm, ...hidden, ...this.convertArgs(decl.params, e.args)), types, returns === "void" ? null : valType(returns), e.span);
  }

  // ---------- statements ----------

  private statement(s: Statement, topLevel: boolean): Expr[] {
    switch (s.kind) {
      case "Block":
        return this.inScope(() => {
          this.registerFunctions(s.body);
          return s.body.flatMap((child) => this.statement(child, false));
        });
      case "ExprStmt":
        if (s.expression.kind === "SuperCall") return [];
        return [this.effect(s.expression)];
      case "Update":
        return [this.update(s)];
      case "Print":
        return this.print(s.args);
      case "If": {
        const cond = this.expression(s.condition);
        const then = this.inScope(() => this.statement(s.then, false));
        const otherwise = s.otherwise ? this.inScope(() => this.statement(s.otherwise as Statement, false)) : null;
        return [ir.if(cond, then, otherwise)];
      }
      case "While":
        return this.whileLoop(s.condition, s.body);
      case "For":
        return this.forLoop(s);
      case "Foreach":
        return this.foreach(s);
      case "Switch":
        return this.switchStatement(s);
      case "Break": {
        const target = this.loops[this.loops.length - 1];
        return target ? [ir.br(target.brk)] : [];
      }
      case "Continue": {
        for (let i = this.loops.length - 1; i >= 0; i--) {
          const target = this.loops[i]?.cont;
          if (target) return [ir.br(target)];
        }
        return [];
      }
      case "Return": {
        if (s.value === null) return [ir.return(null)];
        return [ir.return(this.convert(this.expression(s.value), this.typeOf(s.value), this.returnType))];
      }
      case "VarDecl":
        return this.varDecl(s, topLevel);
      case "FuncDecl": {
        this.registerFunctions([s]);
        const target = this.lookupFunction(s.name) as FuncBinding;
        this.lowerFunction(s, target.wasm, this.owner, this.fn);
        return [];
      }
      case "StructDecl":
        return [];
      case "ClassDecl":
        return [];
    }
  }

  private varDecl(s: VarDecl, topLevel: boolean): Expr[] {
    const type = s.declaredType === null ? this.typeOf(s.init as Expression) : s.declaredType.name + "[]".repeat(s.declaredType.dims);
    // The initial value is lowered before the name exists, so that `int x = x;` does not see itself.
    const init = s.init === null ? null : this.initialValue(s.init, type, s.span);
    const binding = this.declare(s.name, type, topLevel);
    // A declaration with no value starts at zero every time it runs, as the interpreter's `null` does for a reference.
    return [this.write(binding, init ?? (valType(type) === "f64" ? ir.f64(0) : ir.i32(0)))];
  }

  /** The first value of a variable or a field. `int[] b = a;` copies the array (the course's "by copy"); every other way of getting an array shares it. */
  private initialValue(init: Initializer, type: string, span: Span): Expr {
    const value = this.initializer(init, type);
    if (init.kind === "Identifier" && isArray(type)) return ir.call(this.copyFunction(this.typeOf(init)), value, ir.i32(this.site(span, "out of memory")));
    return value;
  }

  private initializer(init: Initializer, type: string): Expr {
    if (init.kind === "ArrayLiteral") return this.arrayLiteral(init, type);
    return this.convert(this.expression(init), this.typeOf(init), type);
  }

  private whileLoop(condition: Expression, body: Statement): Expr[] {
    const brk = this.fresh("break");
    const top = this.fresh("continue");
    this.loops.push({ brk, cont: top });
    const inner = this.inScope(() => this.statement(body, false));
    this.loops.pop();
    return [ir.block(brk, [ir.loop(top, [ir.brIf(brk, ir.op("i32.eqz", this.expression(condition))), ...inner, ir.br(top)])])];
  }

  private forLoop(s: For): Expr[] {
    return this.inScope(() => {
      const init = s.init ? this.statement(s.init, false) : [];
      const brk = this.fresh("break");
      const top = this.fresh("loop");
      const next = this.fresh("continue");
      this.loops.push({ brk, cont: next });
      const body = this.inScope(() => this.statement(s.body, false));
      this.loops.pop();
      const update = s.update.kind === "Update" ? this.update(s.update) : this.effect(s.update);
      return [...init, ir.block(brk, [ir.loop(top, [ir.brIf(brk, ir.op("i32.eqz", this.expression(s.condition))), ir.block(next, body), update, ir.br(top)])])];
    });
  }

  /**
   * A switch: the cases are tried in order against the value; the first that is equal starts running, and each body
   * falls into the next one until a break. The bodies are written one after the other, each after a block whose end
   * is where its case jumps to, which is how fall-through comes for free. A reference (an object, a struct, an array)
   * is an address, and cases match it by identity, as `==` does.
   */
  private switchStatement(s: Switch): Expr[] {
    const subjectType = this.typeOf(s.discriminant);
    const subject = this.fresh("subject");
    this.locals.push({ name: subject, type: valType(subjectType) });
    const end = this.fresh("break");
    const labels = s.cases.map(() => this.fresh("case"));
    const fallback = s.default ? this.fresh("default") : end;

    const dispatch: Expr[] = [ir.set(subject, this.expression(s.discriminant))];
    s.cases.forEach((branch, i) => {
      const testType = this.typeOf(branch.test);
      const common = subjectType === "float" || testType === "float" ? "float" : "int";
      const equal = subjectType === "string"
        ? (testType === "string" ? ir.call(this.runtimeFunction("str_eq"), ir.get(subject), this.expression(branch.test)) : ir.op("i32.eq", ir.get(subject), this.expression(branch.test)))
        : common === "float"
        ? ir.op("f64.eq", this.convert(ir.get(subject), subjectType, "float"), this.convert(this.expression(branch.test), testType, "float"))
        : ir.op("i32.eq", ir.get(subject), this.expression(branch.test));
      dispatch.push(ir.if(equal, [ir.br(labels[i] as string)]));
    });
    dispatch.push(ir.br(fallback));

    // Build from the inside out: the innermost block holds the dispatch and ends just before the first body.
    this.loops.push({ brk: end, cont: null });
    const bodies: Expr[][] = this.inScope(() => [...s.cases.map((branch) => branch.body.flatMap((child) => this.statement(child, false))), ...(s.default ? [s.default.body.flatMap((child) => this.statement(child, false))] : [])]);
    this.loops.pop();

    const order = [...labels, ...(s.default ? [fallback] : [])];
    let nested: Expr = ir.block(order[0] ?? end, dispatch);
    for (let i = 0; i < order.length; i++) {
      const wrapper: Expr[] = [nested, ...(bodies[i] ?? [])];
      nested = i + 1 < order.length ? ir.block(order[i + 1] as string, wrapper) : ir.block(end, wrapper);
    }
    return order.length === 0 ? [ir.block(end, dispatch)] : [nested];
  }

  private update(s: Update): Expr {
    const place = this.placeOf(s.target, s.span);
    if (place === null) return ir.nop();
    const delta = s.op === "++" ? 1 : -1;
    const step = (current: Expr): Expr =>
      place.type === "float" ? ir.op("f64.add", current, ir.f64(delta)) : ir.op("i32.add", current, ir.i32(delta));
    return this.sequence(place.setup, place.write(step(place.read())), null);
  }

  private print(args: readonly Expression[]): Expr[] {
    // The interpreter works out every argument before it writes anything, so a call that prints, or a mistake, in a
    // later argument comes before the first one's text. The values wait in locals until the line is written.
    const out: Expr[] = [];
    const values = args.map((arg) => this.spill(this.expression(arg), this.typeOf(arg), out, true));
    args.forEach((arg, i) => {
      if (i > 0) out.push(ir.call(this.host("write_char"), ir.i32(32)));
      const type = this.typeOf(arg);
      const value = values[i] as Expr;
      switch (type) {
        case "int":
          out.push(ir.call(this.host("write_i32"), value));
          break;
        case "float":
          out.push(ir.call(this.host("write_f64"), value));
          break;
        case "boolean":
          out.push(ir.call(this.host("write_bool"), value));
          break;
        case "char":
          out.push(ir.call(this.host("write_char"), value));
          break;
        case "string":
        case "null":
          out.push(ir.call(this.host("write_string"), value));
          break;
        default:
          if (isArray(type) || this.isRecord(type)) out.push(ir.call(this.host("write_string"), this.toText(value, type, ir.i32(this.site(arg.span, "out of memory")), arg.span)));
          else this.unsupported(arg.span, `printing a ${type}`);
      }
    });
    out.push(ir.call(this.host("write_char"), ir.i32(10)));
    return out;
  }

  // ---------- expressions ----------

  /** An expression used as a statement: its value, if it has one, is dropped. */
  private effect(e: Expression): Expr {
    if (e.kind === "Assign") return this.assign(e, false);
    const value = this.expression(e, true);
    const type = this.typeOf(e);
    return type === "void" ? value : ir.drop(value);
  }

  private expression(e: Expression, allowVoid = false): Expr {
    void allowVoid;
    switch (e.kind) {
      case "Literal":
        return this.literal(e);
      case "Identifier":
        return this.read(this.lookup(e.name));
      case "Group":
        return this.expression(e.expression);
      case "Unary":
        return this.unary(e);
      case "Binary":
        return this.binary(e);
      case "Ternary":
        return this.ternary(e);
      case "Assign":
        return this.assign(e, true);
      case "Call":
        return this.call(e);
      case "Index": {
        const elementType = elementOf(this.typeOf(e.target));
        return ir.load(loadOf(elementType), this.elementAddress(e), ARRAY_HEADER);
      }
      case "Member":
        if (e.name === "length" && isArray(this.typeOf(e.object))) {
          return ir.call(this.runtimeFunction("array_length"), this.expression(e.object), ir.i32(this.site(e.span, "cannot read length of null")));
        }
        return this.fieldRead(e);
      case "NewArray":
        return this.newArray(e);
      case "StructLiteral":
        return this.structLiteral(e);
      case "NewObject":
        return this.newObject(e);
      case "This":
        return ir.get("this");
      case "Super":
      case "SuperCall":
        this.unsupported(e.span, "super here");
        return this.placeholder(e);
    }
  }

  /** A value of the right type for an expression that could not be translated, so the rest still can be. */
  private placeholder(e: Expression): Expr {
    return valType(this.checked.types.get(e) ?? "int") === "f64" ? ir.f64(0) : ir.i32(0);
  }

  private literal(e: Extract<Expression, { kind: "Literal" }>): Expr {
    switch (e.literalType) {
      case "int":
        return ir.i32(e.value as number);
      case "float":
        return ir.f64(e.value as number);
      case "boolean":
        return ir.i32(e.value === true ? 1 : 0);
      case "char":
        return ir.i32((e.value as string).charCodeAt(0));
      case "string":
        return ir.i32(this.stringLiteral(e.value as string));
      case "null":
        return ir.i32(0);
    }
  }

  private unary(e: Unary): Expr {
    if (e.op === "-" && e.operand.kind === "Literal" && e.operand.literalType === "int" && e.operand.value === INT_MAX + 1) return ir.i32(INT_MIN);
    const type = this.typeOf(e.operand);
    const operand = this.expression(e.operand);
    switch (e.op) {
      case "!":
        return ir.op("i32.eqz", operand);
      case "typeof":
        return ir.i32(this.stringLiteral(type));
      case "-":
        return type === "float" ? ir.op("f64.neg", operand) : ir.op("i32.sub", ir.i32(0), operand);
    }
  }

  private binary(e: Binary): Expr {
    const left = this.typeOf(e.left);
    const right = this.typeOf(e.right);

    if (e.op === "&&") return ir.if(this.expression(e.left), [this.expression(e.right)], [ir.i32(0)], "i32");
    if (e.op === "||") return ir.if(this.expression(e.left), [ir.i32(1)], [this.expression(e.right)], "i32");

    if (e.op === "==" || e.op === "!=") return this.equality(e, left, right);

    if (e.op === "+" && (left === "string" || right === "string")) {
      const site = this.site(e.span, "out of memory");
      return this.concat(this.toText(this.expression(e.left), left, ir.i32(site), e.left.span), this.toText(this.expression(e.right), right, ir.i32(site), e.right.span), site);
    }
    if (left === "string" && right === "string") {
      const order = this.runtimeFunction("str_cmp");
      const cmp = ir.call(order, this.expression(e.left), this.expression(e.right), ir.i32(this.site(e.span, `cannot apply '${e.op}' to null`)));
      const test = { "<": "i32.lt_s", "<=": "i32.le_s", ">": "i32.gt_s", ">=": "i32.ge_s" }[e.op as "<" | "<=" | ">" | ">="];
      return ir.op(test as "i32.lt_s", cmp, ir.i32(0));
    }

    const wide = left === "float" || right === "float";
    const a = this.convert(this.expression(e.left), left, wide ? "float" : "int");
    const b = this.convert(this.expression(e.right), right, wide ? "float" : "int");
    return wide ? this.floatOp(e, a, b) : this.intOp(e, a, b);
  }

  private intOp(e: Binary, a: Expr, b: Expr): Expr {
    switch (e.op) {
      case "+":
        return ir.op("i32.add", a, b);
      case "-":
        return ir.op("i32.sub", a, b);
      case "*":
        return ir.op("i32.mul", a, b);
      case "/":
        return ir.call(this.runtimeFunction("div_i32"), a, b, ir.i32(this.site(e.span, "division by zero")));
      case "%":
        return ir.call(this.runtimeFunction("rem_i32"), a, b, ir.i32(this.site(e.span, "division by zero")));
      case "<":
        return ir.op("i32.lt_s", a, b);
      case "<=":
        return ir.op("i32.le_s", a, b);
      case ">":
        return ir.op("i32.gt_s", a, b);
      case ">=":
        return ir.op("i32.ge_s", a, b);
      default:
        throw new Error(`an int operator that is not translated: ${e.op}`);
    }
  }

  private floatOp(e: Binary, a: Expr, b: Expr): Expr {
    switch (e.op) {
      case "+":
        return ir.op("f64.add", a, b);
      case "-":
        return ir.op("f64.sub", a, b);
      case "*":
        return ir.op("f64.mul", a, b);
      case "/":
        return ir.call(this.runtimeFunction("div_f64"), a, b, ir.i32(this.site(e.span, "division by zero")));
      case "%":
        return ir.call(this.runtimeFunction("rem_f64"), a, b, ir.i32(this.site(e.span, "division by zero")));
      case "<":
        return ir.op("f64.lt", a, b);
      case "<=":
        return ir.op("f64.le", a, b);
      case ">":
        return ir.op("f64.gt", a, b);
      case ">=":
        return ir.op("f64.ge", a, b);
      default:
        throw new Error(`a float operator that is not translated: ${e.op}`);
    }
  }

  private equality(e: Binary, left: string, right: string): Expr {
    const same = e.op === "==";
    if (left === "string" && right === "string") {
      const equal = ir.call(this.runtimeFunction("str_eq"), this.expression(e.left), this.expression(e.right));
      return same ? equal : ir.op("i32.eqz", equal);
    }
    if (left === "float" || right === "float") {
      const a = this.convert(this.expression(e.left), left, "float");
      const b = this.convert(this.expression(e.right), right, "float");
      return ir.op(same ? "f64.eq" : "f64.ne", a, b);
    }
    // Whole numbers and booleans, and references against null: all are an i32 compared with an i32.
    return ir.op(same ? "i32.eq" : "i32.ne", this.expression(e.left), this.expression(e.right));
  }

  private ternary(e: Ternary): Expr {
    const type = this.typeOf(e);
    const whenTrue = this.convert(this.expression(e.whenTrue), this.typeOf(e.whenTrue), type);
    const whenFalse = this.convert(this.expression(e.whenFalse), this.typeOf(e.whenFalse), type);
    return ir.if(this.expression(e.condition), [whenTrue], [whenFalse], valType(type));
  }

  /** The place an assignment or an update writes, or null (after saying so) when it is not one the compiler handles yet. */
  private placeOf(target: LValue, span: Span): Place | null {
    if (target.kind === "Identifier") {
      const binding = this.lookup(target.name);
      return { type: binding.type, setup: [], read: () => this.read(binding), write: (value) => this.write(binding, value) };
    }
    if (target.kind === "Index") {
      const elementType = elementOf(this.typeOf(target.target));
      // The address is worked out once, before the value: the interpreter checks the index first, then evaluates the value.
      const slot = this.fresh("slot");
      this.locals.push({ name: slot, type: "i32" });
      return {
        type: elementType,
        setup: [ir.set(slot, this.elementAddress(target))],
        read: () => ir.load(loadOf(elementType), ir.get(slot), ARRAY_HEADER),
        write: (value) => ir.store(storeOf(elementType), ir.get(slot), value, ARRAY_HEADER),
      };
    }
    const objectType = this.typeOf(target.object);
    const field = this.fieldOf(objectType, target.name);
    if (field === null) {
      this.unsupported(span, "assigning to a field of this kind");
      return null;
    }
    const load = (base: Expr): Expr => ir.load(loadOf(field.type), base, field.offset);
    const store = (base: Expr, value: Expr): Expr => ir.store(storeOf(field.type), base, value, field.offset);
    if (target.object.kind === "This") return { type: field.type, setup: [], read: () => load(ir.get("this")), write: (value) => store(ir.get("this"), value) };
    // The object is worked out and checked once, before the value: a null stops the program before the value is evaluated.
    const slot = this.fresh("slot");
    this.locals.push({ name: slot, type: "i32" });
    const checked = ir.call(this.runtimeFunction("non_null"), this.expression(target.object), ir.i32(this.site(target.span, `cannot use field '${target.name}' of null`)));
    return { type: field.type, setup: [ir.set(slot, checked)], read: () => load(ir.get(slot)), write: (value) => store(ir.get(slot), value) };
  }

  /** Statements that run in order, then a last one; a single block when there is something before it. */
  private sequence(before: readonly Expr[], last: Expr, result: ValType | null): Expr {
    return before.length === 0 ? last : ir.block(this.fresh("do"), [...before, last], result);
  }

  /**
   * A value that is safe to use after other code has run: a constant stays as it is, anything else waits in a new local.
   * A plain read of a local also stays unless `everything` says that code which could change it will run first.
   */
  private spill(value: Expr, type: string, before: Expr[], everything = false): Expr {
    if (value.kind === "const" || (!everything && value.kind === "local.get")) return value;
    const name = this.fresh("tmp");
    this.locals.push({ name, type: valType(type) });
    before.push(ir.set(name, value));
    return ir.get(name);
  }

  /** An assignment. As a value it leaves the assigned value on the stack; as a statement it leaves nothing. */
  private assign(e: Assign, asValue: boolean): Expr {
    const place = this.placeOf(e.target, e.span);
    if (place === null) return asValue ? this.placeholder(e) : ir.nop();
    const targetType = place.type;
    const before: Expr[] = [...place.setup];
    let value = this.expression(e.value);
    const valueType = this.typeOf(e.value);
    if (e.op === "=") {
      value = this.convert(value, valueType, targetType);
    } else {
      // The interpreter works out the value before it reads the place, so a call in the value may change the place first.
      value = this.spill(value, valueType, before);
      if (targetType === "string") {
        const site = this.site(e.span, "out of memory");
        value = this.concat(place.read(), this.toText(value, valueType, ir.i32(site), e.value.span), site);
      } else {
        const wide = targetType === "float" || valueType === "float";
        const current = this.convert(place.read(), targetType, wide ? "float" : "int");
        const operand = this.convert(value, valueType, wide ? "float" : "int");
        const synthetic: Binary = { kind: "Binary", op: e.op === "+=" ? "+" : "-", left: e.target, right: e.value, span: e.span };
        value = this.convert(wide ? this.floatOp(synthetic, current, operand) : this.intOp(synthetic, current, operand), wide ? "float" : "int", targetType);
      }
    }
    if (!asValue) return this.sequence(before, place.write(value), null);
    if (e.target.kind === "Identifier" && before.length === 0) {
      const binding = this.lookup(e.target.name);
      if (binding.kind === "local") return ir.tee(binding.wasm, value);
    }
    // The value is kept in a local so that it can be stored and then left as the result.
    const kept = this.fresh("kept");
    this.locals.push({ name: kept, type: valType(targetType) });
    return ir.block(this.fresh("assign"), [...before, ir.set(kept, value), place.write(ir.get(kept)), ir.get(kept)], valType(targetType));
  }

  // ---------- arrays ----------

  /** Where `a[i]` is, checked: the array may not be null and the index must be inside it. Two places can fail, hence two sites. */
  private elementAddress(e: Index): Expr {
    const elementType = elementOf(this.typeOf(e.target));
    const site = this.site(e.span, "cannot index null");
    this.site(e.index.span, "index {0} is out of range for an array of length {1}");
    return ir.call(this.runtimeFunction("elem_addr"), this.expression(e.target), this.expression(e.index), ir.i32(shiftOf(elementType)), ir.i32(site));
  }

  /** `new int[3]`, `new int[2][3]`: every size is worked out and checked first, in order, then the arrays are made, level by level. */
  private newArray(e: NewArray): Expr {
    const sizes = e.sizes.map(() => {
      const name = this.fresh("size");
      this.locals.push({ name, type: "i32" });
      return name;
    });
    const before = e.sizes.map((size, k) =>
      ir.set(sizes[k] as string, ir.call(this.runtimeFunction("check_size"), this.expression(size), ir.i32(this.site(size.span, "an array size cannot be negative ({0})")))),
    );
    // The interpreter refuses an array of more than a million elements in all (checked after every size is known and not negative).
    const limit = DEFAULT_LIMITS.maxArrayElements;
    const total = sizes.slice(1).reduce<Expr>((product, name) => ir.op("f64.mul", product, ir.op("f64.convert_i32_s", ir.get(name))), ir.op("f64.convert_i32_s", ir.get(sizes[0] as string)));
    const tooBig = ir.if(ir.op("f64.gt", total, ir.f64(limit)), [
      ir.call(this.host("fail"), ir.i32(this.site(e.span, `the array is too large (limit: ${limit.toLocaleString("en-US")} elements)`)), ir.i32(0), ir.i32(0)),
      ir.unreachable(),
    ]);
    const site = this.site(e.span, "out of memory");
    return ir.block(this.fresh("new"), [...before, tooBig, this.arrayLevel(e, 0, sizes, site)], "i32");
  }

  private arrayLevel(e: NewArray, level: number, sizes: readonly string[], site: number): Expr {
    const last = level === sizes.length - 1;
    const elementType = e.elementType + "[]".repeat(sizes.length - 1 - level);
    // Strings in a new array start as the empty string, not null (like the interpreter); everything else starts as zero.
    const fill = elementType === "string" ? this.stringLiteral("") : 0;
    const make = ir.call(this.runtimeFunction("new_array"), ir.get(sizes[level] as string), ir.i32(shiftOf(elementType)), ir.i32(fill), ir.i32(site));
    if (last) return make;
    const array = this.fresh("array");
    const i = this.fresh("i");
    this.locals.push({ name: array, type: "i32" }, { name: i, type: "i32" });
    const done = this.fresh("made");
    const next = this.fresh("next");
    return ir.block(this.fresh("rows"), [
      ir.set(array, make),
      ir.set(i, ir.i32(0)),
      ir.block(done, [
        ir.loop(next, [
          ir.brIf(done, ir.op("i32.ge_u", ir.get(i), ir.get(sizes[level] as string))),
          ir.store("i32.store", ir.op("i32.add", ir.get(array), ir.op("i32.shl", ir.get(i), ir.i32(2))), this.arrayLevel(e, level + 1, sizes, site), ARRAY_HEADER),
          ir.set(i, ir.op("i32.add", ir.get(i), ir.i32(1))),
          ir.br(next),
        ]),
      ]),
      ir.get(array),
    ], "i32");
  }

  /** `{1, 2, 3}` and `{{1, 2}, {3}}`: an array of exactly that many elements, each stored where it belongs. */
  private arrayLiteral(literal: ArrayLiteral, type: string): Expr {
    const elementType = elementOf(type);
    const array = this.fresh("list");
    this.locals.push({ name: array, type: "i32" });
    const site = this.site(literal.span, "out of memory");
    const size = 1 << shiftOf(elementType);
    const body: Expr[] = [ir.set(array, ir.call(this.runtimeFunction("new_array"), ir.i32(literal.elements.length), ir.i32(shiftOf(elementType)), ir.i32(0), ir.i32(site)))];
    literal.elements.forEach((element, k) => {
      body.push(ir.store(storeOf(elementType), ir.get(array), this.initializer(element, elementType), ARRAY_HEADER + k * size));
    });
    body.push(ir.get(array));
    return ir.block(this.fresh("literal"), body, "i32");
  }

  private foreach(s: Foreach): Expr[] {
    const arrayType = this.typeOf(s.iterable);
    const elementType = elementOf(arrayType);
    const declared = s.varType === null ? elementType : s.varType.name + "[]".repeat(s.varType.dims);
    const array = this.fresh("array");
    const count = this.fresh("count");
    const i = this.fresh("i");
    this.locals.push({ name: array, type: "i32" }, { name: count, type: "i32" }, { name: i, type: "i32" });
    const start = [
      ir.set(array, ir.call(this.runtimeFunction("non_null"), this.expression(s.iterable), ir.i32(this.site(s.iterable.span, "cannot loop over null")))),
      ir.set(count, ir.load("i32.load", ir.get(array))),
      ir.set(i, ir.i32(0)),
    ];
    return this.inScope(() => {
      const binding = this.declare(s.name, declared, false);
      const element = ir.load(loadOf(elementType), ir.op("i32.add", ir.get(array), ir.op("i32.shl", ir.get(i), ir.i32(shiftOf(elementType)))), ARRAY_HEADER);
      const brk = this.fresh("break");
      const top = this.fresh("loop");
      const next = this.fresh("continue");
      this.loops.push({ brk, cont: next });
      const body = this.inScope(() => this.statement(s.body, false));
      this.loops.pop();
      return [
        ...start,
        ir.block(brk, [
          ir.loop(top, [
            ir.brIf(brk, ir.op("i32.ge_u", ir.get(i), ir.get(count))),
            this.write(binding, this.convert(element, elementType, declared)),
            ir.block(next, body),
            ir.set(i, ir.op("i32.add", ir.get(i), ir.i32(1))),
            ir.br(top),
          ]),
        ]),
      ];
    });
  }

  /** The functions of `.join()` and `.indexOf(x)`; the other methods of arrays do not exist. */
  private arrayMethod(e: Call, callee: Member): Expr {
    const arrayType = this.typeOf(callee.object);
    const elementType = elementOf(arrayType);
    const array = this.expression(callee.object);
    if (callee.name === "join") {
      const text = this.joinFunction(arrayType, e.span);
      const checked = ir.call(this.runtimeFunction("non_null"), array, ir.i32(this.site(e.span, "cannot call join on null")));
      return ir.call(text, checked, ir.i32(this.site(e.span, "out of memory")));
    }
    const wanted = e.args[0] as Expression;
    const site = ir.i32(this.site(e.span, "cannot call indexOf on null"));
    if (elementType === "float") return ir.call(this.runtimeFunction("index_of_f64"), array, this.convert(this.expression(wanted), this.typeOf(wanted), "float"), site);
    return ir.call(this.runtimeFunction(elementType === "string" ? "index_of_str" : "index_of_i32"), array, this.expression(wanted), site);
  }

  // ---------- strings ----------

  private concat(a: Expr, b: Expr, site: number): Expr {
    return ir.call(this.runtimeFunction("str_concat"), a, b, ir.i32(site));
  }

  /** A value as the text that joining it to a string shows (like `display` in the interpreter), as a string object. */
  private toText(value: Expr, type: string, site: Expr, span: Span): Expr {
    switch (type) {
      case "string":
      case "null":
        return value;
      case "int":
        return ir.call(this.runtimeFunction("int_to_str"), value, site);
      case "char":
        return ir.call(this.runtimeFunction("char_to_str"), value, site);
      case "float":
        return ir.call(this.runtimeFunction("float_to_str"), value, site);
      case "boolean":
        return ir.if(value, [ir.i32(this.stringLiteral("true"))], [ir.i32(this.stringLiteral("false"))], "i32");
      default:
        if (isArray(type)) return ir.call(this.showFunction(type, true, span), value, site);
        if (this.checked.classes.get(type) !== undefined) return ir.call(this.showObject(), value, site);
        if (this.structs.has(type)) return ir.call(this.showRecord(type, this.structs.get(type) as Layout, span), value, site);
        this.unsupported(span, `joining a ${type} to a string`);
        return ir.i32(0);
    }
  }

  /** `rt:show:T`: an array as text, like `[1, 2, 3]` (or `null`). It makes a string for each element, then joins them. */
  private showFunction(type: string, bracketed: boolean, span: Span): string {
    const name = `rt:${bracketed ? "show" : "join"}:${mangle(type)}`;
    if (this.runtime.has(name)) return name;
    const elementType = elementOf(type);
    const marked = bracketed && this.isRefy(elementType);
    const get = ir.get;
    const element = ir.load(loadOf(elementType), ir.op("i32.add", get("a"), ir.op("i32.shl", get("i"), ir.i32(shiftOf(elementType)))), ARRAY_HEADER);
    const text = this.toText(element, elementType, get("site"), span);
    const make = ir.call(this.runtimeFunction("new_array"), get("n"), ir.i32(2), ir.i32(0), get("site"));
    this.runtime.set(name, {
      name,
      params: [{ name: "a", type: "i32" }, { name: "site", type: "i32" }],
      results: ["i32"],
      locals: [{ name: "n", type: "i32" }, { name: "i", type: "i32" }, { name: "strs", type: "i32" }, { name: "r", type: "i32" }],
      body: [
        // Showing null is the text "null"; joining it was checked (and failed) before this was called.
        ir.if(ir.op("i32.eqz", get("a")), [ir.return(ir.i32(this.stringLiteral("null")))]),
        // An array that can hold objects can hold itself: it is marked while it is shown, and met again it is `[...]`.
        ...(marked ? [ir.if(ir.load("i32.load", get("a"), MARK), [ir.return(ir.i32(this.stringLiteral("[...]")))]), ir.store("i32.store", get("a"), ir.i32(1), MARK)] : []),
        ir.set("n", ir.load("i32.load", get("a"))),
        ir.set("strs", make),
        ir.set("i", ir.i32(0)),
        ir.block("done", [
          ir.loop("next", [
            ir.brIf("done", ir.op("i32.ge_u", get("i"), get("n"))),
            ir.store("i32.store", ir.op("i32.add", get("strs"), ir.op("i32.shl", get("i"), ir.i32(2))), text, ARRAY_HEADER),
            ir.set("i", ir.op("i32.add", get("i"), ir.i32(1))),
            ir.br("next"),
          ]),
        ]),
        ...(marked
          ? [ir.set("r", ir.call(this.runtimeFunction("join_strings"), get("strs"), ir.i32(1), get("site"))), ir.store("i32.store", get("a"), ir.i32(0), MARK), get("r")]
          : [ir.call(this.runtimeFunction("join_strings"), get("strs"), ir.i32(bracketed ? 1 : 0), get("site"))]),
      ],
    });
    return name;
  }

  private joinFunction(type: string, span: Span): string {
    return this.showFunction(type, false, span);
  }

  /** `rt:copy:T`: a copy of an array, and of the arrays inside it (what `int[] b = a;` does). Other elements are shared. */
  private copyFunction(type: string): string {
    const name = `rt:copy:${mangle(type)}`;
    if (this.runtime.has(name)) return name;
    const elementType = elementOf(type);
    const get = ir.get;
    const bytes = ir.op("i32.add", ir.i32(ARRAY_HEADER), ir.op("i32.shl", get("n"), ir.i32(shiftOf(elementType))));
    const nested: Expr[] = isArray(elementType)
      ? [
          ir.set("i", ir.i32(0)),
          ir.block("done", [
            ir.loop("next", [
              ir.brIf("done", ir.op("i32.ge_u", get("i"), get("n"))),
              ir.store(
                "i32.store",
                ir.op("i32.add", get("p"), ir.op("i32.shl", get("i"), ir.i32(2))),
                ir.call(this.copyFunction(elementType), ir.load("i32.load", ir.op("i32.add", get("a"), ir.op("i32.shl", get("i"), ir.i32(2))), ARRAY_HEADER), get("site")),
                ARRAY_HEADER,
              ),
              ir.set("i", ir.op("i32.add", get("i"), ir.i32(1))),
              ir.br("next"),
            ]),
          ]),
        ]
      : [];
    this.runtime.set(name, {
      name,
      params: [{ name: "a", type: "i32" }, { name: "site", type: "i32" }],
      results: ["i32"],
      locals: [{ name: "n", type: "i32" }, { name: "p", type: "i32" }, { name: "i", type: "i32" }],
      body: [
        ir.if(ir.op("i32.eqz", get("a")), [ir.return(ir.i32(0))]),
        ir.set("n", ir.load("i32.load", get("a"))),
        ir.set("p", ir.call(this.runtimeFunction("alloc"), bytes, get("site"))),
        ir.op("memory.copy", get("p"), get("a"), bytes),
        ...nested,
        get("p"),
      ],
    });
    return name;
  }

  private call(e: Call): Expr {
    if (e.callee.kind === "Member") {
      const callee = e.callee;
      if (callee.object.kind === "Super") return this.superMethod(e, callee);
      const objectType = this.typeOf(callee.object);
      const info = this.checked.classes.get(objectType);
      const method = info === undefined ? null : this.checked.classes.findMethod(info, callee.name);
      if (info !== undefined && method !== null) return this.invoke(info, method, this.expression(callee.object), e, true, false);
      if (isArray(objectType) && (callee.name === "join" || callee.name === "indexOf")) return this.arrayMethod(e, callee);
      this.unsupported(e.span, "a method call");
      return this.placeholder(e);
    }
    if (e.callee.kind !== "Identifier") {
      this.unsupported(e.span, "a method call");
      return this.placeholder(e);
    }
    const name = e.callee.name;
    // Inside a method, `speak()` means `this.speak()`; the methods of the class come before functions.
    const own = this.owner === null ? null : this.checked.classes.findMethod(this.owner, name);
    if (this.owner !== null && own !== null) return this.invoke(this.owner, own, ir.get("this"), e, false, false);
    const nested = this.lookupFunction(name);
    if (nested !== null) return this.callNested(e, nested);
    const decl = this.checked.functions.get(name);
    if (decl === undefined) return this.builtin(e, name);
    const returns = typeNameOfReturn(decl);
    return this.guarded(ir.call(name, ...this.convertArgs(decl.params, e.args)), decl.params.map((param) => valType(paramType(param))), returns === "void" ? null : valType(returns), e.span);
  }

  /**
   * A call that counts how deep the calls are nested, like the interpreter (400, then `stack overflow` at the call). The
   * arguments are worked out first and wait in locals, so the count goes up just before the call and down just after it.
   */
  private guarded(call: Expr, types: readonly ValType[], result: ValType | null, span: Span): Expr {
    if (!this.globals.some((g) => g.name === DEPTH)) this.globals.push({ name: DEPTH, type: "i32", mutable: true, init: 0 });
    const before: Expr[] = [];
    const keep = (value: Expr, type: ValType): Expr => {
      if (value.kind === "const") return value;
      const name = this.fresh("arg");
      this.locals.push({ name, type });
      before.push(ir.set(name, value));
      return ir.get(name);
    };
    let inner: Expr;
    if (call.kind === "call") {
      inner = { ...call, args: call.args.map((arg, i) => keep(arg, types[i] as ValType)) };
    } else if (call.kind === "call_indirect") {
      const args = call.args.map((arg, i) => keep(arg, types[i] as ValType));
      inner = { ...call, args, index: keep(call.index, "i32") };
    } else {
      return call;
    }
    const site = this.site(span, `stack overflow: more than ${DEFAULT_LIMITS.maxDepth} calls nested inside each other`);
    const down = ir.setGlobal(DEPTH, ir.op("i32.sub", ir.getGlobal(DEPTH), ir.i32(1)));
    const body: Expr[] = [
      ...before,
      ir.setGlobal(DEPTH, ir.op("i32.add", ir.getGlobal(DEPTH), ir.i32(1))),
      ir.if(ir.op("i32.gt_s", ir.getGlobal(DEPTH), ir.i32(DEFAULT_LIMITS.maxDepth)), [ir.call(this.host("fail"), ir.i32(site), ir.i32(0), ir.i32(0)), ir.unreachable()]),
    ];
    if (result === null) return ir.block(this.fresh("nest"), [...body, inner, down]);
    const value = this.fresh("result");
    this.locals.push({ name: value, type: result });
    return ir.block(this.fresh("nest"), [...body, ir.set(value, inner), down, ir.get(value)], result);
  }

  /** The functions every program can call (`parseInt`, `toUpperCase`…): same names, same mistakes as the interpreter's. */
  private builtin(e: Call, name: string): Expr {
    const arg = e.args[0];
    const argType = arg === undefined ? "void" : this.typeOf(arg);
    const nullText = (): Expr => ir.call(this.runtimeFunction("non_null"), this.expression(arg as Expression), ir.i32(this.site(e.span, `${name} expects a string, but got ${argType}`, "semantic")));
    const memory = (): Expr => ir.i32(this.site(e.span, "out of memory"));
    switch (name) {
      case "parseInt":
      case "parseFloat":
      case "parsefloat": {
        // A run of places that can fail: null text, text that is not a number, and for an int, one that does not fit.
        const first = this.site(e.span, `${name} expects a string, but got ${argType}`, "semantic");
        const isInt = name === "parseInt";
        this.site(e.span, `${name} cannot convert "{s}" to ${isInt ? "an int" : "a float"}`, "semantic");
        if (isInt) this.site(e.span, `${name}: "{s}" does not fit in an int`, "semantic");
        return ir.call(this.host(isInt ? "parse_int" : "parse_float"), this.expression(arg as Expression), ir.i32(first));
      }
      case "toLowerCase":
        return ir.call(this.runtimeFunction("lower_str"), nullText(), memory());
      case "toUpperCase":
        return ir.call(this.runtimeFunction("upper_str"), nullText(), memory());
      case "time":
        return ir.call(this.runtimeFunction("time_str"), memory());
      case "obtenerLongitudArray":
        return ir.load("i32.load", ir.call(this.runtimeFunction("non_null"), this.expression(arg as Expression), ir.i32(this.site(e.span, `${name} received null instead of an array`, "semantic"))));
      case "toString": {
        const value = this.expression(arg as Expression);
        if (argType !== "string") return this.toText(value, argType, memory(), e.span);
        // A null string becomes the text "null", as the interpreter shows it.
        const kept = this.fresh("text");
        this.locals.push({ name: kept, type: "i32" });
        return ir.block(this.fresh("text"), [ir.set(kept, value), ir.if(ir.get(kept), [ir.get(kept)], [ir.i32(this.stringLiteral("null"))], "i32")], "i32");
      }
    }
    this.unsupported(e.span, `the built-in function ${name}`);
    return this.placeholder(e);
  }

  /** The arguments of a call, each widened to the type of its parameter. */
  private convertArgs(params: readonly Param[], args: readonly Expression[]): Expr[] {
    return args.map((arg, i) => {
      const param = params[i];
      return this.convert(this.expression(arg), this.typeOf(arg), param === undefined ? this.typeOf(arg) : paramType(param));
    });
  }

  // ---------- structs, classes and objects ----------

  /** Where each field goes: after the header, in order; a float starts on a multiple of 8. */
  private layoutOf(list: readonly { readonly name: string; readonly type: string }[]): Layout {
    const fields = new Map<string, { offset: number; type: string }>();
    const order: { name: string; type: string; offset: number }[] = [];
    let offset = OBJECT_HEADER;
    for (const field of list) {
      if (field.type === "float") offset = (offset + 7) & ~7;
      fields.set(field.name, { offset, type: field.type });
      order.push({ name: field.name, type: field.type, offset });
      offset += field.type === "float" ? 8 : 4;
    }
    return { fields, order, size: (offset + 7) & ~7 };
  }

  private classLayout(name: string): ClassLayout {
    const known = this.classLayouts.get(name);
    if (known !== undefined) return known;
    const info = this.checked.classes.get(name) as ClassInfo;
    // A subclass's fields and slots start with its parent's, so a variable typed as the parent finds them in the same place.
    const slots = info.parent === null ? [] : [...this.classLayout(info.parent.name).slots];
    for (const method of info.methods.keys()) if (!slots.includes(method)) slots.push(method);
    const layout: ClassLayout = { ...this.layoutOf(info.fields.map((field) => ({ name: field.name, type: field.type }))), slots, vbase: null };
    this.classLayouts.set(name, layout);
    return layout;
  }

  /** The vtable of a class, made the first time an object of it is created: its `show` function, then one entry per slot. */
  private vtableBase(name: string): number {
    const layout = this.classLayout(name);
    if (layout.vbase !== null) return layout.vbase;
    const info = this.checked.classes.get(name) as ClassInfo;
    layout.vbase = this.table.length;
    this.table.push(this.showRecord(name, layout, info.decl.span));
    for (const slot of layout.slots) {
      const method = this.checked.classes.findMethod(info, slot) as MethodInfo;
      this.table.push(`${method.owner.name}.${method.name}`);
    }
    return layout.vbase;
  }

  private fieldOf(type: string, name: string): { readonly offset: number; readonly type: string } | null {
    if (this.checked.classes.get(type) !== undefined) return this.classLayout(type).fields.get(name) ?? null;
    return this.structs.get(type)?.fields.get(name) ?? null;
  }

  private isRecord(type: string): boolean {
    return this.structs.has(type) || this.checked.classes.get(type) !== undefined;
  }

  /** Can a value of this type lead back to itself (an object, a struct, or an array of them)? */
  private isRefy(type: string): boolean {
    return isArray(type) ? this.isRefy(elementOf(type)) : this.isRecord(type);
  }

  /** In a method, a bare name that is a field of `this` (and not shadowed by a variable) is read from the object. */
  private fieldScope(cls: ClassInfo): Map<string, Binding> {
    const scope = new Map<string, Binding>();
    for (const [name, slot] of this.classLayout(cls.name).fields) scope.set(name, { wasm: "this", type: slot.type, kind: "field", offset: slot.offset });
    return scope;
  }

  private classDecl(decl: Extract<Statement, { kind: "ClassDecl" }>): void {
    const info = this.checked.classes.get(decl.name);
    if (info === undefined) return;
    for (const member of decl.members) if (member.kind === "MethodDecl") this.functionDecl(member, info);
    for (const member of decl.members) if (member.kind === "CtorDecl") this.constructorFunction(info, member);
    if (info.ctors.length === 0) this.constructorFunction(info, null);
  }

  private constructorName(cls: ClassInfo, arity: number): string {
    return `${cls.name}.new${arity}`;
  }

  /**
   * `Class.newN(this, ...)`: first the parent's constructor (with the arguments of `super(...)`, or none), then the initial
   * values of this class's fields, then the rest of the body. The object already exists, with every field at zero.
   */
  private constructorFunction(cls: ClassInfo, ctor: CtorDecl | null): void {
    const saved = { locals: this.locals, scopes: this.scopes, loops: this.loops, returnType: this.returnType, owner: this.owner, fn: this.fn };
    this.locals = [];
    this.loops = [];
    this.returnType = "void";
    this.owner = cls;
    this.fn = this.makeFn(null, false, ctor?.params ?? [], ctor?.body.body ?? []);
    const fields = this.fieldScope(cls);
    const own = new Map<string, Binding>();
    this.scopes = [this.topScope, fields, own];
    const params: Local[] = (ctor?.params ?? []).map((param) => this.bindParameter(own, param));
    this.registerFunctions(ctor?.body.body ?? []);

    const body: Expr[] = [];
    if (cls.parent !== null) {
      const call = ctor === null ? null : superCallOf(ctor.body.body);
      const arity = call?.args.length ?? 0;
      const parentCtor = cls.parent.ctors.find((c) => c.decl.params.length === arity)?.decl ?? null;
      const args = call === null || parentCtor === null ? [] : this.convertArgs(parentCtor.params, call.args);
      const parentCall = ir.call(this.constructorName(cls.parent, arity), ir.get("this"), ...args);
      body.push(this.guarded(parentCall, ["i32", ...(parentCtor?.params ?? []).map((param) => valType(paramType(param)))], null, call?.span ?? cls.decl.nameSpan));
    }
    // An initial value sees `this` and the names outside the class, not the parameters of the constructor.
    this.scopes = [this.topScope, fields];
    const layout = this.classLayout(cls.name);
    for (const info of cls.fields) {
      if (info.owner !== cls || info.init === null) continue;
      const slot = layout.fields.get(info.name) as { offset: number };
      body.push(ir.store(storeOf(info.type), ir.get("this"), this.initialValue(info.init, info.type, info.decl.span), slot.offset));
    }
    this.scopes = [this.topScope, fields, own];
    if (ctor !== null) for (const statement of ctor.body.body) body.push(...this.statement(statement, false));
    this.functions.push({ name: this.constructorName(cls, params.length), params: [{ name: "this", type: "i32" }, ...params], results: [], locals: this.locals, body: this.withFrame(body, ctor?.span ?? cls.decl.span) });
    ({ locals: this.locals, scopes: this.scopes, loops: this.loops, returnType: this.returnType, owner: this.owner, fn: this.fn } = saved);
  }

  /** `new Dog("Rex", 3)`: memory for the object, its vtable, then its constructor. */
  private newObject(e: NewObject): Expr {
    const info = this.checked.classes.get(e.className) as ClassInfo;
    const layout = this.classLayout(info.name);
    const ctor = info.ctors.find((c) => c.decl.params.length === e.args.length)?.decl ?? null;
    const object = this.fresh("object");
    this.locals.push({ name: object, type: "i32" });
    const args = ctor === null ? [] : this.convertArgs(ctor.params, e.args);
    return ir.block(
      this.fresh("new"),
      [
        ir.set(object, ir.call(this.runtimeFunction("alloc"), ir.i32(layout.size), ir.i32(this.site(e.span, "out of memory")))),
        ir.store("i32.store", ir.get(object), ir.i32(this.vtableBase(info.name))),
        this.guarded(ir.call(this.constructorName(info, e.args.length), ir.get(object), ...args), ["i32", ...(ctor?.params ?? []).map((param) => valType(paramType(param)))], null, e.span),
        ir.get(object),
      ],
      "i32",
    );
  }

  /** `Person{name: "Ana"}`. A field left out stays at zero, which is the default of every type. */
  private structLiteral(e: StructLiteral): Expr {
    const layout = this.structs.get(e.structName);
    if (layout === undefined) {
      this.unsupported(e.span, "a struct");
      return ir.i32(0);
    }
    const struct = this.fresh("struct");
    this.locals.push({ name: struct, type: "i32" });
    const body: Expr[] = [ir.set(struct, ir.call(this.runtimeFunction("alloc"), ir.i32(layout.size), ir.i32(this.site(e.span, "out of memory"))))];
    for (const init of e.fields) {
      const slot = layout.fields.get(init.name) as { offset: number; type: string };
      body.push(ir.store(storeOf(slot.type), ir.get(struct), this.convert(this.expression(init.value), this.typeOf(init.value), slot.type), slot.offset));
    }
    body.push(ir.get(struct));
    return ir.block(this.fresh("literal"), body, "i32");
  }

  private fieldRead(e: Member): Expr {
    const field = this.fieldOf(this.typeOf(e.object), e.name);
    if (field === null) {
      this.unsupported(e.span, "reading a field of this kind");
      return this.placeholder(e);
    }
    const object = e.object.kind === "This" ? ir.get("this") : ir.call(this.runtimeFunction("non_null"), this.expression(e.object), ir.i32(this.site(e.span, `cannot read field '${e.name}' of null`)));
    return ir.load(loadOf(field.type), object, field.offset);
  }

  /** Is the method redefined by some class below `cls`? If not, a call to it never needs the vtable. */
  private isOverridden(cls: ClassInfo, name: string): boolean {
    for (const other of this.checked.classes.byName.values()) {
      if (other !== cls && other.methods.has(name) && this.checked.classes.isSubclass(other.name, cls.name)) return true;
    }
    return false;
  }

  /**
   * A call to a method. With a receiver that could be null, the receiver and the arguments are worked out first and
   * only then is the receiver checked, as the interpreter does. A method nobody overrides is called directly; any
   * other goes through the vtable of the object's real class.
   */
  private invoke(cls: ClassInfo, method: MethodInfo, receiver: Expr, e: Call, checkNull: boolean, direct: boolean): Expr {
    const params = method.decl.params;
    const before: Expr[] = [];
    let self = receiver;
    let args = this.convertArgs(params, e.args);
    if (checkNull) {
      self = this.spill(receiver, cls.name, before, true);
      args = args.map((arg, i) => this.spill(arg, paramType(params[i] as Param), before, true));
    }
    const target = checkNull ? ir.call(this.runtimeFunction("non_null"), self, ir.i32(this.site(e.span, `cannot call ${method.name} on null`))) : self;
    const returns = typeNameOf(method.decl.returnType);
    let call: Expr;
    if (!direct && this.isOverridden(cls, method.name)) {
      this.usesTable = true;
      const slot = this.classLayout(cls.name).slots.indexOf(method.name) + 1;
      const signature = { params: ["i32" as ValType, ...params.map((param) => valType(paramType(param)))], results: returns === "void" ? [] : [valType(returns)] };
      call = ir.callIndirect(signature, ir.op("i32.add", ir.load("i32.load", self), ir.i32(slot)), target, ...args);
    } else {
      call = ir.call(`${method.owner.name}.${method.name}`, target, ...args);
    }
    const types = ["i32" as ValType, ...params.map((param) => valType(paramType(param)))];
    return this.sequence(before, this.guarded(call, types, returns === "void" ? null : valType(returns), e.span), returns === "void" ? null : valType(returns));
  }

  private superMethod(e: Call, callee: Member): Expr {
    const parent = this.owner?.parent ?? null;
    const method = parent === null ? null : this.checked.classes.findMethod(parent, callee.name);
    if (parent === null || method === null) {
      this.unsupported(e.span, "super here");
      return this.placeholder(e);
    }
    return this.invoke(parent, method, ir.get("this"), e, false, true);
  }

  /** `rt:showobj`: an object of any class as text, by asking its own class (slot 0 of its vtable). */
  private showObject(): string {
    this.usesTable = true;
    const name = "rt:showobj";
    if (this.runtime.has(name)) return name;
    this.runtime.set(name, {
      name,
      params: [{ name: "a", type: "i32" }, { name: "site", type: "i32" }],
      results: ["i32"],
      locals: [],
      body: [
        ir.if(ir.op("i32.eqz", ir.get("a")), [ir.return(ir.i32(this.stringLiteral("null")))]),
        ir.callIndirect({ params: ["i32", "i32"], results: ["i32"] }, ir.load("i32.load", ir.get("a")), ir.get("a"), ir.get("site")),
      ],
    });
    return name;
  }

  /** `rt:show:Name`: a struct or an object as `Name{field: value, ...}`. A value met again while it is being shown is `Name{...}`. */
  private showRecord(name: string, layout: Layout, span: Span): string {
    const full = `rt:show:${name}`;
    if (this.runtime.has(full) || this.building.has(full)) return full;
    this.building.add(full);
    const get = ir.get;
    const literal = (text: string): Expr => ir.i32(this.stringLiteral(text));
    const join = (a: Expr, b: Expr): Expr => ir.call(this.runtimeFunction("str_concat"), a, b, get("site"));
    const body: Expr[] = [
      ir.if(ir.op("i32.eqz", get("a")), [ir.return(literal("null"))]),
      ir.if(ir.load("i32.load", get("a"), MARK), [ir.return(literal(`${name}{...}`))]),
      ir.store("i32.store", get("a"), ir.i32(1), MARK),
      ir.set("s", literal(`${name}{`)),
    ];
    layout.order.forEach((field, k) => {
      body.push(ir.set("s", join(get("s"), literal(`${k > 0 ? ", " : ""}${field.name}: `))));
      body.push(ir.set("s", join(get("s"), this.toText(ir.load(loadOf(field.type), get("a"), field.offset), field.type, get("site"), span))));
    });
    body.push(ir.set("s", join(get("s"), literal("}"))), ir.store("i32.store", get("a"), ir.i32(0), MARK), get("s"));
    this.runtime.set(full, { name: full, params: [{ name: "a", type: "i32" }, { name: "site", type: "i32" }], results: ["i32"], locals: [{ name: "s", type: "i32" }], body });
    this.building.delete(full);
    return full;
  }

  // ---------- the runtime: small functions the module carries with it ----------

  /** A runtime function, added to the module the first time something needs it. */
  private runtimeFunction(name: "div_i32" | "rem_i32" | "div_f64" | "rem_f64" | MemoryRuntimeName): string {
    const full = `rt:${name}`;
    if (this.runtime.has(full)) return full;
    if (isMemoryRuntime(name)) {
      // The allocator needs the global that holds the first free address; it is given its value when the module is built.
      if (name === "alloc") this.globals.push({ name: HEAP, type: "i32", mutable: true, init: 0 });
      const needs = { host: (n: HostName) => this.host(n), call: (n: MemoryRuntimeName) => this.runtimeFunction(n), literal: (text: string) => this.stringLiteral(text) };
      // Registered after it is built: a function that needs another one builds it first, and none needs itself.
      this.runtime.set(full, memoryRuntime(name, needs));
      return full;
    }
    const fail = (): Expr[] => [ir.call(this.host("fail"), ir.get("site"), ir.i32(0), ir.i32(0)), ir.unreachable()];
    const params = (type: ValType): Local[] => [{ name: "a", type }, { name: "b", type }, { name: "site", type: "i32" }];
    let func: Func;
    switch (name) {
      case "div_i32":
        func = {
          name: full,
          params: params("i32"),
          results: ["i32"],
          locals: [],
          // Dividing the smallest int by -1 does not fit; Java (and the interpreter) wrap, where WebAssembly would trap.
          body: [
            ir.if(ir.op("i32.eqz", ir.get("b")), fail()),
            ir.if(ir.op("i32.eq", ir.get("b"), ir.i32(-1)), [ir.return(ir.op("i32.sub", ir.i32(0), ir.get("a")))]),
            ir.op("i32.div_s", ir.get("a"), ir.get("b")),
          ],
        };
        break;
      case "rem_i32":
        func = { name: full, params: params("i32"), results: ["i32"], locals: [], body: [ir.if(ir.op("i32.eqz", ir.get("b")), fail()), ir.op("i32.rem_s", ir.get("a"), ir.get("b"))] };
        break;
      case "div_f64":
        func = { name: full, params: params("f64"), results: ["f64"], locals: [], body: [ir.if(ir.op("f64.eq", ir.get("b"), ir.f64(0)), fail()), ir.op("f64.div", ir.get("a"), ir.get("b"))] };
        break;
      case "rem_f64":
        func = { name: full, params: params("f64"), results: ["f64"], locals: [], body: [ir.if(ir.op("f64.eq", ir.get("b"), ir.f64(0)), fail()), ir.call(this.host("fmod"), ir.get("a"), ir.get("b"))] };
        break;
    }
    this.runtime.set(full, func);
    return full;
  }
}

const MEMORY_RUNTIME = new Set<string>(MEMORY_RUNTIME_NAMES);
const isMemoryRuntime = (name: string): name is MemoryRuntimeName => MEMORY_RUNTIME.has(name);

function typeNameOfReturn(decl: FuncDecl | MethodDecl): string {
  return decl.returnType.name + "[]".repeat(decl.returnType.dims);
}

/** The functions declared inside these statements, at any depth of blocks and loops, but not the ones inside those functions. */
function nestedFunctions(statements: readonly Statement[]): FuncDecl[] {
  const found: FuncDecl[] = [];
  const visit = (s: Statement | null): void => {
    if (s === null) return;
    switch (s.kind) {
      case "FuncDecl":
        found.push(s);
        return;
      case "Block":
        s.body.forEach(visit);
        return;
      case "If":
        visit(s.then);
        visit(s.otherwise);
        return;
      case "While":
      case "Foreach":
        visit(s.body);
        return;
      case "For":
        visit(s.body);
        return;
      case "Switch":
        for (const branch of s.cases) branch.body.forEach(visit);
        s.default?.body.forEach(visit);
        return;
      default:
        return;
    }
  };
  statements.forEach(visit);
  return found;
}

/** The names of the variables these statements declare (not those of the functions declared inside them), one per declaration. */
function declaredNames(statements: readonly Statement[]): string[] {
  const names: string[] = [];
  const visit = (s: Statement | null): void => {
    if (s === null) return;
    switch (s.kind) {
      case "VarDecl":
        names.push(s.name);
        return;
      case "Block":
        s.body.forEach(visit);
        return;
      case "If":
        visit(s.then);
        visit(s.otherwise);
        return;
      case "While":
        visit(s.body);
        return;
      case "Foreach":
        names.push(s.name);
        visit(s.body);
        return;
      case "For":
        visit(s.init);
        visit(s.body);
        return;
      case "Switch":
        for (const branch of s.cases) branch.body.forEach(visit);
        s.default?.body.forEach(visit);
        return;
      default:
        return;
    }
  };
  statements.forEach(visit);
  return names;
}

/** Every name a statement mentions as a variable (read, assigned or updated), at any depth. */
function collectNames(statement: Statement, into: Set<string>): void {
  const visit = (node: Statement | Expression | Initializer | null): void => {
    if (node === null) return;
    switch (node.kind) {
      case "Identifier":
        into.add(node.name);
        return;
      case "Block":
        node.body.forEach(visit);
        return;
      case "ExprStmt":
        visit(node.expression);
        return;
      case "Update":
        visit(node.target);
        return;
      case "Print":
        node.args.forEach(visit);
        return;
      case "If":
        visit(node.condition);
        visit(node.then);
        visit(node.otherwise);
        return;
      case "While":
        visit(node.condition);
        visit(node.body);
        return;
      case "For":
        visit(node.init);
        visit(node.condition);
        visit(node.update);
        visit(node.body);
        return;
      case "Foreach":
        visit(node.iterable);
        visit(node.body);
        return;
      case "Switch":
        visit(node.discriminant);
        for (const branch of node.cases) {
          visit(branch.test);
          branch.body.forEach(visit);
        }
        node.default?.body.forEach(visit);
        return;
      case "Return":
        visit(node.value);
        return;
      case "VarDecl":
        visit(node.init);
        return;
      case "FuncDecl":
        visit(node.body);
        return;
      case "ClassDecl":
        for (const member of node.members) {
          if (member.kind === "ClassField") visit(member.init);
          else visit(member.body);
        }
        return;
      case "Group":
        visit(node.expression);
        return;
      case "Unary":
        visit(node.operand);
        return;
      case "Binary":
        visit(node.left);
        visit(node.right);
        return;
      case "Ternary":
        visit(node.condition);
        visit(node.whenTrue);
        visit(node.whenFalse);
        return;
      case "Assign":
        visit(node.target);
        visit(node.value);
        return;
      case "Call":
        visit(node.callee);
        node.args.forEach(visit);
        return;
      case "Index":
        visit(node.target);
        visit(node.index);
        return;
      case "Member":
        visit(node.object);
        return;
      case "NewArray":
        node.sizes.forEach(visit);
        return;
      case "ArrayLiteral":
        node.elements.forEach(visit);
        return;
      case "StructLiteral":
        node.fields.forEach((field) => visit(field.value));
        return;
      case "NewObject":
      case "SuperCall":
        node.args.forEach(visit);
        return;
      default:
        return;
    }
  }
  visit(statement);
}
