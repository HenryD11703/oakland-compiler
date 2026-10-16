import type { CheckResult } from "../check/check";
import { diagnostic, type Diagnostic } from "../diagnostics";
import type {
  Assign,
  Binary,
  Call,
  Expression,
  For,
  FuncDecl,
  Initializer,
  Program,
  Statement,
  Switch,
  Ternary,
  Unary,
  Update,
  VarDecl,
} from "../parser/ast";
import type { Span } from "../span";
import { INT_MAX, INT_MIN } from "../types";
import { HOST_IMPORTS, type FailSite, type HostName } from "./host";
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
  readonly kind: "local" | "global";
}

interface LoopLabels {
  readonly brk: string;
  readonly cont: string | null;
}

/** Where the first free address is, once the static strings have been placed. Address 0 is `null`. */
const FIRST_ADDRESS = 8;
const PAGE = 65536;

const valType = (type: string): ValType => (type === "float" ? "f64" : "i32");

/** An `int`, `char` or `boolean`: all are an i32, and `char` and `int` mix in arithmetic. */
const isWhole = (type: string): boolean => type === "int" || type === "char" || type === "boolean";

class Lowerer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly sites: FailSite[] = [];
  private readonly functions: Func[] = [];
  private readonly globals: Global[] = [];
  private readonly data: DataSegment[] = [];
  private readonly strings = new Map<string, number>();
  private readonly used = new Set<HostName>();
  private readonly runtime = new Map<string, Func>();
  private dataEnd = FIRST_ADDRESS;
  private counter = 0;

  // The function being lowered.
  private locals: Local[] = [];
  private scopes: Map<string, Binding>[] = [];
  private loops: LoopLabels[] = [];
  private returnType = "void";
  private promoted = new Set<string>();
  private topScope = new Map<string, Binding>();

  constructor(private readonly checked: CheckResult) {}

  run(program: Program): LowerResult {
    // A top-level variable that a function mentions has to be a global; the others stay locals of main, which is faster.
    for (const statement of program.body) if (statement.kind === "FuncDecl") collectNames(statement.body, this.promoted);

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
      else if (statement.kind === "ClassDecl") this.unsupported(statement.span, "a class");
    }

    this.locals = [];
    this.scopes = [topScope];
    this.loops = [];
    this.returnType = "void";
    const body: Expr[] = [];
    for (const statement of topLevel) body.push(...this.statement(statement, true));
    this.functions.unshift({ name: "main", export: "main", params: [], results: [], locals: this.locals, body });

    return { module: this.build(), sites: this.sites, diagnostics: this.diagnostics };
  }

  private build(): Module {
    const imports: Import[] = [...this.used].map((name) => ({
      module: "env",
      field: name,
      name: `env:${name}`,
      signature: { params: HOST_IMPORTS[name].params as readonly ValType[], results: HOST_IMPORTS[name].results as readonly ValType[] },
    }));
    const pages = Math.max(1, Math.ceil(this.dataEnd / PAGE));
    return { ...emptyModule, imports, functions: [...this.functions, ...this.runtime.values()], globals: this.globals, memory: { min: pages }, data: this.data };
  }

  // ---------- small helpers ----------

  private unsupported(span: Span, what: string): void {
    this.diagnostics.push(diagnostic("semantic", `${what} cannot be compiled yet`, span));
  }

  private host(name: HostName): string {
    this.used.add(name);
    return `env:${name}`;
  }

  private site(span: Span, message: string): number {
    this.sites.push({ span, message });
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
    } else {
      const wasm = `${name}.${++this.counter}`;
      this.locals.push({ name: wasm, type: valType(type) });
      binding = { wasm, type, kind: "local" };
    }
    this.scopes[this.scopes.length - 1]?.set(name, binding);
    return binding;
  }

  private read(binding: Binding): Expr {
    return binding.kind === "local" ? ir.get(binding.wasm) : ir.getGlobal(binding.wasm);
  }

  private write(binding: Binding, value: Expr): Expr {
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

  private functionDecl(decl: FuncDecl): void {
    const saved = { locals: this.locals, scopes: this.scopes, loops: this.loops, returnType: this.returnType };
    this.locals = [];
    this.scopes = [this.topScope, new Map()];
    this.loops = [];
    this.returnType = typeNameOfReturn(decl);
    const params: Local[] = decl.params.map((param) => {
      const type = param.type.name + "[]".repeat(param.type.dims);
      this.scopes[1]?.set(param.name, { wasm: param.name, type, kind: "local" });
      return { name: param.name, type: valType(type) };
    });
    // A function sees the top-level variables that were made global; nothing else outside it.
    const body: Expr[] = [];
    for (const statement of decl.body.body) body.push(...this.statement(statement, false));
    // A function that is not void returns on every path (the checker saw to it); this tells the engine the end is not reached.
    if (this.returnType !== "void") body.push(ir.unreachable());
    this.functions.push({
      name: decl.name,
      params,
      results: this.returnType === "void" ? [] : [valType(this.returnType)],
      locals: this.locals,
      body,
    });
    ({ locals: this.locals, scopes: this.scopes, loops: this.loops, returnType: this.returnType } = saved);
  }

  // ---------- statements ----------

  private statement(s: Statement, topLevel: boolean): Expr[] {
    switch (s.kind) {
      case "Block":
        return this.inScope(() => s.body.flatMap((child) => this.statement(child, false)));
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
        this.unsupported(s.span, "a for-each loop");
        return [];
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
      case "FuncDecl":
        this.unsupported(s.span, "a function declared inside a block");
        return [];
      case "StructDecl":
        return [];
      case "ClassDecl":
        return [];
    }
  }

  private varDecl(s: VarDecl, topLevel: boolean): Expr[] {
    const type = s.declaredType === null ? this.typeOf(s.init as Expression) : s.declaredType.name + "[]".repeat(s.declaredType.dims);
    // The initial value is lowered before the name exists, so that `int x = x;` does not see itself.
    const init = s.init === null ? null : this.initializer(s.init, type);
    const binding = this.declare(s.name, type, topLevel);
    // A declaration with no value starts at zero every time it runs, as the interpreter's `null` does for a reference.
    return [this.write(binding, init ?? (valType(type) === "f64" ? ir.f64(0) : ir.i32(0)))];
  }

  private initializer(init: Initializer, type: string): Expr {
    if (init.kind === "ArrayLiteral") {
      this.unsupported(init.span, "a list of values");
      return ir.i32(0);
    }
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
   * is where its case jumps to, which is how fall-through comes for free.
   */
  private switchStatement(s: Switch): Expr[] {
    const subjectType = this.typeOf(s.discriminant);
    if (!isWhole(subjectType) && subjectType !== "float") {
      this.unsupported(s.discriminant.span, `a switch on a ${subjectType}`);
      return [];
    }
    const subject = this.fresh("subject");
    this.locals.push({ name: subject, type: valType(subjectType) });
    const end = this.fresh("break");
    const labels = s.cases.map(() => this.fresh("case"));
    const fallback = s.default ? this.fresh("default") : end;

    const dispatch: Expr[] = [ir.set(subject, this.expression(s.discriminant))];
    s.cases.forEach((branch, i) => {
      const testType = this.typeOf(branch.test);
      const common = subjectType === "float" || testType === "float" ? "float" : "int";
      const equal = common === "float"
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
    const type = this.typeOf(s.target);
    const delta = s.op === "++" ? 1 : -1;
    const step = (current: Expr): Expr =>
      type === "float" ? ir.op("f64.add", current, ir.f64(delta)) : ir.op("i32.add", current, ir.i32(delta));
    if (s.target.kind === "Identifier") {
      const binding = this.lookup(s.target.name);
      return this.write(binding, step(this.read(binding)));
    }
    this.unsupported(s.span, "this update");
    return ir.nop();
  }

  private print(args: readonly Expression[]): Expr[] {
    const out: Expr[] = [];
    args.forEach((arg, i) => {
      if (i > 0) out.push(ir.call(this.host("write_char"), ir.i32(32)));
      const type = this.typeOf(arg);
      const value = this.expression(arg);
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
          this.unsupported(arg.span, `printing a ${type}`);
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
      case "Index":
      case "Member":
      case "NewArray":
      case "StructLiteral":
      case "NewObject":
      case "This":
      case "Super":
      case "SuperCall":
        this.unsupported(e.span, e.kind === "Index" || e.kind === "NewArray" ? "an array" : e.kind === "Member" || e.kind === "StructLiteral" ? "a struct or an object" : "an object");
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
      this.unsupported(e.span, "joining strings");
      return ir.i32(0);
    }
    if (left === "string" && right === "string") {
      this.unsupported(e.span, "comparing strings");
      return ir.i32(0);
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
      this.unsupported(e.span, "comparing strings");
      return ir.i32(0);
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

  /** An assignment. As a value it leaves the assigned value on the stack; as a statement it leaves nothing. */
  private assign(e: Assign, asValue: boolean): Expr {
    if (e.target.kind !== "Identifier") {
      this.unsupported(e.span, "assigning to an element or a field");
      return asValue ? this.placeholder(e) : ir.nop();
    }
    const binding = this.lookup(e.target.name);
    const targetType = binding.type;
    let value = this.expression(e.value);
    const valueType = this.typeOf(e.value);
    if (e.op === "=") {
      value = this.convert(value, valueType, targetType);
    } else {
      if (targetType === "string") {
        this.unsupported(e.span, "joining strings");
        return asValue ? this.placeholder(e) : ir.nop();
      }
      const wide = targetType === "float" || valueType === "float";
      const current = this.convert(this.read(binding), targetType, wide ? "float" : "int");
      const operand = this.convert(value, valueType, wide ? "float" : "int");
      const synthetic: Binary = { kind: "Binary", op: e.op === "+=" ? "+" : "-", left: e.target, right: e.value, span: e.span };
      value = this.convert(wide ? this.floatOp(synthetic, current, operand) : this.intOp(synthetic, current, operand), wide ? "float" : "int", targetType);
    }
    if (!asValue) return this.write(binding, value);
    return binding.kind === "local" ? ir.tee(binding.wasm, value) : ir.block(this.fresh("assign"), [this.write(binding, value), this.read(binding)], valType(targetType));
  }

  private call(e: Call): Expr {
    if (e.callee.kind !== "Identifier") {
      this.unsupported(e.span, "a method call");
      return this.placeholder(e);
    }
    const name = e.callee.name;
    const decl = this.checked.functions.get(name);
    if (decl === undefined) {
      this.unsupported(e.span, `the built-in function ${name}`);
      return this.placeholder(e);
    }
    const args = e.args.map((arg, i) => this.convert(this.expression(arg), this.typeOf(arg), decl.params[i] ? decl.params[i].type.name + "[]".repeat(decl.params[i].type.dims) : this.typeOf(arg)));
    return ir.call(name, ...args);
  }

  // ---------- the runtime: small functions the module carries with it ----------

  /** A runtime function, added to the module the first time something needs it. */
  private runtimeFunction(name: "div_i32" | "rem_i32" | "div_f64" | "rem_f64"): string {
    const full = `rt:${name}`;
    if (this.runtime.has(full)) return full;
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

function typeNameOfReturn(decl: FuncDecl): string {
  return decl.returnType.name + "[]".repeat(decl.returnType.dims);
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
