import { mulberry32 } from "./fuzz";

/**
 * A generator of well-typed OakLand programs (task T53). Every program it makes passes the type checker and ends: the
 * loops are bounded, the recursion is shallow, the divisors can never be zero and the array indexes are always in range.
 * What it does try to hit is what a compiler gets wrong: int overflow, ints and floats mixed, strings built from
 * everything, loops with break and continue, arrays, functions that call each other, functions inside functions, and
 * classes whose methods are overridden and called through the parent's type.
 *
 * It is seeded, so a failing program can be made again from its number.
 */

type Kind = "int" | "float" | "string" | "boolean" | "char";

interface Variable {
  readonly name: string;
  readonly kind: Kind;
  /** Set for an array of ints: how many elements it has. */
  readonly length?: number;
}

interface FunctionInfo {
  readonly name: string;
  readonly returns: Kind;
  readonly params: readonly Kind[];
}

interface ClassInfo {
  readonly name: string;
  readonly parent: string | null;
  /** The int and string fields (the same in the subclass, which adds none). */
  readonly ctorArgs: readonly Kind[];
}

const INTS = ["0", "1", "2", "3", "7", "10", "100", "65535", "46341", "1000000", "2147483647", "(-1)", "(-5)", "(-2147483647)"];
const FLOATS = ["0.5", "1.5", "2.0", "3.25", "0.1", "0.2", "100.0", "(-2.5)", "1000000.0", "0.0"];
const STRINGS = ['""', '"a"', '"Oak"', '"Land"', '"x y"', '"Ab1"'];
const CHARS = ["'a'", "'z'", "'A'", "'0'", "' '"];

class Generator {
  private readonly random: () => number;
  private counter = 0;
  private readonly functions: FunctionInfo[] = [];
  private readonly classes: ClassInfo[] = [];
  private readonly lines: string[] = [];
  private indent = 0;

  constructor(seed: number) {
    this.random = mulberry32(seed);
  }

  // ---------- helpers ----------

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)] as T;
  }
  private chance(p: number): boolean {
    return this.random() < p;
  }
  private between(low: number, high: number): number {
    return low + Math.floor(this.random() * (high - low + 1));
  }
  private fresh(prefix: string): string {
    return `${prefix}${++this.counter}`;
  }
  private emit(text: string): void {
    this.lines.push("    ".repeat(this.indent) + text);
  }

  // ---------- expressions ----------

  private expr(kind: Kind, vars: readonly Variable[], depth: number): string {
    switch (kind) {
      case "int":
        return this.intExpr(vars, depth);
      case "float":
        return this.floatExpr(vars, depth);
      case "string":
        return this.stringExpr(vars, depth);
      case "boolean":
        return this.boolExpr(vars, depth);
      case "char":
        return this.pick([...CHARS, ...vars.filter((v) => v.kind === "char").map((v) => v.name)]);
    }
  }

  private variablesOf(vars: readonly Variable[], kind: Kind): string[] {
    return vars.filter((v) => v.kind === kind && v.length === undefined).map((v) => v.name);
  }

  private intExpr(vars: readonly Variable[], depth: number): string {
    const names = this.variablesOf(vars, "int");
    if (depth <= 0 || this.chance(0.2)) return this.chance(0.55) && names.length > 0 ? this.pick(names) : this.pick(INTS);
    const sub = (): string => this.intExpr(vars, depth - 1);
    const arrays = vars.filter((v) => v.length !== undefined);
    const options: (() => string)[] = [
      () => `(${sub()} + ${sub()})`,
      () => `(${sub()} - ${sub()})`,
      () => `(${sub()} * ${sub()})`,
      () => `(${sub()} * ${sub()})`,
      () => `(${sub()} / ${this.safeDivisor(vars, depth - 1)})`,
      () => `(${sub()} / (0 - ${this.safeDivisor(vars, depth - 1)}))`,
      () => `(${sub()} % ${this.safeDivisor(vars, depth - 1)})`,
      () => `(-${sub()})`,
      () => `(${this.boolExpr(vars, depth - 1)} ? ${sub()} : ${sub()})`,
      () => `(${this.pick(["'a'", "'z'", "'0'"])} + ${sub()})`,
      () => `parseInt(toString(${sub()}))`,
    ];
    for (const array of arrays) {
      const n = array.length as number;
      options.push(() => `${array.name}[${this.index(vars, depth - 1, n)}]`, () => `${array.name}.length`);
    }
    for (const fn of this.functions.filter((f) => f.returns === "int")) options.push(() => `${fn.name}(${fn.params.map((k) => this.expr(k, vars, depth - 1)).join(", ")})`);
    for (const object of vars.filter((v) => this.isClass(v.kind))) options.push(() => `${object.name}.calc(${sub()})`, () => `${object.name}.x`);
    return this.pick(options)();
  }

  private isClass(kind: string): boolean {
    return this.classes.some((c) => c.name === kind);
  }

  /** An index that is always inside an array of `n` elements, whatever the expression is. */
  private index(vars: readonly Variable[], depth: number, n: number): string {
    return `(((${this.intExpr(vars, depth)} % ${n}) + ${n}) % ${n})`;
  }

  /** Never zero: a square plus one cannot be zero in 32-bit arithmetic (a square is 0 or 1 modulo 4). */
  private safeDivisor(vars: readonly Variable[], depth: number): string {
    const e = this.intExpr(vars, depth);
    return `(${e} * ${e} + 1)`;
  }

  private floatExpr(vars: readonly Variable[], depth: number): string {
    const names = this.variablesOf(vars, "float");
    if (depth <= 0 || this.chance(0.2)) return this.chance(0.5) && names.length > 0 ? this.pick(names) : this.pick(FLOATS);
    const sub = (): string => this.floatExpr(vars, depth - 1);
    const mixed = (): string => (this.chance(0.5) ? this.intExpr(vars, depth - 1) : sub());
    const options: (() => string)[] = [
      () => `(${sub()} + ${mixed()})`,
      () => `(${mixed()} + ${sub()})`,
      () => `(${sub()} - ${mixed()})`,
      () => `(${sub()} * ${mixed()})`,
      () => {
        const divisor = sub();
        return `(${sub()} / (${divisor} * ${divisor} + 1.0))`;
      },
      () => `(${this.boolExpr(vars, depth - 1)} ? ${sub()} : ${mixed()})`,
    ];
    return this.pick(options)();
  }

  private stringExpr(vars: readonly Variable[], depth: number): string {
    const names = this.variablesOf(vars, "string");
    if (depth <= 0 || this.chance(0.25)) return this.chance(0.5) && names.length > 0 ? this.pick(names) : this.pick(STRINGS);
    const sub = (): string => this.stringExpr(vars, depth - 1);
    const anything = (): string => this.expr(this.pick<Kind>(["int", "float", "boolean", "char", "string"]), vars, depth - 1);
    const options: (() => string)[] = [
      () => `(${sub()} + ${anything()})`,
      () => `(${anything()} + ${sub()})`,
      () => `toUpperCase(${sub()})`,
      () => `toLowerCase(${sub()})`,
      () => `toString(${this.expr(this.pick<Kind>(["int", "float", "boolean", "char"]), vars, depth - 1)})`,
      () => `(${this.boolExpr(vars, depth - 1)} ? ${sub()} : ${sub()})`,
    ];
    for (const fn of this.functions.filter((f) => f.returns === "string")) options.push(() => `${fn.name}(${fn.params.map((k) => this.expr(k, vars, depth - 1)).join(", ")})`);
    for (const object of vars.filter((v) => this.isClass(v.kind))) options.push(() => `${object.name}.label()`, () => `${object.name}.s`);
    return this.pick(options)();
  }

  private boolExpr(vars: readonly Variable[], depth: number): string {
    const names = this.variablesOf(vars, "boolean");
    if (depth <= 0 || this.chance(0.15)) return this.chance(0.5) && names.length > 0 ? this.pick(names) : this.pick(["true", "false"]);
    const options: (() => string)[] = [
      () => `(${this.intExpr(vars, depth - 1)} ${this.pick(["<", "<=", ">", ">=", "==", "!="])} ${this.intExpr(vars, depth - 1)})`,
      () => `(${this.floatExpr(vars, depth - 1)} ${this.pick(["<", "<=", ">", ">=", "==", "!="])} ${this.pick([this.intExpr(vars, depth - 1), this.floatExpr(vars, depth - 1)])})`,
      () => `(${this.stringExpr(vars, depth - 1)} ${this.pick(["==", "!=", "<", ">="])} ${this.stringExpr(vars, depth - 1)})`,
      () => `(${this.boolExpr(vars, depth - 1)} && ${this.boolExpr(vars, depth - 1)})`,
      () => `(${this.boolExpr(vars, depth - 1)} || ${this.boolExpr(vars, depth - 1)})`,
      () => `(!${this.boolExpr(vars, depth - 1)})`,
    ];
    return this.pick(options)();
  }

  // ---------- statements ----------

  /** Writes `count` statements into a block. `vars` is copied: what the block declares is gone when it ends. */
  private block(vars: Variable[], count: number, depth: number, loop: "for" | "while" | null): void {
    const scope = [...vars];
    for (let i = 0; i < count; i++) this.statement(scope, depth, loop);
  }

  private statement(vars: Variable[], depth: number, loop: "for" | "while" | null): void {
    const options: (() => void)[] = [
      () => this.declare(vars),
      () => this.declare(vars),
      () => this.assign(vars),
      () => this.assign(vars),
      () => this.print(vars),
      () => this.print(vars),
    ];
    if (depth > 0) {
      options.push(
        () => this.ifStatement(vars, depth),
        () => this.forLoop(vars, depth),
        () => this.whileLoop(vars, depth),
        () => this.switchStatement(vars, depth),
      );
    }
    if (loop !== null) options.push(() => this.jump(vars, loop));
    if (vars.some((v) => v.length !== undefined)) options.push(() => this.arrayStatement(vars));
    this.pick(options)();
  }

  private declare(vars: Variable[]): void {
    const kind = this.pick<Kind>(["int", "int", "int", "float", "string", "boolean", "char"]);
    const name = this.fresh(kind === "int" ? "n" : kind === "float" ? "f" : kind === "string" ? "s" : kind === "boolean" ? "b" : "c");
    const shape = this.random();
    if (kind === "int" && shape < 0.2) {
      const length = this.between(1, 5);
      const items = Array.from({ length }, () => this.intExpr(vars, 1));
      this.emit(`int[] ${name} = {${items.join(", ")}};`);
      vars.push({ name, kind, length });
      return;
    }
    if (shape > 0.9 && this.classes.length > 0) {
      const cls = this.pick(this.classes);
      const object = this.fresh("o");
      const declared = this.chance(0.6) ? this.rootOf(cls) : cls.name;
      this.emit(`${declared} ${object} = new ${cls.name}(${cls.ctorArgs.map((k) => this.expr(k, vars, 1)).join(", ")});`);
      vars.push({ name: object, kind: declared as Kind });
      return;
    }
    this.emit(`${kind} ${name} = ${this.expr(kind, vars, 3)};`);
    vars.push({ name, kind });
  }

  private rootOf(cls: ClassInfo): string {
    return cls.parent ?? cls.name;
  }

  private assign(vars: Variable[]): void {
    const targets = vars.filter((v) => v.length === undefined && !this.isClass(v.kind) && !v.name.startsWith("loop"));
    if (targets.length === 0) return this.print(vars);
    const target = this.pick(targets);
    switch (target.kind) {
      case "int":
        return this.emit(this.pick([`${target.name} = ${this.intExpr(vars, 3)};`, `${target.name} += ${this.intExpr(vars, 2)};`, `${target.name} -= ${this.intExpr(vars, 2)};`, `${target.name}++;`, `${target.name}--;`]));
      case "float":
        return this.emit(this.pick([`${target.name} = ${this.pick([this.floatExpr(vars, 3), this.intExpr(vars, 2)])};`, `${target.name} += ${this.floatExpr(vars, 2)};`, `${target.name} -= ${this.intExpr(vars, 2)};`]));
      case "string":
        return this.emit(this.pick([`${target.name} = ${this.stringExpr(vars, 3)};`, `${target.name} += ${this.expr(this.pick<Kind>(["int", "float", "string", "char", "boolean"]), vars, 2)};`]));
      case "boolean":
        return this.emit(`${target.name} = ${this.boolExpr(vars, 3)};`);
      case "char":
        return this.emit(`${target.name} = ${this.pick(CHARS)};`);
    }
  }

  private print(vars: Variable[]): void {
    const count = this.between(1, 3);
    const args = Array.from({ length: count }, () => this.expr(this.pick<Kind>(["int", "int", "float", "string", "boolean", "char"]), vars, 3));
    this.emit(`System.out.println(${args.join(", ")});`);
  }

  private arrayStatement(vars: Variable[]): void {
    const array = this.pick(vars.filter((v) => v.length !== undefined));
    const n = array.length as number;
    const index = this.index(vars, 2, n);
    this.emit(
      this.pick([
        `${array.name}[${index}] = ${this.intExpr(vars, 3)};`,
        `${array.name}[${index}] += ${this.intExpr(vars, 2)};`,
        `${array.name}[${index}]++;`,
        `System.out.println(${array.name}, ${array.name}.length, ${array.name}.indexOf(${this.intExpr(vars, 1)}), ${array.name}.join());`,
      ]),
    );
    if (this.chance(0.3)) {
      const element = this.fresh("e");
      const total = this.fresh("t");
      this.emit(`int ${total} = 0;`);
      this.emit(`for (int ${element} : ${array.name}) { ${total} += ${element}; }`);
      this.emit(`System.out.println(${total});`);
      vars.push({ name: total, kind: "int" });
    }
  }

  private ifStatement(vars: Variable[], depth: number): void {
    this.emit(`if (${this.boolExpr(vars, 2)}) {`);
    this.indent++;
    this.block(vars, this.between(1, 3), depth - 1, null);
    this.indent--;
    if (this.chance(0.5)) {
      this.emit("} else {");
      this.indent++;
      this.block(vars, this.between(1, 3), depth - 1, null);
      this.indent--;
    }
    this.emit("}");
  }

  private forLoop(vars: Variable[], depth: number): void {
    const i = this.fresh("loop");
    this.emit(`for (int ${i} = 0; ${i} < ${this.between(1, 6)}; ${i}++) {`);
    this.indent++;
    this.block([...vars, { name: i, kind: "int" }], this.between(1, 4), depth - 1, "for");
    this.indent--;
    this.emit("}");
  }

  /** A `while` counts up to its bound at the end of the body, so it cannot contain `continue`. */
  private whileLoop(vars: Variable[], depth: number): void {
    const w = this.fresh("loop");
    this.emit(`int ${w} = 0;`);
    this.emit(`while (${w} < ${this.between(1, 5)}) {`);
    this.indent++;
    this.block([...vars, { name: w, kind: "int" }], this.between(1, 3), depth - 1, "while");
    this.emit(`${w}++;`);
    this.indent--;
    this.emit("}");
  }

  private jump(vars: Variable[], loop: "for" | "while"): void {
    const word = loop === "for" ? this.pick(["break", "continue"]) : "break";
    this.emit(`if (${this.boolExpr(vars, 2)}) { ${word}; }`);
  }

  private switchStatement(vars: Variable[], depth: number): void {
    this.emit(`switch (${this.index(vars, 2, 4)}) {`);
    this.indent++;
    for (const value of [0, 1, 2]) {
      if (!this.chance(0.7)) continue;
      this.emit(`case ${value}:`);
      this.indent++;
      this.block(vars, this.between(1, 2), depth - 1, null);
      if (this.chance(0.7)) this.emit("break;");
      this.indent--;
    }
    this.emit("default:");
    this.indent++;
    this.block(vars, 1, depth - 1, null);
    this.indent--;
    this.indent--;
    this.emit("}");
  }

  // ---------- the pieces of a program ----------

  private makeClasses(): void {
    const count = this.between(0, 2);
    for (let i = 0; i < count; i++) {
      const base = this.fresh("Base");
      const sub = this.fresh("Sub");
      const here: Variable[] = [{ name: "x", kind: "int" }, { name: "s", kind: "string" }];
      this.emit(`class ${base} {`);
      this.indent++;
      this.emit("int x;");
      this.emit("string s;");
      this.emit(`${base}(int x, string s) { this.x = x; this.s = s; }`);
      this.emit(`int calc(int d) { return ${this.intExpr([...here, { name: "d", kind: "int" }], 3)}; }`);
      this.emit(`string label() { return ${this.stringExpr(here, 2)}; }`);
      this.emit(`int twice(int d) { return calc(d) + calc(d + 1); }`);
      this.indent--;
      this.emit("}");
      this.emit(`class ${sub} extends ${base} {`);
      this.indent++;
      this.emit(`${sub}(int x, string s) { super(x, s); }`);
      this.emit(`int calc(int d) { return ${this.chance(0.5) ? "super.calc(d) + " : ""}${this.intExpr([...here, { name: "d", kind: "int" }], 2)}; }`);
      if (this.chance(0.5)) this.emit(`string label() { return super.label() + "!" + x; }`);
      this.indent--;
      this.emit("}");
      this.classes.push({ name: base, parent: null, ctorArgs: ["int", "string"] }, { name: sub, parent: base, ctorArgs: ["int", "string"] });
    }
  }

  private makeFunctions(): void {
    const count = this.between(1, 3);
    for (let i = 0; i < count; i++) {
      const kind = this.pick<Kind>(["int", "int", "string"]);
      const name = this.fresh(kind === "int" ? "calc" : "text");
      const params: Kind[] = kind === "int" ? ["int", "int"] : ["int", "string"];
      const vars: Variable[] = params.map((k, j) => ({ name: `p${j}`, kind: k }));
      this.emit(`${kind} ${name}(${params.map((k, j) => `${k} p${j}`).join(", ")}) {`);
      this.indent++;
      this.block(vars, this.between(1, 3), 1, null);
      if (kind === "int" && this.chance(0.4)) this.innerFunction(vars);
      this.emit(`return ${this.expr(kind, vars, 3)};`);
      this.indent--;
      this.emit("}");
      this.functions.push({ name, returns: kind, params });
    }
    if (this.chance(0.5)) {
      const name = this.fresh("rec");
      this.emit(`int ${name}(int n) {`);
      this.emit(`    if (n <= 0) { return ${this.between(0, 5)}; }`);
      this.emit(`    return ${name}(n - 1) * ${this.between(2, 9)} + n;`);
      this.emit("}");
      this.functions.push({ name, returns: "int", params: ["int"] });
    }
  }

  /** A function inside a function, which uses and changes a variable of the one around it. */
  private innerFunction(vars: Variable[]): void {
    const total = this.fresh("acc");
    const inner = this.fresh("inner");
    this.emit(`int ${total} = ${this.intExpr(vars, 1)};`);
    this.emit(`int ${inner}(int z) {`);
    this.emit(`    ${total} += z * ${this.between(1, 9)};`);
    this.emit(`    return ${total} - p0;`);
    this.emit("}");
    vars.push({ name: total, kind: "int" });
    this.emit(`System.out.println(${inner}(${this.intExpr(vars, 1)}), ${inner}(${this.between(0, 9)}), ${total});`);
  }

  program(): string {
    this.makeClasses();
    this.makeFunctions();
    const vars: Variable[] = [];
    this.emit("// generated");
    this.block(vars, this.between(6, 14), 2, null);
    // Whatever was declared is shown at the end, so that a wrong value cannot hide.
    for (const v of vars) {
      if (this.isClass(v.kind)) this.emit(`System.out.println(${v.name}.calc(3), ${v.name}.label(), ${v.name}.twice(2), ${v.name});`);
      else this.emit(`System.out.println(${v.name});`);
    }
    return this.lines.join("\n") + "\n";
  }
}

export function generateProgram(seed: number): string {
  return new Generator(seed).program();
}
