import { describe, expect, it } from "vitest";
import { arrayTypeOf, baseTypeOf, elementTypeOf, isArrayType, isAssignable, isNumeric } from "../../src/core/interpreter/types";
import { deepCopyArray, defaultFor, display, formatFloat, OakArray, OakStruct } from "../../src/core/interpreter/values";

describe("float text, like Java (AC-02)", () => {
  it.each([
    [16, "16.0"],
    [2.5, "2.5"],
    [0, "0.0"],
    [-10.5, "-10.5"],
    [0.1 + 0.2, "0.30000000000000004"],
    [1.9090909090909092, "1.9090909090909092"],
    [100, "100.0"],
    [1234567.0, "1234567.0"],
    [0.001, "0.001"],
    [1e7, "1.0E7"],
    [12345678.9, "1.23456789E7"],
    [0.0001, "1.0E-4"],
    [1.234e-5, "1.234E-5"],
    [1e21, "1.0E21"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [-0, "-0.0"],
  ])("%s prints as %s", (n, expected) => {
    expect(formatFloat(n)).toBe(expected);
  });
});

describe("type helpers", () => {
  it("builds and takes apart array types", () => {
    expect(arrayTypeOf("int", 2)).toBe("int[][]");
    expect(elementTypeOf("int[][]")).toBe("int[]");
    expect(baseTypeOf("Person[][]")).toBe("Person");
    expect(isArrayType("int[]")).toBe(true);
    expect(isArrayType("int")).toBe(false);
  });

  it("allows only widening conversions", () => {
    expect(isAssignable("int", "float")).toBe(true);
    expect(isAssignable("char", "int")).toBe(true);
    expect(isAssignable("char", "float")).toBe(true);
    expect(isAssignable("float", "int")).toBe(false);
    expect(isAssignable("int", "char")).toBe(false);
    expect(isAssignable("string", "char")).toBe(false);
    expect(isAssignable("boolean", "int")).toBe(false);
    expect(isAssignable("int[]", "float[]")).toBe(false);
    expect(isAssignable("null", "Person")).toBe(true);
    expect(isAssignable("null", "int")).toBe(true);
    expect(isAssignable("Person", "Pet")).toBe(false);
  });

  it("treats char as a number", () => {
    expect(isNumeric("char")).toBe(true);
    expect(isNumeric("string")).toBe(false);
  });
});

describe("display", () => {
  it("shows primitives and null", () => {
    expect(display(10, "int")).toBe("10");
    expect(display(10, "float")).toBe("10.0");
    expect(display("a", "char")).toBe("a");
    expect(display("hi", "string")).toBe("hi");
    expect(display(true, "boolean")).toBe("true");
    expect(display(null, "int")).toBe("null");
    expect(display(null, "error")).toBe("null");
  });

  it("shows arrays, nested arrays and structs", () => {
    const row = (...n: number[]) => new OakArray("int", n);
    expect(display(row(1, 2, 3), "int[]")).toBe("[1, 2, 3]");
    expect(display(new OakArray("int[]", [row(1, 2), row(3)]), "int[][]")).toBe("[[1, 2], [3]]");
    expect(display(new OakArray("float", [1, 2.5]), "float[]")).toBe("[1.0, 2.5]");
    expect(display(new OakArray("string", ["x", "y"]), "string[]")).toBe("[x, y]");
    const fields = [{ name: "name", type: "string" }, { name: "age", type: "int" }];
    const person = new OakStruct("Person", fields, new Map<string, unknown>([["name", "Ana"], ["age", 20]]));
    expect(display(person, "Person")).toBe("Person{name: Ana, age: 20}");
  });

  it("does not loop forever on a struct that contains itself", () => {
    const node = new OakStruct("Node", [{ name: "next", type: "Node" }], new Map<string, unknown>());
    node.values.set("next", node);
    expect(display(node, "Node")).toBe("Node{next: Node{...}}");
  });
});

describe("defaults and copies", () => {
  it("has a default for each type", () => {
    expect(defaultFor("int")).toBe(0);
    expect(defaultFor("float")).toBe(0);
    expect(defaultFor("string")).toBe("");
    expect(defaultFor("boolean")).toBe(false);
    expect(defaultFor("char")).toBe("\0");
    expect(defaultFor("int[]")).toBeNull();
    expect(defaultFor("Person")).toBeNull();
  });

  it("copies nested arrays all the way down", () => {
    const inner = new OakArray("int", [1, 2]);
    const outer = new OakArray("int[]", [inner]);
    const copy = deepCopyArray(outer);
    inner.items[0] = 99;
    expect(((copy.items[0] as OakArray).items)[0]).toBe(1);
  });
});
