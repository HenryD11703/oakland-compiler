import { LOADS, OPS, STORES, type LoadName, type OpName, type StoreName, type ValType } from "./opcodes";

/**
 * The intermediate representation: a WebAssembly module as a tree. Expressions are written "folded", the way
 * the text format allows: `(i32.add (local.get $a) (local.get $b))`, so that lowering a source expression is
 * one function call per node. The binary encoder and the text printer both read this tree, so what the page
 * shows is exactly the module that runs (plan D15).
 *
 * Locals, labels, functions, globals and types are referred to by name; the encoder works out the numbers.
 */

export type { ValType, OpName, LoadName, StoreName } from "./opcodes";

export interface Signature {
  readonly params: readonly ValType[];
  readonly results: readonly ValType[];
}

export type Expr =
  | { readonly kind: "const"; readonly type: ValType; readonly value: number }
  | { readonly kind: "local.get"; readonly local: string }
  | { readonly kind: "local.set"; readonly local: string; readonly value: Expr }
  | { readonly kind: "local.tee"; readonly local: string; readonly value: Expr }
  | { readonly kind: "global.get"; readonly global: string }
  | { readonly kind: "global.set"; readonly global: string; readonly value: Expr }
  | { readonly kind: "op"; readonly op: OpName; readonly args: readonly Expr[] }
  | { readonly kind: "load"; readonly op: LoadName; readonly addr: Expr; readonly offset: number }
  | { readonly kind: "store"; readonly op: StoreName; readonly addr: Expr; readonly value: Expr; readonly offset: number }
  | { readonly kind: "call"; readonly func: string; readonly args: readonly Expr[] }
  | { readonly kind: "call_indirect"; readonly signature: Signature; readonly index: Expr; readonly args: readonly Expr[] }
  | { readonly kind: "block"; readonly label: string; readonly result: ValType | null; readonly body: readonly Expr[] }
  | { readonly kind: "loop"; readonly label: string; readonly result: ValType | null; readonly body: readonly Expr[] }
  | { readonly kind: "if"; readonly label: string | null; readonly result: ValType | null; readonly cond: Expr; readonly then: readonly Expr[]; readonly otherwise: readonly Expr[] | null }
  | { readonly kind: "br"; readonly label: string }
  | { readonly kind: "br_if"; readonly label: string; readonly cond: Expr }
  | { readonly kind: "br_table"; readonly labels: readonly string[]; readonly fallback: string; readonly index: Expr }
  | { readonly kind: "return"; readonly value: Expr | null }
  | { readonly kind: "drop"; readonly value: Expr }
  | { readonly kind: "select"; readonly whenTrue: Expr; readonly whenFalse: Expr; readonly cond: Expr }
  | { readonly kind: "memory.size" }
  | { readonly kind: "memory.grow"; readonly delta: Expr }
  | { readonly kind: "unreachable" }
  | { readonly kind: "nop" };

export interface Local {
  readonly name: string;
  readonly type: ValType;
}

export interface Func {
  readonly name: string;
  readonly params: readonly Local[];
  readonly results: readonly ValType[];
  /** Locals beyond the parameters. */
  readonly locals: readonly Local[];
  readonly body: readonly Expr[];
  /** The name the host sees, if the function is exported. */
  readonly export?: string;
}

export interface Import {
  readonly module: string;
  readonly field: string;
  /** The name the module's own code calls it by. */
  readonly name: string;
  readonly signature: Signature;
}

export interface Global {
  readonly name: string;
  readonly type: ValType;
  readonly mutable: boolean;
  readonly init: number;
  readonly export?: string;
}

export interface DataSegment {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export interface Module {
  readonly imports: readonly Import[];
  readonly functions: readonly Func[];
  /** Pages of 64 KiB: the memory starts at `min` and may grow to `max`. Exported as `memory`. */
  readonly memory: { readonly min: number; readonly max?: number } | null;
  readonly globals: readonly Global[];
  /** The functions `call_indirect` can reach, by position. */
  readonly table: readonly string[];
  readonly data: readonly DataSegment[];
  /** A function to run when the module is created. */
  readonly start?: string;
}

// ---------- building ----------

/** The builders. Each makes one node; the ones that take operands check how many an instruction needs. */
export const ir = {
  i32: (value: number): Expr => ({ kind: "const", type: "i32", value: value | 0 }),
  f64: (value: number): Expr => ({ kind: "const", type: "f64", value }),
  get: (local: string): Expr => ({ kind: "local.get", local }),
  set: (local: string, value: Expr): Expr => ({ kind: "local.set", local, value }),
  tee: (local: string, value: Expr): Expr => ({ kind: "local.tee", local, value }),
  getGlobal: (global: string): Expr => ({ kind: "global.get", global }),
  setGlobal: (global: string, value: Expr): Expr => ({ kind: "global.set", global, value }),
  op(name: OpName, ...args: Expr[]): Expr {
    const info = OPS[name];
    if (args.length !== info.params.length) throw new Error(`${name} takes ${info.params.length} operands, not ${args.length}`);
    return { kind: "op", op: name, args };
  },
  load: (op: LoadName, addr: Expr, offset = 0): Expr => ({ kind: "load", op, addr, offset }),
  store: (op: StoreName, addr: Expr, value: Expr, offset = 0): Expr => ({ kind: "store", op, addr, value, offset }),
  call: (func: string, ...args: Expr[]): Expr => ({ kind: "call", func, args }),
  callIndirect: (signature: Signature, index: Expr, ...args: Expr[]): Expr => ({ kind: "call_indirect", signature, index, args }),
  block: (label: string, body: readonly Expr[], result: ValType | null = null): Expr => ({ kind: "block", label, result, body }),
  loop: (label: string, body: readonly Expr[], result: ValType | null = null): Expr => ({ kind: "loop", label, result, body }),
  if: (cond: Expr, then: readonly Expr[], otherwise: readonly Expr[] | null = null, result: ValType | null = null, label: string | null = null): Expr => ({
    kind: "if",
    label,
    result,
    cond,
    then,
    otherwise,
  }),
  br: (label: string): Expr => ({ kind: "br", label }),
  brIf: (label: string, cond: Expr): Expr => ({ kind: "br_if", label, cond }),
  brTable: (labels: readonly string[], fallback: string, index: Expr): Expr => ({ kind: "br_table", labels, fallback, index }),
  return: (value: Expr | null = null): Expr => ({ kind: "return", value }),
  drop: (value: Expr): Expr => ({ kind: "drop", value }),
  select: (whenTrue: Expr, whenFalse: Expr, cond: Expr): Expr => ({ kind: "select", whenTrue, whenFalse, cond }),
  memorySize: (): Expr => ({ kind: "memory.size" }),
  memoryGrow: (delta: Expr): Expr => ({ kind: "memory.grow", delta }),
  unreachable: (): Expr => ({ kind: "unreachable" }),
  nop: (): Expr => ({ kind: "nop" }),
};

/** The empty module, to build on. */
export const emptyModule: Module = { imports: [], functions: [], memory: null, globals: [], table: [], data: [] };

export const isLoad = (name: string): name is LoadName => name in LOADS;
export const isStore = (name: string): name is StoreName => name in STORES;
