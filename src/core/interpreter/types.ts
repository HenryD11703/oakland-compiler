import type { TypeRef } from "../parser/ast";

/**
 * Types are plain strings, the same strings `typeof` returns:
 * `int`, `float`, `string`, `boolean`, `char`, a struct name (`Person`), or any of those followed by
 * `[]` for each array dimension (`int[]`, `Person[][]`). Three internal names are never written by users:
 * `null` (the type of the literal `null`), `void` (what a void call returns) and `error` (a value that
 * already produced a diagnostic, so that nothing downstream reports it again).
 */
export const PRIMITIVE_NAMES: readonly string[] = ["int", "float", "string", "boolean", "char"];

export function isPrimitive(type: string): boolean {
  return PRIMITIVE_NAMES.includes(type);
}

export function isArrayType(type: string): boolean {
  return type.endsWith("[]");
}

/** `int[][]` -> `int[]` */
export function elementTypeOf(type: string): string {
  return type.slice(0, -2);
}

/** `int[][]` -> `int` */
export function baseTypeOf(type: string): string {
  let base = type;
  while (base.endsWith("[]")) base = base.slice(0, -2);
  return base;
}

export function arrayTypeOf(base: string, dimensions: number): string {
  return base + "[]".repeat(dimensions);
}

export function typeNameOf(ref: TypeRef): string {
  return arrayTypeOf(ref.name, ref.dims);
}

/** char counts as a number in arithmetic, like in Java. */
export function isNumeric(type: string): boolean {
  return type === "int" || type === "float" || type === "char";
}

/**
 * Can a value of type `from` be stored where `to` is expected?
 * Widening only: int and char to float, char to int. `null` can be stored anywhere.
 */
export function isAssignable(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === "null") return to !== "void";
  if (to === "float") return from === "int" || from === "char";
  if (to === "int") return from === "char";
  return false;
}

export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;
