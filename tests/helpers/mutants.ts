import { check } from "../../src/core/check/check";
import type { CompileResult } from "../../src/core/compile/index";
import { encode } from "../../src/core/compile/encode";
import { ir, type Expr, type Func, type Module, type OpName } from "../../src/core/compile/ir";
import { lower } from "../../src/core/compile/lower";
import { printWat } from "../../src/core/compile/wat";
import { parse } from "../../src/core/parser/parser";

/**
 * Deliberately broken compilers, to prove that the differential tests can tell (task T53). Each one is the real compiler
 * with one instruction replaced, in the program and in the runtime functions alike: the kind of slip a real change could make.
 * A broken compiler can make a loop that never ends, so every loop of a mutant spends fuel and traps when it runs out; a
 * program that traps differs from the interpreter, which is what the tests are looking for.
 */
export interface Mutant {
  readonly name: string;
  readonly from: OpName;
  readonly to: OpName;
}

export const MUTANTS: readonly Mutant[] = [
  { name: "an int sum takes the difference", from: "i32.add", to: "i32.sub" },
  { name: "an int product adds", from: "i32.mul", to: "i32.add" },
  { name: "less than is less or equal", from: "i32.lt_s", to: "i32.le_s" },
  { name: "equal is not equal", from: "i32.eq", to: "i32.ne" },
  { name: "a float sum takes the difference", from: "f64.add", to: "f64.sub" },
  { name: "a float product divides", from: "f64.mul", to: "f64.div" },
  { name: "the remainder divides", from: "i32.rem_s", to: "i32.div_s" },
  { name: "greater or equal is greater", from: "i32.ge_s", to: "i32.gt_s" },
];

const mapExpr = (e: Expr, f: (e: Expr) => Expr): Expr => {
  const m = (x: Expr): Expr => mapExpr(x, f);
  const list = (xs: readonly Expr[]): Expr[] => xs.map(m);
  switch (e.kind) {
    case "local.set":
    case "local.tee":
    case "global.set":
    case "drop":
      return f({ ...e, value: m(e.value) });
    case "op":
      return f({ ...e, args: list(e.args) });
    case "load":
      return f({ ...e, addr: m(e.addr) });
    case "store":
      return f({ ...e, addr: m(e.addr), value: m(e.value) });
    case "call":
      return f({ ...e, args: list(e.args) });
    case "call_indirect":
      return f({ ...e, index: m(e.index), args: list(e.args) });
    case "block":
    case "loop":
      return f({ ...e, body: list(e.body) });
    case "if":
      return f({ ...e, cond: m(e.cond), then: list(e.then), otherwise: e.otherwise === null ? null : list(e.otherwise) });
    case "br_if":
      return f({ ...e, cond: m(e.cond) });
    case "br_table":
      return f({ ...e, index: m(e.index) });
    case "return":
      return f({ ...e, value: e.value === null ? null : m(e.value) });
    case "select":
      return f({ ...e, whenTrue: m(e.whenTrue), whenFalse: m(e.whenFalse), cond: m(e.cond) });
    case "memory.grow":
      return f({ ...e, delta: m(e.delta) });
    default:
      return f(e);
  }
};

/** Compiles like `compile()`, but with the mutation applied to the module; null when the program is not one the compiler takes. */
export function compileMutant(source: string, mutant: Mutant): CompileResult | null {
  const parsed = parse(source);
  if (parsed.diagnostics.length > 0) return null;
  const checked = check(parsed.program);
  if (checked.diagnostics.length > 0) return null;
  const lowered = lower(parsed.program, checked);
  if (lowered.diagnostics.length > 0) return null;
  const fuel = (e: Expr): Expr =>
    e.kind === "loop"
      ? { ...e, body: [ir.setGlobal("fuel", ir.op("i32.sub", ir.getGlobal("fuel"), ir.i32(1))), ir.if(ir.op("i32.le_s", ir.getGlobal("fuel"), ir.i32(0)), [ir.unreachable()]), ...e.body] }
      : e;
  const swap = (e: Expr): Expr => (e.kind === "op" && e.op === mutant.from ? { ...e, op: mutant.to } : fuel(e));
  const module: Module = { ...lowered.module, globals: [...lowered.module.globals, { name: "fuel", type: "i32", mutable: true, init: 20_000_000 }], functions: lowered.module.functions.map((fn): Func => ({ ...fn, body: fn.body.map((e) => mapExpr(e, swap)) })) };
  const wasm = encode(module);
  if (!WebAssembly.validate(wasm)) return null;
  return { ok: true, diagnostics: [], wasm, wat: printWat(module), sites: lowered.sites };
}
