import type { Expr, Func, Module, Signature } from "./ir";
import { ByteWriter } from "./bytes";
import { LOADS, OPS, STORES, WASM, type ValType } from "./opcodes";

/** A bug in the compiler (never a mistake in a user's program): the IR names something that does not exist. */
export class EncodeError extends Error {}

/**
 * Turns the IR into the bytes of a WebAssembly module: `\0asm`, a version, then the sections in the order the
 * format asks for. Written by hand, with no library (spec S-21); the engine's own `WebAssembly.validate` is the
 * independent check.
 */
export function encode(module: Module): Uint8Array {
  return new Encoder(module).encode();
}

const signatureKey = (signature: Signature): string => `${signature.params.join(",")}->${signature.results.join(",")}`;

/** The control instructions: the opcodes the format fixes. */
const OP = {
  unreachable: 0x00,
  nop: 0x01,
  block: 0x02,
  loop: 0x03,
  if: 0x04,
  else: 0x05,
  end: 0x0b,
  br: 0x0c,
  brIf: 0x0d,
  brTable: 0x0e,
  return: 0x0f,
  call: 0x10,
  callIndirect: 0x11,
  drop: 0x1a,
  select: 0x1b,
  localGet: 0x20,
  localSet: 0x21,
  localTee: 0x22,
  globalGet: 0x23,
  globalSet: 0x24,
  memorySize: 0x3f,
  memoryGrow: 0x40,
  i32Const: 0x41,
  f64Const: 0x44,
} as const;

class Encoder {
  private readonly types: Signature[] = [];
  private readonly typeIndex = new Map<string, number>();
  private readonly functionIndex = new Map<string, number>();
  private readonly globalIndex = new Map<string, number>();

  constructor(private readonly module: Module) {
    module.imports.forEach((imported, i) => this.define(this.functionIndex, imported.name, i, "function"));
    module.functions.forEach((func, i) => this.define(this.functionIndex, func.name, module.imports.length + i, "function"));
    module.globals.forEach((global, i) => this.define(this.globalIndex, global.name, i, "global"));
    for (const imported of module.imports) this.typeOf(imported.signature);
    for (const func of module.functions) this.typeOf({ params: func.params.map((p) => p.type), results: func.results });
  }

  private define(map: Map<string, number>, name: string, index: number, what: string): void {
    if (map.has(name)) throw new EncodeError(`two ${what}s are named '${name}'`);
    map.set(name, index);
  }

  private typeOf(signature: Signature): number {
    const key = signatureKey(signature);
    const known = this.typeIndex.get(key);
    if (known !== undefined) return known;
    this.types.push(signature);
    this.typeIndex.set(key, this.types.length - 1);
    return this.types.length - 1;
  }

  encode(): Uint8Array {
    const { module } = this;
    const out = new ByteWriter().raw(WASM.magic).raw(WASM.version);
    const s = WASM.section;

    // The bodies are encoded first: a call_indirect names a signature, and the type section must hold it.
    const bodies = module.functions.map((func) => this.body(func));

    out.section(
      s.type,
      new ByteWriter().vec(this.types, (signature, w) => {
        w.u8(WASM.funcType);
        w.vec(signature.params, (type, ww) => ww.u8(WASM.valType[type]));
        w.vec(signature.results, (type, ww) => ww.u8(WASM.valType[type]));
      }),
    );

    if (module.imports.length > 0) {
      out.section(
        s.import,
        new ByteWriter().vec(module.imports, (imported, w) => {
          w.name(imported.module).name(imported.field).u8(0x00).u32(this.typeOf(imported.signature));
        }),
      );
    }

    if (module.functions.length > 0) {
      out.section(
        s.function,
        new ByteWriter().vec(module.functions, (func, w) => w.u32(this.typeOf({ params: func.params.map((p) => p.type), results: func.results }))),
      );
    }

    if (module.table.length > 0) {
      out.section(s.table, new ByteWriter().u32(1).u8(WASM.funcRef).u8(0x00).u32(module.table.length));
    }

    if (module.memory !== null) {
      const { min, max } = module.memory;
      const limits = new ByteWriter();
      if (max === undefined) limits.u8(0x00).u32(min);
      else limits.u8(0x01).u32(min).u32(max);
      out.section(s.memory, new ByteWriter().u32(1).append(limits));
    }

    if (module.globals.length > 0) {
      out.section(
        s.global,
        new ByteWriter().vec(module.globals, (global, w) => {
          w.u8(WASM.valType[global.type]).u8(global.mutable ? 0x01 : 0x00);
          if (global.type === "i32") w.u8(OP.i32Const).i32(global.init);
          else w.u8(OP.f64Const).f64(global.init);
          w.u8(OP.end);
        }),
      );
    }

    const exports: { name: string; kind: number; index: number }[] = [];
    for (const func of module.functions) if (func.export !== undefined) exports.push({ name: func.export, kind: WASM.exportKind.func, index: this.functionOf(func.name) });
    for (const global of module.globals) if (global.export !== undefined) exports.push({ name: global.export, kind: WASM.exportKind.global, index: this.globalOf(global.name) });
    if (module.memory !== null) exports.push({ name: "memory", kind: WASM.exportKind.memory, index: 0 });
    if (exports.length > 0) {
      out.section(s.export, new ByteWriter().vec(exports, (entry, w) => w.name(entry.name).u8(entry.kind).u32(entry.index)));
    }

    if (module.start !== undefined) out.section(s.start, new ByteWriter().u32(this.functionOf(module.start)));

    if (module.table.length > 0) {
      out.section(
        s.element,
        new ByteWriter().u32(1).u8(0x00).u8(OP.i32Const).i32(0).u8(OP.end).vec(module.table, (name, w) => w.u32(this.functionOf(name))),
      );
    }

    out.section(
      s.code,
      new ByteWriter().vec(bodies, (body, w) => w.u32(body.length).append(body)),
    );

    if (module.data.length > 0) {
      out.section(
        s.data,
        new ByteWriter().vec(module.data, (segment, w) => {
          w.u8(0x00).u8(OP.i32Const).i32(segment.offset).u8(OP.end).u32(segment.bytes.length);
          for (const byte of segment.bytes) w.u8(byte);
        }),
      );
    }
    return out.toUint8Array();
  }

  private functionOf(name: string): number {
    const index = this.functionIndex.get(name);
    if (index === undefined) throw new EncodeError(`no function is named '${name}'`);
    return index;
  }

  private globalOf(name: string): number {
    const index = this.globalIndex.get(name);
    if (index === undefined) throw new EncodeError(`no global is named '${name}'`);
    return index;
  }

  // ---------- function bodies ----------

  private body(func: Func): ByteWriter {
    const locals = new Map<string, { index: number; type: ValType }>();
    [...func.params, ...func.locals].forEach((local, index) => {
      if (locals.has(local.name)) throw new EncodeError(`'${func.name}' has two locals named '${local.name}'`);
      locals.set(local.name, { index, type: local.type });
    });

    const w = new ByteWriter();
    // Locals are written as runs of one type: "3 of i32, then 1 of f64".
    const runs: { count: number; type: ValType }[] = [];
    for (const local of func.locals) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last.type === local.type) last.count++;
      else runs.push({ count: 1, type: local.type });
    }
    w.vec(runs, (run, ww) => ww.u32(run.count).u8(WASM.valType[run.type]));

    const labels: (string | null)[] = [];
    for (const expr of func.body) this.expr(expr, w, locals, labels, func.name);
    w.u8(OP.end);
    return w;
  }

  private local(name: string, locals: Map<string, { index: number; type: ValType }>, where: string): number {
    const found = locals.get(name);
    if (found === undefined) throw new EncodeError(`'${where}' uses a local named '${name}' that it does not have`);
    return found.index;
  }

  /** How many blocks out the label `name` is: 0 is the innermost. */
  private depth(name: string, labels: (string | null)[], where: string): number {
    for (let i = labels.length - 1; i >= 0; i--) if (labels[i] === name) return labels.length - 1 - i;
    throw new EncodeError(`'${where}' jumps to a label named '${name}' that is not around it`);
  }

  private blockType(w: ByteWriter, result: ValType | null): void {
    w.u8(result === null ? WASM.empty : WASM.valType[result]);
  }

  private expr(e: Expr, w: ByteWriter, locals: Map<string, { index: number; type: ValType }>, labels: (string | null)[], where: string): void {
    const sub = (child: Expr): void => this.expr(child, w, locals, labels, where);
    const list = (children: readonly Expr[]): void => children.forEach(sub);
    switch (e.kind) {
      case "const":
        if (e.type === "i32") w.u8(OP.i32Const).i32(e.value);
        else w.u8(OP.f64Const).f64(e.value);
        return;
      case "local.get":
        w.u8(OP.localGet).u32(this.local(e.local, locals, where));
        return;
      case "local.set":
        sub(e.value);
        w.u8(OP.localSet).u32(this.local(e.local, locals, where));
        return;
      case "local.tee":
        sub(e.value);
        w.u8(OP.localTee).u32(this.local(e.local, locals, where));
        return;
      case "global.get":
        w.u8(OP.globalGet).u32(this.globalOf(e.global));
        return;
      case "global.set":
        sub(e.value);
        w.u8(OP.globalSet).u32(this.globalOf(e.global));
        return;
      case "op":
        list(e.args);
        w.raw(OPS[e.op].code);
        return;
      case "load": {
        const info = LOADS[e.op];
        sub(e.addr);
        w.u8(info.code).u32(info.align).u32(e.offset);
        return;
      }
      case "store": {
        const info = STORES[e.op];
        sub(e.addr);
        sub(e.value);
        w.u8(info.code).u32(info.align).u32(e.offset);
        return;
      }
      case "call":
        list(e.args);
        w.u8(OP.call).u32(this.functionOf(e.func));
        return;
      case "call_indirect":
        list(e.args);
        sub(e.index);
        w.u8(OP.callIndirect).u32(this.typeOf(e.signature)).u8(0x00);
        return;
      case "block":
      case "loop": {
        w.u8(e.kind === "block" ? OP.block : OP.loop);
        this.blockType(w, e.result);
        labels.push(e.label);
        list(e.body);
        labels.pop();
        w.u8(OP.end);
        return;
      }
      case "if": {
        sub(e.cond);
        w.u8(OP.if);
        this.blockType(w, e.result);
        labels.push(e.label);
        list(e.then);
        if (e.otherwise !== null) {
          w.u8(OP.else);
          list(e.otherwise);
        }
        labels.pop();
        w.u8(OP.end);
        return;
      }
      case "br":
        w.u8(OP.br).u32(this.depth(e.label, labels, where));
        return;
      case "br_if":
        sub(e.cond);
        w.u8(OP.brIf).u32(this.depth(e.label, labels, where));
        return;
      case "br_table":
        sub(e.index);
        w.u8(OP.brTable).vec(e.labels, (label, ww) => ww.u32(this.depth(label, labels, where))).u32(this.depth(e.fallback, labels, where));
        return;
      case "return":
        if (e.value !== null) sub(e.value);
        w.u8(OP.return);
        return;
      case "drop":
        sub(e.value);
        w.u8(OP.drop);
        return;
      case "select":
        sub(e.whenTrue);
        sub(e.whenFalse);
        sub(e.cond);
        w.u8(OP.select);
        return;
      case "memory.size":
        w.u8(OP.memorySize).u8(0x00);
        return;
      case "memory.grow":
        sub(e.delta);
        w.u8(OP.memoryGrow).u8(0x00);
        return;
      case "unreachable":
        w.u8(OP.unreachable);
        return;
      case "nop":
        w.u8(OP.nop);
        return;
    }
  }
}
