import { describe, expect, it } from "vitest";
import { out, problems, runOak } from "../helpers/run";

describe("functions", () => {
  it("calls functions with and without parameters and results", () => {
    expect(out('void hi() { System.out.println("Hola"); } hi(); int ten() { return 10 + 20; } System.out.println(ten());')).toBe("Hola\n30");
    expect(out('void greet(string n) { System.out.println("Hola " + n); } greet("mundo"); int add(int a, int b) { return a + b; } System.out.println(add(10, 20));')).toBe(
      "Hola mundo\n30",
    );
  });

  it("recurses", () => {
    expect(out("int fact(int n) { if (n == 0) { return 1; } else { return n * fact(n - 1); } } System.out.println(fact(5));")).toBe("120");
    expect(out("int fib(int n) { if (n == 0 || n == 1) { return n; } else { return fib(n - 1) + fib(n - 2); } } System.out.println(fib(10));")).toBe("55");
  });

  it("solves the towers of Hanoi", () => {
    const source = `
      void hanoi(int n, string a, string b, string c) {
        if (n == 1) { System.out.println("Mover disco 1 de", a, "a", c); }
        else { hanoi(n - 1, a, c, b); System.out.println("Mover disco", n, "de", a, "a", c); hanoi(n - 1, b, a, c); }
      }
      hanoi(3, "A", "B", "C");`;
    expect(out(source).split("\n")).toEqual([
      "Mover disco 1 de A a C",
      "Mover disco 2 de A a B",
      "Mover disco 1 de C a B",
      "Mover disco 3 de A a C",
      "Mover disco 1 de B a A",
      "Mover disco 2 de B a C",
      "Mover disco 1 de A a C",
    ]);
  });

  it("can be called before its declaration (AC-13)", () => {
    expect(out("System.out.println(twice(4)); int twice(int n) { return n * 2; }")).toBe("8");
    expect(out("{ System.out.println(inner()); int inner() { return 7; } }")).toBe("7");
  });

  it("supports mutual recursion", () => {
    expect(out("boolean even(int n) { if (n == 0) { return true; } return odd(n - 1); } boolean odd(int n) { if (n == 0) { return false; } return even(n - 1); } System.out.println(even(10), odd(7));")).toBe(
      "true true",
    );
  });

  it("sees globals, and can change them", () => {
    expect(out("int g = 5; int f() { return g; } void set() { g = 7; } System.out.println(f()); set(); System.out.println(g);")).toBe("5\n7");
  });

  it("keeps parameters local", () => {
    expect(out("int x = 1; void f(int x) { x = 9; } f(5); System.out.println(x);")).toBe("1");
  });

  it("closes over the scope it was declared in", () => {
    expect(out("int total(int a, int b) { int c = 10; int inner() { return a + b + c; } return inner(); } System.out.println(total(10, 20));")).toBe("40");
  });

  it("widens int arguments and return values to float", () => {
    expect(out("float half(float x) { return x / 2; } System.out.println(half(5)); float one() { return 1; } System.out.println(one());")).toBe("2.5\n1.0");
  });

  it("returns early from loops", () => {
    expect(out("int firstOver(int[] a, int limit) { for (int v : a) { if (v > limit) { return v; } } return -1; } int[] xs = {1, 5, 9}; System.out.println(firstOver(xs, 3), firstOver(xs, 20));")).toBe(
      "5 -1",
    );
  });

  it("passes arrays by reference", () => {
    expect(out("void f(int[] x) { x[0] = 99; } int[] a = {1}; f(a); System.out.println(a[0]);")).toBe("99");
  });
});

describe("function mistakes (AC-14, AC-15)", () => {
  it("names an unknown function", () => {
    expect(problems("System.out.println(nope(1));")).toEqual(["function 'nope' is not declared"]);
  });

  it("checks the number of arguments", () => {
    expect(problems("int f(int a, int b) { return a + b; } System.out.println(f(1));")).toEqual(["'f' expects 2 arguments but got 1"]);
    expect(problems("int f(int a) { return a; } System.out.println(f(1, 2));")).toEqual(["'f' expects 1 argument but got 2"]);
  });

  it("checks the type of each argument", () => {
    const result = runOak('int f(int x) { return x; } System.out.println(f("a"));');
    expect(result.diagnostics.map((d) => d.message)).toEqual(["argument 1 of 'f' must be int, but it is string"]);
    expect(result.diagnostics[0]?.span.start.column).toBe(49);
    expect(result.stdout).toBe("null\n");
  });

  it("checks the returned type", () => {
    expect(problems("int f() { return 1.5; } System.out.println(f());")).toEqual(["'f' must return int, but it returned float"]);
    expect(problems('string f() { return 1; } f();')).toEqual(["'f' must return string, but it returned int"]);
  });

  it("requires a value from a non-void function", () => {
    expect(problems("int f() { } System.out.println(f());")).toEqual(["'f' must return a value of type int"]);
    expect(problems("int f() { return; } f();")).toEqual(["'f' must return a value of type int"]);
    expect(problems("int f(boolean b) { if (b) { return 1; } } f(false);")).toEqual(["'f' must return a value of type int"]);
  });

  it("does not let a void function return a value or be used as one", () => {
    expect(problems("void f() { return 1; } f();")).toEqual(["'f' is void and cannot return a value"]);
    expect(problems("void f() { } System.out.println(f());")).toEqual(["this call returns no value"]);
    expect(problems("void f() { } int x = f();")).toEqual(["this call returns no value"]);
  });

  it("reports a name that is not a function", () => {
    expect(problems("int x = 1; x(2);")).toEqual(["'x' is a variable, not a function"]);
    expect(problems("int f() { return 1; } System.out.println(f);")).toEqual(["'f' is a function; call it as f(...)"]);
  });

  it("reports a function declared twice in one scope", () => {
    expect(problems("int f() { return 1; } int f() { return 2; }")).toEqual(["'f' is already declared in this scope"]);
  });

  it("reports a repeated parameter name", () => {
    expect(problems("int f(int a, int a) { return a; } f(1, 2);")).toEqual(["the parameter 'a' is declared twice"]);
  });

  it("does not let a body redeclare a parameter", () => {
    expect(problems("int f(int a) { int a = 2; return a; } f(1);")).toEqual(["'a' is already declared in this scope"]);
  });
});

describe("recursion depth (AC-15)", () => {
  it("handles recursion of moderate depth", () => {
    expect(out("int down(int n) { if (n == 0) { return 0; } return 1 + down(n - 1); } System.out.println(down(300));")).toBe("300");
  });

  it("stops runaway recursion with a diagnostic, not a host exception", () => {
    const result = runOak("int f(int n) { return f(n + 1); } System.out.println(f(0)); System.out.println(1);");
    expect(result.diagnostics.map((d) => [d.phase, d.message])).toEqual([
      ["runtime", "stack overflow: more than 400 calls nested inside each other"],
    ]);
    expect(result.stoppedEarly).toBe(true);
  });

  it("survives the deepest allowed recursion", () => {
    const result = runOak("int down(int n) { if (n == 0) { return 0; } return 1 + down(n - 1); } System.out.println(down(399));");
    expect(result.diagnostics).toEqual([]);
    expect(result.stdout).toBe("399\n");
  });
});

describe("built-in functions (AC-16)", () => {
  it("parses numbers", () => {
    expect(out('System.out.println(parseInt("10"), parseInt("10.5123"), parseInt(" -7 "), parseInt("-3.9"));')).toBe("10 10 -7 -3");
    expect(out('System.out.println(parsefloat("10"), parsefloat("10.5"), parseFloat("-2.25"), parseFloat(".5"));')).toBe("10.0 10.5 -2.25 0.5");
  });

  it("reports text that is not a number", () => {
    expect(problems('int x = parseInt("Hola");')).toEqual(['parseInt cannot convert "Hola" to an int']);
    expect(problems('float x = parsefloat("Hola");')).toEqual(['parsefloat cannot convert "Hola" to a float']);
    expect(problems('int x = parseInt("12abc");')).toEqual(['parseInt cannot convert "12abc" to an int']);
    expect(problems('int x = parseInt("99999999999");')).toEqual(['parseInt: "99999999999" does not fit in an int']);
  });

  it("wants a string", () => {
    expect(problems("int x = parseInt(10.5);")).toEqual(["parseInt expects a string, but got float"]);
    expect(problems("string s = toLowerCase(10);")).toEqual(["toLowerCase expects a string, but got int"]);
    expect(problems("string s = toUpperCase(10);")).toEqual(["toUpperCase expects a string, but got int"]);
  });

  it("converts to text", () => {
    expect(out('System.out.println(toString(10), toString(10.5) + toString(10), "php: " + toString(false), toString(2.0), toString(\'c\'));')).toBe(
      "10 10.510 php: false 2.0 c",
    );
  });

  it("changes case", () => {
    expect(out('System.out.println(toLowerCase("HOLA MUNDO"), toUpperCase("hola mundo"));')).toBe("hola mundo HOLA MUNDO");
  });

  it("gives the time as text and the length of an array", () => {
    expect(out("System.out.println(typeof time()); int[] a = {1, 2, 3}; System.out.println(obtenerLongitudArray(a));")).toBe("string\n3");
  });

  it("checks the number of arguments", () => {
    expect(problems("parseInt();")).toEqual(["parseInt expects 1 argument but got 0"]);
    expect(problems("time(1);")).toEqual(["time expects 0 arguments but got 1"]);
  });

  it("can be shadowed by the program", () => {
    expect(out("int toString(int x) { return x + 1; } System.out.println(toString(1));")).toBe("2");
  });
});
