import { elementTypeOf, isArrayType } from "./types";

/** The result of evaluating an expression: a type and the raw JavaScript value (null means OakLand null). */
export interface Value {
  readonly type: string;
  readonly value: unknown;
}

/** A value that already caused a diagnostic. Operations that receive it stay silent and pass it on. */
export const ERROR: Value = { type: "error", value: null };
/** What a call to a void function returns. */
export const VOID: Value = { type: "void", value: null };
export const NULL: Value = { type: "null", value: null };

export const isError = (value: Value): boolean => value.type === "error";

/** Raw items: numbers for int/float, one-character strings for char, strings, booleans, OakArray, OakStruct or null. */
export class OakArray {
  constructor(
    readonly elementType: string,
    readonly items: unknown[],
  ) {}
}

export interface StructField {
  readonly name: string;
  readonly type: string;
}

export class OakStruct {
  constructor(
    readonly name: string,
    readonly fields: readonly StructField[],
    readonly values: Map<string, unknown>,
  ) {}
}

/** What a variable holds before anything is stored in it (`new int[3]` is `{0, 0, 0}`, `int x;` is null). */
export function defaultFor(type: string): unknown {
  switch (type) {
    case "int":
    case "float":
      return 0;
    case "string":
      return "";
    case "boolean":
      return false;
    case "char":
      return "\0";
    default:
      return null;
  }
}

/** Float text like Java's Double.toString: `16.0`, `2.5`, `1.0E7`, `1.234E-5`, `NaN`, `Infinity`. */
export function formatFloat(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
  const magnitude = Math.abs(n);
  if (magnitude >= 1e-3 && magnitude < 1e7) {
    const text = String(n);
    return text.includes(".") ? text : `${text}.0`;
  }
  const [mantissa = "", exponent = "0"] = n.toExponential().split("e");
  return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
}

/** How `System.out.println` and string concatenation show a value. */
export function display(value: unknown, type: string, seen: Set<object> = new Set()): string {
  if (value === null || value === undefined) return "null";
  switch (type) {
    case "int":
    case "boolean":
      return String(value);
    case "float":
      return formatFloat(value as number);
    case "string":
    case "char":
      return value as string;
    case "error":
    case "void":
    case "null":
      return "null";
  }
  if (value instanceof OakArray) {
    if (seen.has(value)) return "[...]";
    seen.add(value);
    const elementType = isArrayType(type) ? elementTypeOf(type) : value.elementType;
    const text = `[${value.items.map((item) => display(item, elementType, seen)).join(", ")}]`;
    seen.delete(value);
    return text;
  }
  if (value instanceof OakStruct) {
    if (seen.has(value)) return `${value.name}{...}`;
    seen.add(value);
    const fields = value.fields.map((f) => `${f.name}: ${display(value.values.get(f.name), f.type, seen)}`);
    seen.delete(value);
    return `${value.name}{${fields.join(", ")}}`;
  }
  return String(value);
}

/** Copies an array and every array inside it. Structs inside are shared, not copied. */
export function deepCopyArray(array: OakArray): OakArray {
  return new OakArray(
    array.elementType,
    array.items.map((item) => (item instanceof OakArray ? deepCopyArray(item) : item)),
  );
}
