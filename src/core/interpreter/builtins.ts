import { INT_MAX, INT_MIN, isArrayType } from "../types";
import { display, ERROR, OakArray, type Value } from "./values";

/** What a built-in may do: report a problem (returns the value to give back) and read the clock. */
export interface BuiltinContext {
  fail(message: string): Value;
  now(): Date;
}

interface Builtin {
  readonly params: number;
  call(context: BuiltinContext, args: readonly Value[], name: string): Value;
}

const text = (value: string): Value => ({ type: "string", value });

function requireString(context: BuiltinContext, name: string, arg: Value): string | null {
  if (arg.type === "string" && arg.value !== null) return arg.value as string;
  context.fail(`${name} expects a string, but got ${arg.type}`);
  return null;
}

const parseInteger: Builtin = {
  params: 1,
  call(context, [arg], name) {
    const source = requireString(context, name, arg as Value);
    if (source === null) return ERROR;
    if (!/^\s*[+-]?\d+(\.\d+)?\s*$/.test(source)) return context.fail(`${name} cannot convert "${source}" to an int`);
    const number = Math.trunc(Number(source));
    if (number < INT_MIN || number > INT_MAX) return context.fail(`${name}: "${source}" does not fit in an int`);
    return { type: "int", value: number };
  },
};

const parseDecimal: Builtin = {
  params: 1,
  call(context, [arg], name) {
    const source = requireString(context, name, arg as Value);
    if (source === null) return ERROR;
    if (!/^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/.test(source)) return context.fail(`${name} cannot convert "${source}" to a float`);
    return { type: "float", value: Number(source) };
  },
};

const toText: Builtin = {
  params: 1,
  call(context, [arg], name) {
    const value = arg as Value;
    if (isArrayType(value.type) || value.type === "null") return context.fail(`${name} cannot convert ${value.type} to a string`);
    return text(display(value.value, value.type));
  },
};

const lower: Builtin = {
  params: 1,
  call(context, [arg], name) {
    const source = requireString(context, name, arg as Value);
    return source === null ? ERROR : text(source.toLowerCase());
  },
};

const upper: Builtin = {
  params: 1,
  call(context, [arg], name) {
    const source = requireString(context, name, arg as Value);
    return source === null ? ERROR : text(source.toUpperCase());
  },
};

const clock: Builtin = {
  params: 0,
  call(context) {
    return text(context.now().toISOString());
  },
};

const arrayLength: Builtin = {
  params: 1,
  call(context, [arg], name) {
    const value = arg as Value;
    if (!isArrayType(value.type)) return context.fail(`${name} expects an array, but got ${value.type}`);
    if (!(value.value instanceof OakArray)) return context.fail(`${name} received null instead of an array`);
    return { type: "int", value: value.value.items.length };
  },
};

/**
 * The functions every program can call. `parsefloat` is the spelling the course sample uses; `parseFloat`
 * is the Java-like one the README documents. Both work.
 */
export const BUILTINS: ReadonlyMap<string, Builtin> = new Map([
  ["parseInt", parseInteger],
  ["parseFloat", parseDecimal],
  ["parsefloat", parseDecimal],
  ["toString", toText],
  ["toLowerCase", lower],
  ["toUpperCase", upper],
  ["time", clock],
  ["obtenerLongitudArray", arrayLength],
]);
