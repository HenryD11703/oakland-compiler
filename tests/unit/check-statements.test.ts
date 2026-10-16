import { describe, expect, it } from "vitest";
import { mistakes, mistakesAt } from "../helpers/check";

describe("a number must have a value before it is read (S-13)", () => {
  const read = (name: string): string => `variable '${name}' is read before it is assigned a value`;

  it("reports reading an int, float, boolean or char that was never assigned", () => {
    expect(mistakes("int n; int m = n;")).toEqual([read("n")]);
    expect(mistakes("float f; System.out.println(f);")).toEqual([read("f")]);
    expect(mistakes("boolean b; if (b) { }")).toEqual([read("b")]);
    expect(mistakes("char c; string s = \"\" + c;")).toEqual([read("c")]);
    expect(mistakes("int n; n++;")).toEqual([read("n")]);
    expect(mistakes("int n; n += 1;")).toEqual([read("n")]);
  });

  it("accepts a number that is assigned first, however it is assigned", () => {
    expect(mistakes("int n; n = 1; int m = n;")).toEqual([]);
    expect(mistakes("int a; int b; a = b = 3; int c = a + b;")).toEqual([]);
    expect(mistakes("int n = 0; n++;")).toEqual([]);
    expect(mistakes("int n; for (n = 0; n < 3; n++) { }")).toEqual([]);
  });

  it("strings, arrays, structs and objects start as null, so they need no assignment", () => {
    expect(mistakes("string s; int[] a; P p; struct P { int x; } System.out.println(s, a, p);")).toEqual([]);
  });

  it("follows an if: both branches must assign", () => {
    expect(mistakes("int n; if (true) { n = 1; } else { n = 2; } int m = n;")).toEqual([]);
    expect(mistakes("int n; boolean b = true; if (b) { n = 1; } int m = n;")).toEqual([read("n")]);
    expect(mistakes("int n; boolean b = true; if (b) { n = 1; } else { } int m = n;")).toEqual([read("n")]);
  });

  it("a branch that leaves (return, break, continue) does not count against the rest", () => {
    expect(mistakes("int f(boolean b) { int n; if (b) { return 1; } else { n = 2; } return n; }")).toEqual([]);
    expect(mistakes("void f(boolean b) { int n; while (true) { if (b) { break; } n = 1; } }")).toEqual([]);
    expect(mistakes("void f(int[] a) { for (int v : a) { int n; if (v > 0) { continue; } n = 1; int m = n; } }")).toEqual([]);
  });

  it("an assignment inside a loop does not count after it", () => {
    expect(mistakes("int n; int i = 0; while (i < 3) { n = 1; i++; } int m = n;")).toEqual([read("n")]);
    expect(mistakes("int n; for (int i = 0; i < 3; i++) { n = i; } int m = n;")).toEqual([read("n")]);
    expect(mistakes("int n; for (int v : new int[2]) { n = v; } int m = n;")).toEqual([read("n")]);
  });

  it("an assignment inside a loop counts inside the same pass", () => {
    expect(mistakes("int i = 0; while (i < 3) { int n; n = i; int m = n; i++; }")).toEqual([]);
  });

  it("follows a switch: it must assign in every case and have a default", () => {
    expect(mistakes("int n; int k = 1; switch (k) { case 1: n = 1; break; default: n = 2; } int m = n;")).toEqual([read("n")]);
    expect(mistakes("int n = 0; int k = 1; switch (k) { case 1: n = 1; break; default: n = 2; } int m = n;")).toEqual([]);
  });

  it("follows the ternary: a value assigned in one side is not certain", () => {
    expect(mistakes("int n; boolean b = true; int x = b ? (n = 1) : 2; int m = n;")).toEqual([read("n")]);
  });

  it("a function does not see the flow of the code that calls it", () => {
    expect(mistakes("int g; void f() { g = 1; } f();")).toEqual([]);
    expect(mistakes("int g = 0; int f() { return g; } g = 1; System.out.println(f());")).toEqual([]);
  });

  it("a number declared in a function must still be assigned there", () => {
    expect(mistakes("int f() { int n; return n; }")).toEqual([read("n")]);
  });

  it("points at the place where the variable is read", () => {
    expect(mistakesAt("int n;\nint m = n + 1;")).toEqual(["2:9 " + read("n")]);
  });
});

describe("a function must return on every path", () => {
  const needs = (name: string, type: string): string => `'${name}' must return a value of type ${type}`;

  it("accepts a function that returns on every path", () => {
    expect(mistakes("int f(boolean b) { if (b) { return 1; } else { return 2; } }")).toEqual([]);
    expect(mistakes("int f() { return 1; }")).toEqual([]);
    expect(mistakes("int f(int n) { if (n < 2) { return n; } return f(n - 1) + f(n - 2); }")).toEqual([]);
    expect(mistakes("int f() { while (true) { } }")).toEqual([]);
    expect(mistakes("int f() { while (true) { return 1; } }")).toEqual([]);
    expect(mistakes("int f(int k) { switch (k) { case 1: return 1; default: return 2; } }")).toEqual([]);
    expect(mistakes("int f() { { return 1; } }")).toEqual([]);
  });

  it("reports a path that ends without a value, at the name of the function", () => {
    expect(mistakes("int f(boolean b) { if (b) { return 1; } }")).toEqual([needs("f", "int")]);
    expect(mistakes("int f() { }")).toEqual([needs("f", "int")]);
    expect(mistakes("string f() { int x = 1; }")).toEqual([needs("f", "string")]);
    expect(mistakes("int f(int k) { switch (k) { case 1: return 1; } }")).toEqual([needs("f", "int")]);
    expect(mistakes("int f(int k) { switch (k) { case 1: return 1; default: break; } }")).toEqual([needs("f", "int")]);
    expect(mistakes("int f() { while (true) { break; } }")).toEqual([needs("f", "int")]);
    expect(mistakes("int f(int[] a) { for (int v : a) { return v; } }")).toEqual([needs("f", "int")]);
    expect(mistakesAt("\nint f() {\n}")).toEqual(["2:5 " + needs("f", "int")]);
  });

  it("a void function needs no return", () => {
    expect(mistakes("void f() { } void g() { return; } void h(boolean b) { if (b) { return; } }")).toEqual([]);
  });

  it("checks what is returned", () => {
    expect(mistakes('int f() { return "x"; }')).toEqual(["'f' must return int, but it returned string"]);
    expect(mistakes("float f() { return 1; }")).toEqual([]);
    expect(mistakes("int f() { return 1.5; }")).toEqual(["'f' must return int, but it returned float"]);
    expect(mistakes("int f() { return; }")).toEqual([needs("f", "int")]);
    expect(mistakes("void f() { return 1; }")).toEqual(["'f' is void and cannot return a value"]);
    expect(mistakes("int[] f() { return null; } string g() { return null; }")).toEqual([]);
  });

  it("a mistake inside a function body is found even if nothing calls the function", () => {
    expect(mistakes("void never() { int x = \"s\"; }")).toEqual(["cannot assign string to int"]);
  });
});

describe("statements", () => {
  it("conditions must be boolean", () => {
    const message = (type: string): string => `the condition must be boolean, but it is ${type}`;
    expect(mistakes("if (1) { }")).toEqual([message("int")]);
    expect(mistakes("while (\"x\") { }")).toEqual([message("string")]);
    expect(mistakes("for (int i = 0; i; i++) { }")).toEqual([message("int")]);
    expect(mistakes("int i = 0; do_nothing(); void do_nothing() { } if (i == 0) { } else if (i) { }")).toEqual([message("int")]);
  });

  it("for-each needs an array and a type the elements fit", () => {
    expect(mistakes("int n = 3; for (int v : n) { }")).toEqual(["a for-each loop needs an array, but this is int"]);
    expect(mistakes('string[] a = {"x"}; for (int v : a) { }')).toEqual(["the loop variable is int, but the elements are string"]);
    expect(mistakes("int[] a = {1}; for (float v : a) { } for (var w : a) { int x = w; }")).toEqual([]);
    expect(mistakes("for (Nope v : new int[1]) { }")).toEqual(["unknown type 'Nope'"]);
  });

  it("switch cases must be comparable with the value", () => {
    expect(mistakes('int k = 1; switch (k) { case "a": break; }')).toEqual(["cannot compare int with string"]);
    expect(mistakes("int k = 1; switch (k) { case 1: break; case 2.0: break; default: break; }")).toEqual([]);
    expect(mistakes('string s = "a"; switch (s) { case "a": break; case "b": break; }')).toEqual([]);
  });

  it("++ and -- need a number", () => {
    expect(mistakes('string s = "x"; s++;')).toEqual(["'++' needs an int or a float, but this is string"]);
    expect(mistakes("boolean b = true; b--;")).toEqual(["'--' needs an int or a float, but this is boolean"]);
    expect(mistakes("int[] a = {1}; a[0]++; P p = P{x: 1}; p.x--; struct P { int x; }")).toEqual([]);
  });

  it("functions and structs can be used before the line that declares them", () => {
    expect(mistakes("int a = twice(3); int twice(int x) { return x * 2; }")).toEqual([]);
    expect(mistakes("P p = P{x: 1}; struct P { int x; }")).toEqual([]);
  });

  it("the parameters of a function are in its scope, and a duplicate is reported", () => {
    expect(mistakes("int f(int a, int b) { return a + b; }")).toEqual([]);
    expect(mistakes("int f(int a, int a) { return a; }")).toEqual(["the parameter 'a' is declared twice"]);
    expect(mistakes("int f(Nope a) { return 1; }")).toEqual(["unknown type 'Nope'"]);
  });

  it("break, continue and return outside their place are reported once", () => {
    expect(mistakes("break;")).toEqual(["'break' is only allowed inside a loop or a switch"]);
    expect(mistakes("continue;")).toEqual(["'continue' is only allowed inside a loop"]);
    expect(mistakes("return;")).toEqual(["'return' is only allowed inside a function"]);
  });

  it("recursion and mutual recursion are accepted", () => {
    expect(mistakes("boolean even(int n) { if (n == 0) { return true; } return odd(n - 1); } boolean odd(int n) { if (n == 0) { return false; } return even(n - 1); }")).toEqual([]);
  });

  it("a function declared in a block belongs to that block", () => {
    expect(mistakes("{ int f() { return 1; } int x = f(); } int y = f();")).toEqual(["function 'f' is not declared"]);
  });
});

