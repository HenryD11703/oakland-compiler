import type { Expr, Func, Global, Import, Local, Module, Signature } from "./ir";
import type { ValType } from "./opcodes";

/**
 * Prints the IR in the text format of WebAssembly (WAT), the form a person reads. It reads the same tree the
 * binary encoder reads, so the text on the page is exactly the module that runs (plan D15).
 */
export function printWat(module: Module): string {
  const lines: string[] = ["(module"];
  const add = (text: readonly string[]): void => {
    for (const line of text) lines.push(`  ${line}`);
  };

  for (const imported of module.imports) add([importText(imported)]);
  if (module.memory !== null) {
    const { min, max } = module.memory;
    add([`(memory (export "memory") ${min}${max === undefined ? "" : ` ${max}`})`]);
  }
  for (const global of module.globals) add([globalText(global)]);
  if (module.table.length > 0) {
    add([`(table ${module.table.length} funcref)`, `(elem (i32.const 0) ${module.table.map((name) => `$${id(name)}`).join(" ")})`]);
  }
  for (const segment of module.data) add([`(data (i32.const ${segment.offset}) "${escapeBytes(segment.bytes)}")`]);
  for (const func of module.functions) add(funcLines(func));
  if (module.start !== undefined) add([`(start $${id(module.start)})`]);
  lines.push(")");
  return `${lines.join("\n")}\n`;
}

/** A name in the text format: `$` and the characters the format allows. */
const id = (name: string): string => name.replace(/[^A-Za-z0-9!#$%&'*+\-./:<=>?@\\^_`|~]/g, "_");

const signatureText = (signature: Signature): string => {
  const parts: string[] = [];
  if (signature.params.length > 0) parts.push(`(param ${signature.params.join(" ")})`);
  if (signature.results.length > 0) parts.push(`(result ${signature.results.join(" ")})`);
  return parts.join(" ");
};

function importText(imported: Import): string {
  const signature = signatureText(imported.signature);
  return `(import "${imported.module}" "${imported.field}" (func $${id(imported.name)}${signature === "" ? "" : ` ${signature}`}))`;
}

function globalText(global: Global): string {
  const type = global.mutable ? `(mut ${global.type})` : global.type;
  const value = global.type === "i32" ? `(i32.const ${global.init})` : `(f64.const ${floatText(global.init)})`;
  const exported = global.export === undefined ? "" : ` (export "${global.export}")`;
  return `(global $${id(global.name)}${exported} ${type} ${value})`;
}

function escapeBytes(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    const printable = byte >= 0x20 && byte < 0x7f && byte !== 0x22 && byte !== 0x5c;
    text += printable ? String.fromCharCode(byte) : `\\${byte.toString(16).padStart(2, "0")}`;
  }
  return text;
}

function floatText(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function localDecl(kind: "param" | "local", local: Local): string {
  return `(${kind} $${id(local.name)} ${local.type})`;
}

function funcLines(func: Func): string[] {
  const parts = [`(func $${id(func.name)}`];
  if (func.export !== undefined) parts.push(`(export "${func.export}")`);
  for (const param of func.params) parts.push(localDecl("param", param));
  if (func.results.length > 0) parts.push(`(result ${func.results.join(" ")})`);
  const lines = [parts.join(" ")];
  if (func.locals.length > 0) lines.push(`  ${func.locals.map((local) => localDecl("local", local)).join(" ")}`);
  for (const expr of func.body) lines.push(...exprLines(expr, 2));
  lines[lines.length - 1] += ")";
  return lines;
}

// ---------- expressions ----------

const WIDTH = 96;

const resultText = (result: ValType | null): string => (result === null ? "" : ` (result ${result})`);
const labelText = (label: string | null): string => (label === null ? "" : ` $${id(label)}`);

/** The first line of an expression: its name and the parts that are not other expressions. */
function head(e: Expr): string {
  switch (e.kind) {
    case "const":
      return `${e.type}.const ${e.type === "i32" ? e.value : floatText(e.value)}`;
    case "local.get":
    case "local.set":
    case "local.tee":
      return `${e.kind} $${id(e.local)}`;
    case "global.get":
    case "global.set":
      return `${e.kind} $${id(e.global)}`;
    case "op":
      return e.op;
    case "load":
    case "store":
      return e.offset === 0 ? e.op : `${e.op} offset=${e.offset}`;
    case "call":
      return `call $${id(e.func)}`;
    case "call_indirect":
      return `call_indirect ${signatureText(e.signature)}`.trimEnd();
    case "block":
    case "loop":
      return `${e.kind}${labelText(e.label)}${resultText(e.result)}`;
    case "if":
      return `if${labelText(e.label)}${resultText(e.result)}`;
    case "br":
      return `br $${id(e.label)}`;
    case "br_if":
      return `br_if $${id(e.label)}`;
    case "br_table":
      return `br_table ${[...e.labels, e.fallback].map((label) => `$${id(label)}`).join(" ")}`;
    case "return":
    case "drop":
    case "select":
    case "memory.size":
    case "memory.grow":
    case "unreachable":
    case "nop":
      return e.kind;
  }
}

/** The operands that are expressions, in the order the text format writes them. */
function operands(e: Expr): readonly Expr[] {
  switch (e.kind) {
    case "local.set":
    case "local.tee":
    case "global.set":
    case "drop":
      return [e.value];
    case "op":
    case "call":
      return e.args;
    case "load":
      return [e.addr];
    case "store":
      return [e.addr, e.value];
    case "call_indirect":
      return [...e.args, e.index];
    case "br_if":
      return [e.cond];
    case "br_table":
      return [e.index];
    case "return":
      return e.value === null ? [] : [e.value];
    case "select":
      return [e.whenTrue, e.whenFalse, e.cond];
    case "memory.grow":
      return [e.delta];
    default:
      return [];
  }
}

/** The whole expression on one line, or null if it has a body (a block, a loop, an if) and so needs several. */
function oneLine(e: Expr): string | null {
  if (e.kind === "block" || e.kind === "loop" || e.kind === "if") return null;
  const parts = [head(e)];
  for (const operand of operands(e)) {
    const text = oneLine(operand);
    if (text === null) return null;
    parts.push(text);
  }
  return `(${parts.join(" ")})`;
}

function exprLines(e: Expr, indent: number): string[] {
  const pad = " ".repeat(indent);
  const flat = oneLine(e);
  if (flat !== null && indent + flat.length <= WIDTH) return [`${pad}${flat}`];

  if (e.kind === "block" || e.kind === "loop") {
    const lines = [`${pad}(${head(e)}`];
    for (const child of e.body) lines.push(...exprLines(child, indent + 2));
    return closeLast(lines);
  }
  if (e.kind === "if") {
    const lines = [`${pad}(${head(e)}`, ...exprLines(e.cond, indent + 2), `${pad}  (then`];
    for (const child of e.then) lines.push(...exprLines(child, indent + 4));
    lines[lines.length - 1] += ")";
    if (e.otherwise !== null) {
      lines.push(`${pad}  (else`);
      for (const child of e.otherwise) lines.push(...exprLines(child, indent + 4));
      lines[lines.length - 1] += ")";
    }
    return closeLast(lines);
  }
  const lines = [`${pad}(${head(e)}`];
  for (const operand of operands(e)) lines.push(...exprLines(operand, indent + 2));
  return closeLast(lines);
}

/** Adds the closing parenthesis to the last line. */
function closeLast(lines: string[]): string[] {
  lines[lines.length - 1] += ")";
  return lines;
}
