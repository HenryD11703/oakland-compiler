import { describe, expect, it } from "vitest";
import { mistakes, mistakesAt, typeOf } from "../helpers/check";

const PRELUDE = `
int i = 1; float f = 2.5; string s = "x"; char c = 'a'; boolean b = true;
int[] ia = {1, 2}; float[] fa = {1.5}; string[] sa = {"a"}; int[][] m = {{1, 2}, {3, 4}};
struct P { string name; int age; P friend; }
P p = P{name: "Ana", age: 3};
class Animal { string name; Animal(string n) { name = n; } string sound() { return "..."; } }
class Dog extends Animal { Dog() { super("d"); } string sound() { return "Woof"; } void bark() { } }
Animal an = new Dog(); Dog dg = new Dog();
int twice(int x) { return x * 2; }
void nothing() { }
`;

describe("the static type of an expression (S-12, S-14)", () => {
  const cases: [string, string][] = [
    // literals
    ["1", "int"], ["2.5", "float"], ['"t"', "string"], ["'z'", "char"], ["true", "boolean"], ["null", "null"],
    // arithmetic
    ["i + i", "int"], ["i + f", "float"], ["f * f", "float"], ["c + 1", "int"], ["c + c", "int"], ["c + f", "float"],
    ["i / i", "int"], ["i % 3", "int"], ["f % 2", "float"], ["-i", "int"], ["-f", "float"], ["-c", "int"],
    ["(i + 1) * 2", "int"], ["-2147483648", "int"],
    // strings
    ['s + 1', "string"], ['1 + s', "string"], ['s + f + c + b', "string"], ['s + null', "string"], ['s + ia', "string"], ['s + p', "string"],
    // comparisons and logic
    ["i < f", "boolean"], ["c >= i", "boolean"], ['s < "y"', "boolean"], ["i == f", "boolean"], ["s == s", "boolean"],
    ["b && !b", "boolean"], ["b || b", "boolean"], ["i != c", "boolean"], ["b == b", "boolean"],
    ["p == null", "boolean"], ["null == ia", "boolean"], ["s == null", "boolean"], ["an == dg", "boolean"], ["dg == an", "boolean"],
    ["ia == ia", "boolean"], ["p == p", "boolean"],
    // ternary: one static type (S-14)
    ["b ? 1 : 2", "int"], ["b ? 1 : 2.5", "float"], ["b ? 2.5 : 1", "float"], ["b ? c : i", "int"], ['b ? "a" : "b"', "string"],
    ["b ? s : null", "string"], ["b ? null : p", "P"], ["b ? dg : an", "Animal"], ["b ? an : dg", "Animal"],
    // arrays
    ["ia[0]", "int"], ["m[1]", "int[]"], ["m[1][0]", "int"], ["fa[0] + 1", "float"], ["ia.length", "int"], ["m.length", "int"],
    ["ia.join()", "string"], ["ia.indexOf(2)", "int"], ["sa.indexOf(\"a\")", "int"], ["fa.indexOf(1)", "int"],
    ["new int[3]", "int[]"], ["new float[2][3]", "float[][]"], ["new P[2]", "P[]"], ["new Dog[1][1]", "Dog[][]"],
    // structs
    ["p.name", "string"], ["p.age + 1", "int"], ["p.friend", "P"], ['P{name: "z"}', "P"], ["P{}", "P"],
    // typeof, assignment, calls, built-ins
    ["typeof i", "string"], ["typeof p", "string"],
    ["i = 3", "int"], ["f = i", "float"], ["f = c", "float"], ["i = c", "int"], ["s = null", "string"], ["i += 2", "int"], ["f -= 1", "float"],
    ["s += 1", "string"], ["an = dg", "Animal"], ["p.age = 5", "int"], ["ia[0] = 9", "int"],
    ["twice(i)", "int"], ["twice(c)", "int"], ["parseInt(s)", "int"], ["parseFloat(s)", "float"], ["parsefloat(s)", "float"],
    ["toString(i)", "string"], ["toString(p)", "string"], ["toLowerCase(s)", "string"], ["toUpperCase(s)", "string"], ["time()", "string"],
    ["obtenerLongitudArray(ia)", "int"],
    // classes
    ["new Dog()", "Dog"], ['new Animal("a")', "Animal"], ["an.name", "string"], ["an.sound()", "string"], ["dg.sound()", "string"],
    ["dg.name", "string"],
  ];
  it.each(cases)("%s is %s", (expression, expected) => {
    expect(typeOf(expression, PRELUDE)).toBe(expected);
  });

  it("a void call is allowed as a statement, with no type of its own", () => {
    expect(mistakes(`${PRELUDE}\nnothing();\ndg.bark();`)).toEqual([]);
  });
});

describe("the mistakes in expressions are named, with the message of the interpreter", () => {
  const cases: [string, string][] = [
    ["i + b", "cannot apply '+' to int and boolean"],
    ["b * 2", "cannot apply '*' to boolean and int"],
    ["s - 1", "cannot apply '-' to string and int"],
    ["s < 1", "cannot apply '<' to string and int"],
    ["i + null", "cannot apply '+' to null"],
    ["null * 2", "cannot apply '*' to null"],
    ["!i", "cannot apply '!' to int"],
    ["-s", "cannot apply '-' to string"],
    ["-b", "cannot apply '-' to boolean"],
    ["i && b", "cannot apply '&&' to int"],
    ["b || i", "cannot apply '||' to int"],
    ["i == s", "cannot compare int with string"],
    ["b == i", "cannot compare boolean with int"],
    ["i == null", "cannot compare int with null"],
    ["p == ia", "cannot compare P with int[]"],
    ["p == an", "cannot compare P with Animal"],
    ["ia == fa", "cannot compare int[] with float[]"],
    ["ia[b]", "an array index must be an int, but it is boolean"],
    ["ia[1.5]", "an array index must be an int, but it is float"],
    ["i[0]", "cannot index a value of type int"],
    ["ia.size", "arrays have no member 'size' (they have length, indexOf and join)"],
    ["ia.push(1)", "arrays have no method 'push' (they have length, indexOf and join)"],
    ['ia.indexOf("a")', "indexOf needs a int, but got string"],
    ["ia.join(1)", "join expects no arguments"],
    ["ia.indexOf()", "indexOf expects 1 argument"],
    ["p.weight", "struct 'P' has no field 'weight'"],
    ["i.x", "a value of type int has no member 'x'"],
    ["i.f()", "a value of type int has no method 'f'"],
    ['P{name: 1}', "the field 'name' of 'P' must be string, but it is int"],
    ["P{zzz: 1}", "struct 'P' has no field 'zzz'"],
    ['P{name: "a", name: "b"}', "the field 'name' is given twice"],
    ["new int[b]", "an array size must be an int, but it is boolean"],
    ["new Nope[2]", "unknown type 'Nope'"],
    ["twice()", "'twice' expects 1 argument but got 0"],
    ["twice(1, 2)", "'twice' expects 1 argument but got 2"],
    ['twice("a")', "argument 1 of 'twice' must be int, but it is string"],
    ["twice(1.5)", "argument 1 of 'twice' must be int, but it is float"],
    ["nothing() + 1", "this call returns no value"],
    ["unknown(1)", "function 'unknown' is not declared"],
    ["undeclared + 1", "variable 'undeclared' is not declared"],
    ["P(1)", "'P' is a struct, not a function"],
    ["twice", "'twice' is a function; call it as twice(...)"],
    ["i = s", "cannot assign string to int"],
    ["i = f", "cannot assign float to int"],
    ["i += 1.5", "cannot assign float to int"],
    ["s = 1", "cannot assign int to string"],
    ["dg = an", "cannot assign Animal to Dog"],
    ["b = 1", "cannot assign int to boolean"],
    ["p.age = s", "cannot assign string to int"],
    ["ia[0] = s", "cannot assign string to int"],
    ["parseInt(1)", "parseInt expects a string, but got int"],
    ["parseInt()", "parseInt expects 1 argument but got 0"],
    ["toString(ia)", "toString cannot convert int[] to a string"],
    ["toString(null)", "toString cannot convert null to a string"],
    ["toLowerCase(1)", "toLowerCase expects a string, but got int"],
    ["obtenerLongitudArray(i)", "obtenerLongitudArray expects an array, but got int"],
    ["time(1)", "time expects 0 arguments but got 1"],
    ["b ? 1 : s", "the two sides of ?: must have the same type, but they are int and string"],
    ["b ? p : an", "the two sides of ?: must have the same type, but they are P and Animal"],
    ["i ? 1 : 2", "the condition must be boolean, but it is int"],
    ["2147483648", "the number 2147483648 is too large for an int"],
    ["this", "'this' can only be used inside a method or a constructor of a class"],
  ];
  it.each(cases)("%s", (expression, message) => {
    expect(mistakes(`${PRELUDE}\n${expression};`)).toContain(message);
  });

  it("reports an error once and does not cascade it into the expression around it", () => {
    expect(mistakes(`${PRELUDE}\nint x = (undeclared + 1) * 2 - 3 + i;`)).toEqual(["variable 'undeclared' is not declared"]);
    expect(mistakes(`${PRELUDE}\nint y = twice(nothing2()) + 1;`)).toEqual(["function 'nothing2' is not declared"]);
    expect(mistakes(`${PRELUDE}\nint z = ia[s] + 1;`)).toEqual(["an array index must be an int, but it is string"]);
  });

  it("points at the place of the mistake", () => {
    expect(mistakesAt("int a = 1;\nstring s = a + 1;\nint b = s * 2;")).toEqual([
      "2:12 cannot assign int to string",
      "3:9 cannot apply '*' to string and int",
    ]);
    expect(mistakesAt("int[] a = {1, 2};\nint x = a[true];")).toEqual(["2:11 an array index must be an int, but it is boolean"]);
  });
});

describe("declarations and initial values", () => {
  it("accepts the ways of declaring a variable", () => {
    expect(mistakes("int a = 1; var b = 2.5; string c = \"s\"; int[] d = {1, 2}; int[][] e = {{1}, {2, 3}}; int[] f = new int[2]; P g; struct P { int x; }")).toEqual([]);
  });

  it("var takes the type of its value", () => {
    expect(mistakes("var a = 1; var b = a + 0.5; int c = a; float d = b; string s = a;")).toEqual(["cannot assign int to string"]);
  });

  it("reports what cannot be declared", () => {
    expect(mistakes("var a = null;")).toEqual(["cannot infer the type of 'a' from null"]);
    expect(mistakes("Nope n;")).toEqual(["unknown type 'Nope'"]);
    expect(mistakes("int a = 1; int a = 2;")).toEqual(["'a' is already declared in this scope"]);
    expect(mistakes("int a = {1, 2};")).toEqual(["cannot use a list of values for type int"]);
    expect(mistakes("int[] a = {1, \"x\"};")).toEqual(["element 2 must be int, but it is string"]);
    expect(mistakes("int[] a = {{1}};")).toEqual(["element 1 cannot be a list of values: the elements are int"]);
    expect(mistakes("float x = 1; int y = x;")).toEqual(["cannot assign float to int"]);
  });

  it("a shadowing variable in an inner block is not a duplicate", () => {
    expect(mistakes("int a = 1; { int a = 2; a++; } a++;")).toEqual([]);
  });

  it("names are shared by variables, functions, structs and classes", () => {
    expect(mistakes("int a = 1; void a() { }")).toEqual(["'a' is already declared in this scope"]);
    expect(mistakes("struct S { int x; } class S { }")).toEqual(["'S' is already declared in this scope"]);
  });

  it("structs: duplicate fields and unknown field types", () => {
    expect(mistakes("struct S { int x; string x; }")).toEqual(["struct 'S' already has a field named 'x'"]);
    expect(mistakes("struct S { Nope n; }")).toEqual(["unknown type 'Nope'"]);
  });

  it("a struct may name a struct declared further down", () => {
    expect(mistakes("struct A { B b; } struct B { int x; } A a = A{}; int y = a.b.x;")).toEqual([]);
  });
});
