import { isArrayType } from "../types";

/** What the checker knows about a built-in function: how many arguments, and a rule for each one. */
export interface BuiltinSignature {
  readonly params: number;
  /** The result type, or a message when the argument cannot be used. Receives the argument types. */
  check(name: string, args: readonly string[]): { readonly type: string } | { readonly error: string };
}

const wantsString = (result: string): BuiltinSignature["check"] => (name, [arg]) => (arg === "string" ? { type: result } : { error: `${name} expects a string, but got ${arg}` });

/** The static counterpart of BUILTINS in interpreter/builtins.ts; the two must name the same functions. */
export const BUILTIN_SIGNATURES: ReadonlyMap<string, BuiltinSignature> = new Map<string, BuiltinSignature>([
  ["parseInt", { params: 1, check: wantsString("int") }],
  ["parseFloat", { params: 1, check: wantsString("float") }],
  ["parsefloat", { params: 1, check: wantsString("float") }],
  [
    "toString",
    {
      params: 1,
      check: (name, [arg]) => (arg === undefined || isArrayType(arg) || arg === "null" ? { error: `${name} cannot convert ${arg} to a string` } : { type: "string" }),
    },
  ],
  ["toLowerCase", { params: 1, check: wantsString("string") }],
  ["toUpperCase", { params: 1, check: wantsString("string") }],
  ["time", { params: 0, check: () => ({ type: "string" }) }],
  [
    "obtenerLongitudArray",
    { params: 1, check: (name, [arg]) => (arg !== undefined && isArrayType(arg) ? { type: "int" } : { error: `${name} expects an array, but got ${arg}` }) },
  ],
]);
